import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import { STATUS_LABEL, type Dish, type Ingredient, type Order, type OrderStatus, type PurchaseRow } from '../lib/types'
import { downloadCsv, errText, fmt, fmtDate, qty } from '../lib/format'

type Tab = 'menu' | 'purchase' | 'breakdown'

export default function OrderEdit() {
  const orderId = Number(useParams().id)
  const [order, setOrder] = useState<Order | null>(null)
  const [draft, setDraft] = useState<Order | null>(null)
  const [dishes, setDishes] = useState<Dish[]>([])
  const [items, setItems] = useState<Record<number, string>>({}) // dish_id -> кількість (як введено)
  const [tab, setTab] = useState<Tab>('menu')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)
  const timers = useRef<Record<number, number>>({})
  const pending = useRef<Set<Promise<unknown>>>(new Set())
  const chains = useRef<Record<number, Promise<unknown>>>({})

  useEffect(() => {
    let cancelled = false // ігноруємо застарілі відповіді (повторний рендер / зміна id)
    ;(async () => {
      try {
        const [{ data: o, error: e1 }, ds, { data: its, error: e2 }] = await Promise.all([
          supabase.from('orders').select('*').eq('id', orderId).single(),
          fetchAll<Dish>((f, t) => supabase.from('dishes').select('*').order('name').range(f, t)),
          supabase.from('order_items').select('dish_id, quantity').eq('order_id', orderId),
        ])
        if (cancelled) return
        if (e1) throw e1
        if (e2) throw e2
        setOrder(o)
        setDraft(o)
        setDishes(ds)
        setItems(Object.fromEntries((its ?? []).map((i) => [i.dish_id, String(i.quantity)])))
      } catch (e) {
        if (!cancelled) setError(errText(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  const track = useCallback((p: PromiseLike<{ error: { message: string } | null }>) => {
    const pr = Promise.resolve(p).then(({ error }) => {
      if (error) setError(error.message)
    })
    pending.current.add(pr)
    setSaving((n) => n + 1)
    pr.finally(() => {
      pending.current.delete(pr)
      setSaving((n) => n - 1)
    })
    return pr
  }, [])

  const persist = useCallback(
    (dishId: number, raw: string) => {
      const q = Number(raw.replace(',', '.'))
      const run = () =>
        !raw.trim() || !(q > 0)
          ? supabase.from('order_items').delete().eq('order_id', orderId).eq('dish_id', dishId)
          : supabase.from('order_items').upsert({ order_id: orderId, dish_id: dishId, quantity: q })
      // записи по одній страві — строго по черзі, щоб старе значення не перезаписало нове
      const prev = chains.current[dishId] ?? Promise.resolve()
      const next = prev.then(run, run)
      chains.current[dishId] = next
      return track(next)
    },
    [orderId, track],
  )

  function setQty(dishId: number, raw: string, immediate = false) {
    setItems((prev) => ({ ...prev, [dishId]: raw }))
    window.clearTimeout(timers.current[dishId])
    delete timers.current[dishId]
    if (immediate) persist(dishId, raw)
    else
      timers.current[dishId] = window.setTimeout(() => {
        delete timers.current[dishId]
        persist(dishId, raw)
      }, 500)
  }

  function removeDish(dishId: number) {
    window.clearTimeout(timers.current[dishId])
    setItems((prev) => {
      const next = { ...prev }
      delete next[dishId]
      return next
    })
    persist(dishId, '')
  }

  async function flush() {
    for (const [id, t] of Object.entries(timers.current)) {
      window.clearTimeout(t)
      delete timers.current[Number(id)]
      if (items[Number(id)] !== undefined) persist(Number(id), items[Number(id)])
    }
    await Promise.all([...pending.current])
  }

  async function saveHeader() {
    if (!draft) return
    const { data, error } = await supabase
      .from('orders')
      .update({
        title: draft.title.trim() || order!.title,
        event_date: draft.event_date || null,
        guests: draft.guests,
        notes: draft.notes,
        status: draft.status,
      })
      .eq('id', orderId)
      .select()
      .single()
    if (error) setError(error.message)
    else {
      setOrder(data)
      setDraft(data)
    }
  }

  const dishById = useMemo(() => new Map(dishes.map((d) => [d.id, d])), [dishes])
  const selected = useMemo(
    () =>
      Object.entries(items)
        .map(([id, q]) => ({ dish: dishById.get(Number(id)), raw: q }))
        .filter((x): x is { dish: Dish; raw: string } => !!x.dish)
        .sort((a, b) => a.dish.name.localeCompare(b.dish.name, 'uk')),
    [items, dishById],
  )

  if (error && !order) return <div className="page"><div className="alert err">{error}</div></div>
  if (!order || !draft) return <div className="page muted">Завантаження…</div>

  const dirty = JSON.stringify(order) !== JSON.stringify(draft)

  return (
    <div className="page">
      <div className="crumbs no-print">
        <Link to="/orders">← Замовлення</Link>
        <span className="muted small">{saving > 0 ? 'Збереження…' : 'Усі зміни збережено'}</span>
      </div>

      <div className="card order-head no-print">
        <label className="grow">
          Назва
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label>
          Дата
          <input
            type="date"
            value={draft.event_date ?? ''}
            onChange={(e) => setDraft({ ...draft, event_date: e.target.value || null })}
          />
        </label>
        <label>
          Гостей
          <input
            type="number"
            min={0}
            className="w-num"
            value={draft.guests ?? ''}
            onChange={(e) => setDraft({ ...draft, guests: e.target.value ? Number(e.target.value) : null })}
          />
        </label>
        <label>
          Статус
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as OrderStatus })}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Примітки
          <input value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
        </label>
        {dirty && (
          <div className="full right">
            <button className="ghost" onClick={() => setDraft(order)}>Скасувати</button>
            <button className="primary" onClick={saveHeader}>Зберегти</button>
          </div>
        )}
      </div>

      <div className="print-only print-head">
        <h2>{order.title}</h2>
        <div>
          Дата: {fmtDate(order.event_date)} · Гостей: {order.guests ?? '—'}
          {order.notes ? ` · ${order.notes}` : ''}
        </div>
      </div>

      {error && <div className="alert err no-print" onClick={() => setError(null)}>{error}</div>}

      <div className="tabs no-print">
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
          1. Меню замовлення <span className="pill">{selected.length}</span>
        </button>
        <button
          className={tab === 'purchase' ? 'active' : ''}
          onClick={async () => {
            await flush()
            setTab('purchase')
          }}
        >
          2. Закупка продуктів
        </button>
        <button
          className={tab === 'breakdown' ? 'active' : ''}
          onClick={async () => {
            await flush()
            setTab('breakdown')
          }}
        >
          3. Склад по стравах
        </button>
      </div>

      {tab === 'menu' && (
        <MenuTab
          dishes={dishes}
          selected={selected}
          items={items}
          guests={order.guests}
          onQty={setQty}
          onRemove={removeDish}
        />
      )}
      {tab === 'purchase' && <PurchaseTab order={order} />}
      {tab === 'breakdown' && <BreakdownTab order={order} selected={selected} />}
    </div>
  )
}

/* ---------------- 1. Меню ---------------- */

function MenuTab(props: {
  dishes: Dish[]
  selected: { dish: Dish; raw: string }[]
  items: Record<number, string>
  guests: number | null
  onQty: (id: number, raw: string, immediate?: boolean) => void
  onRemove: (id: number) => void
}) {
  const { dishes, selected, items, guests, onQty, onRemove } = props
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const cats = useMemo(
    () => [...new Set(dishes.map((d) => d.category ?? 'Без категорії'))].sort((a, b) => a.localeCompare(b, 'uk')),
    [dishes],
  )
  const list = dishes.filter(
    (d) =>
      d.is_active &&
      (!cat || (d.category ?? 'Без категорії') === cat) &&
      (!q || d.name.toLowerCase().includes(q.toLowerCase())),
  )
  const num = (raw: string) => Number(raw.replace(',', '.')) || 0
  const totalPortions = selected.reduce((s, x) => s + num(x.raw), 0)
  const totalWeight = selected.reduce((s, x) => s + num(x.raw) * (x.dish.portion_weight_g ?? 0), 0)

  return (
    <div className="split">
      <section className="card">
        <h3>Каталог страв</h3>
        <input className="search" placeholder="Пошук страви…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chips">
          <button className={!cat ? 'chip active' : 'chip'} onClick={() => setCat('')}>
            Усі
          </button>
          {cats.map((c) => (
            <button key={c} className={cat === c ? 'chip active' : 'chip'} onClick={() => setCat(c === cat ? '' : c)}>
              {c}
            </button>
          ))}
        </div>
        <ul className="dish-list">
          {list.map((d) => {
            const inOrder = items[d.id] !== undefined
            return (
              <li key={d.id} className={inOrder ? 'in' : ''}>
                <div>
                  <div>{d.name}</div>
                  <div className="muted small">
                    {d.category} · {fmt(d.portion_weight_g)} г / порція
                  </div>
                </div>
                {inOrder ? (
                  <span className="muted small">✓ {items[d.id]}</span>
                ) : (
                  <button className="add" onClick={() => onQty(d.id, String(guests || 1), true)} title="Додати">
                    +
                  </button>
                )}
              </li>
            )
          })}
          {list.length === 0 && <li className="muted">Нічого не знайдено</li>}
        </ul>
      </section>

      <section className="card">
        <h3>Обрані страви</h3>
        {selected.length === 0 ? (
          <p className="muted">Додайте страви з каталогу ліворуч і вкажіть кількість порцій.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Страва</th>
                  <th className="num">Кількість</th>
                  <th className="num">Вага 1 порції, г</th>
                  <th className="num">Загальна вага, г</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.map(({ dish, raw }) => (
                  <tr key={dish.id}>
                    <td>{dish.name}</td>
                    <td className="num">
                      <input
                        className="w-num"
                        inputMode="decimal"
                        value={raw}
                        onChange={(e) => onQty(dish.id, e.target.value)}
                        onBlur={(e) => onQty(dish.id, e.target.value, true)}
                      />
                      {guests ? (
                        <button className="ghost small" title="Кількість = гостей" onClick={() => onQty(dish.id, String(guests), true)}>
                          ×{guests}
                        </button>
                      ) : null}
                    </td>
                    <td className="num">{fmt(dish.portion_weight_g)}</td>
                    <td className="num">{fmt(num(raw) * (dish.portion_weight_g ?? 0))}</td>
                    <td>
                      <button className="ghost small danger" onClick={() => onRemove(dish.id)} title="Прибрати">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>Разом</td>
                  <td className="num">{fmt(totalPortions)}</td>
                  <td />
                  <td className="num">
                    {fmt(totalWeight)} г{guests ? <div className="muted small">{fmt(totalWeight / guests)} г / гостя</div> : null}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/* ---------------- 2. Закупка ---------------- */

function PurchaseTab({ order }: { order: Order }) {
  const [rows, setRows] = useState<PurchaseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inKg, setInKg] = useState(true)
  const [q, setQ] = useState('')
  const key = `bought:${order.id}`
  const [bought, setBought] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]'))
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    let cancelled = false
    supabase.rpc('purchase_list', { p_order_id: order.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message)
      else setRows((data ?? []) as PurchaseRow[])
    })
    return () => {
      cancelled = true
    }
  }, [order.id])

  function toggle(k: string) {
    const next = new Set(bought)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setBought(next)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* немає доступу до localStorage — не критично */
    }
  }

  if (error) return <div className="alert err">{error}</div>
  if (!rows) return <p className="muted">Розрахунок…</p>
  if (rows.length === 0) return <div className="card empty">Додайте страви в меню, щоб побачити список закупки.</div>

  const shown = rows.filter((r) => !q || r.product.toLowerCase().includes(q.toLowerCase()))
  const grams = rows.filter((r) => r.unit === 'г')
  const totalGross = grams.reduce((s, r) => s + Number(r.gross_total), 0)
  const totalNet = grams.reduce((s, r) => s + Number(r.net_total), 0)
  const k = (r: PurchaseRow) => `${r.product_id}|${r.unit}`

  function exportCsv() {
    downloadCsv(`Закупка - ${order.title}.csv`, [
      ['№', 'Продукт', 'Од.', 'Брутто', 'Нетто, г', 'Кількість страв', 'Страви'],
      ...rows!.map((r, i) => [
        i + 1,
        r.product,
        r.unit === 'г' && inKg ? 'кг' : r.unit,
        r.unit === 'г' && inKg ? Number(r.gross_total) / 1000 : Number(r.gross_total),
        Number(r.net_total),
        r.dishes_count,
        r.dishes.join(', '),
      ]),
    ])
  }

  return (
    <section className="card">
      <div className="toolbar no-print">
        <input className="search" placeholder="Пошук продукту…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="inline">
          <input type="checkbox" checked={inKg} onChange={(e) => setInKg(e.target.checked)} /> показувати в кг
        </label>
        <span className="grow" />
        <button className="ghost" onClick={exportCsv}>⬇ Excel (CSV)</button>
        <button className="ghost" onClick={() => window.print()}>🖨 Друк</button>
      </div>
      <div className="muted small no-print">
        Позицій: {rows.length} · куплено: {rows.filter((r) => bought.has(k(r))).length}. Брутто — скільки закупити, нетто — вихід після обробки.
      </div>
      <div className="table-wrap">
        <table className="purchase">
          <thead>
            <tr>
              <th className="no-print" />
              <th>№</th>
              <th>Продукт</th>
              <th className="num">Брутто (закупити)</th>
              <th className="num">Нетто</th>
              <th className="num">Страв</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={k(r)} className={bought.has(k(r)) ? 'done' : ''}>
                <td className="no-print">
                  <input type="checkbox" checked={bought.has(k(r))} onChange={() => toggle(k(r))} aria-label="Куплено" />
                </td>
                <td className="muted">{i + 1}</td>
                <td>
                  {r.product}
                  {r.unit !== 'г' && <span className="unit-tag">{r.unit}</span>}
                </td>
                <td className="num strong">{qty(r.gross_total, r.unit, inKg)}</td>
                <td className="num">{qty(r.net_total, 'г', inKg)}</td>
                <td className="num" title={r.dishes.join('\n')}>
                  {r.dishes_count}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="no-print" />
              <td />
              <td>Разом (вагові продукти)</td>
              <td className="num">{qty(totalGross, 'г', inKg)}</td>
              <td className="num">{qty(totalNet, 'г', inKg)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">
        Для штучних позицій (шт) брутто — кількість штук, нетто — їх вага в грамах. Наведіть на число страв, щоб побачити, у яких стравах є продукт.
      </p>
    </section>
  )
}

/* ---------------- 3. Склад по стравах ---------------- */

function BreakdownTab({ order, selected }: { order: Order; selected: { dish: Dish; raw: string }[] }) {
  const [ings, setIngs] = useState<Ingredient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ids = selected.map((s) => s.dish.id)
  const idsKey = ids.join(',')

  useEffect(() => {
    if (!idsKey) return setIngs([])
    let cancelled = false
    const list = idsKey.split(',').map(Number)
    fetchAll<Ingredient>((f, t) =>
      supabase
        .from('dish_ingredients')
        .select('*, products(name)')
        .in('dish_id', list)
        .order('dish_id')
        .order('position')
        .range(f, t),
    )
      .then((r) => !cancelled && setIngs(r))
      .catch((e) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  if (error) return <div className="alert err">{error}</div>
  if (!ings) return <p className="muted">Завантаження…</p>
  if (selected.length === 0) return <div className="card empty">Меню порожнє.</div>

  function exportCsv() {
    const rows: (string | number)[][] = [
      ['Страва', 'Продукт', 'Од.', 'Брутто на 1 порцію', 'Нетто на 1 порцію, г', 'Кількість страв', 'Брутто всього', 'Нетто всього, г'],
    ]
    for (const { dish, raw } of selected) {
      const n = Number(raw.replace(',', '.')) || 0
      for (const i of ings!.filter((x) => x.dish_id === dish.id))
        rows.push([dish.name, i.products?.name ?? '', i.unit, Number(i.gross), Number(i.net), n, Number(i.gross) * n, Number(i.net) * n])
    }
    downloadCsv(`Склад страв - ${order.title}.csv`, rows)
  }

  return (
    <section className="card">
      <div className="toolbar no-print">
        <span className="grow" />
        <button className="ghost" onClick={exportCsv}>⬇ Excel (CSV)</button>
        <button className="ghost" onClick={() => window.print()}>🖨 Друк</button>
      </div>
      {selected.map(({ dish, raw }) => {
        const n = Number(raw.replace(',', '.')) || 0
        const list = ings.filter((i) => i.dish_id === dish.id)
        return (
          <div key={dish.id} className="breakdown">
            <h4>
              {dish.name} <span className="muted">× {fmt(n)}</span>
            </h4>
            {list.length === 0 ? (
              <p className="alert warn">Немає технологічної карти — додайте склад у розділі «Страви».</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Продукт</th>
                    <th className="num">Брутто / порц.</th>
                    <th className="num">Нетто / порц., г</th>
                    <th className="num">Брутто всього</th>
                    <th className="num">Нетто всього, г</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((i) => (
                    <tr key={i.id}>
                      <td>{i.products?.name}</td>
                      <td className="num">{qty(i.gross, i.unit, false)}</td>
                      <td className="num">{fmt(i.net)}</td>
                      <td className="num strong">{qty(i.gross * n, i.unit, false)}</td>
                      <td className="num">{fmt(i.net * n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </section>
  )
}
