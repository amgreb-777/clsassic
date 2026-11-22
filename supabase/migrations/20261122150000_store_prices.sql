-- Ціни по магазинах: окремий рядок на кожну пару «продукт × магазин».
-- products.price_* — ціна ДЛЯ РОЗРАХУНКУ; її задає apply_price_store() з обраного магазину.
create table public.product_prices (
  product_id   bigint not null references public.products(id) on delete cascade,
  store        text not null check (length(trim(store)) > 0),
  price_kg     numeric(12,2) check (price_kg is null or price_kg >= 0),
  price_pcs    numeric(12,2) check (price_pcs is null or price_pcs >= 0),
  item         text,
  pack         text,
  url          text,
  note         text,
  collected_at date not null default current_date,
  primary key (product_id, store)
);
create index product_prices_store_idx on public.product_prices(store);

alter table public.product_prices enable row level security;
create policy "team read"   on public.product_prices for select to authenticated using (private.is_team_member());
create policy "team insert" on public.product_prices for insert to authenticated with check (private.is_team_member());
create policy "team update" on public.product_prices for update to authenticated using (private.is_team_member()) with check (private.is_team_member());
create policy "team delete" on public.product_prices for delete to authenticated using (private.is_team_member());
grant select, insert, update, delete on public.product_prices to authenticated;

-- Налаштування платформи (ключ → значення)
create table public.app_settings (
  key   text primary key,
  value text not null
);
alter table public.app_settings enable row level security;
create policy "team read"    on public.app_settings for select to authenticated using (private.is_team_member());
create policy "admin insert" on public.app_settings for insert to authenticated with check (private.is_team_admin());
create policy "admin update" on public.app_settings for update to authenticated using (private.is_team_admin()) with check (private.is_team_admin());
grant select, insert, update on public.app_settings to authenticated;
insert into public.app_settings (key, value) values ('price_store', 'METRO');

-- Ціна для розрахунку = ціна обраного магазину (або «Середня» по всіх магазинах).
-- Якщо в магазині продукту немає — ціни для розрахунку немає (без підміни іншим магазином).
create function public.apply_price_store(p_store text)
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
              left join public.product_prices pp on pp.product_id = p2.id
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
  end if;
  insert into public.app_settings (key, value) values ('price_store', p_store)
  on conflict (key) do update set value = excluded.value;
  return (select count(*) from public.products where price_kg is not null or price_pcs is not null)::int;
end
$$;
revoke all on function public.apply_price_store(text) from public, anon;
grant execute on function public.apply_price_store(text) to authenticated;
