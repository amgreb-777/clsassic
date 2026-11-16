-- Доступ лише для команди: реєстрація тільки з email зі списку team_members,
-- а дані бачать і змінюють лише члени команди.

create schema if not exists private;
grant usage on schema private to authenticated;

create table public.team_members (
  email       text primary key check (email = lower(trim(email)) and email like '%@%'),
  role        text not null default 'member' check (role in ('admin', 'member')),
  created_at  timestamptz not null default now()
);

-- Хелпери в непублічній схемі (не викликаються через REST API)
create function private.current_email() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function private.is_team_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where email = private.current_email())
$$;

create function private.is_team_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.team_members where email = private.current_email() and role = 'admin')
$$;

revoke all on function private.current_email(), private.is_team_member(), private.is_team_admin() from public, anon;
grant execute on function private.current_email(), private.is_team_member(), private.is_team_admin() to authenticated;

-- Блокуємо реєстрацію (і зміну email) для адрес поза списком команди
create function private.enforce_team_signup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is null
     or not exists (select 1 from public.team_members where email = lower(new.email)) then
    raise exception 'TEAM_ONLY: email % is not in the team list', new.email
      using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger enforce_team_signup
  before insert or update of email on auth.users
  for each row execute function private.enforce_team_signup();

-- Початковий склад команди
insert into public.team_members (email, role) values
  ('amgreb@gmail.com', 'admin'),
  ('amggoodsmm@gmail.com', 'member')
on conflict (email) do nothing;

-- RLS для списку команди: бачать усі члени, змінюють лише адміни, себе видалити не можна
alter table public.team_members enable row level security;
create policy "team read" on public.team_members for select to authenticated
  using (private.is_team_member());
create policy "admin insert" on public.team_members for insert to authenticated
  with check (private.is_team_admin());
create policy "admin update" on public.team_members for update to authenticated
  using (private.is_team_admin() and email <> private.current_email())
  with check (private.is_team_admin());
create policy "admin delete" on public.team_members for delete to authenticated
  using (private.is_team_admin() and email <> private.current_email());

-- Замінюємо політики «будь-який авторизований» на «лише член команди»
do $$
declare t text;
begin
  foreach t in array array['products', 'dishes', 'dish_ingredients', 'orders', 'order_items'] loop
    execute format('drop policy if exists "team read" on public.%I', t);
    execute format('drop policy if exists "team insert" on public.%I', t);
    execute format('drop policy if exists "team update" on public.%I', t);
    execute format('drop policy if exists "team delete" on public.%I', t);
    execute format('create policy "team read" on public.%I for select to authenticated using (private.is_team_member())', t);
    execute format('create policy "team insert" on public.%I for insert to authenticated with check (private.is_team_member())', t);
    execute format('create policy "team update" on public.%I for update to authenticated using (private.is_team_member()) with check (private.is_team_member())', t);
    execute format('create policy "team delete" on public.%I for delete to authenticated using (private.is_team_member())', t);
  end loop;
end $$;
