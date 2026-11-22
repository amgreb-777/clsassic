import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { StorePrice, Unit } from '../lib/types'
import { averagePrice, ingredientCost, uah } from '../lib/cost'

export const STORES = ['METRO', 'Сільпо', 'NOVUS', 'Auchan', 'MegaMarket']

/** Рядок закупки: продукт і кількість (брутто/нетто вже помножені на кількість порцій). */
export type CostLine = { product_id: number; unit: Unit | string; gross: number; net: number }

type Total = { label: string; sum: number; missing: number; kind: 'store' | 'avg' | 'opt' }

/**
 * Вартість тих самих продуктів в інших магазинах: по кожному магазину («без N», якщо чогось немає),
 * за середньою ціною і «оптимальний кошик» (кожна позиція — де найдешевше серед наявних).
 * Магазин, з якого рахується собівартість (`exclude`), не показується — це головне число плитки.
 */
export default function StoreTotals({ lines, exclude }: { lines: CostLine[]; exclude?: string }) {
  const [map, setMap] = useState<Map<number, Record<string, StorePrice>> | null>(null)
  const idsKey = useMemo(() => [...new Set(lines.map((l) => l.product_id))].sort((a, b) => a - b).join(','), [lines])

  useEffect(() => {
    if (!idsKey) return
    let cancelled = false
    const ids = idsKey.split(',').map(Number)
    fetchAll<StorePrice>((f, t) => supabase.from('product_prices').select('*').in('product_id', ids).range(f, t))
      .then((list) => {
        if (cancelled) return
        const m = new Map<number, Record<string, StorePrice>>()
        for (const x of list) m.set(x.product_id, { ...(m.get(x.product_id) ?? {}), [x.store]: x })
        setMap(m)
      })
      .catch(() => {
        /* порівняння магазинів — не критичне */
      })
    return () => {
      cancelled = true
    }
  }, [idsKey])

  const totals = useMemo<Total[] | null>(() => {
    if (!map || !lines.length) return null
    // однакові продукти з різних страв зводимо разом (як у списку закупки)
    const agg = new Map<string, CostLine>()
    for (const l of lines) {
      const k = `${l.product_id}|${l.unit}`
      const a = agg.get(k)
      agg.set(k, a ? { ...a, gross: a.gross + l.gross, net: a.net + l.net } : { ...l })
    }
    const rows = [...agg.values()]
    const cost = (r: CostLine, x?: StorePrice) => (x ? ingredientCost(r.unit, r.gross, r.net, x) : null)
    const out: Total[] = STORES.map((st) => {
      let sum = 0
      let missing = 0
      for (const r of rows) {
        const c = cost(r, map.get(r.product_id)?.[st])
        if (c == null) missing++
        else sum += c
      }
      return { label: st, sum, missing, kind: 'store' }
    })
    let avg = 0
    let avgMissing = 0
    let opt = 0
    let optMissing = 0
    for (const r of rows) {
      const rec = map.get(r.product_id)
      const a = cost(r, averagePrice(rec, STORES, r.product_id))
      if (a == null) avgMissing++
      else avg += a
      const xs = STORES.map((st) => rec?.[st])
        .filter((x) => x && !/наявн/.test(x.note ?? ''))
        .map((x) => cost(r, x))
        .filter((c): c is number => c != null)
      if (xs.length) opt += Math.min(...xs)
      else optMissing++
    }
    out.push({ label: 'Середня ціна', sum: avg, missing: avgMissing, kind: 'avg' })
    out.push({ label: 'Оптимальний кошик', sum: opt, missing: optMissing, kind: 'opt' })
    return out
  }, [map, lines])

  if (!totals) return null
  // найдешевший магазин, де є все (порівнюємо з усіма, зокрема з магазином розрахунку)
  const cheapest = totals
    .filter((t) => t.kind === 'store' && t.missing === 0)
    .reduce<Total | null>((a, b) => (!a || b.sum < a.sum ? b : a), null)?.label
  const shown = totals.filter((t) => t.label !== exclude && !(exclude === 'Середня' && t.kind === 'avg'))

  return (
    <ul className="store-totals" aria-label="Вартість в інших магазинах">
      {shown.map((t) => (
        <li
          key={t.label}
          className={`${t.kind}${t.label === cheapest ? ' best' : ''}`}
          title={
            t.kind === 'opt'
              ? 'Кожна позиція — в магазині, де вона найдешевша (серед товарів у наявності)'
              : t.kind === 'avg'
                ? 'За середньою ціною магазинів'
                : t.missing
                  ? `Сума без ${t.missing} позицій, яких немає в ${t.label}`
                  : `Усе в ${t.label}`
          }
        >
          <span>{t.label}</span>
          <b>{uah(t.sum)}</b>
          {t.missing > 0 && <em>без {t.missing}</em>}
        </li>
      ))}
    </ul>
  )
}
