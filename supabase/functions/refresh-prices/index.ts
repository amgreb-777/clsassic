// Оновлення цін у всіх магазинах: METRO, NOVUS, Auchan, MegaMarket (API zakaz.ua) і Сільпо (API silpo.ua).
// Працює чергою (price_run_items) за кілька проходів, щоб не перевищувати ліміти запитів магазинів:
//   { action: 'start' }            — адміністратор запускає оновлення (кнопка в розділі «Ціни»);
//   { action: 'step', run_id }     — наступний прохід (щохвилини викликає планувальник pg_cron, заголовок x-cron-key).
// Товари, на які магазин відповів «забагато запитів», повертаються в чергу з паузою (1–5 хв), до 8 спроб.
// Кожна перевірена ціна пишеться в price_history; після останнього проходу finish_price_run перераховує ціну
// для розрахунку, робить знімок у історію й формує звіт. Береться ЗВИЧАЙНА ціна (без акцій).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

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
let lastFail = ''

/** GET з повторною спробою (429/5xx/мережа — 2 спроби); далі товар повертається в чергу на наступний прохід. */
async function fetchJson(url: string): Promise<{ status: number; data: any }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 15000)
    try {
      const r = await fetch(url, {
        headers: { 'Accept-Language': 'uk', Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; price-refresh)' },
        signal: ctl.signal,
      })
      if (r.status === 429 || r.status >= 500) {
        await r.body?.cancel()
        if (attempt === 1) return { status: r.status, data: null }
        await sleep(1200 + Math.random() * 600)
        continue
      }
      if (!r.ok) {
        await r.body?.cancel()
        return { status: r.status, data: null }
      }
      return { status: r.status, data: await r.json() }
    } catch {
      if (attempt === 1) return { status: 0, data: null }
      await sleep(1000)
    } finally {
      clearTimeout(t)
    }
  }
  return { status: 0, data: null }
}
const fail = (why: string) => {
  lastFail = why
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

async function pool<T>(items: T[], n: number, gapMs: number, fn: (x: T) => Promise<void>, deadline: number) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length && Date.now() < deadline) {
        const k = i++
        await fn(items[k])
        if (gapMs) await sleep(gapMs)
      }
    }),
  )
}

type Item = { run_id: number; product_id: number; store: string; status: string; attempts: number; next_at: string; error: string | null }
type Hist = {
  run_id: number; product_id: number; store: string; price_kg: number | null; price_pcs: number | null; pack_price: number | null
  prev_kg: number | null; prev_pcs: number | null; in_stock: boolean; suspicious: boolean
}
const RETRY_MIN = [1, 2, 3, 4, 5, 5, 5, 5]
const MAX_ATTEMPTS = 8

