-- Атомарне збереження складу страви з UI: продукти створюються за назвою, якщо їх ще немає
create function public.save_dish_ingredients(p_dish_id bigint, p_items jsonb)
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.products(name)
    select distinct trim(x->>'product')
    from jsonb_array_elements(p_items) x
    where length(trim(coalesce(x->>'product', ''))) > 0
  on conflict (name) do nothing;

  delete from public.dish_ingredients where dish_id = p_dish_id;

  insert into public.dish_ingredients(dish_id, product_id, gross, net, unit, position)
    select p_dish_id, p.id,
           sum(coalesce((x->>'gross')::numeric, 0)),
           sum(coalesce((x->>'net')::numeric, 0)),
           coalesce(nullif(x->>'unit', ''), 'г'),
           min(ord)::int
    from jsonb_array_elements(p_items) with ordinality as t(x, ord)
    join public.products p on p.name = trim(x->>'product')
    group by p.id, coalesce(nullif(x->>'unit', ''), 'г');
end $$;

revoke all on function public.save_dish_ingredients(bigint, jsonb) from public, anon;
grant execute on function public.save_dish_ingredients(bigint, jsonb) to authenticated;
