import { useEffect, useState, type FormEvent } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { errText } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, SearchInput, Skeleton, useConfirm, useToast } from '../components/ui'

type Row = Product & { dish_ingredients: { count: number }[] }

export default function Products() {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'unused'>('all')
  const [name, setName] = useState('')
  const [edit, setEdit] = useState<Record<number, { name: string; category: string }>>({})

  async function load() {
    try {
      setRows(await fetchAll<Row>((f, t) => supabase.from('products').select('*, dish_ingredients(count)').order('name').range(f, t)))
    } catch (e) {
      toast(errText(e), 'err')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase.from('products').insert({ name: name.trim() })
    if (error) return toast(error.code === '23505' ? 'Такий продукт уже є' : error.message, 'err')
    toast(`«${name.trim()}» додано`)
    setName('')
    load()
  }

  async function save(p: Row) {
    const v = edit[p.id]
    const { error } = await supabase.from('products').update({ name: v.name.trim(), category: v.category.trim() || null }).eq('id', p.id)
    if (error) return toast(error.code === '23505' ? 'Продукт з такою назвою вже є' : error.message, 'err')
    setEdit(({ [p.id]: _, ...rest }) => rest)
    toast('Збережено — назва оновилась у всіх техкартах')
    load()
  }

  async function remove(p: Row) {
    const ok = await confirm({ title: 'Видалити продукт?', text: `«${p.name}» буде видалено з довідника.`, ok: 'Видалити', danger: true })
    if (!ok) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) return toast(error.code === '23503' ? 'Продукт використовується у стравах — спершу приберіть його з техкарт.' : error.message, 'err')
    toast('Продукт видалено')
    load()
  }

  const used = (p: Row) => p.dish_ingredients[0]?.count ?? 0
  const unusedCount = (rows ?? []).filter((p) => used(p) === 0).length
  const list = (rows ?? []).filter(
    (p) => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (filter === 'all' || used(p) === 0),
  )

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Довідник</div>
          <h1>Продукти</h1>
          <p>Єдині назви продуктів — щоб закупка коректно сумувала однакові позиції з різних страв.</p>
        </div>
      </div>

      <form className="card row wrap" style={{ gap: 12, alignItems: 'flex-end' }} onSubmit={add}>
        <label className="field grow">
          <span>Новий продукт</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Сир Брі" />
        </label>
        <button className="btn primary"><Icon name="plus" size={18} /> Додати</button>
      </form>

      <section className="card flush">
        <div className="row wrap" style={{ padding: 16, gap: 12, borderBottom: '1px solid var(--line)' }}>
          <SearchInput value={q} onChange={setQ} placeholder="Знайти продукт…" />
          <div className="chips">
            <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>Усі<span className="count">{rows?.length ?? 0}</span></button>
            <button className={filter === 'unused' ? 'chip active' : 'chip'} onClick={() => setFilter('unused')}>Не використовуються<span className="count">{unusedCount}</span></button>
          </div>
        </div>
        {!rows ? (
          <div style={{ padding: 16 }}><Skeleton rows={8} /></div>
        ) : list.length === 0 ? (
          <Empty icon="products" title="Нічого не знайдено" text="Змініть запит або фільтр." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Продукт</th>
                  <th className="hide-sm">Категорія</th>
                  <th className="num">У стравах</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const e = edit[p.id]
                  return (
                    <tr key={p.id}>
                      <td>
                        {e ? (
                          <input autoFocus value={e.name} aria-label="Назва" onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, name: ev.target.value } })} onKeyDown={(ev) => ev.key === 'Enter' && save(p)} />
                        ) : (
                          <span className="strong" style={{ fontWeight: 500 }}>{p.name}</span>
                        )}
                      </td>
                      <td className="hide-sm">
                        {e ? (
                          <input value={e.category} aria-label="Категорія" placeholder="Напр.: Сири" onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, category: ev.target.value } })} />
                        ) : (
                          <span className="muted">{p.category ?? '—'}</span>
                        )}
                      </td>
                      <td className="num">{used(p) ? <span className="badge plain">{used(p)}</span> : <span className="muted">0</span>}</td>
                      <td className="actions">
                        {e ? (
                          <>
                            <button className="btn primary sm" onClick={() => save(p)}>Зберегти</button>
                            <button className="btn ghost sm" onClick={() => setEdit(({ [p.id]: _, ...rest }) => rest)}>Скасувати</button>
                          </>
                        ) : (
                          <>
                            <button className="btn ghost icon sm" aria-label={`Змінити «${p.name}»`} title="Змінити" onClick={() => setEdit({ ...edit, [p.id]: { name: p.name, category: p.category ?? '' } })}>
                              <Icon name="edit" size={17} />
                            </button>
                            {used(p) === 0 && (
                              <button className="btn ghost icon sm danger" aria-label={`Видалити «${p.name}»`} title="Видалити" onClick={() => remove(p)}>
                                <Icon name="trash" size={17} />
                              </button>
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
      </section>
    </div>
  )
}
