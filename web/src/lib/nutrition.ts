/** Харчова цінність: ккал, білки, жири, вуглеводи (г). */
export interface Nutr {
  kcal: number
  protein: number
  fat: number
  carbs: number
}
export interface DishNutr extends Nutr {
  dish_id: number
  missing: number
}

export const ZERO: Nutr = { kcal: 0, protein: 0, fat: 0, carbs: 0 }

export function addN(a: Nutr, b: Nutr, k = 1): Nutr {
  return {
    kcal: a.kcal + Number(b.kcal) * k,
    protein: a.protein + Number(b.protein) * k,
    fat: a.fat + Number(b.fat) * k,
    carbs: a.carbs + Number(b.carbs) * k,
  }
}

export const divN = (a: Nutr, d: number): Nutr =>
  d > 0 ? { kcal: a.kcal / d, protein: a.protein / d, fat: a.fat / d, carbs: a.carbs / d } : ZERO

/**
 * Вага, від якої рахуємо КБЖВ (г) — так само, як у базі (public.ingredient_grams):
 * для «г» — менша з брутто/нетто (їстівна частина; для круп нетто — вже варені),
 * для «шт»/«л» — нетто в грамах.
 */
export const gramsBasis = (unit: string, gross: number, net: number) =>
  unit === 'г' ? Math.min(Number(gross), Number(net)) : Number(net)

/** Референтні добові величини споживання (Регламент ЄС 1169/2011, дорослий, 2000 ккал). */
export const RI: Nutr = { kcal: 2000, protein: 50, fat: 70, carbs: 260 }

const f0 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 })
const f1 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 1 })
export const kcalFmt = (n: number) => f0.format(n)
export const gFmt = (n: number) => (n >= 100 ? f0.format(n) : f1.format(n))

/** Частка енергії з білків/жирів/вуглеводів, % (4/9/4 ккал на грам). */
export function energySplit(n: Nutr) {
  const p = n.protein * 4
  const f = n.fat * 9
  const c = n.carbs * 4
  const s = p + f + c
  if (!s) return { p: 0, f: 0, c: 0 }
  return { p: Math.round((p / s) * 100), f: Math.round((f / s) * 100), c: 100 - Math.round((p / s) * 100) - Math.round((f / s) * 100) }
}
