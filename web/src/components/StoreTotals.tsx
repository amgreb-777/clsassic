import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { StorePrice, Unit } from '../lib/types'
import { averagePrice, ingredientCost, uah } from '../lib/cost'

export const STORES = ['METRO', 'Сільпо', 'NOVUS', 'Auchan', 'MegaMarket']

/** Рядок закупки: продукт і кількість (брутто/нетто вже помножені на кількість порцій). */
export type CostLine = { product_id: number; unit: Unit | string; gross: number; net: number }

/**
 * Вартість тих самих продуктів за середньою ціною магазинів (без ручних цін) —
 * показується в плитках собівартості під основною сумою (ціна для розрахунку).
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

  const avg = useMemo<{ sum: number; missing: number } | null>(() => {
    if (!map || !lines.length) return null
    // однакові продукти з різних страв зводимо разом (як у списку закупки)
    const agg = new Map<string, CostLine>()
    for (const l of lines) {
      const k = `${l.product_id}|${l.unit}`
      const a = agg.get(k)
      agg.set(k, a ? { ...a, gross: a.gross + l.gross, net: a.net + l.net } : { ...l })
    }
    let sum = 0
    let missing = 0
    for (const r of agg.values()) {
      const x = averagePrice(map.get(r.product_id), STORES, r.product_id)
      const c = x ? ingredientCost(r.unit, r.gross, r.net, x) : null
      if (c == null) missing++
      else sum += c
    }
    return { sum, missing }
  }, [map, lines])

  // якщо собівартість і так рахується за середньою ціною — рядок не потрібен
  if (!avg || exclude === 'Середня') return null
  return (
    <ul className="store-totals" aria-label="Вартість за середньою ціною магазинів">
      <li className="avg" title="За середньою ціною магазинів (METRO, Сільпо, NOVUS, Auchan, MegaMarket)">
        <span>Середня ціна</span>
        <b>{uah(avg.sum)}</b>
        {avg.missing > 0 && <em>без {avg.missing}</em>}
      </li>
    </ul>
  )
}
