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
import { exportPricesXlsx } from '../lib/exportPrices'
import { Link } from 'react-router-dom'

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
const AVG = 'Середня'
type View = 'prices' | 'nutr'

const fmtD = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA') : '')
const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type SortKey = 'name' | 'category' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'price' | 'used' | `store:${string}`

/** Заголовок колонки з сортуванням */
function SortTh({ k, sort, onSort, className, title, children }: {
  k: SortKey
  sort: { key: SortKey; dir: 1 | -1 }
  onSort: (k: SortKey) => void
  className?: string
  title?: string
  children: React.ReactNode
}) {
  const active = sort.key === k
  return (
    <th className={className} title={title} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`sort-btn${active ? ' active' : ''}`} onClick={() => onSort(k)}>
        {children}
        <span className="sort-ind" aria-hidden="true">{active ? (sort.dir === 1 ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

/** Клітинка з ціною одного магазину */
function StoreCell({ sp, calc, best, used }: { sp?: StorePrice; calc: boolean; best: boolean; used: boolean }) {
  if (!sp || (sp.price_kg == null && sp.price_pcs == null))
    return <td className={`num store-cell hide-sm${calc ? ' calc' : ''}`}><span className="muted">—</span></td>
  const oos = /наявн/.test(sp.note ?? '')
  const title = [sp.item, sp.pack, sp.note].filter(Boolean).join(' · ')
  const body = (
    <>
      {sp.price_kg != null && <div className={best ? 'best' : undefined}>{uah(Number(sp.price_kg))}<span className="u">/кг</span></div>}
      {sp.price_pcs != null && <div className="pcs">{uah(Number(sp.price_pcs))}<span className="u">/шт</span></div>}
      {oos && <div className="oos">немає в наявності</div>}
      {sp.store === 'Вручну' && <div className="date-tag">від {fmtD(sp.collected_at)}</div>}
      {used && <div className="used-tag">у розрахунку</div>}
    </>
  )
  return (
    <td className={`num store-cell hide-sm${calc ? ' calc' : ''}${used ? ' used' : ''}${sp.store === 'Середня' ? ' avg' : ''}`} title={title}>
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
  const [exporting, setExporting] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)
  async function exportXlsx() {
    if (!rows) return
    setExporting(true)
    try {
      const withAvg = new Map(
        rows.map((p) => {
          const a = avgOf(p.id)
          return [p.id, { ...(sp.get(p.id) ?? {}), ...(a ? { [AVG]: a } : {}) }] as const
        }),
      )
      await exportPricesXlsx({ products: sortRows(rows), prices: withAvg, stores: cols, calcStore })
    } catch (e) {
      toast(`Не вдалося створити Excel: ${errText(e)}`, 'err')
    } finally {
      setExporting(false)
    }
  }
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
        supabase.from('app_settings').select('key, value').in('key', ['price_store', 'prices_refreshed_at']),
      ])
      const m = new Map<number, Record<string, StorePrice>>()
      for (const x of prices) m.set(x.product_id, { ...(m.get(x.product_id) ?? {}), [x.store]: x })
      setRows(prods)
      setSp(m)
      const set = Object.fromEntries((st ?? []).map((x) => [x.key, x.value]))
      if (set.price_store) setCalcStore(set.price_store)
      setRefreshedAt(set.prices_refreshed_at ?? null)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  async function applyStore(store: string) {
    if (store === calcStore) return
    const ok = await confirm({
      title: 'Змінити джерело цін?',
      text: `Собівартість страв і вартість закупки буде перераховано за цінами «${store}». Для продуктів, яких там немає або немає в наявності, — мінімальна ціна серед інших магазинів, де товар є в наявності. Ручні ціни буде замінено (вони лишаються в колонці «Вручну»).`,
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
    const today = todayISO()
    const cleared = prices.price_kg == null && prices.price_pcs == null
    let priceMeta: Record<string, unknown> = {}
    if (priceChanged && !cleared) {
      // ручна ціна — окрема колонка «Вручну» з датою внесення; має перевагу над магазинами
      const { error: e1 } = await supabase.from('product_prices').upsert({
        product_id: p.id,
        store: 'Вручну',
        price_kg: prices.price_kg,
        price_pcs: prices.price_pcs,
        note: 'змінено вручну',
        collected_at: today,
      })
      if (e1) return toast(e1.message, 'err')
      priceMeta = { price_source: 'Вручну', price_item: null, price_pack: null, price_url: null, price_note: `ручна ціна від ${fmtD(today)}`, price_at: today }
    } else if (priceChanged && cleared) {
      // ручну ціну прибрано — повертаємо ціну магазину (або мінімальну з наявних в інших магазинах)
      const { error: e1 } = await supabase.from('product_prices').delete().eq('product_id', p.id).eq('store', 'Вручну')
      if (e1) return toast(e1.message, 'err')
      const fb = storeFallback(p.id)
      if (fb) {
        prices.price_kg = fb.price_kg == null ? null : Number(fb.price_kg)
        prices.price_pcs = fb.price_pcs == null ? null : Number(fb.price_pcs)
        priceMeta = {
          price_source: fb.store,
          price_item: fb.item,
          price_pack: fb.pack,
          price_url: fb.url,
          price_note: fb.store === calcStore ? fb.note : [(sp.get(p.id)?.[calcStore] ? 'немає в наявності в ' : 'немає в ') + calcStore + ' — мінімальна ціна серед магазинів з наявністю', fb.note].filter(Boolean).join('; '),
          price_at: fb.collected_at,
        }
      } else priceMeta = { price_source: null, price_item: null, price_pack: null, price_url: null, price_note: null, price_at: null }
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
  const hasManual = [...sp.values()].some((r) => r['Вручну'])
  // «Середня» — віртуальна колонка: середнє арифметичне цін магазинів (без ручних), як у режимі «Середня по магазинах»
  const cols = [...STORES, AVG, ...(hasManual ? ['Вручну'] : [])]
  const avgOf = (id: number): StorePrice | undefined => {
    const r = sp.get(id)
    if (!r) return undefined
    const xs = STORES.map((st) => r[st]).filter((x): x is StorePrice => !!x && (x.price_kg != null || x.price_pcs != null))
    if (!xs.length) return undefined
    const mean = (vs: number[]) => (vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 100) / 100 : null)
    const kgs = xs.filter((x) => x.price_kg != null).map((x) => Number(x.price_kg))
    const pcs = xs.filter((x) => x.price_pcs != null).map((x) => Number(x.price_pcs))
    return {
      product_id: id,
      store: AVG,
      price_kg: mean(kgs),
      price_pcs: mean(pcs),
      item: `середня з ${xs.length} магаз.: ${xs.map((x) => x.store).join(', ')}`,
      pack: null,
      url: null,
      note: null,
      collected_at: xs.map((x) => x.collected_at).sort().pop() ?? '',
    }
  }
  const cellOf = (id: number, st: string) => (st === AVG ? avgOf(id) : sp.get(id)?.[st])
  const storeCount = (st: string) => [...sp.values()].filter((r) => r[st] && (r[st].price_kg != null || r[st].price_pcs != null)).length
  // найнижча ціна за кг серед магазинів (якщо цін щонайменше дві)
  const bestStore = (id: number) => {
    const r = sp.get(id)
    if (!r) return null
    const xs = STORES.map((st) => [st, r[st]?.price_kg] as const).filter(([, v]) => v != null) as [string, number][]
    if (xs.length < 2) return null
    return xs.reduce((a, b) => (Number(b[1]) < Number(a[1]) ? b : a))[0]
  }
  // ціна для розрахунку без ручної: магазин розрахунку, інакше мінімальна з наявних в інших магазинах
  function storeFallback(id: number): StorePrice | null {
    const r = sp.get(id) ?? {}
    const has = (x?: StorePrice) => !!x && (x.price_kg != null || x.price_pcs != null)
    const own = calcStore !== 'Середня' && has(r[calcStore]) ? r[calcStore] : null
    if (own && !/наявн/.test(own.note ?? '')) return own
    // немає в магазині для розрахунку або немає там у наявності — мінімальна ціна серед магазинів з наявністю
    const xs = STORES.filter((st) => st !== calcStore && has(r[st]) && !/наявн/.test(r[st].note ?? '')).map((st) => r[st])
    xs.sort((a, b) => (a.price_kg ?? Infinity) - (b.price_kg ?? Infinity) || (a.price_pcs ?? Infinity) - (b.price_pcs ?? Infinity))
    return xs[0] ?? own
  }

  // сортування
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  // перше натискання: за зростанням (дешевші спершу), для «Страв» — найуживаніші спершу
  const onSort = (k: SortKey) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: k === 'used' ? -1 : 1 }))
  const sortVal = (p: Row): string | number | null => {
    const k = sort.key
    if (k === 'name') return p.name
    if (k === 'category') return p.category
    if (k === 'used') return used(p)
    // ціни порівнюємо лише за кг; товари лише з ціною за штуку — в кінці
    if (k === 'price') return p.price_kg == null ? null : Number(p.price_kg)
    if (k.startsWith('store:')) {
      const x = cellOf(p.id, k.slice(6))
      return x?.price_kg == null ? null : Number(x.price_kg)
    }
    const v = p[k as 'kcal' | 'protein' | 'fat' | 'carbs']
    return v == null ? null : Number(v)
  }
  const sortRows = (xs: Row[]) =>
    [...xs].sort((a, b) => {
      const va = sortVal(a)
      const vb = sortVal(b)
      if (va == null && vb == null) return a.name.localeCompare(b.name, 'uk')
      if (va == null) return 1 // порожні — завжди в кінці
      if (vb == null) return -1
      const c = typeof va === 'string' ? va.localeCompare(String(vb), 'uk') : Number(va) - Number(vb)
      return c * sort.dir || a.name.localeCompare(b.name, 'uk')
    })

  const cats = useMemo(() => categoryCounts(base, q), [base, q])
  const allCats = useMemo(() => [...new Set((rows ?? []).map((p) => p.category).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'uk')), [rows])
  const effCat = cat && cats.some(([c]) => c === cat) ? cat : ''
  const found = cats.reduce((s, [, n]) => s + n, 0)
  const list = sortRows(base.filter((p) => (!effCat || catOf(p) === effCat) && dishMatches(p, q)))

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
                Ціни інтернет-магазинів з доставкою по Києву (звичайна ціна, без акцій) · зібрано <b>{pricedAt}</b>
                {refreshedAt && <> · оновлено <b>{new Date(refreshedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></>} · для розрахунку собівартості — <b>{calcStore}</b>
              </span>
            </p>
          )}
        </div>
        <div className="calc-side">
        <Link to="/prices" className="btn refresh-btn" title="Оновлення цін: автоматично щопонеділка або вручну, історія й звіти">
          <Icon name="trend" size={18} /> Оновлення цін
        </Link>
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
            <button className="btn sm" onClick={exportXlsx} disabled={!rows || exporting} title="Ціни всіх магазинів для всіх продуктів">
              <Icon name="download" size={16} /> {exporting ? 'Готую…' : 'Excel'}
            </button>
            <label className="sort-sm">
              <span className="sr-only">Сортування</span>
              <select
                value={`${sort.key}|${sort.dir}`}
                onChange={(e) => {
                  const [k, d] = e.target.value.split('|')
                  setSort({ key: k as SortKey, dir: Number(d) as 1 | -1 })
                }}
              >
                <option value="name|1">Назва А→Я</option>
                <option value="name|-1">Назва Я→А</option>
                <option value="price|1">Ціна для розрахунку: дешевші спершу</option>
                <option value="price|-1">Ціна для розрахунку: дорожчі спершу</option>
                <option value="used|-1">Найчастіше в стравах</option>
                <option value="kcal|-1">Ккал ↓</option>
                {cols.map((st) => (
                  <option key={st} value={`store:${st}|1`}>{st}: дешевші спершу</option>
                ))}
              </select>
            </label>
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
                  <SortTh k="name" sort={sort} onSort={onSort}>Продукт</SortTh>
                  <SortTh k="category" sort={sort} onSort={onSort} className="hide-sm">Категорія</SortTh>
                  {view === 'nutr' &&
                    NUTR.map((x) => (
                      <SortTh key={x.k} k={x.k} sort={sort} onSort={onSort} className="num hide-sm" title={`${x.label} на 100 г`}>{x.label}</SortTh>
                    ))}
                  {view === 'nutr' && <SortTh k="price" sort={sort} onSort={onSort} className="num hide-sm">Ціна</SortTh>}
                  {view === 'prices' &&
                    cols.map((st) => (
                      <SortTh
                        key={st}
                        k={`store:${st}`}
                        sort={sort}
                        onSort={onSort}
                        className={`num hide-sm${st === calcStore ? ' calc' : ''}`}
                        title={
                          st === calcStore
                            ? 'Ця ціна йде в собівартість і закупку (якщо немає ручної)'
                            : st === 'Вручну'
                              ? 'Ручна ціна має перевагу над усіма магазинами'
                              : st === AVG
                                ? 'Середнє арифметичне цін магазинів, де продукт знайдено (без ручних цін)'
                                : undefined
                        }
                      >
                        <span>
                          {st === AVG ? 'Середня ціна' : st}
                          {st === calcStore && <span className="calc-tag">розрахунок</span>}
                          {st === 'Вручну' && <span className="calc-tag">пріоритет</span>}
                        </span>
                      </SortTh>
                    ))}
                  <SortTh k="used" sort={sort} onSort={onSort} className="num" title="У скількох стравах використовується">Страв</SortTh>
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
                              Ціна для розрахунку — {calcStore === 'Середня' ? 'середня по магазинах' : calcStore} (якщо продукту там немає — мінімальна з наявних в інших магазинах). Ручна ціна має перевагу над усіма магазинами й зберігається з датою внесення; щоб повернути ціну магазину — очистіть поля ціни.
                              {sp.get(p.id)?.['Вручну'] ? ` Поточна ручна ціна внесена ${fmtD(sp.get(p.id)!['Вручну'].collected_at)}.` : ''}
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
                            {cols.filter((st) => cellOf(p.id, st)).map((st) => {
                              const x = cellOf(p.id, st)!
                              const v = x.price_kg != null ? `${uah(Number(x.price_kg))}/кг` : x.price_pcs != null ? `${uah(Number(x.price_pcs))}/шт` : '—'
                              return (
                                <span key={st} className={st === calcStore || p.price_source === st ? 'calc' : bestStore(p.id) === st ? 'best' : undefined}>
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
                        cols.map((st) => (
                          <StoreCell
                            key={st}
                            sp={cellOf(p.id, st)}
                            calc={st === calcStore}
                            best={bestStore(p.id) === st}
                            used={st !== calcStore && p.price_source === st}
                          />
                        ))}
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
