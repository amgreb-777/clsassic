import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fetchAll, supabase } from '../lib/supabase'
import type { Dish, Ingredient, Product, Unit } from '../lib/types'
import { errText, fmt } from '../lib/format'

type Line = { key: string; product: string; gross: string; net: string; unit: Unit }
let seq = 0
const newKey = () => `k${++seq}`

export default function DishEdit() {
  const id = Number(useParams().id)
  const nav = useNavigate()
  const [dish, setDish] = useState<Dish | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cats, setCats] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        setLines(
          ((ings ?? []) as Ingredient[]).map((i) => ({
            key: newKey(),
            product: i.products?.name ?? '',
            gross: String(i.gross),
            net: String(i.net),
            unit: i.unit,
          })),
        )
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
    setError(null)
    setMsg(null)
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
      setMsg(added.length ? `Збережено. Нові продукти в довіднику: ${added.join(', ')}` : 'Збережено')
      if (added.length)
        setProducts(await fetchAll<Product>((f, t) => supabase.from('products').select('*').order('name').range(f, t)))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!dish || !confirm(`Видалити страву «${dish.name}» разом з технологічною картою?`)) return
    const { error } = await supabase.from('dishes').delete().eq('id', id)
    if (error)
      setError(
        error.code === '23503'
          ? 'Страва використовується в замовленнях. Зніміть галочку «Показувати в каталозі», щоб приховати її.'
          : error.message,
      )
    else nav('/dishes')
  }

  if (error && !dish) return <div className="page"><div className="alert err">{error}</div></div>
  if (!dish) return <div className="page muted">Завантаження…</div>

  return (
    <div className="page">
      <div className="crumbs">
        <Link to="/dishes">← Страви</Link>
      </div>
      <div className="card order-head">
        <label className="grow">
          Назва страви
          <input value={dish.name} onChange={(e) => setDish({ ...dish, name: e.target.value })} />
        </label>
        <label>
          Категорія
          <input list="cats" value={dish.category ?? ''} onChange={(e) => setDish({ ...dish, category: e.target.value })} />
          <datalist id="cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label>
          Вага 1 порції, г
          <input
            className="w-num"
            inputMode="decimal"
            value={dish.portion_weight_g ?? ''}
            onChange={(e) => setDish({ ...dish, portion_weight_g: e.target.value ? n(e.target.value) : null })}
          />
        </label>
        <label className="inline">
          <input type="checkbox" checked={dish.is_active} onChange={(e) => setDish({ ...dish, is_active: e.target.checked })} />
          Показувати в каталозі
        </label>
      </div>

      <div className="card">
        <h3>Технологічна карта (на 1 порцію)</h3>
        <datalist id="products">
          {products.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <div className="table-wrap">
          <table className="edit">
            <thead>
              <tr>
                <th>#</th>
                <th>Продукт</th>
                <th className="num">Брутто</th>
                <th>Од.</th>
                <th className="num">Нетто, г</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const isNew = l.product.trim() && !known.has(l.product.trim().toLowerCase())
                const suspicious = l.unit === 'г' && n(l.net) > n(l.gross) && n(l.gross) > 0
                return (
                  <tr key={l.key}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <input list="products" value={l.product} onChange={(e) => upd(l.key, { product: e.target.value })} />
                      {isNew && <span className="unit-tag">новий продукт</span>}
                    </td>
                    <td className="num">
                      <input className="w-num" inputMode="decimal" value={l.gross} onChange={(e) => upd(l.key, { gross: e.target.value })} />
                    </td>
                    <td>
                      <select value={l.unit} onChange={(e) => upd(l.key, { unit: e.target.value as Unit })}>
                        <option value="г">г</option>
                        <option value="шт">шт</option>
                        <option value="л">л</option>
                      </select>
                    </td>
                    <td className="num">
                      <input
                        className={suspicious ? 'w-num warn-input' : 'w-num'}
                        title={suspicious ? 'Нетто більше за брутто — перевірте (норма для круп/бобових після варіння)' : ''}
                        inputMode="decimal"
                        value={l.net}
                        onChange={(e) => upd(l.key, { net: e.target.value })}
                      />
                    </td>
                    <td>
                      <button className="ghost small danger" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td />
                <td>
                  <button
                    className="ghost"
                    onClick={() => setLines((ls) => [...ls, { key: newKey(), product: '', gross: '', net: '', unit: 'г' }])}
                  >
                    + Додати продукт
                  </button>
                </td>
                <td colSpan={2} className="num muted">Вихід (нетто):</td>
                <td className="num">
                  {fmt(netAll)} г
                  {dish.portion_weight_g ? (
                    <div className={Math.abs(netG - dish.portion_weight_g) > dish.portion_weight_g * 0.25 ? 'small warn-text' : 'small muted'}>
                      порція {fmt(dish.portion_weight_g)} г
                    </div>
                  ) : null}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small">
          Одиниця «шт»: брутто — кількість штук, нетто — їх вага в грамах. Нові назви продуктів автоматично додаються в довідник.
        </p>
        {error && <div className="alert err">{error}</div>}
        {msg && <div className="alert ok">{msg}</div>}
        <div className="right">
          <button className="ghost danger" onClick={remove}>Видалити страву</button>
          <button className="primary" onClick={save} disabled={busy}>
            {busy ? 'Збереження…' : 'Зберегти'}
          </button>
        </div>
      </div>
    </div>
  )
}
