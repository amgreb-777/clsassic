-- Ціна для розрахунку: останній резерв — якщо товару немає в наявності в жодному магазині, береться
-- найнижча відома ціна (раніше продукт лишався без ціни, напр. при розрахунку за Сільпо).
-- Черга оновлення: рядки з порожнім посиланням не беруться (перевіряти нічого).
create or replace function private.apply_price_store_core(p_store text, p_fallback boolean default true)
returns integer language plpgsql set search_path = '' as $function$
begin
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
             price_note = concat_ws('; ',
               case when p.price_kg is null and p.price_pcs is null then 'немає в ' else 'немає в наявності в ' end
                 || p_store || ' — мінімальна ціна серед магазинів з наявністю',
               f.note)
        from (select distinct on (x.product_id) x.*
                from public.product_prices x
               where x.store not in (p_store, 'Вручну')
                 and (x.price_kg is not null or x.price_pcs is not null)
                 and coalesce(x.note, '') not ilike '%наявн%'
               order by x.product_id, x.price_kg asc nulls last, x.price_pcs asc nulls last) f
       where f.product_id = p.id
         and ((p.price_kg is null and p.price_pcs is null) or coalesce(p.price_note, '') ilike '%наявн%');
      -- останній резерв: товару немає в наявності ніде — найнижча відома ціна (щоб собівартість не була порожньою)
      update public.products p
         set price_kg = f.price_kg, price_pcs = f.price_pcs, price_source = f.store,
             price_item = f.item, price_pack = f.pack, price_url = f.url, price_at = f.collected_at,
             price_note = concat_ws('; ', 'немає в наявності в жодному магазині — остання відома ціна', f.note)
        from (select distinct on (x.product_id) x.*
                from public.product_prices x
               where x.store <> 'Вручну' and (x.price_kg is not null or x.price_pcs is not null)
               order by x.product_id, x.price_kg asc nulls last, x.price_pcs asc nulls last) f
       where f.product_id = p.id and p.price_kg is null and p.price_pcs is null;
    end if;
  end if;
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
$function$;

create or replace function public.start_price_run(p_trigger text default 'manual')
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  if p_trigger = 'manual' and not private.is_team_admin() then
    raise exception 'Оновлювати ціни може лише адміністратор';
  end if;
  if p_trigger = 'schedule' and not private.is_service() then
    raise exception 'Запуск за розкладом — лише службовий';
  end if;
  if p_trigger not in ('manual', 'schedule') then
    raise exception 'Невідомий тип запуску';
  end if;
  -- завислі оновлення (понад 3 год) закриваємо
  update public.price_runs set status = 'error', error = 'не завершилось за 3 години', finished_at = now(), lock_until = null
   where status = 'running' and started_at < now() - interval '3 hours';
  select id into v_id from public.price_runs where status = 'running' order by id desc limit 1;
  if v_id is not null then
    return v_id; -- уже йде — не дублюємо
  end if;
  insert into public.price_runs (trigger, started_by, calc_store)
  values (p_trigger, nullif(private.current_email(), ''), (select value from public.app_settings where key = 'price_store'))
  returning id into v_id;
  insert into public.price_run_items (run_id, product_id, store)
  select v_id, product_id, store from public.product_prices
   where store <> 'Вручну' and coalesce(url, '') <> '' and (price_kg is not null or price_pcs is not null);
  update public.price_runs set total = (select count(*) from public.price_run_items where run_id = v_id) where id = v_id;
  return v_id;
end
$$;
