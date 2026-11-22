// Оновлення цін у всіх магазинах: METRO, NOVUS, Auchan, MegaMarket (API zakaz.ua) і Сільпо (API silpo.ua).
// Запускає лише адміністратор команди; зміни пишуться від імені користувача (діють RLS-політики).
// Береться ЗВИЧАЙНА ціна (без акцій). Після оновлення перераховується ціна для розрахунку (apply_price_store).
import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ZAKAZ: Record<string, number> = { METRO: 48215611, NOVUS: 48201070, Auchan: 48246401, MegaMarket: 48267601 }
const SILPO_BRANCH = '1edb6b38-214b-66d6-a8e0-7f2fdd178564' // доставка по Києву
const OOS = 'немає в наявності'

type Row = {
  product_id: number
  store: string
  price_kg: number | null
  price_pcs: number | null
  item: string | null
  pack: string | null
  url: string | null
  note: string | null
  collected_at: string
  pack_price: number | null
}
type Fresh = { reg: number; kg: number | null; count: number | null; perPiece: boolean; inStock: boolean; title?: string; pack?: string }

/** Вага/об'єм упаковки в грамах (мл) з рядка «830г», «0,75л», «1кг», «500мл». */
function gramsOf(s: string | null | undefined): number | null {
  if (!s) return null
  const m = s.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(кг|г|мл|л)\b/i)
  if (!m) return null
  const v = Number(m[1])
  const u = m[2].toLowerCase()
  return u === 'кг' || u === 'л' ? v * 1000 : v
}
const countOf = (s: string | null | undefined) => {
  const m = s?.match(/(\d+)\s*шт/i)
  return m ? Number(m[1]) : null
}
const round2 = (n: number) => Math.round(n * 100) / 100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const failReasons: Record<string, number> = {}

/** GET з повторними спробами: 429/5xx/мережа — до 4 спроб з паузою. */
async function fetchJson(url: string): Promise<{ status: number; data: any }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    try {
      const r = await fetch(url, {
        headers: { 'Accept-Language': 'uk', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; price-refresh)' },
        signal: ctl.signal,
      })
      if (r.status === 429 || r.status >= 500) {
        await r.body?.cancel()
        await sleep(800 * 2 ** attempt + Math.random() * 400)
        if (attempt === 3) return { status: r.status, data: null }
        continue
      }
      if (!r.ok) {
        await r.body?.cancel()
        return { status: r.status, data: null }
      }
      return { status: r.status, data: await r.json() }
    } catch {
      if (attempt === 3) return { status: 0, data: null }
      await sleep(800 * 2 ** attempt)
    } finally {
      clearTimeout(t)
    }
  }
  return { status: 0, data: null }
}
const fail = (why: string) => {
  failReasons[why] = (failReasons[why] ?? 0) + 1
  return null
}

/** zakaz.ua: код товару — частина посилання після «--». */
async function freshZakaz(store: string, url: string): Promise<Fresh | null | 'gone'> {
  const ean = url.replace(/\/+$/, '').split('--').pop()
  if (!ean) return null
  const { status, data } = await fetchJson(`https://stores-api.zakaz.ua/stores/${ZAKAZ[store]}/products/${encodeURIComponent(ean)}/`)
  if (status === 404) return 'gone'
  const p = data?.product ?? data
  if (!p || typeof p.price !== 'number') return fail(`zakaz ${status}`)
  const reg = (p.discount?.status && p.discount?.old_price ? p.discount.old_price : p.price) / 100
  let kg: number | null = null
  if (p.unit === 'kg') kg = reg
  else {
    const g = p.weight || p.volume || gramsOf(p.title)
    if (g) kg = (reg / g) * 1000
  }
  return { reg, kg, count: countOf(p.title), perPiece: p.unit !== 'kg' && !kg, inStock: p.in_stock !== false, title: p.title }
}

