import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import type { Product, StorePrice } from '../lib/types'
import { errText } from '../lib/format'
import Icon from '../components/Icon'
import { Empty, SearchInput, Skeleton, useConfirm, useToast } from '../components/ui'
import CategoryChips from '../components/CategoryChips'
import { catOf, categoryCounts, dishMatches, norm } from '../lib/search'
import { gFmt, kcalFmt } from '../lib/nutrition'
import { priceDate, priceParts, uah } from '../lib/cost'

type Edit = { name: string; category: string; kcal: string; protein: string; fat: string; carbs: string; price_kg: string; price_pcs: string }
const numOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
const NUTR: { k: 'kcal' | 'protein' | 'fat' | 'carbs'; label: string }[] = [
  { k: 'kcal', label: 'Ккал' },
  { k: 'protein', label: 'Б' },
  { k: 'fat', label: 'Ж' },
  { k: 'carbs', label: 'В' },
]

type Row = Product & { dish_ingredients: { count: number }[] }

/** Магазини, ціни яких показуємо колонками */
const STORES = ['METRO', 'Сільпо', 'NOVUS', 'Auchan', 'MegaMarket']
type View = 'prices' | 'nutr'

/** Клітинка з ціною одного магазину */
function StoreCell({ sp, calc, best }: { sp?: StorePrice; calc: boolean; best: boolean }) {
  if (!sp || (sp.price_kg == null && sp.price_pcs == null))
    return <td className={`num store-cell hide-sm${calc ? ' calc' : ''}`}><span className="muted">—</span></td>
  const oos = /наявн/.test(sp.note ?? '')
  const title = [sp.item, sp.pack, sp.note].filter(Boolean).join(' · ')
  const body = (
    <>
      {sp.price_kg != null && <div className={best ? 'best' : undefined}>{uah(Number(sp.price_kg))}<span className="u">/кг</span></div>}
      {sp.price_pcs != null && <div className="pcs">{uah(Number(sp.price_pcs))}<span className="u">/шт</span></div>}
      {oos && <div className="oos">немає в наявності</div>}
    </>
  )
  return (
    <td className={`num store-cell hide-sm${calc ? ' calc' : ''}`} title={title}>
      {sp.url ? <a href={sp.url} target="_blank" rel="noreferrer">{body}</a> : body}
    </td>
  )
}

