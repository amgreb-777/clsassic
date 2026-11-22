import type { Product } from './types'

export type Price = Pick<Product, 'price_kg' | 'price_pcs'>

/**
 * Вартість інгредієнта — так само, як у базі (public.ingredient_cost), від БРУТТО:
 * «г» → брутто/1000 × ₴/кг; «шт» → брутто × ₴/шт (або нетто/1000 × ₴/кг); «л» → брутто × ₴/л.
 * null — ціни немає.
 */
export function ingredientCost(unit: string, gross: number, net: number, p?: Price | null): number | null {
  if (!p) return null
  const kg = p.price_kg == null ? null : Number(p.price_kg)
  const pcs = p.price_pcs == null ? null : Number(p.price_pcs)
  if (unit === 'шт') return pcs != null ? Number(gross) * pcs : kg != null ? (Number(net) / 1000) * kg : null
  if (unit === 'л') return kg != null ? Number(gross) * kg : null
  return kg != null ? (Number(gross) / 1000) * kg : null
}

const f2 = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const f0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
/** 12,50 ₴ · 1 234 ₴ (від 1000 — без копійок) */
export const uah = (n: number) => (Math.abs(n) >= 1000 ? f0.format(Math.round(n)) : f2.format(n)) + ' ₴'
export const uahPlain = (n: number) => f2.format(n)

/** Підпис ціни продукту: «189,00 ₴/кг», «12,50 ₴/шт». */
export function priceParts(p: Price): string[] {
  const out: string[] = []
  if (p.price_kg != null) out.push(`${uah(Number(p.price_kg))}/кг`)
  if (p.price_pcs != null) out.push(`${uah(Number(p.price_pcs))}/шт`)
  return out
}

/** Найсвіжіша дата збору цін серед продуктів, «22.11.2026». */
export function priceDate(list: { price_at: string | null }[]): string | null {
  const d = list.reduce<string | null>((m, p) => (p.price_at && (!m || p.price_at > m) ? p.price_at : m), null)
  return d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA') : null
}
