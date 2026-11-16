import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL, type Order, type OrderStatus } from '../lib/types'
import { errText } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, SearchInput, Skeleton, useConfirm, useToast } from '../components/ui'

type Row = Order & { order_items: { count: number }[] }
const MONTHS = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру']

export default function Orders() {
  const nav = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<OrderStatus | ''>('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [guests, setGuests] = useState('')

  async function load() {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(count)')
      .order('created_at', { ascending: false })
    if (error) toast(error.message, 'err')
    else setRows(data as Row[])
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const stats = useMemo(() => {
    const r = rows ?? []
    return {
      upcoming: r.filter((o) => o.event_date && o.event_date >= today && o.status !== 'done').length,
      drafts: r.filter((o) => o.status === 'draft').length,
      toBuy: r.filter((o) => o.status === 'confirmed').length,
      total: r.length,
    }
  }, [rows, today])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const o of rows ?? []) c[o.status] = (c[o.status] ?? 0) + 1
    return c
  }, [rows])

  // Найближчі заходи першими, далі без дати, далі минулі (найсвіжіші зверху)
  const rank = (o: Row) => (!o.event_date ? 1 : o.event_date >= today ? 0 : 2)
  const list = (rows ?? [])
    .filter((o) => (!status || o.status === status) && (!q || o.title.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => {
      const r = rank(a) - rank(b)
      if (r) return r
      if (rank(a) === 0) return a.event_date!.localeCompare(b.event_date!)
      if (rank(a) === 2) return b.event_date!.localeCompare(a.event_date!)
      return b.created_at.localeCompare(a.created_at)
    })

  async function create(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase
      .from('orders')
      .insert({ title: title.trim(), event_date: date || null, guests: guests ? Number(guests) : null })
      .select('id')
      .single()
    if (error) return toast(error.message, 'err')
    nav(`/orders/${data.id}`)
  }

  async function duplicate(o: Row) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .insert({ title: `${o.title} (копія)`, event_date: o.event_date, guests: o.guests, notes: o.notes })
        .select('id')
        .single()
      if (error) throw error
      const { data: items, error: e2 } = await supabase.from('order_items').select('dish_id, quantity').eq('order_id', o.id)
      if (e2) throw e2
      if (items?.length) {
        const { error: e3 } = await supabase.from('order_items').insert(items.map((i) => ({ ...i, order_id: data.id })))
        if (e3) throw e3
      }
      toast('Копію створено')
      nav(`/orders/${data.id}`)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  async function remove(o: Row) {
    const ok = await confirm({
      title: 'Видалити замовлення?',
      text: `«${o.title}» буде видалено разом із меню. Цю дію не можна скасувати.`,
      ok: 'Видалити',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('orders').delete().eq('id', o.id)
    if (error) return toast(error.message, 'err')
    toast('Замовлення видалено')
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Робочий простір</div>
          <h1>Замовлення</h1>
          <p>Створіть захід, оберіть страви — платформа порахує, скільки продуктів закупити.</p>
        </div>
        {!creating && (
          <button className="btn primary lg" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} /> Нове замовлення
          </button>
        )}
      </div>

      {creating && (
        <form className="card" onSubmit={create}>
          <div className="card-head">
            <h3>Нове замовлення</h3>
            <button type="button" className="btn ghost icon sm" aria-label="Закрити" onClick={() => setCreating(false)}>
              <Icon name="x" size={18} />
            </button>
          </div>
          <div className="form-grid">
            <label className="field span-2">
              <span>Назва заходу</span>
              <input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Напр.: Фуршет, офіс «Альфа», 25.12" />
            </label>
            <label className="field">
              <span>Дата</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Кількість гостей</span>
              <input type="number" min={0} inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} placeholder="0" />
            </label>
            <button className="btn primary">
              Створити і обрати страви <Icon name="next" size={18} />
            </button>
          </div>
        </form>
      )}

      {rows && rows.length > 0 && (
        <div className="stats">
          <div className="stat"><div className="k">Найближчі заходи</div><div className="v">{stats.upcoming}</div></div>
          <div className="stat"><div className="k">Чернетки</div><div className="v">{stats.drafts}</div></div>
          <div className="stat"><div className="k">Чекають закупівлі</div><div className="v">{stats.toBuy}</div></div>
          <div className="stat"><div className="k">Усього замовлень</div><div className="v">{stats.total}</div></div>
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="row wrap" style={{ gap: 12 }}>
          <SearchInput value={q} onChange={setQ} placeholder="Пошук за назвою…" />
          <div className="chips" role="tablist" aria-label="Фільтр за статусом">
            <button className={!status ? 'chip active' : 'chip'} onClick={() => setStatus('')}>
              Усі<span className="count">{rows.length}</span>
            </button>
            {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
              <button key={s} className={status === s ? 'chip active' : 'chip'} onClick={() => setStatus(status === s ? '' : s)}>
                {STATUS_LABEL[s]}
                <span className="count">{counts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!rows ? (
        <div className="order-grid"><Skeleton rows={3} card /></div>
      ) : rows.length === 0 ? (
        <div className="card">
          <Empty
            icon="orders"
            title="Ще немає замовлень"
            text="Створіть перше замовлення: вкажіть захід і кількість гостей, оберіть страви — список закупівлі сформується автоматично."
            action={
              <button className="btn primary" onClick={() => setCreating(true)}>
                <Icon name="plus" size={18} /> Нове замовлення
              </button>
            }
          />
        </div>
      ) : list.length === 0 ? (
        <div className="card"><Empty icon="search" title="Нічого не знайдено" text="Змініть пошуковий запит або фільтр статусу." /></div>
      ) : (
        <div className="order-grid">
          {list.map((o) => {
            const d = o.event_date ? new Date(o.event_date + 'T00:00:00') : null
            const past = o.event_date && o.event_date < today
            const dishes = o.order_items[0]?.count ?? 0
            return (
              <article key={o.id} className="order-card" style={past && o.status !== 'done' ? { opacity: 0.8 } : undefined}>
                <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <div className="date-pill" aria-hidden="true">
                    {d ? (
                      <>
                        <span className="d">{d.getDate()}</span>
                        <span className="m">{MONTHS[d.getMonth()]}</span>
                      </>
                    ) : (
                      <Icon name="calendar" size={20} className="muted" />
                    )}
                  </div>
                  <div className="grow">
                    <h3>
                      <Link to={`/orders/${o.id}`} className="stretched">{o.title}</Link>
                    </h3>
                    <div className="meta" style={{ marginTop: 6 }}>
                      <span><Icon name="users" size={15} /> {o.guests ?? '—'} гостей</span>
                      <span><Icon name="dishes" size={15} /> {dishes} страв</span>
                    </div>
                  </div>
                </div>
                <div className="foot">
                  <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  <div className="card-actions">
                    <button className="btn ghost icon sm" title="Створити копію" aria-label={`Копія «${o.title}»`} onClick={() => duplicate(o)}>
                      <Icon name="copy" size={17} />
                    </button>
                    <button className="btn ghost icon sm danger" title="Видалити" aria-label={`Видалити «${o.title}»`} onClick={() => remove(o)}>
                      <Icon name="trash" size={17} />
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