/** Сільпо: slug — остання частина посилання silpo.ua/product/<slug>. */
async function freshSilpo(url: string): Promise<Fresh | null | 'gone'> {
  const slug = url.replace(/\/+$/, '').split('/').pop()
  if (!slug) return null
  const { status, data } = await fetchJson(`https://sf-ecom-api.silpo.ua/v1/uk/branches/${SILPO_BRANCH}/products/${encodeURIComponent(slug)}`)
  if (status === 404) return 'gone'
  const p = data?.product ?? data
  if (!p || typeof p.price !== 'number') return fail(`silpo ${status}`)
  const reg = typeof p.oldPrice === 'number' && p.oldPrice > p.price ? p.oldPrice : p.price
  // ratio «кг» — ціна за 1 кг (ваговий товар); «шт» — ціна за упаковку, її вміст у displayRatio («225г», «10шт», «шт»)
  const weighted = p.ratio === 'кг'
  const pack: string = p.displayRatio ?? ''
  let kg: number | null = null
  if (weighted) kg = reg
  else {
    const g = gramsOf(pack) ?? gramsOf(p.title)
    if (g) kg = (reg / g) * 1000
  }
  const inStock = p.stock == null || Number(p.stock) > 0
  return { reg, kg, count: countOf(pack), perPiece: !weighted && !kg, inStock, title: p.title, pack: weighted ? 'кг' : pack || undefined }
}

/**
 * Нова ціна рядка.
 * Є збережена ціна упаковки (pack_price) → ₴/кг і ₴/шт змінюються пропорційно зміні ціни упаковки
 *   (зберігається наше трактування фасування: скибки хліба, штуки в упаковці, вага без розсолу тощо).
 * Перше оновлення (pack_price ще немає) → ₴/кг з даних магазину, якщо він узгоджується з поточною ціною; інакше ціну лишаємо.
 * Зміна понад ×2,5 — підозріла: ціну не чіпаємо (на перше оновлення лише запам'ятовуємо ціну упаковки як базу).
 */
