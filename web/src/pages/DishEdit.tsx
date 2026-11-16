import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import type { Dish, Ingredient, Product, Unit } from '../lib/types'
import { errText, fmt } from '../lib/format'
import Icon from '../components/Icon'
import { Alert, Skeleton, useConfirm, useToast } from '../components/ui'

type Line = { key: string; product: string; gross: string; net: string; unit: Unit }
let seq = 0
const newKey = () => `k${++seq}`

export default function DishEdit() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [dish, setDish] = useState<Dish | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: d, error: e1 }, { data: ings, error: e2 }, prods, { data: cs, error: e3 }] = await Promise.all([
          supabase.from('dishes').select('*').eq('id', id).single(),
          supabase.from('dish_ingredients').select('*, products(name)').eq('dish_id', id).order('position'),
          fetchAll<Product>((f, t) => supabase.from('products').select('*').order('name').range(f, t)),
          supabase.from('dishes').select('category'),
        ])
        if (cancelled) return
        if (e1) throw e1
        if (e2) throw e2
        if (e3) throw e3
        setDish(d)
        const built: Line[] = ((ings ?? []) as Ingredient[]).map((i) => ({
          key: newKey(),
          product: i.products?.name ?? '',
          gross: String(i.gross),
          net: String(i.net),
          unit: i.unit,
        }))
        setLines(built)
        setSaved(JSON.stringify({ dish: d, lines: built }))
        setProducts(prods)
        setCats([...new Set((cs ?? []).map((c) => c.category).filter(Boolean) as string[])].sort())
      } catch (e) {
        if (!cancelled) setError(errText(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const known = useMemo(() => new Set(products.map((p) => p.name.toLowerCase())), [products])
  const n = (s: string) => Number(s.replace(',', '.')) || 0
  const netG = lines.filter((l) => l.unit === 'г').reduce((s, l) => s + n(l.net), 0)
  const netAll = lines.reduce((s, l) => s + n(l.net), 0)

  function upd(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  async function save() {
    if (!dish) return
    setBusy(true)
    try {
      const { error } = await supabase
        .from('dishes')
        .update({
          name: dish.name.trim(),
          category: dish.category?.trim() || null,
          portion_weight_g: dish.portion_weight_g,
          is_active: dish.is_active,
        })
        .eq('id', id)
      if (error) throw error.code === '23505' ? new Error('Страва з такою назвою вже існує') : error
      const items = lines
        .filter((l) => l.product.trim())
        .map((l) => ({ product: l.product.trim(), gross: n(l.gross), net: n(l.net), unit: l.unit }))
      const { error: e2 } = await supabase.rpc('save_dish_ingredients', { p_dish_id: id, p_items: items })
      if (e2) throw e2
      const added = items.filter((i) => !known.has(i.product.toLowerCase())).map((i) => i.product)
      setSaved(JSON.stringify({ dish, lines }))
      toast(added.length ? `Збережено. Нові продукти в довіднику: ${added.join(', ')}` : 'Техкарту збережено')
      if (added.length)
        setProducts(await fetchAll<Product>((f, t) => supabase.from('products').select('*').order('name').range(f, t)))
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setBusy(false)
    }
  }


  async function remove() {
    if (!dish) return
    const ok = await confirm({
      title: 'Видалити страву?',
      text: `«${dish.name}» буде видалено разом із технологічною картою.`,
      ok: 'Видалити',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('dishes').delete().eq('id', id)
    if (error)
      toast(
        error.code === '23503'
          ? 'Страва використовується в замовленнях. Вимкніть «Показувати в каталозі», щоб приховати її.'
          : error.message,
        'err',
      )
    else {
      toast('Страву видалено')
      nav('/dishes')
    }
  }

  if (error && !dish)
    return (
      <div className="page">
        <Link to="/dishes" className="back"><Icon name="back" size={18} /> Страви</Link>
        <Alert kind="err">{error}</Alert>
      </div>
    )
  if (!dish)
    return (
      <div className="page">
        <Skeleton rows={1} card />
        <Skeleton rows={6} />
      </div>
    )

  const dirty = saved !== '' && saved !== JSON.stringify({ dish, lines })
  const portionMismatch = dish.portion_weight_g ? Math.abs(netG - dish.portion_weight_g) > dish.portion_weight_g * 0.25 : false

  return (
    <div className="page">
      <div>
        <Link to="/dishes" className="back"><Icon name="back" size={18} /> Страви</Link>
        <div className="page-head">
          <div className="grow">
            <div className="eyebrow">{dish.category || 'Без категорії'}</div>
            <h1>{dish.name || 'Нова страва'}</h1>
          </div>
          <div className="row">
            <button className="btn ghost danger" onClick={remove}><Icon name="trash" size={18} /> Видалити</button>
            <button className="btn primary" onClick={save} disabled={busy || !dirty}>
              <Icon name="check" size={18} /> {busy ? 'Збереження…' : dirty ? 'Зберегти' : 'Збережено'}
            </button>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="form-grid">
          <label className="field span-2">
            <span>Назва страви</span>
            <input value={dish.name} onChange={(e) => setDish({ ...dish, name: e.target.value })} />
          </label>
          <label className="field">
            <span>Категорія</span>
            <input list="cats" value={dish.category ?? ''} onChange={(e) => setDish({ ...dish, category: e.target.value })} placeholder="Оберіть або введіть" />
            <datalist id="cats">
              {cats.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Вага 1 порції, г</span>
            <input
              inputMode="decimal"
              className="tnum"
              value={dish.portion_weight_g ?? ''}
              onChange={(e) => setDish({ ...dish, portion_weight_g: e.target.value ? n(e.target.value) : null })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={dish.is_active} onChange={(e) => setDish({ ...dish, is_active: e.target.checked })} />
            Показувати в каталозі
          </label>
        </div>
      </section>

      <section className="card flush">
        <div className="card-head" style={{ padding: '20px 20px 0' }}>
          <div>
            <h3>Технологічна карта</h3>
            <p>Склад на 1 порцію. Нові назви продуктів автоматично додаються в довідник.</p>
          </div>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))' }}>
            <div className="stat"><div className="k">Вихід, нетто</div><div className="v">{fmt(netAll)} г</div></div>
            <div className="stat">
              <div className="k">Порція</div>
              <div className="v" style={portionMismatch ? { color: 'var(--warn)' } : undefined}>{fmt(dish.portion_weight_g)} г</div>
            </div>
          </div>
        </div>
        <datalist id="products">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="edit">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>Продукт</th>
                <th className="num">Брутто</th>
                <th>Од.</th>
                <th className="num">Нетто, г</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const isNew = l.product.trim() && !known.has(l.product.trim().toLowerCase())
                const suspicious = l.unit === 'г' && n(l.net) > n(l.gross) && n(l.gross) > 0
                return (
                  <tr key={l.key}>
                    <td className="muted tnum">{i + 1}</td>
                    <td style={{ minWidth: 200 }}>
                      <input list="products" value={l.product} onChange={(e) => upd(l.key, { product: e.target.value })} aria-label={`Продукт ${i + 1}`} placeholder="Почніть вводити назву…" />
                      {isNew && <span className="tag" style={{ marginTop: 4, marginLeft: 0 }}>новий продукт</span>}
                    </td>
                    <td className="num">
                      <input className="w-num" inputMode="decimal" value={l.gross} onChange={(e) => upd(l.key, { gross: e.target.value })} aria-label="Брутто" />
                    </td>
                    <td>
                      <select value={l.unit} onChange={(e) => upd(l.key, { unit: e.target.value as Unit })} aria-label="Одиниця" style={{ width: 76 }}>
                        <option value="г">г</option>
                        <option value="шт">шт</option>
                        <option value="л">л</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className={suspicious ? 'w-num warn-input' : 'w-num'}
                        title={suspicious ? 'Нетто більше за брутто — перевірте (норма для круп/бобових після варіння)' : undefined}
                        inputMode="decimal"
                        value={l.net}
                        onChange={(e) => upd(l.key, { net: e.target.value })}
                        aria-label="Нетто"
                      />
                    </td>
                    <td className="actions">
                      <button className="btn ghost icon sm danger" aria-label="Прибрати продукт" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        <Icon name="trash" size={17} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="row wrap" style={{ padding: 16, justifyContent: 'space-between', borderTop: '1px solid var(--line)' }}>
          <button className="btn" onClick={() => setLines((ls) => [...ls, { key: newKey(), product: '', gross: '', net: '', unit: 'г' }])}>
            <Icon name="plus" size={18} /> Додати продукт
          </button>
          <span className="muted small">Одиниця «шт»: брутто — кількість штук, нетто — їх вага в грамах.</span>
        </div>
      </section>

      {dirty && (
        <div className="summary-bar">
          <span>Є незбережені зміни</span>
          <button className="btn" onClick={save} disabled={busy}><Icon name="check" size={18} /> {busy ? 'Збереження…' : 'Зберегти'}</button>
        </div>
      )}
    </div>
  )
}
