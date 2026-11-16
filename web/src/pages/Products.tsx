import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { Product } from '../lib/types'
import { errText } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, SearchInput, Skeleton, useConfirm, useToast } from '../components/ui'
import CategoryChips from '../components/CategoryChips'
import { catOf, categoryCounts, dishMatches, norm } from '../lib/search'
import { gFmt, kcalFmt } from '../lib/nutrition'

type Edit = { name: string; category: string; kcal: string; protein: string; fat: string; carbs: string }
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const NUTR: { k: 'kcal' | 'protein' | 'fat' | 'carbs'; label: string }[] = [
  { k: 'kcal', label: 'Ккал' },
  { k: 'protein', label: 'Б' },
  { k: 'fat', label: 'Ж' },
  { k: 'carbs', label: 'В' },
]

type Row = Product & { dish_ingredients: { count: number }[] }

export default function Products() {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'unused'>('all')
  const [name, setName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<Record<number, Edit>>({})

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
    const { error } = await supabase.from('products').insert({ name: name.trim(), category: newCat.trim() || null })
    if (error) return toast(error.code === '23505' ? 'Такий продукт уже є' : error.message, 'err')
    toast(`«${name.trim()}» додано`)
    setName('')
    setNewCat('')
    load()
  }

  async function save(p: Row) {
    const v = edit[p.id]
    // Перейменування на назву, яка вже є, — пропонуємо об'єднати дублі
    const other = (rows ?? []).find((x) => x.id !== p.id && norm(x.name) === norm(v.name))
    if (other) {
      const ok = await confirm({
        title: 'Такий продукт уже є',
        text: `«${other.name}» вже є в довіднику. Об'єднати «${p.name}» з ним? Усі техкарти перейдуть на «${other.name}», кількості в стравах, де є обидва, складуться.`,
        ok: "Об'єднати",
      })
      if (!ok) return
      const { error } = await supabase.rpc('merge_products', { p_keep: other.id, p_dup: p.id })
      if (error) return toast(error.message, 'err')
      setEdit(({ [p.id]: _, ...rest }) => rest)
      toast(`Об'єднано з «${other.name}»`)
      return load()
    }
    const vals = { kcal: numOrNull(v.kcal), protein: numOrNull(v.protein), fat: numOrNull(v.fat), carbs: numOrNull(v.carbs) }
    if (Object.values(vals).some((x) => x != null && (Number.isNaN(x) || x < 0)))
      return toast('КБЖВ — невід\'ємні числа (на 100 г)', 'err')
    const { error } = await supabase
      .from('products')
      .update({ name: v.name.trim(), category: v.category.trim() || null, ...vals })
      .eq('id', p.id)
    if (error) return toast(error.code === '23505' ? 'Продукт з такою назвою вже є' : error.message, 'err')
    setEdit(({ [p.id]: _, ...rest }) => rest)
    toast('Збережено — зміни застосовано в усіх техкартах')
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
  const base = useMemo(() => (rows ?? []).filter((p) => filter === 'all' || used(p) === 0), [rows, filter])
  const unusedCount = (rows ?? []).filter((p) => used(p) === 0).length
  const cats = useMemo(() => categoryCounts(base, q), [base, q])
  const allCats = useMemo(() => [...new Set((rows ?? []).map((p) => p.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'uk')), [rows])
  const effCat = cat && cats.some(([c]) => c === cat) ? cat : ''
  const found = cats.reduce((s, [, n]) => s + n, 0)
  const list = base.filter((p) => (!effCat || catOf(p) === effCat) && dishMatches(p, q))

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Довідник</div>
          <h1>Продукти</h1>
          <p>Єдині назви продуктів — щоб закупка коректно сумувала однакові позиції з різних страв. КБЖВ вказано на 100 г їстівної частини.</p>
        </div>
      </div>

      <form className="card row wrap" style={{ gap: 12, alignItems: 'flex-end' }} onSubmit={add}>
        <label className="field grow">
          <span>Новий продукт</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Сир Брі" />
        </label>
        <label className="field" style={{ minWidth: 220 }}>
          <span>Категорія</span>
          <input list="product-cats" value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Оберіть або введіть" />
        </label>
        <button className="btn primary"><Icon name="plus" size={18} /> Додати</button>
      </form>

      <section className="card flush">
        <datalist id="product-cats">
          {allCats.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="stack" style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <SearchInput value={q} onChange={setQ} placeholder="Знайти продукт або категорію…" />
            <label className="check small">
              <input type="checkbox" checked={filter === 'unused'} onChange={(e) => setFilter(e.target.checked ? 'unused' : 'all')} />
              Лише ті, що не використовуються ({unusedCount})
            </label>
          </div>
          <CategoryChips cats={cats} value={effCat} onChange={setCat} total={found} />
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
                  {NUTR.map((x) => (
                    <th key={x.k} className="num hide-sm" title={`${x.label} на 100 г`}>{x.label}</th>
                  ))}
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
                          <input list="product-cats" value={e.category} aria-label="Категорія" placeholder="Оберіть або введіть" onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, category: ev.target.value } })} />
                        ) : (
                          p.category ? <span className="badge plain">{p.category}</span> : <span className="muted">—</span>
                        )}
                      </td>
                      {NUTR.map((x) => (
                        <td key={x.k} className="num hide-sm tnum">
                          {e ? (
                            <input
                              className="w-num"
                              style={{ width: 70 }}
                              inputMode="decimal"
                              aria-label={`${x.label} на 100 г`}
                              value={e[x.k]}
                              onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, [x.k]: ev.target.value } })}
                            />
                          ) : p[x.k] == null ? (
                            <span className="warn-text">—</span>
                          ) : x.k === 'kcal' ? (
                            kcalFmt(Number(p.kcal))
                          ) : (
                            <span className="muted">{gFmt(Number(p[x.k]))}</span>
                          )}
                        </td>
                      ))}
                      <td className="num">{used(p) ? <span className="badge plain">{used(p)}</span> : <span className="muted">0</span>}</td>
                      <td className="actions">
                        {e ? (
                          <>
                            <button className="btn primary sm" onClick={() => save(p)}>Зберегти</button>
                            <button className="btn ghost sm" onClick={() => setEdit(({ [p.id]: _, ...rest }) => rest)}>Скасувати</button>
                          </>
                        ) : (
                          <>
                            <button className="btn ghost icon sm" aria-label={`Змінити «${p.name}»`} title="Змінити" onClick={() =>
                                setEdit({
                                  ...edit,
                                  [p.id]: {
                                    name: p.name,
                                    category: p.category ?? '',
                                    kcal: p.kcal == null ? '' : String(p.kcal),
                                    protein: p.protein == null ? '' : String(p.protein),
                                    fat: p.fat == null ? '' : String(p.fat),
                                    carbs: p.carbs == null ? '' : String(p.carbs),
                                  },
                                })
                              }>
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
