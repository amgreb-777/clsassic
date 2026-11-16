-- Керування акаунтами без листів: адміністратор створює акаунти та задає тимчасові паролі.
-- Тимчасовий пароль позначається прапорцем app_metadata.must_change_password —
-- при вході сайт просить користувача задати власний пароль.

-- Стан акаунтів членів команди (для сторінки «Команда»)
create function public.team_accounts()
returns table (email text, has_account boolean, last_sign_in_at timestamptz, must_change_password boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_team_member() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
    select t.email,
           u.id is not null,
           u.last_sign_in_at,
           coalesce((u.raw_app_meta_data ->> 'must_change_password')::boolean, false)
    from public.team_members t
    left join auth.users u on lower(u.email) = t.email
    order by t.created_at;
end $$;

-- Створити акаунт колезі (email додається в команду, якщо його там ще немає)
create function public.admin_create_account(p_email text, p_password text, p_role text default 'member')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid := gen_random_uuid();
begin
  if not private.is_team_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'BAD_EMAIL';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'BAD_ROLE';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'USER_EXISTS';
  end if;

  insert into public.team_members (email, role) values (v_email, p_role)
  on conflict (email) do nothing;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'must_change_password', true),
    '{}'::jsonb, now(), now(), '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now()
  );
end $$;

-- Задати тимчасовий пароль члену команди (забув пароль); завершує всі його сесії
create function public.admin_set_password(p_email text, p_password text)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if not private.is_team_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_email = private.current_email() then
    raise exception 'USE_CHANGE_PASSWORD';
  end if;
  if not exists (select 1 from public.team_members where email = v_email) then
    raise exception 'NOT_IN_TEAM';
  end if;
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'WEAK_PASSWORD';
  end if;
  select id into v_id from auth.users where lower(email) = v_email;
  if v_id is null then
    raise exception 'NO_ACCOUNT';
  end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"must_change_password": true}'::jsonb,
         updated_at = now()
   where id = v_id;

  delete from auth.sessions where user_id = v_id;
end $$;

-- Користувач задав власний пароль — знімаємо прапорець тимчасового
create function public.clear_must_change_password()
returns void
language sql security definer set search_path = '' as $$
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) - 'must_change_password',
         updated_at = now()
   where id = auth.uid();
$$;

revoke all on function public.team_accounts(), public.admin_create_account(text, text, text),
  public.admin_set_password(text, text), public.clear_must_change_password() from public, anon;
grant execute on function public.team_accounts(), public.admin_create_account(text, text, text),
  public.admin_set_password(text, text), public.clear_must_change_password() to authenticated;