/** Один прохід черги: обробляє товари, яким настав час, поки не вичерпано ~100 с. */
async function step(admin: SupabaseClient, runId: number) {
  const { data: claimed, error: ce } = await admin.rpc('claim_price_run', { p_run: runId })
  if (ce) throw ce
  if (!claimed) return { busy: true }
  const deadline = Date.now() + 100_000
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' })
  let processed = 0
  try {
    // поточні ціни магазинів
    const rows = new Map<string, Row>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('product_prices').select('*').neq('store', 'Вручну').order('product_id').order('store').range(from, from + 999)
      if (error) throw error
      for (const r of data as Row[]) rows.set(`${r.product_id}|${r.store}`, r)
      if (!data || data.length < 1000) break
    }
    // дві незалежні черги: магазини zakaz.ua (спільний ліміт запитів) і Сільпо
    const lane = async (stores: string[], threads: number, gapMs: number) => {
      while (Date.now() < deadline - 15_000) {
        const { data: due, error } = await admin
          .from('price_run_items')
          .select('*')
          .eq('run_id', runId)
          .eq('status', 'pending')
          .in('store', stores)
          .lte('next_at', new Date().toISOString())
          .order('attempts')
          .limit(threads * 40)
        if (error) throw error
        if (!due?.length) break
        const items = due as Item[]
        const upd: Row[] = []
        const hist: Hist[] = []
        const itemUpd: Item[] = []
        const work = async (it: Item) => {
          const row = rows.get(`${it.product_id}|${it.store}`)
          if (!row?.url) {
            itemUpd.push({ ...it, status: 'failed', error: 'немає посилання' })
            return
          }
          let f: Fresh | null | 'gone' = null
          let why = ''
          try {
            const r = row.store in ZAKAZ ? await freshZakaz(row.store, row.url) : row.store === 'Сільпо' ? await freshSilpo(row.url) : null
            f = r
            why = lastFail
          } catch {
            f = null
          }
          processed++
          if (f === 'gone') {
            const keep = (row.note ?? '').split(';').map((x) => x.trim()).filter((x) => x && !x.startsWith('не знайдено при оновленні'))
            const next = { ...row, note: [...keep, 'не знайдено при оновленні ' + today].join('; ') }
            rows.set(`${row.product_id}|${row.store}`, next)
            upd.push(next)
            itemUpd.push({ ...it, status: 'gone', error: 'товар не знайдено' })
            return
          }
          if (!f) {
            const attempts = it.attempts + 1
            itemUpd.push({
              ...it,
              attempts,
              status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
              error: why || 'немає відповіді',
              next_at: new Date(Date.now() + (RETRY_MIN[attempts - 1] ?? 5) * 60_000).toISOString(),
            })
            return
          }
          const { row: next, suspicious } = applyFresh(row, f, today)
          rows.set(`${row.product_id}|${row.store}`, next)
          upd.push(next)
          hist.push({
            run_id: runId,
            product_id: row.product_id,
            store: row.store,
            price_kg: next.price_kg == null ? null : Number(next.price_kg),
            price_pcs: next.price_pcs == null ? null : Number(next.price_pcs),
            pack_price: round2(f.reg),
            prev_kg: row.price_kg == null ? null : Number(row.price_kg),
            prev_pcs: row.price_pcs == null ? null : Number(row.price_pcs),
            in_stock: f.inStock,
            suspicious,
          })
          itemUpd.push({ ...it, status: 'done', error: suspicious ? 'підозріла зміна — ціну не змінено' : null })
        }
        await pool(items, threads, gapMs, work, deadline - 10_000)
        for (let i = 0; i < upd.length; i += 200) {
          const { error: e } = await admin.from('product_prices').upsert(upd.slice(i, i + 200), { onConflict: 'product_id,store' })
          if (e) throw e
        }
        for (let i = 0; i < hist.length; i += 300) {
          const { error: e } = await admin.from('price_history').insert(hist.slice(i, i + 300))
          if (e) throw e
        }
        for (let i = 0; i < itemUpd.length; i += 300) {
          const { error: e } = await admin.from('price_run_items').upsert(itemUpd.slice(i, i + 300), { onConflict: 'run_id,product_id,store' })
          if (e) throw e
        }
        if (!itemUpd.length) break
      }
    }
    // zakaz.ua: 2 потоки з паузою 400 мс — менше відмов «забагато запитів»
    await Promise.all([lane(Object.keys(ZAKAZ), 2, 400), lane(['Сільпо'], 4, 50)])
    const { count } = await admin.from('price_run_items').select('*', { count: 'exact', head: true }).eq('run_id', runId).eq('status', 'pending')
    if (!count) {
      const { error: fe } = await admin.rpc('finish_price_run', { p_run: runId })
      if (fe) throw fe
      return { processed, finished: true }
    }
    return { processed, pending: count }
  } catch (e) {
    await admin.from('price_runs').update({ error: e instanceof Error ? e.message : String(e) }).eq('id', runId)
    throw e
  } finally {
    await admin.rpc('release_price_run', { p_run: runId })
  }
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
const background = (p: Promise<unknown>) => {
  const safe = p.catch((e) => console.error('step failed', e))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(safe)
  return safe
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const body = await req.json().catch(() => ({}))
    const cronKey = req.headers.get('x-cron-key')

    if (cronKey) {
      const { data: ok } = await admin.rpc('verify_cron_key', { k: cronKey })
      if (ok !== true) return json({ error: 'forbidden' }, 403)
      const runId = Number(body?.run_id)
      if (!runId) return json({ error: 'run_id' }, 400)
      background(step(admin, runId))
      return json({ ok: true, run_id: runId })
    }

    // користувач: лише адміністратор команди
    const auth = req.headers.get('Authorization') ?? ''
    const sb = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
    const { data: u } = await sb.auth.getUser()
    if (!u?.user?.email) return json({ error: 'Потрібно увійти' }, 401)
    const { data: me } = await sb.from('team_members').select('role').ilike('email', u.user.email).maybeSingle()
    if (me?.role !== 'admin') return json({ error: 'Оновлювати ціни може лише адміністратор' }, 403)

    let runId = Number(body?.run_id) || 0
    if (body?.action === 'start' || !runId) {
      const { data, error } = await sb.rpc('start_price_run', { p_trigger: 'manual' })
      if (error) throw error
      runId = Number(data)
    }
    background(step(admin, runId))
    return json({ ok: true, run_id: runId })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