function applyFresh(row: Row, f: Fresh, today: string): { row: Row; suspicious: boolean } {
  const oldKg = row.price_kg == null ? null : Number(row.price_kg)
  const oldPcs = row.price_pcs == null ? null : Number(row.price_pcs)
  const oldPack = row.pack_price == null ? null : Number(row.pack_price)
  let k: number | null = null // коефіцієнт зміни ціни
  if (oldPack && oldPack > 0) k = f.reg / oldPack
  else if (f.kg != null && oldKg && oldKg > 0) k = f.kg / oldKg
  else if (f.perPiece && oldPcs && oldPcs > 0) {
    const per = f.count ? f.reg / f.count : f.reg
    k = per / oldPcs
  }
  const base = (row.note ?? '').split(';').map((s) => s.trim()).filter((s) => s && s !== OOS && !s.startsWith('не знайдено при оновленні'))
  if (!f.inStock) base.push(OOS)
  const note = base.join('; ') || null
  if (k != null && (k > 2.5 || k < 0.4)) {
    // інше трактування фасування — ціну не змінюємо; ціну упаковки запам'ятовуємо лише якщо її ще не було
    return { row: { ...row, note, pack_price: oldPack ?? round2(f.reg) }, suspicious: true }
  }
  const kg = oldKg == null ? null : k == null ? oldKg : round2(oldKg * k)
  const pcs = oldPcs == null ? null : k == null ? oldPcs : round2(oldPcs * k)
  return { row: { ...row, price_kg: kg, price_pcs: pcs, note, collected_at: today, pack_price: round2(f.reg) }, suspicious: false }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++
        out[k] = await fn(items[k])
      }
    }),
  )
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const auth = req.headers.get('Authorization') ?? ''
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await sb.auth.getUser()
    if (!u?.user?.email) return json({ error: 'Потрібно увійти' }, 401)
    const { data: me } = await sb.from('team_members').select('role').ilike('email', u.user.email).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Оновлювати ціни може лише адміністратор' }, 403)

    // body: { store?: string } — оновити один магазин (сайт викликає по черзі, щоб вкластися в ліміт часу);
    //       { finalize: true } — лише перерахувати ціну для розрахунку й зберегти час оновлення.
    const body = await req.json().catch(() => ({}))
    const onlyStore: string | undefined = typeof body?.store === 'string' ? body.store : undefined
    const finalize = body?.finalize === true || !onlyStore
    const rows: Row[] = []
    for (let from = 0; body?.finalize !== true; from += 1000) {
      let q = sb.from('product_prices').select('*').neq('store', 'Вручну')
      if (onlyStore) q = q.eq('store', onlyStore)
      const { data, error } = await q.range(from, from + 999)
      if (error) throw error
      rows.push(...(data as Row[]))
      if (!data || data.length < 1000) break
    }
    for (const k of Object.keys(failReasons)) delete failReasons[k]
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' })
    const deadline = Date.now() + 110_000 // ліміт функції — 150 с: решту рядків лишаємо на наступний запуск
    const stat = { total: rows.length, updated: 0, changed: 0, failed: 0, gone: 0, skipped: 0, suspicious: 0, timeout: 0, byStore: {} as Record<string, { updated: number; failed: number; changed: number }> }
    const changes: { product_id: number; store: string; from: number | null; to: number | null }[] = []
    // різниця понад ×2,5 — швидше інше трактування фасування, ніж зміна ціни: не перезаписуємо, показуємо на перевірку
    const suspicious: { product_id: number; store: string; from: number; to: number; title?: string }[] = []

    const work = async (row: Row) => {
      const s = (stat.byStore[row.store] ??= { updated: 0, failed: 0, changed: 0 })
      if (!row.url) {
        stat.skipped++
        return null
      }
      if (Date.now() > deadline) {
        stat.timeout++
        return null
      }
      try {
        const f = row.store in ZAKAZ ? await freshZakaz(row.store, row.url) : row.store === 'Сільпо' ? await freshSilpo(row.url) : null
        if (f === 'gone') {
          stat.gone++
          s.failed++
          const keep = (row.note ?? '').split(';').map((x) => x.trim()).filter((x) => x && !x.startsWith('не знайдено при оновленні'))
          const note = [...keep, 'не знайдено при оновленні ' + today].join('; ')
          return { ...row, note }
        }
        if (!f) {
          stat.failed++
          s.failed++
          return null
        }
        const { row: next, suspicious: sus } = applyFresh(row, f, today)
        const was = row.price_kg ?? row.price_pcs
        const fresh = f.kg ?? (f.count ? f.reg / f.count : f.reg)
        if (sus) {
          stat.suspicious++
          suspicious.push({ product_id: row.product_id, store: row.store, from: Number(was), to: round2(Number(fresh)), title: f.title })
          return next
        }
        const now = next.price_kg ?? next.price_pcs
        stat.updated++
        s.updated++
        if (was != null && now != null && Math.abs(Number(was) - Number(now)) >= 0.01) {
          stat.changed++
          s.changed++
          changes.push({ product_id: row.product_id, store: row.store, from: Number(was), to: Number(now) })
        }
        return next
      } catch {
        stat.failed++
        s.failed++
        return null
      }
    }
    // zakaz.ua обмежує частоту запитів — менше паралельних звернень; Сільпо — окремо, паралельно
    rows.sort((a, b) => (a.collected_at ?? '').localeCompare(b.collected_at ?? ''))
    const zRows = rows.filter((r) => r.store in ZAKAZ)
    const oRows = rows.filter((r) => !(r.store in ZAKAZ))
    const [zRes, oRes] = await Promise.all([pool(zRows, 6, work), pool(oRows, 6, work)])
    const results = [...zRes, ...oRes]

    const upd = results.filter((x): x is Row => !!x)
    for (let i = 0; i < upd.length; i += 200) {
      const { error } = await sb.from('product_prices').upsert(upd.slice(i, i + 200), { onConflict: 'product_id,store' })
      if (error) throw error
    }

    // перерахунок ціни для розрахунку за поточним магазином
    const { data: st } = await sb.from('app_settings').select('value').eq('key', 'price_store').maybeSingle()
    const store = st?.value ?? 'METRO'
    let at: string | null = null
    if (finalize) {
      const { error: e2 } = await sb.rpc('apply_price_store', { p_store: store })
      if (e2) throw e2
      at = new Date().toISOString()
      await sb.from('app_settings').upsert({ key: 'prices_refreshed_at', value: at })
    }

    changes.sort((a, b) => Math.abs((b.to ?? 0) - (b.from ?? 0)) - Math.abs((a.to ?? 0) - (a.from ?? 0)))
    // назви продуктів для звіту
    const ids = [...new Set([...changes.slice(0, 15), ...suspicious].map((c) => c.product_id))]
    const names = new Map<number, string>()
    if (ids.length) {
      const { data: ps } = await sb.from('products').select('id, name').in('id', ids)
      for (const p of ps ?? []) names.set(p.id, p.name)
    }
    const named = <T extends { product_id: number }>(xs: T[]) => xs.map((x) => ({ ...x, product: names.get(x.product_id) ?? String(x.product_id) }))
    return json({ ok: true, at, calcStore: store, ...stat, failReasons, topChanges: named(changes.slice(0, 15)), suspicious: named(suspicious) })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
