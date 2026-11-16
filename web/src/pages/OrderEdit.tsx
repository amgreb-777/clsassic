import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import { STATUS_LABEL, type Dish, type Ingredient, type Order, type OrderStatus, type PurchaseRow } from '../lib/types'
import { downloadCsv, errText, fmt, fmtDate, qty } from '../lib/format'
import Icon from '../components/Icon'
import { Alert, Empty, Logo, SearchInput, Skeleton, useToast } from '../components/ui'

type Tab = 'menu' | 'purchase' | 'breakdown'

export default function OrderEdit() {
  const orderId = Number(useParams().id)
  const toast = useToast()
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
      if (error) toast(`Не вдалося зберегти: ${error.message}`, 'err')
    })
    pending.current.add(pr)
    setSaving((n) => n + 1)
    pr.finally(() => {
      pending.current.delete(pr)
      setSaving((n) => n - 1)
    })
    return pr
  }, [toast])

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
    if (error) toast(error.message, 'err')
    else {
      setOrder(data)
      setDraft(data)
      toast('Дані замовлення збережено')
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


  const num = (raw: string) => Number(raw.replace(',', '.')) || 0
  const totalPortions = selected.reduce((s, x) => s + num(x.raw), 0)
  const totalWeight = selected.reduce((s, x) => s + num(x.raw) * (x.dish.portion_weight_g ?? 0), 0)

  if (error && !order)
    return (
      <div className="page">
        <Link to="/orders" className="back"><Icon name="back" size={18} /> Замовлення</Link>
        <Alert kind="err">{error}</Alert>
      </div>
    )
  if (!order || !draft)
    return (
      <div className="page">
        <Skeleton rows={1} card />
        <Skeleton rows={6} />
      </div>
    )

  const dirty = JSON.stringify(order) !== JSON.stringify(draft)
  const goTab = async (t: Tab) => {
    if (t !== 'menu') await flush()
    setTab(t)
  }

  return (
    <div className="page">
      <div className="no-print">
        <Link to="/orders" className="back"><Icon name="back" size={18} /> Усі замовлення</Link>
        <div className="page-head">
          <div className="grow">
            <h1>{order.title}</h1>
            <div className="row wrap muted" style={{ gap: 16, marginTop: 8 }}>
              <span className="row" style={{ gap: 6 }}><Icon name="calendar" size={16} /> {fmtDate(order.event_date)}</span>
              <span className="row" style={{ gap: 6 }}><Icon name="users" size={16} /> {order.guests ?? '—'} гостей</span>
              <span className={`badge ${order.status}`}>{STATUS_LABEL[order.status]}</span>
            </div>
          </div>
          <span className={`save-state ${saving > 0 ? 'saving' : ''}`} aria-live="polite">
            <span className="dot" /> {saving > 0 ? 'Збереження…' : 'Усі зміни збережено'}
          </span>
        </div>
      </div>

      <details className="card no-print order-details" open={dirty || undefined}>
        <summary>
          <Icon name="edit" size={18} /> Дані заходу
          <span className="muted small">назва, дата, гості, статус, примітки</span>
        </summary>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label className="field span-2">
            <span>Назва</span>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Дата</span>
            <input type="date" value={draft.event_date ?? ''} onChange={(e) => setDraft({ ...draft, event_date: e.target.value || null })} />
          </label>
          <label className="field">
            <span>Гостей</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={draft.guests ?? ''}
              onChange={(e) => setDraft({ ...draft, guests: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="field">
            <span>Статус</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as OrderStatus })}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field span-2">
            <span>Примітки</span>
            <input value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Адреса, час подачі, побажання…" />
          </label>
        </div>
        {dirty && (
          <div className="right" style={{ marginTop: 14 }}>
            <button className="btn ghost" onClick={() => setDraft(order)}>Скасувати</button>
            <button className="btn primary" onClick={saveHeader}><Icon name="check" size={18} /> Зберегти</button>
          </div>
        )}
      </details>

      <div className="print-only print-head">
        <div>
          <h2>{order.title}</h2>
          <div>
            {fmtDate(order.event_date)} · гостей: {order.guests ?? '—'}
            {order.notes ? ` · ${order.notes}` : ''}
          </div>
        </div>
        <Logo />
      </div>

      <div className="steps no-print" role="tablist" aria-label="Етапи">
        <button role="tab" aria-selected={tab === 'menu'} className={tab === 'menu' ? 'active' : ''} onClick={() => goTab('menu')}>
          <span className="n">1</span> Меню <span className="label-long">замовлення</span>
          {selected.length > 0 && <span className="tag">{selected.length}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'purchase'} className={tab === 'purchase' ? 'active' : ''} onClick={() => goTab('purchase')}>
          <span className="n">2</span> Закупка <span className="label-long">продуктів</span>
        </button>
        <button role="tab" aria-selected={tab === 'breakdown'} className={tab === 'breakdown' ? 'active' : ''} onClick={() => goTab('breakdown')}>
          <span className="n">3</span> Склад <span className="label-long">по стравах</span>
        </button>
      </div>

      {tab === 'menu' && (
        <>
          <MenuTab dishes={dishes} selected={selected} items={items} guests={order.guests} onQty={setQty} onRemove={removeDish} />
          {selected.length > 0 && (
            <div className="summary-bar no-print">
              <div className="row wrap" style={{ gap: 24 }}>
                <div className="item"><span className="k">Страв</span><span className="v">{selected.length}</span></div>
                <div className="item opt"><span className="k">Порцій</span><span className="v">{fmt(totalPortions)}</span></div>
                <div className="item"><span className="k">Вага</span><span className="v">{fmt(totalWeight / 1000)} кг</span></div>
                {order.guests ? (
                  <div className="item opt"><span className="k">На гостя</span><span className="v">{fmt(totalWeight / order.guests)} г</span></div>
                ) : null}
              </div>
              <button className="btn" onClick={() => goTab('purchase')}>
                <Icon name="cart" size={18} /> <span className="btn-text">До закупки</span> <Icon name="next" size={16} />
              </button>
            </div>
          )}
        </>
      )}
      {tab === 'purchase' && <PurchaseTab order={order} />}
      {tab === 'breakdown' && <BreakdownTab order={order} selected={selected} />}
    </div>
  )
}

