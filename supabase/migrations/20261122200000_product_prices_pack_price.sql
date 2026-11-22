-- Звичайна ціна упаковки в магазині: базова точка для автоматичного оновлення цін
-- (Edge Function refresh-prices). Зміна ціни упаковки у k разів змінює ціну за кг/шт теж у k разів;
-- якщо k > 2,5 або < 0,4 — зміну позначено як підозрілу (ймовірна заміна фасування) і не застосовано.
alter table public.product_prices
  add column if not exists pack_price numeric(12,2) check (pack_price is null or pack_price >= 0);
