import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL, type Order } from '../lib/types'
import { errText, fmtDate } from '../lib/format'

type Row = Order & { order_items: { count: number }[] }

export default function Orders() {
  const nav = useNavigate()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [guests, setGuests] = useState('')

  async function load() {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(count)')
      .order('created_at', { ascending: false })
    if (error) setError(error.message)
    else setRows(data as Row[])
  }
  useEffect(() => {
    load()
  }, [])

  async function create(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase
      .from('orders')
      .insert({ title: title.trim(), event_date: date || null, guests: guests ? Number(guests) : null })
      .select('id')
      .single()
    if (error) return setError(error.message)
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
      const { data: items, error: e2 } = await supabase
        .from('order_items')
        .select('dish_id, quantity')
        .eq('order_id', o.id)
      if (e2) throw e2
      if (items?.length) {
        const { error: e3 } = await supabase
          .from('order_items')
          .insert(items.map((i) => ({ ...i, order_id: data.id })))
        if (e3) throw e3
      }
      nav(`/orders/${data.id}`)
    } catch (e) {
      setError(errText(e))
    }
  }

  async function remove(o: Row) {
    if (!confirm(`Видалити замовлення «${o.title}»?`)) return
    const { error } = await supabase.from('orders').delete().eq('id', o.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="page">
      <h1>Замовлення</h1>
      <form className="card row-form" onSubmit={create}>
        <label className="grow">
          Назва заходу
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Фуршет 25.12, офіс" />
        </label>
        <label>
          Дата
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Гостей
          <input type="number" min={0} value={guests} onChange={(e) => setGuests(e.target.value)} className="w-num" />
        </label>
        <button className="primary">+ Нове замовлення</button>
      </form>
      {error && <div className="alert err">{error}</div>}
      {!rows ? (
        <p className="muted">Завантаження…</p>
      ) : rows.length === 0 ? (
        <div className="card empty">
          Ще немає замовлень. Створіть перше — оберіть страви, вкажіть кількість, і платформа порахує закупку.
        </div>
      ) : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Назва</th>
                <th>Дата</th>
                <th className="num">Гостей</th>
                <th className="num">Страв</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/orders/${o.id}`}>{o.title}</Link>
                  </td>
                  <td>{fmtDate(o.event_date)}</td>
                  <td className="num">{o.guests ?? '—'}</td>
                  <td className="num">{o.order_items[0]?.count ?? 0}</td>
                  <td>
                    <span className={`badge ${o.status}`}>{STATUS_LABEL[o.status]}</span>
                  </td>
                  <td className="actions">
                    <button className="ghost small" onClick={() => duplicate(o)} title="Створити копію">
                      Копія
                    </button>
                    <button className="ghost small danger" onClick={() => remove(o)}>
                      Видалити
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
