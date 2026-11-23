import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import type { Dish, DishCost, Order } from '../lib/types'
import { errText, fmt } from '../lib/format'
import { kcalFmt, type DishNutr } from '../lib/nutrition'
import { uah } from '../lib/cost'
import Icon from '../components/Icon'
import { Alert, Logo, Skeleton, useToast } from '../components/ui'
import { docFileName, exportOrderXlsx, groupLines, OTHER_CAT, plural, totalsOf, type DocLine } from '../lib/orderDoc'

const longDate = (d: string | null) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'дата уточнюється'

/** Документ замовлення: меню заходу у фірмовому оформленні — друк, PDF, Excel. */
export default function OrderDoc() {
  const { id } = useParams()
  const orderId = Number(id)
  const toast = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [lines, setLines] = useState<DocLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [withCost, setWithCostState] = useState(() => {
    try {
      return localStorage.getItem('docWithCost') === '1'
    } catch {
      return false
    }
  })
  const setWithCost = (v: boolean) => {
    setWithCostState(v)
    try {
      localStorage.setItem('docWithCost', v ? '1' : '0')
    } catch {
      /* немає доступу до localStorage */
    }
  }

  useEffect(() => {
    ;(async () => {
      try {
        const [{ data: o, error: e1 }, { data: items, error: e2 }] = await Promise.all([
          supabase.from('orders').select('*').eq('id', orderId).single(),
          supabase.from('order_items').select('dish_id, quantity').eq('order_id', orderId),
        ])
        if (e1) throw e1
        if (e2) throw e2
        const ids = (items ?? []).map((x) => x.dish_id)
        const [dishes, nutr, costs] = ids.length
          ? await Promise.all([
              fetchAll<Dish>((f, t) => supabase.from('dishes').select('*').in('id', ids).range(f, t)),
              fetchAll<DishNutr>((f, t) => supabase.from('dish_nutrition').select('*').in('dish_id', ids).range(f, t)),
              fetchAll<DishCost>((f, t) => supabase.from('dish_cost').select('*').in('dish_id', ids).range(f, t)),
            ])
          : [[], [], []]
        const dm = new Map(dishes.map((d) => [d.id, d]))
        const nm = new Map(nutr.map((n) => [n.dish_id, n]))
        const cm = new Map(costs.map((c) => [c.dish_id, c]))
        setOrder(o as Order)
        setLines(
          (items ?? [])
            .filter((x) => dm.has(x.dish_id) && x.quantity > 0)
            .map((x) => {
              const d = dm.get(x.dish_id)!
              const c = cm.get(x.dish_id)
              return {
                id: d.id,
                name: d.name,
                category: d.category || OTHER_CAT,
                portion: d.portion_weight_g != null ? Number(d.portion_weight_g) : null,
                qty: x.quantity,
                kcal: nm.get(x.dish_id) ? Number(nm.get(x.dish_id)!.kcal) : null,
                cost: c && c.cost != null ? Number(c.cost) : null,
              }
            }),
        )
      } catch (e) {
        setError(errText(e))
      }
    })()
  }, [orderId])

  const groups = useMemo(() => groupLines(lines ?? []), [lines])
  const totals = useMemo(() => totalsOf(lines ?? []), [lines])

  function print(asPdf: boolean) {
    if (!order) return
    const was = document.title
    document.title = docFileName(order, 'pdf').replace(/\.pdf$/, '')
    const restore = () => {
      document.title = was
      window.removeEventListener('afterprint', restore)
    }
    window.addEventListener('afterprint', restore)
    if (asPdf) toast('У вікні друку оберіть «Зберегти як PDF»')
    setTimeout(() => window.print(), asPdf ? 350 : 0)
  }

  async function excel() {
    if (!order) return
    setBusy(true)
    try {
      await exportOrderXlsx({ order, groups, totals, withCost })
    } catch (e) {
      toast(`Не вдалося створити Excel: ${errText(e)}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="page"><Alert kind="err">{error}</Alert></div>
  if (!order || !lines) return <div className="page"><Skeleton rows={6} /></div>

  const g = order.guests || 0
  return (
    <div className="page doc-page">
      <div className="doc-toolbar no-print">
        <Link to={`/orders/${order.id}`} className="back"><Icon name="back" size={18} /> До замовлення</Link>
        <div className="doc-actions">
          <label className="check">
            <input type="checkbox" checked={withCost} onChange={(e) => setWithCost(e.target.checked)} /> Собівартість
          </label>
          <button className="btn" onClick={excel} disabled={busy || !lines.length}><Icon name="download" size={18} /> Excel</button>
          <button className="btn" onClick={() => print(true)} disabled={!lines.length}><Icon name="download" size={18} /> PDF</button>
          <button className="btn primary" onClick={() => print(false)} disabled={!lines.length}><Icon name="printer" size={18} /> Друк</button>
        </div>
      </div>

      <article className="lux-doc">
        <div className="lux-frame">
          <header className="lux-head">
            <Logo size="lg" script />
            <div className="lux-orn" aria-hidden="true"><i /><b>◆</b><i /></div>
          </header>

          <section className="lux-title">
            <div className="lux-eyebrow">Меню заходу</div>
            <h1>{order.title}</h1>
            <div className="lux-meta">
              <span>{longDate(order.event_date)}</span>
              {g > 0 && <><b>·</b><span>{g} {plural(g, 'гість', 'гості', 'гостей')}</span></>}
            </div>
            {order.notes?.trim() && <p className="lux-notes">{order.notes.trim()}</p>}
          </section>

          {!lines.length ? (
            <p className="lux-empty">У замовленні ще немає страв.</p>
          ) : (
            <>
              <table className={`lux-table ${withCost ? 'with-cost' : ''}`}>
                <thead>
                  <tr>
                    <th>Страва</th>
                    <th className="num">Вихід</th>
                    <th className="num">Порцій</th>
                    <th className="num">Вага</th>
                    {withCost && <th className="num">Собів. / порц.</th>}
                    {withCost && <th className="num">Сума</th>}
                  </tr>
                </thead>
                {groups.map((gr) => (
                  <tbody key={gr.name}>
                    <tr className="lux-cat">
                      <td colSpan={withCost ? 6 : 4}><span>{gr.name}</span></td>
                    </tr>
                    {gr.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="lux-dish">
                          <span className="nm">{l.name}</span>
                          <span className="lead" aria-hidden="true" />
                          <span className="sm-meta">
                            {l.portion != null ? `${fmt(l.portion)} г` : ''} × {l.qty}
                            {withCost && l.cost != null ? ` · ${uah(l.cost * l.qty)}` : ''}
                          </span>
                        </td>
                        <td className="num">{l.portion != null ? `${fmt(l.portion)} г` : '—'}</td>
                        <td className="num">{l.qty}</td>
                        <td className="num">{l.portion != null ? `${fmt((l.portion * l.qty) / 1000)} кг` : '—'}</td>
                        {withCost && <td className="num">{l.cost != null ? uah(l.cost) : '—'}</td>}
                        {withCost && <td className="num strong">{l.cost != null ? uah(l.cost * l.qty) : '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>

              <section className="lux-totals">
                <div><span>Страв</span><b>{totals.dishes}</b><small>{fmt(totals.portions)} порцій</small></div>
                <div><span>Загальна вага</span><b>{fmt(totals.weight / 1000)} кг</b><small>{kcalFmt(totals.kcal)} ккал</small></div>
                {g > 0 && (
                  <div><span>На 1 гостя</span><b>{fmt(Math.round(totals.weight / g))} г</b><small>{kcalFmt(totals.kcal / g)} ккал</small></div>
                )}
                {withCost && (
                  <div className="gold">
                    <span>Собівартість</span>
                    <b>{uah(totals.cost)}</b>
                    <small>{g > 0 ? `${uah(totals.cost / g)} на гостя` : ' '}{totals.missingCost ? ` · без ${totals.missingCost}` : ''}</small>
                  </div>
                )}
              </section>
            </>
          )}

          <footer className="lux-foot">
            <div className="lux-orn" aria-hidden="true"><i /><b>◆</b><i /></div>
            <div className="lux-sign">Classic Catering</div>
            <div className="lux-date">Документ сформовано {new Date().toLocaleDateString('uk-UA')}</div>
          </footer>
        </div>
      </article>
    </div>
  )
}