export default function Products({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'unused' | 'noprice'>('all')
  const [name, setName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<Record<number, Edit>>({})
  const [sp, setSp] = useState<Map<number, Record<string, StorePrice>>>(new Map())
  const [calcStore, setCalcStore] = useState('METRO')
  const [applying, setApplying] = useState(false)
  const [view, setViewState] = useState<View>(() => {
    try {
      return (localStorage.getItem('productsView') as View) || 'prices'
    } catch {
      return 'prices'
    }
  })
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem('productsView', v)
    } catch {
      /* немає доступу до localStorage */
    }
  }

  async function load() {
    try {
      const [prods, prices, { data: st }] = await Promise.all([
        fetchAll<Row>((f, t) => supabase.from('products').select('*, dish_ingredients(count)').order('name').range(f, t)),
        fetchAll<StorePrice>((f, t) => supabase.from('product_prices').select('*').range(f, t)),
        supabase.from('app_settings').select('value').eq('key', 'price_store').maybeSingle(),
      ])
      const m = new Map<number, Record<string, StorePrice>>()
      for (const x of prices) m.set(x.product_id, { ...(m.get(x.product_id) ?? {}), [x.store]: x })
      setRows(prods)
      setSp(m)
      if (st?.value) setCalcStore(st.value)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  async function applyStore(store: string) {
    if (store === calcStore) return
    const ok = await confirm({
      title: 'Змінити джерело цін?',
      text: `Собівартість страв і вартість закупки буде перераховано за цінами «${store}». Продукти, яких немає в цьому магазині, залишаться без ціни.`,
      ok: 'Перерахувати',
    })
    if (!ok) return
    setApplying(true)
    const { data, error } = await supabase.rpc('apply_price_store', { p_store: store })
    setApplying(false)
    if (error) return toast(error.message, 'err')
    toast(`Ціни для розрахунку: ${store} (${data} продуктів з ціною)`)
    load()
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
    const prices = { price_kg: numOrNull(v.price_kg), price_pcs: numOrNull(v.price_pcs) }
    if (Object.values(prices).some((x) => x != null && (Number.isNaN(x) || x < 0))) return toast('Ціна — невід\'ємне число', 'err')
    // Ціну змінено вручну — фіксуємо джерело і дату
    const priceChanged = prices.price_kg !== (p.price_kg == null ? null : Number(p.price_kg)) || prices.price_pcs !== (p.price_pcs == null ? null : Number(p.price_pcs))
    const today = new Date().toISOString().slice(0, 10)
    const manual = calcStore === 'Середня' ? 'Вручну' : calcStore
    const priceMeta = priceChanged ? { price_source: manual, price_note: 'змінено вручну', price_at: today } : {}
    if (priceChanged && calcStore !== 'Середня') {
      // ручна ціна зберігається як ціна магазину, з якого рахуємо, — не зітреться при перерахунку
      const { error: e1 } = await supabase.from('product_prices').upsert({
        product_id: p.id,
        store: calcStore,
        price_kg: prices.price_kg,
        price_pcs: prices.price_pcs,
        item: sp.get(p.id)?.[calcStore]?.item ?? null,
        pack: sp.get(p.id)?.[calcStore]?.pack ?? null,
        url: sp.get(p.id)?.[calcStore]?.url ?? null,
        note: 'змінено вручну',
        collected_at: today,
      })
      if (e1) return toast(e1.message, 'err')
    }
    const { error } = await supabase
      .from('products')
      .update({ name: v.name.trim(), category: v.category.trim() || null, ...vals, ...prices, ...priceMeta })
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
  const noPrice = (p: Row) => p.price_kg == null && p.price_pcs == null
  const base = useMemo(
    () => (rows ?? []).filter((p) => filter === 'all' || (filter === 'unused' ? used(p) === 0 : noPrice(p))),
    [rows, filter],
  )
  const unusedCount = (rows ?? []).filter((p) => used(p) === 0).length
  const noPriceCount = (rows ?? []).filter(noPrice).length
  const pricedAt = priceDate([...sp.values()].flatMap((r) => Object.values(r).map((x) => ({ price_at: x.collected_at }))))
  const storeCount = (st: string) => [...sp.values()].filter((r) => r[st] && (r[st].price_kg != null || r[st].price_pcs != null)).length
  // найнижча ціна за кг серед магазинів (якщо цін щонайменше дві)
  const bestStore = (id: number) => {
    const r = sp.get(id)
    if (!r) return null
    const xs = STORES.map((st) => [st, r[st]?.price_kg] as const).filter(([, v]) => v != null) as [string, number][]
    if (xs.length < 2) return null
    return xs.reduce((a, b) => (Number(b[1]) < Number(a[1]) ? b : a))[0]
  }
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
          {pricedAt && (
            <p className="price-note">
              <Icon name="cart" size={16} />
              <span>
                Ціни інтернет-магазинів з доставкою по Києву (звичайна ціна, без акцій) · зібрано <b>{pricedAt}</b> · для розрахунку собівартості — <b>{calcStore}</b>
              </span>
            </p>
          )}
        </div>
        <label className="field calc-store">
          <span>Ціна для розрахунку</span>
          {isAdmin ? (
            <select value={calcStore} disabled={applying} onChange={(e) => applyStore(e.target.value)}>
              {STORES.map((st) => (
                <option key={st} value={st}>{st} ({storeCount(st)})</option>
              ))}
              <option value="Середня">Середня по магазинах</option>
            </select>
          ) : (
            <b>{calcStore}</b>
          )}
        </label>
      </div>

      <form className="card inline-form" onSubmit={add}>
        <label className="field grow">
          <span>Новий продукт</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Напр.: Сир Брі" />
        </label>
        <label className="field">
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
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Знайти продукт або категорію…" />
            <div className="chips seg" role="tablist" aria-label="Що показувати">
              <button role="tab" aria-selected={view === 'prices'} className={view === 'prices' ? 'chip active' : 'chip'} onClick={() => setView('prices')}>Ціни магазинів</button>
              <button role="tab" aria-selected={view === 'nutr'} className={view === 'nutr' ? 'chip active' : 'chip'} onClick={() => setView('nutr')}>КБЖВ</button>
            </div>
            <label className="check small">
              <input type="checkbox" checked={filter === 'unused'} onChange={(e) => setFilter(e.target.checked ? 'unused' : 'all')} />
              Лише ті, що не використовуються ({unusedCount})
            </label>
            {noPriceCount > 0 && (
              <label className="check small">
                <input type="checkbox" checked={filter === 'noprice'} onChange={(e) => setFilter(e.target.checked ? 'noprice' : 'all')} />
                Без ціни для розрахунку ({noPriceCount})
              </label>
            )}
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
                  {view === 'nutr' &&
                    NUTR.map((x) => (
                      <th key={x.k} className="num hide-sm" title={`${x.label} на 100 г`}>{x.label}</th>
                    ))}
                  {view === 'nutr' && <th className="num hide-sm">Ціна</th>}
                  {view === 'prices' &&
                    STORES.map((st) => (
                      <th key={st} className={`num hide-sm${st === calcStore ? ' calc' : ''}`} title={st === calcStore ? 'Ця ціна йде в собівартість і закупку' : undefined}>
                        {st}
                        {st === calcStore && <div className="calc-tag">розрахунок</div>}
                      </th>
                    ))}
                  <th className="num" title="У скількох стравах використовується">Страв</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((p) => {
                  const e = edit[p.id]
                  const set = (patch: Partial<Edit>) => setEdit((cur) => ({ ...cur, [p.id]: { ...cur[p.id], ...patch } }))
                  const cancel = () => setEdit(({ [p.id]: _, ...rest }) => rest)
                  if (e)
                    return (
                      <tr key={p.id} className="edit-row">
                        <td colSpan={12}>
                          <form
                            className="edit-form"
                            onSubmit={(ev) => {
                              ev.preventDefault()
                              save(p)
                            }}
                            onKeyDown={(ev) => ev.key === 'Escape' && cancel()}
                          >
                            <label className="field wide">
                              <span>Назва</span>
                              <input autoFocus required value={e.name} onChange={(ev) => set({ name: ev.target.value })} />
                            </label>
                            <label className="field wide">
                              <span>Категорія</span>
                              <input list="product-cats" value={e.category} placeholder="Оберіть або введіть" onChange={(ev) => set({ category: ev.target.value })} />
                            </label>
                            {NUTR.map((x) => (
                              <label key={x.k} className="field">
                                <span>{x.k === 'kcal' ? 'Ккал' : x.k === 'protein' ? 'Білки, г' : x.k === 'fat' ? 'Жири, г' : 'Вуглев., г'}</span>
                                <input className="tnum" inputMode="decimal" value={e[x.k]} aria-label={`${x.label} на 100 г`} onChange={(ev) => set({ [x.k]: ev.target.value })} />
                              </label>
                            ))}
                            <label className="field price-f">
                              <span>Ціна, ₴/кг</span>
                              <input className="tnum" inputMode="decimal" value={e.price_kg} placeholder="—" onChange={(ev) => set({ price_kg: ev.target.value })} />
                            </label>
                            <label className="field price-f">
                              <span>Ціна, ₴/шт</span>
                              <input className="tnum" inputMode="decimal" value={e.price_pcs} placeholder="—" onChange={(ev) => set({ price_pcs: ev.target.value })} />
                            </label>
                            <p className="small muted full">
                              Ціна для розрахунку — {calcStore === 'Середня' ? 'середня по магазинах' : calcStore}; ручна зміна збережеться як ціна цього магазину.
                            </p>
                            {p.price_item && (
                              <p className="small muted full">
                                Зараз: {p.price_source}: {p.price_url ? <a href={p.price_url} target="_blank" rel="noreferrer">{p.price_item}</a> : p.price_item}
                                {p.price_pack ? ` · ${p.price_pack}` : ''}
                                {p.price_at ? ` · ${new Date(p.price_at + 'T00:00:00').toLocaleDateString('uk-UA')}` : ''}
                                {p.price_note ? ` · ${p.price_note}` : ''}
                              </p>
                            )}
                            <div className="acts">
                              <span className="muted small grow" style={{ alignSelf: 'center' }}>КБЖВ на 100 г · у стравах: {used(p)}</span>
                              <button type="button" className="btn ghost" onClick={cancel}>Скасувати</button>
                              <button className="btn primary"><Icon name="check" size={18} /> Зберегти</button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )
                  const startEdit = () =>
                    setEdit({
                      ...edit,
                      [p.id]: {
                        name: p.name,
                        category: p.category ?? '',
                        kcal: p.kcal == null ? '' : String(p.kcal),
                        protein: p.protein == null ? '' : String(p.protein),
                        fat: p.fat == null ? '' : String(p.fat),
                        carbs: p.carbs == null ? '' : String(p.carbs),
                        price_kg: p.price_kg == null ? '' : String(p.price_kg),
                        price_pcs: p.price_pcs == null ? '' : String(p.price_pcs),
                      },
                    })
                  return (
                    <tr key={p.id}>
                      <td>
                        <span className="strong" style={{ fontWeight: 500 }}>{p.name}</span>
                        {view === 'prices' ? (
                          <div className="sub-sm show-sm store-line">
                            {STORES.filter((st) => sp.get(p.id)?.[st]).map((st) => {
                              const x = sp.get(p.id)![st]
                              const v = x.price_kg != null ? `${uah(Number(x.price_kg))}/кг` : x.price_pcs != null ? `${uah(Number(x.price_pcs))}/шт` : '—'
                              return (
                                <span key={st} className={st === calcStore ? 'calc' : bestStore(p.id) === st ? 'best' : undefined}>
                                  {st} {v}
                                </span>
                              )
                            })}
                            {!STORES.some((st) => sp.get(p.id)?.[st]) && <span className="warn-text">ціни не знайдено</span>}
                          </div>
                        ) : (
                        <div className="sub-sm show-sm">
                          {p.category ?? 'Без категорії'} ·{' '}
                          {p.kcal == null ? (
                            <span className="warn-text">КБЖВ не задано</span>
                          ) : (
                            `${kcalFmt(Number(p.kcal))} ккал · Б ${gFmt(Number(p.protein ?? 0))} · Ж ${gFmt(Number(p.fat ?? 0))} · В ${gFmt(Number(p.carbs ?? 0))}`
                          )}
                          {' · '}
                          {noPrice(p) ? <span className="warn-text">без ціни</span> : priceParts(p).join(' · ')}
                        </div>
                        )}
                      </td>
                      <td className="hide-sm">
                        {p.category ? <span className="badge plain">{p.category}</span> : <span className="muted">—</span>}
                      </td>
                      {view === 'nutr' && NUTR.map((x) => (
                        <td key={x.k} className="num hide-sm tnum">
                          {p[x.k] == null ? (
                            <span className="warn-text">—</span>
                          ) : x.k === 'kcal' ? (
                            kcalFmt(Number(p.kcal))
                          ) : (
                            <span className="muted">{gFmt(Number(p[x.k]))}</span>
                          )}
                        </td>
                      ))}
                      {view === 'prices' &&
                        STORES.map((st) => <StoreCell key={st} sp={sp.get(p.id)?.[st]} calc={st === calcStore} best={bestStore(p.id) === st} />)}
                      {view === 'nutr' && (
                      <td className="num price-cell hide-sm" title={p.price_item ? `${p.price_source}: ${p.price_item}${p.price_pack ? ` (${p.price_pack})` : ''}${p.price_note ? ` — ${p.price_note}` : ''}` : undefined}>
                        {noPrice(p) ? (
                          <span className="warn-text">—</span>
                        ) : (
                          <>
                            {priceParts(p).map((x) => (
                              <div key={x} className="tnum">{x}</div>
                            ))}
                            {p.price_source && <div className="src">{p.price_source}</div>}
                          </>
                        )}
                      </td>
                      )}
                      <td className="num">{used(p) ? <span className="badge plain">{used(p)}</span> : <span className="muted">0</span>}</td>
                      <td className="actions">
                        <button className="btn ghost icon sm" aria-label={`Змінити «${p.name}»`} title="Змінити" onClick={startEdit}>
                          <Icon name="edit" size={17} />
                        </button>
                        {used(p) === 0 && (
                          <button className="btn ghost icon sm danger" aria-label={`Видалити «${p.name}»`} title="Видалити" onClick={() => remove(p)}>
                            <Icon name="trash" size={17} />
                          </button>
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
