-- Розділ «Ціни»: оновлення цін чергою за кілька проходів (за розкладом щопонеділка о 8:00 або вручну),
-- історія цін по кожному продукту й магазину, звіт по кожному оновленню.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Таблиці ----------
create table if not exists public.price_runs (
  id bigint generated always as identity primary key,
  trigger text not null check (trigger in ('manual', 'schedule', 'import')),
  started_by text,
  status text not null default 'running' check (status in ('running', 'done', 'error', 'cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  passes int not null default 0,
  calc_store text,
  total int not null default 0,
  checked int not null default 0,
  changed int not null default 0,
  failed int not null default 0,
  gone int not null default 0,
  out_of_stock int not null default 0,
  suspicious int not null default 0,
  calc_changed int not null default 0,
  by_store jsonb,
  top_changes jsonb,
  suspicious_list jsonb,
  calc_changes jsonb,
  error text,
  lock_until timestamptz
);
comment on table public.price_runs is 'Оновлення цін: прогрес, підсумки й звіт';

create table if not exists public.price_run_items (
  run_id bigint not null references public.price_runs (id) on delete cascade,
  product_id bigint not null references public.products (id) on delete cascade,
  store text not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed', 'gone')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  error text,
  primary key (run_id, product_id, store)
);
create index if not exists price_run_items_due on public.price_run_items (run_id, status, next_at);

create table if not exists public.price_history (
  id bigint generated always as identity primary key,
  run_id bigint references public.price_runs (id) on delete cascade,
  product_id bigint not null references public.products (id) on delete cascade,
  store text not null, -- магазин або «Розрахунок» (ціна для собівартості)
  price_kg numeric(12, 2),
  price_pcs numeric(12, 2),
  pack_price numeric(12, 2),
  prev_kg numeric(12, 2),
  prev_pcs numeric(12, 2),
  in_stock boolean,
  suspicious boolean not null default false,
  source text, -- для «Розрахунок»: магазин, з якого взято ціну
  observed_at timestamptz not null default now()
);
create index if not exists price_history_product on public.price_history (product_id, store, observed_at);
create index if not exists price_history_run on public.price_history (run_id);

alter table public.price_runs enable row level security;
alter table public.price_run_items enable row level security;
alter table public.price_history enable row level security;
create policy "team read" on public.price_runs for select to authenticated using (private.is_team_member());
create policy "team read" on public.price_run_items for select to authenticated using (private.is_team_member());
create policy "team read" on public.price_history for select to authenticated using (private.is_team_member());

-- ---------- Секрет для виклику функції з планувальника ----------
create table if not exists private.app_secrets (name text primary key, value text not null);
insert into private.app_secrets (name, value) values ('cron_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

create or replace function public.verify_cron_key(k text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.app_secrets where name = 'cron_key' and value = k)
$$;
revoke all on function public.verify_cron_key(text) from public, anon, authenticated;
grant execute on function public.verify_cron_key(text) to service_role;

-- Службовий виклик: Edge Function (service_role) або планувальник (postgres)
create or replace function private.is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role' or session_user = 'postgres'
$$;

-- ---------- Ціна для розрахунку: ядро без перевірки прав ----------
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

create or replace function public.apply_price_store(p_store text, p_fallback boolean default true)
returns integer language plpgsql set search_path = '' as $$
begin
  if not private.is_team_admin() then
    raise exception 'Змінювати джерело цін може лише адміністратор';
  end if;
  return private.apply_price_store_core(p_store, p_fallback);
end
$$;

-- ---------- Запуск оновлення ----------
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
   where store <> 'Вручну' and url is not null and (price_kg is not null or price_pcs is not null);
  update public.price_runs set total = (select count(*) from public.price_run_items where run_id = v_id) where id = v_id;
  return v_id;
end
$$;
revoke all on function public.start_price_run(text) from public, anon;
grant execute on function public.start_price_run(text) to authenticated, service_role;

-- Один прохід за раз: блокування на 3 хв
create or replace function public.claim_price_run(p_run bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service() then raise exception 'Лише службовий виклик'; end if;
  update public.price_runs set lock_until = now() + interval '170 seconds', passes = passes + 1
   where id = p_run and status = 'running' and (lock_until is null or lock_until < now());
  return found;
end
$$;

create or replace function public.release_price_run(p_run bigint)
returns void language sql security definer set search_path = '' as $$
  update public.price_runs set lock_until = null where id = p_run and private.is_service();
$$;

-- Завершення: ціна для розрахунку, знімок у історію, підсумки звіту
create or replace function public.finish_price_run(p_run bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_store text := coalesce((select value from public.app_settings where key = 'price_store'), 'METRO');
begin
  if not private.is_service() then raise exception 'Лише службовий виклик'; end if;
  if not exists (select 1 from public.price_runs where id = p_run and status = 'running') then return; end if;
  perform private.apply_price_store_core(v_store, true);

  -- знімок ціни для розрахунку (з попередньою для динаміки)
  insert into public.price_history (run_id, product_id, store, price_kg, price_pcs, prev_kg, prev_pcs, source, in_stock)
  select p_run, p.id, 'Розрахунок', p.price_kg, p.price_pcs, prev.price_kg, prev.price_pcs, p.price_source, true
    from public.products p
    left join lateral (select h.price_kg, h.price_pcs from public.price_history h
                        where h.product_id = p.id and h.store = 'Розрахунок' and h.run_id <> p_run
                        order by h.observed_at desc, h.id desc limit 1) prev on true
   where p.price_kg is not null or p.price_pcs is not null;

  update public.price_runs r set
    status = 'done', finished_at = now(), lock_until = null, calc_store = v_store,
    checked = s.checked, changed = s.changed, out_of_stock = s.oos, suspicious = s.sus,
    failed = (select count(*) from public.price_run_items i where i.run_id = p_run and i.status = 'failed'),
    gone = (select count(*) from public.price_run_items i where i.run_id = p_run and i.status = 'gone'),
    by_store = (select jsonb_object_agg(store, jsonb_build_object(
                  'total', total, 'checked', done, 'failed', failed, 'gone', gone,
                  'changed', coalesce(ch.n, 0), 'oos', coalesce(ch.oos, 0)))
                  from (select store, count(*) total, count(*) filter (where status = 'done') done,
                               count(*) filter (where status = 'failed') failed, count(*) filter (where status = 'gone') gone
                          from public.price_run_items where run_id = p_run group by store) t
                  left join (select h.store st,
                                    count(*) filter (where coalesce(h.price_kg, h.price_pcs) is distinct from coalesce(h.prev_kg, h.prev_pcs) and not h.suspicious) n,
                                    count(*) filter (where h.in_stock = false) oos
                               from public.price_history h where h.run_id = p_run and h.store <> 'Розрахунок' group by h.store) ch on ch.st = t.store),
    top_changes = (select coalesce(jsonb_agg(x order by abs(x.pct) desc), '[]') from (
                    select h.product_id, p.name product, h.store, coalesce(h.prev_kg, h.prev_pcs) "from", coalesce(h.price_kg, h.price_pcs) "to",
                           case when h.price_kg is not null then 'кг' else 'шт' end unit,
                           round((coalesce(h.price_kg, h.price_pcs) / nullif(coalesce(h.prev_kg, h.prev_pcs), 0) - 1) * 100, 1) pct
                      from public.price_history h join public.products p on p.id = h.product_id
                     where h.run_id = p_run and h.store <> 'Розрахунок' and not h.suspicious
                       and coalesce(h.price_kg, h.price_pcs) is distinct from coalesce(h.prev_kg, h.prev_pcs)
                       and coalesce(h.prev_kg, h.prev_pcs) > 0
                     order by abs(coalesce(h.price_kg, h.price_pcs) / coalesce(h.prev_kg, h.prev_pcs) - 1) desc limit 30) x),
    suspicious_list = (select coalesce(jsonb_agg(jsonb_build_object('product_id', h.product_id, 'product', p.name, 'store', h.store,
                          'from', coalesce(h.prev_kg, h.prev_pcs), 'pack', h.pack_price)), '[]')
                        from public.price_history h join public.products p on p.id = h.product_id
                       where h.run_id = p_run and h.suspicious),
    calc_changed = c.n,
    calc_changes = c.list
  from (select count(*) filter (where store <> 'Розрахунок') checked,
               count(*) filter (where store <> 'Розрахунок' and not suspicious and coalesce(price_kg, price_pcs) is distinct from coalesce(prev_kg, prev_pcs)) changed,
               count(*) filter (where store <> 'Розрахунок' and in_stock = false) oos,
               count(*) filter (where suspicious) sus
          from public.price_history where run_id = p_run) s,
       (select count(*) n,
               coalesce(jsonb_agg(jsonb_build_object('product_id', h.product_id, 'product', p.name, 'source', h.source,
                   'from', coalesce(h.prev_kg, h.prev_pcs), 'to', coalesce(h.price_kg, h.price_pcs),
                   'pct', round((coalesce(h.price_kg, h.price_pcs) / nullif(coalesce(h.prev_kg, h.prev_pcs), 0) - 1) * 100, 1))
                   order by abs(coalesce(h.price_kg, h.price_pcs) - coalesce(h.prev_kg, h.prev_pcs)) desc), '[]') list
          from public.price_history h join public.products p on p.id = h.product_id
         where h.run_id = p_run and h.store = 'Розрахунок'
           and (h.prev_kg is not null or h.prev_pcs is not null)
           and coalesce(h.price_kg, h.price_pcs) is distinct from coalesce(h.prev_kg, h.prev_pcs)) c
  where r.id = p_run;

  insert into public.app_settings (key, value) values ('prices_refreshed_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  on conflict (key) do update set value = excluded.value;
end
$$;

revoke all on function public.claim_price_run(bigint) from public, anon, authenticated;
revoke all on function public.release_price_run(bigint) from public, anon, authenticated;
revoke all on function public.finish_price_run(bigint) from public, anon, authenticated;
grant execute on function public.claim_price_run(bigint) to service_role;
grant execute on function public.release_price_run(bigint) to service_role;
grant execute on function public.finish_price_run(bigint) to service_role;

-- ---------- Планувальник ----------
-- Щохвилини: якщо йде оновлення і прохід не зайнятий — викликати функцію для наступного проходу
create or replace function private.price_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  update public.price_runs set status = 'error', error = 'не завершилось за 3 години', finished_at = now(), lock_until = null
   where status = 'running' and started_at < now() - interval '3 hours';
  for r in select id from public.price_runs
            where status = 'running' and (lock_until is null or lock_until < now()) loop
    perform net.http_post(
      url := 'https://gnsgayyhmajofcjlilbq.supabase.co/functions/v1/refresh-prices',
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-cron-key', (select value from private.app_secrets where name = 'cron_key')),
      body := jsonb_build_object('action', 'step', 'run_id', r.id),
      timeout_milliseconds := 5000);
  end loop;
end
$$;

-- Щопонеділка о 8:00 за Києвом (UTC+2 взимку / UTC+3 влітку — завдання о 5:00 і 6:00 UTC, спрацьовує одне)
create or replace function private.price_weekly()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if extract(isodow from now() at time zone 'Europe/Kyiv') <> 1
     or extract(hour from now() at time zone 'Europe/Kyiv') <> 8 then
    return;
  end if;
  if exists (select 1 from public.price_runs where trigger = 'schedule'
              and (started_at at time zone 'Europe/Kyiv')::date = (now() at time zone 'Europe/Kyiv')::date) then
    return;
  end if;
  perform public.start_price_run('schedule');
  perform private.price_tick();
end
$$;

select cron.unschedule(jobname) from cron.job where jobname in ('price-refresh-tick', 'price-refresh-weekly');
select cron.schedule('price-refresh-tick', '* * * * *', 'select private.price_tick()');
select cron.schedule('price-refresh-weekly', '0 5,6 * * 1', 'select private.price_weekly()');

-- ---------- Початкова точка історії: ціни зібрані 22.11.2026 ----------
do $$
declare
  v_id bigint;
begin
  if exists (select 1 from public.price_runs where trigger = 'import') then return; end if;
  insert into public.price_runs (trigger, status, started_at, finished_at, calc_store, started_by)
  values ('import', 'done', '2026-11-22 16:34:08+00', '2026-11-22 16:34:08+00',
          (select value from public.app_settings where key = 'price_store'), 'початкові ціни')
  returning id into v_id;
  insert into public.price_history (run_id, product_id, store, price_kg, price_pcs, pack_price, in_stock, observed_at)
  select v_id, product_id, store, price_kg, price_pcs, pack_price, coalesce(note, '') not ilike '%наявн%', '2026-11-22 16:34:08+00'
    from public.product_prices where store <> 'Вручну' and (price_kg is not null or price_pcs is not null);
  insert into public.price_history (run_id, product_id, store, price_kg, price_pcs, source, in_stock, observed_at)
  select v_id, id, 'Розрахунок', price_kg, price_pcs, price_source, true, '2026-11-22 16:34:08+00'
    from public.products where price_kg is not null or price_pcs is not null;
  update public.price_runs set
    total = (select count(*) from public.price_history where run_id = v_id and store <> 'Розрахунок'),
    checked = (select count(*) from public.price_history where run_id = v_id and store <> 'Розрахунок')
  where id = v_id;
end
$$;

-- Прогрес оновлення по магазинах (для сторінки «Ціни»)
create or replace view public.price_run_progress with (security_invoker = on) as
select run_id, store,
       count(*)::int as total,
       count(*) filter (where status = 'done')::int as done,
       count(*) filter (where status = 'pending')::int as pending,
       count(*) filter (where status = 'pending' and attempts > 0)::int as retrying,
       count(*) filter (where status = 'failed')::int as failed,
       count(*) filter (where status = 'gone')::int as gone,
       min(next_at) filter (where status = 'pending') as next_at
  from public.price_run_items
 group by run_id, store;
grant select on public.price_run_progress to authenticated;
