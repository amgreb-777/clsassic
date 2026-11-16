-- Платформа закупівлі продуктів під вибрані страви (на основі «Шаблон_меню.xlsx»)
--
-- Довідник Продуктів → products
-- МенюЗамовлення     → dishes (каталог) + orders / order_items (конкретне замовлення)
-- Склад Блюд         → dish_ingredients (брутто/нетто на 1 порцію)
-- ЗАкупка            → функція purchase_list(order_id)

create table public.products (
  id          bigint generated always as identity primary key,
  name        text not null unique check (length(trim(name)) > 0),
  category    text,
  created_at  timestamptz not null default now()
);

create table public.dishes (
  id                bigint generated always as identity primary key,
  name              text not null unique check (length(trim(name)) > 0),
  category          text,
  portion_weight_g  numeric(10,2) check (portion_weight_g is null or portion_weight_g >= 0),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now()
);

-- Склад страви на 1 порцію. unit: 'г' (брутто/нетто в грамах),
-- 'шт' (брутто — кількість штук, нетто — грами), 'л' (брутто — літри, нетто — грами/мл)
create table public.dish_ingredients (
  id          bigint generated always as identity primary key,
  dish_id     bigint not null references public.dishes(id) on delete cascade,
  product_id  bigint not null references public.products(id) on delete restrict,
  gross       numeric(12,3) not null default 0 check (gross >= 0),
  net         numeric(12,3) not null default 0 check (net >= 0),
  unit        text not null default 'г' check (unit in ('г', 'шт', 'л')),
  position    int not null default 0,
  unique (dish_id, product_id, unit)
);
create index dish_ingredients_product_idx on public.dish_ingredients(product_id);

create table public.orders (
  id          bigint generated always as identity primary key,
  title       text not null check (length(trim(title)) > 0),
  event_date  date,
  guests      int check (guests is null or guests >= 0),
  notes       text,
  status      text not null default 'draft' check (status in ('draft', 'confirmed', 'purchased', 'done')),
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index orders_created_by_idx on public.orders(created_by);

create table public.order_items (
  order_id  bigint not null references public.orders(id) on delete cascade,
  dish_id   bigint not null references public.dishes(id) on delete restrict,
  quantity  numeric(10,2) not null check (quantity > 0),
  primary key (order_id, dish_id)
);
create index order_items_dish_idx on public.order_items(dish_id);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- Зведення по стравах каталогу: кількість інгредієнтів і вихід
create view public.dish_overview with (security_invoker = true) as
select d.id, d.name, d.category, d.portion_weight_g, d.is_active,
       count(i.id)::int as ingredients_count,
       coalesce(sum(i.net) filter (where i.unit = 'г'), 0) as net_g_total
from public.dishes d
left join public.dish_ingredients i on i.dish_id = d.id
group by d.id;

-- Аналог аркуша «ЗАкупка»: SUM(брутто × кількість), SUM(нетто × кількість) по продукту
create function public.purchase_list(p_order_id bigint)
returns table (
  product_id   bigint,
  product      text,
  category     text,
  unit         text,
  dishes_count int,
  dishes       text[],
  gross_total  numeric,
  net_total    numeric
)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.name, p.category, i.unit,
         count(distinct d.id)::int,
         array_agg(distinct d.name order by d.name),
         sum(i.gross * oi.quantity),
         sum(i.net * oi.quantity)
  from public.order_items oi
  join public.dishes d on d.id = oi.dish_id
  join public.dish_ingredients i on i.dish_id = d.id
  join public.products p on p.id = i.product_id
  where oi.order_id = p_order_id
  group by p.id, p.name, p.category, i.unit
  order by p.name, i.unit;
$$;

-- Безпека: дані доступні лише авторизованим користувачам (команда кейтерингу)
alter table public.products         enable row level security;
alter table public.dishes           enable row level security;
alter table public.dish_ingredients enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;

create policy "team read"   on public.products for select to authenticated using (true);
create policy "team insert" on public.products for insert to authenticated with check (true);
create policy "team update" on public.products for update to authenticated using (true) with check (true);
create policy "team delete" on public.products for delete to authenticated using (true);

create policy "team read"   on public.dishes for select to authenticated using (true);
create policy "team insert" on public.dishes for insert to authenticated with check (true);
create policy "team update" on public.dishes for update to authenticated using (true) with check (true);
create policy "team delete" on public.dishes for delete to authenticated using (true);

create policy "team read"   on public.dish_ingredients for select to authenticated using (true);
create policy "team insert" on public.dish_ingredients for insert to authenticated with check (true);
create policy "team update" on public.dish_ingredients for update to authenticated using (true) with check (true);
create policy "team delete" on public.dish_ingredients for delete to authenticated using (true);

create policy "team read"   on public.orders for select to authenticated using (true);
create policy "team insert" on public.orders for insert to authenticated with check (true);
create policy "team update" on public.orders for update to authenticated using (true) with check (true);
create policy "team delete" on public.orders for delete to authenticated using (true);

create policy "team read"   on public.order_items for select to authenticated using (true);
create policy "team insert" on public.order_items for insert to authenticated with check (true);
create policy "team update" on public.order_items for update to authenticated using (true) with check (true);
create policy "team delete" on public.order_items for delete to authenticated using (true);

revoke all on function public.purchase_list(bigint) from public, anon;
grant execute on function public.purchase_list(bigint) to authenticated;
revoke select on public.dish_overview from anon;
