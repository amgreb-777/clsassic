-- Ціни продуктів і собівартість страв.
-- price_kg  — грн за 1 кг (для рідин — за 1 л), price_pcs — грн за 1 шт.
-- Вартість рахується від БРУТТО (те, що треба купити, з відходами):
--   'г'  → брутто(г) / 1000 × price_kg
--   'шт' → брутто(шт) × price_pcs, а якщо ціни за штуку немає — нетто(г) / 1000 × price_kg
--   'л'  → брутто(л) × price_kg
alter table public.products
  add column price_kg     numeric(12,2) check (price_kg is null or price_kg >= 0),
  add column price_pcs    numeric(12,2) check (price_pcs is null or price_pcs >= 0),
  add column price_source text,  -- магазин: «Сільпо», «Novus», …
  add column price_item   text,  -- назва товару в магазині
  add column price_pack   text,  -- фасування, напр. «400г», «10 шт», «кг»
  add column price_url    text,
  add column price_note   text,
  add column price_at     date;  -- дата збору ціни

create function public.ingredient_cost(p_unit text, p_gross numeric, p_net numeric, p_price_kg numeric, p_price_pcs numeric)
returns numeric
language sql immutable set search_path = '' as $$
  select case
    when p_unit = 'шт' then coalesce(p_gross * p_price_pcs, p_net / 1000 * p_price_kg)
    when p_unit = 'л'  then p_gross * p_price_kg
    else p_gross / 1000 * p_price_kg
  end
$$;

-- Собівартість 1 порції за техкартою
create view public.dish_cost with (security_invoker = true) as
select d.id as dish_id,
       round(coalesce(sum(public.ingredient_cost(i.unit, i.gross, i.net, p.price_kg, p.price_pcs)), 0), 2) as cost,
       (count(i.id) filter (where public.ingredient_cost(i.unit, i.gross, i.net, p.price_kg, p.price_pcs) is null))::int as missing,
       min(p.price_at) as price_from,
       max(p.price_at) as price_to
from public.dishes d
left join public.dish_ingredients i on i.dish_id = d.id
left join public.products p on p.id = i.product_id
group by d.id;

grant select on public.dish_cost to authenticated;
grant execute on function public.ingredient_cost(text, numeric, numeric, numeric, numeric) to authenticated;
revoke select on public.dish_cost from anon;
revoke all on function public.ingredient_cost(text, numeric, numeric, numeric, numeric) from public, anon;
