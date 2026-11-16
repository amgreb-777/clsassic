-- Об'єднання дубля продукту з основним: техкарти переводяться на основний продукт.
-- Якщо в страві вже є основний продукт з тією ж одиницею — кількості сумуються.
create function public.merge_products(p_keep bigint, p_dup bigint)
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_keep = p_dup then
    raise exception 'SAME_PRODUCT';
  end if;
  if not exists (select 1 from public.products where id = p_keep)
     or not exists (select 1 from public.products where id = p_dup) then
    raise exception 'NOT_FOUND';
  end if;

  update public.dish_ingredients k
     set gross = k.gross + d.gross, net = k.net + d.net
    from public.dish_ingredients d
   where d.product_id = p_dup and k.product_id = p_keep and k.dish_id = d.dish_id and k.unit = d.unit;

  delete from public.dish_ingredients d
   using public.dish_ingredients k
   where d.product_id = p_dup and k.product_id = p_keep and k.dish_id = d.dish_id and k.unit = d.unit;

  update public.dish_ingredients set product_id = p_keep where product_id = p_dup;

  update public.products k
     set category = coalesce(k.category, d.category)
    from public.products d
   where k.id = p_keep and d.id = p_dup;

  delete from public.products where id = p_dup;
end $$;

revoke all on function public.merge_products(bigint, bigint) from public, anon;
grant execute on function public.merge_products(bigint, bigint) to authenticated;