/* ---------------- 1. Меню ---------------- */

function Stepper({ value, onChange, onCommit, label }: { value: string; onChange: (v: string) => void; onCommit: (v: string) => void; label: string }) {
  const n = Number(value.replace(',', '.')) || 0
  return (
    <span className="stepper">
      <button type="button" aria-label={`Зменшити: ${label}`} onClick={() => onCommit(String(Math.max(0, n - 1)))}>
        <Icon name="minus" size={16} />
      </button>
      <input
        inputMode="decimal"
        aria-label={`Кількість: ${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`Збільшити: ${label}`} onClick={() => onCommit(String(n + 1))}>
        <Icon name="plus" size={16} />
      </button>
    </span>
  )
}

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
  const cats = useMemo(() => {
    const c = new Map<string, number>()
    for (const d of dishes) if (d.is_active) c.set(d.category ?? 'Без категорії', (c.get(d.category ?? 'Без категорії') ?? 0) + 1)
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0], 'uk'))
  }, [dishes])
  const list = dishes.filter(
    (d) =>
      d.is_active &&
      (!cat || (d.category ?? 'Без категорії') === cat) &&
      (!q || d.name.toLowerCase().includes(q.toLowerCase())),
  )
  const num = (raw: string) => Number(raw.replace(',', '.')) || 0
  const commit = (id: number, v: string) => (num(v) > 0 ? onQty(id, v, true) : onRemove(id))

  return (
    <div className="split">
      <section className="card sticky-col" aria-label="Каталог страв">
        <div className="card-head">
          <h3>Каталог страв</h3>
          <span className="muted small">{list.length} з {dishes.filter((d) => d.is_active).length}</span>
        </div>
        <div className="stack">
          <SearchInput value={q} onChange={setQ} placeholder="Знайти страву…" />
          <div className="chips">
            <button className={!cat ? 'chip active' : 'chip'} onClick={() => setCat('')}>Усі</button>
            {cats.map(([c, n]) => (
              <button key={c} className={cat === c ? 'chip active' : 'chip'} onClick={() => setCat(c === cat ? '' : c)}>
                {c}<span className="count">{n}</span>
              </button>
            ))}
          </div>
          <ul className="dish-list">
            {list.map((d) => {
              const inOrder = items[d.id] !== undefined
              return (
                <li key={d.id} className={`dish-item ${inOrder ? 'in' : ''}`}>
                  <div className="grow">
                    <div className="name">{d.name}</div>
                    <div className="sub">{d.category} · {fmt(d.portion_weight_g)} г</div>
                  </div>
                  {inOrder ? (
                    <span className="in-qty"><Icon name="check" size={16} /> {items[d.id]}</span>
                  ) : (
                    <button className="add-btn" onClick={() => onQty(d.id, String(guests || 1), true)} aria-label={`Додати «${d.name}»`} title="Додати в меню">
                      <Icon name="plus" size={18} />
                    </button>
                  )}
                </li>
              )
            })}
            {list.length === 0 && <li className="muted" style={{ padding: 16 }}>Нічого не знайдено</li>}
          </ul>
        </div>
      </section>

      <section className="card flush" aria-label="Обрані страви">
        <div className="card-head" style={{ padding: '20px 20px 0' }}>
          <div>
            <h3>Меню замовлення</h3>
            <p>Кількість за замовчуванням = кількість гостей. Змінюйте кнопками − / + або введіть число.</p>
          </div>
        </div>
        {selected.length === 0 ? (
          <Empty icon="dishes" title="Меню порожнє" text="Додайте страви з каталогу — кнопка «+» біля назви." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Страва</th>
                  <th className="num">Кількість</th>
                  <th className="num hide-sm">Порція, г</th>
                  <th className="num">Вага, кг</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {selected.map(({ dish, raw }) => (
                  <tr key={dish.id} className="selected-row">
                    <td>
                      {dish.name}
                      <div className="small muted">{dish.category}</div>
                    </td>
                    <td className="num">
                      <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                        <Stepper label={dish.name} value={raw} onChange={(v) => onQty(dish.id, v)} onCommit={(v) => commit(dish.id, v)} />
                        {guests && num(raw) !== guests ? (
                          <button className="btn ghost sm hide-sm" title="Кількість = гостей" onClick={() => onQty(dish.id, String(guests), true)}>
                            ×{guests}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="num hide-sm">{fmt(dish.portion_weight_g)}</td>
                    <td className="num strong">{fmt((num(raw) * (dish.portion_weight_g ?? 0)) / 1000)}</td>
                    <td className="actions">
                      <button className="btn ghost icon sm danger" onClick={() => onRemove(dish.id)} aria-label={`Прибрати «${dish.name}»`} title="Прибрати з меню">
                        <Icon name="trash" size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
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
  const [onlyLeft, setOnlyLeft] = useState(false)
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

  function save(next: Set<string>) {
    setBought(next)
    try {
      localStorage.setItem(key, JSON.stringify([...next]))
    } catch {
      /* немає доступу до localStorage — не критично */
    }
  }
  function toggle(k: string) {
    const next = new Set(bought)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    save(next)
  }

  if (error) return <Alert kind="err">{error}</Alert>
  if (!rows) return <div className="card"><Skeleton rows={8} /></div>
  if (rows.length === 0)
    return <div className="card"><Empty icon="cart" title="Список закупки порожній" text="Додайте страви в меню — тут з'явиться перелік продуктів з кількістю." /></div>

  const k = (r: PurchaseRow) => `${r.product_id}|${r.unit}`
  const boughtCount = rows.filter((r) => bought.has(k(r))).length
  const pct = Math.round((boughtCount / rows.length) * 100)
  const shown = rows.filter(
    (r) => (!q || r.product.toLowerCase().includes(q.toLowerCase())) && (!onlyLeft || !bought.has(k(r))),
  )
  const grams = rows.filter((r) => r.unit === 'г')
  const totalGross = grams.reduce((s, r) => s + Number(r.gross_total), 0)
  const totalNet = grams.reduce((s, r) => s + Number(r.net_total), 0)

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
    <>
      <div className="stats no-print">
        <div className="stat"><div className="k">Позицій у списку</div><div className="v">{rows.length}</div></div>
        <div className="stat"><div className="k">Вагових продуктів, брутто</div><div className="v">{qty(totalGross, 'г', true)}</div></div>
        <div className="stat">
          <div className="k">Куплено</div>
          <div className="v">{boughtCount} / {rows.length}</div>
          <div className="progress" style={{ marginTop: 8 }} aria-label={`Куплено ${pct}%`}><i style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <section className="card flush">
        <div className="row wrap no-print" style={{ padding: 16, gap: 12, borderBottom: '1px solid var(--line)' }}>
          <SearchInput value={q} onChange={setQ} placeholder="Знайти продукт…" />
          <label className="check small"><input type="checkbox" checked={inKg} onChange={(e) => setInKg(e.target.checked)} /> у кг</label>
          <label className="check small"><input type="checkbox" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} /> лише некуплені</label>
          <div className="row">
            {boughtCount > 0 && (
              <button className="btn ghost sm" onClick={() => save(new Set())} title="Зняти всі позначки">Скинути</button>
            )}
            <button className="btn sm" onClick={exportCsv}><Icon name="download" size={16} /> Excel</button>
            <button className="btn sm" onClick={() => window.print()}><Icon name="printer" size={16} /> Друк</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="purchase">
            <thead>
              <tr>
                <th className="no-print" style={{ width: 44 }}><span className="sr-only">Куплено</span></th>
                <th style={{ width: 44 }}>№</th>
                <th>Продукт</th>
                <th className="num">Закупити (брутто)</th>
                <th className="num hide-sm">Нетто</th>
                <th className="num hide-sm">Страв</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const done = bought.has(k(r))
                return (
                  <tr key={k(r)} className={done ? 'done' : ''} onClick={(e) => (e.target as HTMLElement).tagName !== 'INPUT' && toggle(k(r))} style={{ cursor: 'pointer' }}>
                    <td className="no-print">
                      <input type="checkbox" checked={done} onChange={() => toggle(k(r))} aria-label={`Куплено: ${r.product}`} />
                    </td>
                    <td className="muted tnum">{rows.indexOf(r) + 1}</td>
                    <td>
                      <span className="pname">{r.product}</span>
                      {r.unit !== 'г' && <span className="tag">{r.unit}</span>}
                    </td>
                    <td className="num strong">{qty(r.gross_total, r.unit, inKg)}</td>
                    <td className="num muted hide-sm">{qty(r.net_total, 'г', inKg)}</td>
                    <td className="num hide-sm" title={r.dishes.join('\n')}>
                      <span className="badge plain">{r.dishes_count}</span>
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="muted center-text" style={{ padding: 24 }}>{onlyLeft ? 'Усе куплено 🎉' : 'Нічого не знайдено'}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="no-print" />
                <td />
                <td>Разом (вагові)</td>
                <td className="num">{qty(totalGross, 'г', inKg)}</td>
                <td className="num hide-sm">{qty(totalNet, 'г', inKg)}</td>
                <td className="hide-sm" />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <p className="muted small no-print">
        Брутто — скільки закупити, нетто — вихід після обробки. Для штучних позицій (шт) брутто — кількість штук. Натисніть на рядок, щоб позначити як куплене.
      </p>
    </>
  )
}

/* ---------------- 3. Склад по стравах ---------------- */

function BreakdownTab({ order, selected }: { order: Order; selected: { dish: Dish; raw: string }[] }) {
  const [ings, setIngs] = useState<Ingredient[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idsKey = selected.map((s) => s.dish.id).join(',')

  useEffect(() => {
    if (!idsKey) return setIngs([])
    let cancelled = false
    const list = idsKey.split(',').map(Number)
    fetchAll<Ingredient>((f, t) =>
      supabase.from('dish_ingredients').select('*, products(name)').in('dish_id', list).order('dish_id').order('position').range(f, t),
    )
      .then((r) => !cancelled && setIngs(r))
      .catch((e) => !cancelled && setError(errText(e)))
    return () => {
      cancelled = true
    }
  }, [idsKey])

  if (error) return <Alert kind="err">{error}</Alert>
  if (!ings) return <div className="card"><Skeleton rows={8} /></div>
  if (selected.length === 0) return <div className="card"><Empty icon="list" title="Меню порожнє" text="Спершу додайте страви на кроці 1." /></div>

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
      <div className="card-head no-print">
        <div>
          <h3>Склад по стравах</h3>
          <p>Технологічні карти обраних страв: на 1 порцію і на всю кількість.</p>
        </div>
        <div className="row">
          <button className="btn sm" onClick={exportCsv}><Icon name="download" size={16} /> Excel</button>
          <button className="btn sm" onClick={() => window.print()}><Icon name="printer" size={16} /> Друк</button>
        </div>
      </div>
      {selected.map(({ dish, raw }) => {
        const n = Number(raw.replace(',', '.')) || 0
        const list = ings.filter((i) => i.dish_id === dish.id)
        return (
          <div key={dish.id} className="breakdown">
            <h4>
              {dish.name} <span className="badge plain">× {fmt(n)}</span>
            </h4>
            {list.length === 0 ? (
              <Alert kind="warn">Немає технологічної карти — додайте склад у розділі «Страви».</Alert>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Продукт</th>
                      <th className="num hide-sm">Брутто / порц.</th>
                      <th className="num hide-sm">Нетто / порц., г</th>
                      <th className="num">Брутто всього</th>
                      <th className="num">Нетто, г</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((i) => (
                      <tr key={i.id}>
                        <td>{i.products?.name}</td>
                        <td className="num hide-sm">{qty(i.gross, i.unit, false)}</td>
                        <td className="num hide-sm">{fmt(i.net)}</td>
                        <td className="num strong">{qty(i.gross * n, i.unit, false)}</td>
                        <td className="num">{fmt(i.net * n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
