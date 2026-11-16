import { useEffect, useState, type FormEvent } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { errText } from '../lib/format'

type Row = Product & { dish_ingredients: { count: number }[] }

export default function Products() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<Record<number, { name: string; category: string }>>({})

  async function load() {
    try {
      setRows(
        await fetchAll<Row>((f, t) =>
          supabase.from('products').select('*, dish_ingredients(count)').order('name').range(f, t),
        ),
      )
    } catch (e) {
      setError(errText(e))
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('products').insert({ name: name.trim() })
    if (error) return setError(error.code === '23505' ? 'Такий продукт уже є' : error.message)
    setName('')
    load()
  }

  async function save(p: Row) {
    const v = edit[p.id]
    const { error } = await supabase
      .from('products')
      .update({ name: v.name.trim(), category: v.category.trim() || null })
      .eq('id', p.id)
    if (error) return setError(error.code === '23505' ? 'Продукт з такою назвою вже є' : error.message)
    setEdit(({ [p.id]: _, ...rest }) => rest)
    load()
  }

  async function remove(p: Row) {
    if (!confirm(`Видалити «${p.name}»?`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) setError(error.code === '23503' ? 'Продукт використовується у стравах — спершу приберіть його з техкарт.' : error.message)
    else load()
  }

  const list = (rows ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="page">
      <h1>Довідник продуктів</h1>
      <p className="muted">Єдині назви продуктів — щоб закупка коректно сумувала однакові позиції з різних страв.</p>
      <form className="card row-form" onSubmit={add}>
        <label className="grow">
          Новий продукт
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="primary">+ Додати</button>
      </form>
      {error && <div className="alert err" onClick={() => setError(null)}>{error}</div>}
      <div className="card">
        <div className="toolbar">
          <input className="search" placeholder="Пошук…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{list.length} продуктів</span>
        </div>
        {!rows ? (
          <p className="muted">Завантаження…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Продукт</th>
                  <th>Категорія</th>
                  <th className="num">У стравах</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const e = edit[p.id]
                  const used = p.dish_ingredients[0]?.count ?? 0
                  return (
                    <tr key={p.id}>
                      <td>
                        {e ? (
                          <input value={e.name} onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, name: ev.target.value } })} />
                        ) : (
                          p.name
                        )}
                      </td>
                      <td>
                        {e ? (
                          <input
                            value={e.category}
                            onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, category: ev.target.value } })}
                          />
                        ) : (
                          <span className="muted">{p.category ?? '—'}</span>
                        )}
                      </td>
                      <td className="num">{used || <span className="muted">0</span>}</td>
                      <td className="actions">
                        {e ? (
                          <>
                            <button className="primary small" onClick={() => save(p)}>Зберегти</button>
                            <button className="ghost small" onClick={() => setEdit(({ [p.id]: _, ...rest }) => rest)}>Скасувати</button>
                          </>
                        ) : (
                          <>
                            <button className="ghost small" onClick={() => setEdit({ ...edit, [p.id]: { name: p.name, category: p.category ?? '' } })}>
                              Змінити
                            </button>
                            {used === 0 && (
                              <button className="ghost small danger" onClick={() => remove(p)}>Видалити</button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
