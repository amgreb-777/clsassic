import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import type { DishOverview } from '../lib/types'
import { errText, fmt } from '../lib/format'

export default function Dishes() {
  const nav = useNavigate()
  const [rows, setRows] = useState<DishOverview[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    fetchAll<DishOverview>((f, t) => supabase.from('dish_overview').select('*').order('name').range(f, t))
      .then(setRows)
      .catch((e) => setError(errText(e)))
  }, [])

  const cats = useMemo(
    () => [...new Set((rows ?? []).map((d) => d.category ?? 'Без категорії'))].sort((a, b) => a.localeCompare(b, 'uk')),
    [rows],
  )

  async function create(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('dishes').insert({ name: name.trim() }).select('id').single()
    if (error) return setError(error.code === '23505' ? 'Страва з такою назвою вже існує' : error.message)
    nav(`/dishes/${data.id}`)
  }

  const list = (rows ?? []).filter(
    (d) =>
      (!cat || (d.category ?? 'Без категорії') === cat) && (!q || d.name.toLowerCase().includes(q.toLowerCase())),
  )

  return (
    <div className="page">
      <h1>Страви та технологічні карти</h1>
      <form className="card row-form" onSubmit={create}>
        <label className="grow">
          Нова страва
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Назва страви" />
        </label>
        <button className="primary">+ Додати</button>
      </form>
      {error && <div className="alert err">{error}</div>}
      <div className="card">
        <div className="toolbar">
          <input className="search" placeholder="Пошук…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Усі категорії</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted small">{list.length} страв</span>
        </div>
        {!rows ? (
          <p className="muted">Завантаження…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Страва</th>
                  <th>Категорія</th>
                  <th className="num">Вага порції, г</th>
                  <th className="num">Інгредієнтів</th>
                  <th className="num">Σ нетто (г)</th>
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className={d.is_active ? '' : 'inactive'}>
                    <td>
                      <Link to={`/dishes/${d.id}`}>{d.name}</Link>
                      {!d.is_active && <span className="unit-tag">прихована</span>}
                    </td>
                    <td className="muted">{d.category ?? '—'}</td>
                    <td className="num">{fmt(d.portion_weight_g)}</td>
                    <td className="num">{d.ingredients_count || <span className="warn-text">0</span>}</td>
                    <td className="num">{fmt(d.net_g_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
