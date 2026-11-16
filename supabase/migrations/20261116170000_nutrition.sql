-- Харчова цінність: КБЖВ на 100 г їстівної частини продукту
alter table public.products
  add column kcal    numeric(7,2) check (kcal is null or kcal >= 0),
  add column protein numeric(6,2) check (protein is null or protein >= 0),
  add column fat     numeric(6,2) check (fat is null or fat >= 0),
  add column carbs   numeric(6,2) check (carbs is null or carbs >= 0);

-- Вага, від якої рахуємо КБЖВ (г): для «г» — менша з брутто/нетто (їстівна частина;
-- для круп/бобових нетто — вага після варіння, тож беремо суху вагу), для «шт»/«л» — нетто в грамах.
create function public.ingredient_grams(p_unit text, p_gross numeric, p_net numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_unit = 'г' then least(p_gross, p_net) else p_net end
$$;

-- КБЖВ на 1 порцію страви
create view public.dish_nutrition with (security_invoker = true) as
select d.id as dish_id,
       round(coalesce(sum(public.ingredient_grams(i.unit, i.gross, i.net) * p.kcal / 100), 0), 1)    as kcal,
       round(coalesce(sum(public.ingredient_grams(i.unit, i.gross, i.net) * p.protein / 100), 0), 1) as protein,
       round(coalesce(sum(public.ingredient_grams(i.unit, i.gross, i.net) * p.fat / 100), 0), 1)     as fat,
       round(coalesce(sum(public.ingredient_grams(i.unit, i.gross, i.net) * p.carbs / 100), 0), 1)   as carbs,
       count(i.id) filter (where p.kcal is null)::int as missing
from public.dishes d
left join public.dish_ingredients i on i.dish_id = d.id
left join public.products p on p.id = i.product_id
group by d.id;

-- КБЖВ замовлення: по стравах (на порцію і на всю кількість)
create function public.order_nutrition(p_order_id bigint)
returns table (dish_id bigint, quantity numeric, kcal numeric, protein numeric, fat numeric, carbs numeric, missing int)
language sql stable security invoker set search_path = '' as $$
  select oi.dish_id, oi.quantity, n.kcal, n.protein, n.fat, n.carbs, n.missing
  from public.order_items oi
  join public.dish_nutrition n on n.dish_id = oi.dish_id
  where oi.order_id = p_order_id
$$;

revoke select on public.dish_nutrition from anon;
revoke all on function public.order_nutrition(bigint) from public, anon;
grant execute on function public.order_nutrition(bigint) to authenticated;
