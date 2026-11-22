import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import type { DishCost, DishOverview } from '../lib/types'
import { errText, fmt } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, SearchInput, Skeleton, useToast } from '../components/ui'
import CategoryChips from '../components/CategoryChips'
import { kcalFmt, type DishNutr } from '../lib/nutrition'
import { uah } from '../lib/cost'
import { catOf, categoryCounts, dishMatches } from '../lib/search'

export default function Dishes() {
  const nav = useNavigate()
  const toast = useToast()
  const [rows, setRows] = useState<DishOverview[] | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [nutr, setNutr] = useState<Map<number, DishNutr>>(new Map())
  const [costs, setCosts] = useState<Map<number, DishCost>>(new Map())

  useEffect(() => {
    fetchAll<DishOverview>((f, t) => supabase.from('dish_overview').select('*').order('name').range(f, t))
      .then(setRows)
      .catch((e) => toast(errText(e), 'err'))
    fetchAll<DishNutr>((f, t) => supabase.from('dish_nutrition').select('*').range(f, t))
      .then((r) => setNutr(new Map(r.map((n) => [n.dish_id, n]))))
      .catch((e) => toast(errText(e), 'err'))
    fetchAll<DishCost>((f, t) => supabase.from('dish_cost').select('*').range(f, t))
      .then((r) => setCosts(new Map(r.map((c) => [c.dish_id, c]))))
      .catch((e) => toast(errText(e), 'err'))
  }, [toast])

  const cats = useMemo(() => categoryCounts(rows ?? [], q), [rows, q])
  const allCats = useMemo(() => categoryCounts(rows ?? [], ''), [rows])
  const effCat = cat && cats.some(([c]) => c === cat) ? cat : ''
  const found = cats.reduce((s, [, n]) => s + n, 0)

  async function create(e: FormEvent) {
    e.preventDefault()
    const { data, error } = await supabase.from('dishes').insert({ name: name.trim() }).select('id').single()
    if (error) return toast(error.code === '23505' ? 'Страва з такою назвою вже існує' : error.message, 'err')
    nav(`/dishes/${data.id}`)
  }

  const list = (rows ?? []).filter((d) => (!effCat || catOf(d) === effCat) && dishMatches(d, q))
  const noCard = (rows ?? []).filter((d) => d.ingredients_count === 0).length

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Каталог</div>
          <h1>Страви та техкарти</h1>
          <p>Склад кожної страви на 1 порцію — з нього рахується закупка.</p>
        </div>
        {!adding && (
          <button className="btn primary lg" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> Нова страва
          </button>
        )}
      </div>

      {adding && (
        <form className="card inline-form" onSubmit={create}>
          <label className="field grow">
            <span>Назва нової страви</span>
            <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Брускета з томатами" />
          </label>
          <button className="btn primary">Створити <Icon name="next" size={18} /></button>
          <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Скасувати</button>
        </form>
      )}

      {rows && (
        <div className="stats">
          <div className="stat"><div className="k">Страв у каталозі</div><div className="v">{rows.length}</div></div>
          <div className="stat"><div className="k">Категорій</div><div className="v">{allCats.length}</div></div>
          <div className="stat"><div className="k">Без техкарти</div><div className="v" style={noCard ? { color: 'var(--warn)' } : undefined}>{noCard}</div></div>
        </div>
      )}

      <section className="card flush">
        <div className="stack" style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <SearchInput value={q} onChange={setQ} placeholder="Знайти страву…" />
          <CategoryChips cats={cats} value={effCat} onChange={setCat} total={found} />
        </div>
        {!rows ? (
          <div style={{ padding: 16 }}><Skeleton rows={8} /></div>
        ) : list.length === 0 ? (
          <Empty icon="search" title="Нічого не знайдено" text="Змініть запит або категорію." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Страва</th>
                  <th className="hide-sm">Категорія</th>
                  <th className="num">Порція, г</th>
                  <th className="num hide-sm">Інгредієнтів</th>
                  <th className="num hide-sm">Σ нетто, г</th>
                  <th className="num hide-sm">Ккал / порц.</th>
                  <th className="num" title="Собівартість 1 порції за цінами продуктів (брутто)">Собів., ₴</th>
                  <th style={{ width: 40 }} />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className={d.is_active ? '' : 'inactive'} onClick={() => nav(`/dishes/${d.id}`)} style={{ cursor: 'pointer' }}>
                    <td>
                      <Link to={`/dishes/${d.id}`} className="row-link" onClick={(e) => e.stopPropagation()}>{d.name}</Link>
                      {!d.is_active && <span className="tag">прихована</span>}
                      {d.ingredients_count === 0 && <span className="tag">без техкарти</span>}
                      <div className="sub-sm show-sm">{d.category ?? 'Без категорії'} · {d.ingredients_count} інгр.{nutr.get(d.id) ? ` · ${kcalFmt(nutr.get(d.id)!.kcal)} ккал` : ''}</div>
                    </td>
                    <td className="muted hide-sm">{d.category ?? '—'}</td>
                    <td className="num">{fmt(d.portion_weight_g)}</td>
                    <td className="num hide-sm">{d.ingredients_count}</td>
                    <td className="num hide-sm muted">{fmt(d.net_g_total)}</td>
                    <td className="num hide-sm">{nutr.get(d.id) ? kcalFmt(nutr.get(d.id)!.kcal) : '—'}</td>
                    <td className="num cost">
                      {costs.get(d.id) && d.ingredients_count > 0 ? uah(Number(costs.get(d.id)!.cost)) : '—'}
                      {costs.get(d.id)?.missing ? <div className="cost-missing" title="Для частини продуктів немає ціни">без {costs.get(d.id)!.missing} цін</div> : null}
                    </td>
                    <td className="muted"><Icon name="next" size={18} /></td>
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
