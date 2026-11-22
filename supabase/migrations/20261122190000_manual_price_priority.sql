-- Ручна ціна (store = 'Вручну') має перевагу над усіма магазинами; дата внесення — collected_at.
create or replace function public.apply_price_store(p_store text, p_fallback boolean default true)
returns int
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_team_admin() then
    raise exception 'Змінювати джерело цін може лише адміністратор';
  end if;
  if p_store = 'Середня' then
    update public.products p
       set price_kg = a.kg, price_pcs = a.pcs, price_source = case when a.n > 0 then 'Середня' end,
           price_item = case when a.n > 0 then 'середня з ' || a.n || ' магаз.: ' || a.stores end,
           price_pack = null, price_url = null, price_note = null, price_at = a.at
      from (select p2.id,
                   round(avg(pp.price_kg), 2) as kg, round(avg(pp.price_pcs), 2) as pcs,
                   count(pp.store) filter (where pp.price_kg is not null or pp.price_pcs is not null) as n,
                   string_agg(pp.store, ', ' order by pp.store) as stores, max(pp.collected_at) as at
              from public.products p2
              left join public.product_prices pp on pp.product_id = p2.id and pp.store <> 'Вручну'
             group by p2.id) a
     where a.id = p.id;
  else
    if not exists (select 1 from public.product_prices where store = p_store) then
      raise exception 'Немає цін для магазину «%»', p_store;
    end if;
    update public.products p
       set price_kg = pp.price_kg, price_pcs = pp.price_pcs, price_source = pp.store,
           price_item = pp.item, price_pack = pp.pack, price_url = pp.url, price_note = pp.note, price_at = pp.collected_at
      from (select p2.id, x.store, x.price_kg, x.price_pcs, x.item, x.pack, x.url, x.note, x.collected_at
              from public.products p2
              left join public.product_prices x on x.product_id = p2.id and x.store = p_store) pp
     where pp.id = p.id;

    if p_fallback and p_store <> 'Вручну' then
      update public.products p
         set price_kg = f.price_kg, price_pcs = f.price_pcs, price_source = f.store,
             price_item = f.item, price_pack = f.pack, price_url = f.url, price_at = f.collected_at,
             price_note = concat_ws('; ', 'немає в ' || p_store || ' — мінімальна ціна серед магазинів з наявністю', f.note)
        from (select distinct on (x.product_id) x.*
                from public.product_prices x
               where x.store not in (p_store, 'Вручну')
                 and (x.price_kg is not null or x.price_pcs is not null)
                 and coalesce(x.note, '') not ilike '%наявн%'
               order by x.product_id, x.price_kg asc nulls last, x.price_pcs asc nulls last) f
       where f.product_id = p.id and p.price_kg is null and p.price_pcs is null;
    end if;
  end if;
  -- ручна ціна має перевагу над усіма магазинами
  update public.products p
     set price_kg = m.price_kg, price_pcs = m.price_pcs, price_source = 'Вручну',
         price_item = null, price_pack = null, price_url = null,
         price_note = 'ручна ціна від ' || to_char(m.collected_at, 'DD.MM.YYYY'), price_at = m.collected_at
    from public.product_prices m
   where m.product_id = p.id and m.store = 'Вручну' and (m.price_kg is not null or m.price_pcs is not null);
  insert into public.app_settings (key, value) values ('price_store', p_store)
  on conflict (key) do update set value = excluded.value;
  return (select count(*) from public.products where price_kg is not null or price_pcs is not null)::int;
end
$$;

-- застосувати до поточних даних
update public.products p
   set price_kg = m.price_kg, price_pcs = m.price_pcs, price_source = 'Вручну',
       price_item = null, price_pack = null, price_url = null,
       price_note = 'ручна ціна від ' || to_char(m.collected_at, 'DD.MM.YYYY'), price_at = m.collected_at
  from public.product_prices m
 where m.product_id = p.id and m.store = 'Вручну' and (m.price_kg is not null or m.price_pcs is not null);
