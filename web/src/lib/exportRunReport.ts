import { fetchAll, supabase } from './supabase'
import { downloadBlob } from './format'

const HEAD = 'FF262422'
const GOLD = 'FFF3EAD9'
const GOLD_INK = 'FF7D6238'
const MUTED = 'FF7A7169'
const RED = 'FFB23B2A'
const GREEN = 'FF2F7A55'
const LINE = 'FFE5DED3'
const WARN = 'FFFBF0D9'
const STORES = ['METRO', 'Сільпо', 'NOVUS', 'Auchan', 'MegaMarket']
const CALC = 'Розрахунок'

export type ReportRun = {
  id: number
  trigger: 'manual' | 'schedule' | 'import'
  started_by: string | null
  status: string
  started_at: string
  finished_at: string | null
  passes: number
  calc_store: string | null
  total: number
  checked: number
  changed: number
  failed: number
  gone: number
  out_of_stock: number
  suspicious: number
  calc_changed: number
  by_store: Record<string, { total: number; checked: number; failed: number; gone: number; changed: number; oos: number }> | null
}
type H = {
  product_id: number
  store: string
  price_kg: number | null
  price_pcs: number | null
  prev_kg: number | null
  prev_pcs: number | null
  pack_price: number | null
  in_stock: boolean | null
  suspicious: boolean
  source: string | null
}
type Item = { product_id: number; store: string; status: string; attempts: number; error: string | null }

const TRIGGER = { manual: 'вручну', schedule: 'за розкладом (щопонеділка о 8:00)', import: 'початкові ціни' } as const
const dt = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const num = (x: number | null | undefined) => (x == null ? null : Number(x))
const pct = (a: number | null, b: number | null) => (a && b != null && a > 0 ? b / a - 1 : null)

/** Звіт одного оновлення цін у .xlsx: «Звіт», «Ціна для розрахунку», «Усі ціни», «Не оновлено». */
export async function exportRunReport(run: ReportRun) {
  const [hist, prods, items] = await Promise.all([
    fetchAll<H>((f, t) =>
      supabase.from('price_history').select('product_id, store, price_kg, price_pcs, prev_kg, prev_pcs, pack_price, in_stock, suspicious, source').eq('run_id', run.id).range(f, t),
    ),
    fetchAll<{ id: number; name: string; category: string | null }>((f, t) => supabase.from('products').select('id, name, category').range(f, t)),
    fetchAll<Item>((f, t) => supabase.from('price_run_items').select('product_id, store, status, attempts, error').eq('run_id', run.id).neq('status', 'done').range(f, t)),
  ])
  const P = new Map(prods.map((p) => [p.id, p]))
  const name = (id: number) => P.get(id)?.name ?? String(id)
  const cat = (id: number) => P.get(id)?.category ?? ''
  const byName = (a: { product_id: number }, b: { product_id: number }) => name(a.product_id).localeCompare(name(b.product_id), 'uk')

  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Classic Catering'
  wb.created = new Date()
  const when = dt(run.finished_at ?? run.started_at)

  const header = (ws: import('exceljs').Worksheet, row: number, cols: string[], filter = true) => {
    const r = ws.getRow(row)
    r.values = cols
    r.height = 30
    r.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    })
    if (filter) ws.autoFilter = { from: { row, column: 1 }, to: { row, column: cols.length } }
  }
  const title = (ws: import('exceljs').Worksheet, text: string, sub: string) => {
    ws.getCell('A1').value = text
    ws.getCell('A1').font = { bold: true, size: 14 }
    ws.getCell('A2').value = sub
    ws.getCell('A2').font = { color: { argb: MUTED }, size: 10 }
  }
  const colorPct = (c: import('exceljs').Cell, v: number | null) => {
    c.value = v
    c.numFmt = '+0.0%;-0.0%;0%'
    if (v != null && Math.abs(v) >= 0.0005) c.font = { color: { argb: v > 0 ? RED : GREEN }, bold: Math.abs(v) >= 0.2 }
  }
  const sub = `Оновлення цін від ${when} · ${TRIGGER[run.trigger]}${run.started_by && run.trigger !== 'import' ? ` · ${run.started_by}` : ''}`

  /* ---------- 1. Звіт ---------- */
  const s1 = wb.addWorksheet('Звіт')
  s1.columns = [{ width: 44 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }]
  title(s1, 'Classic Catering — звіт оновлення цін', sub)
  const dur = run.finished_at ? Math.max(1, Math.round((new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 60000)) : null
  const facts: [string, string | number][] = [
    ['Почато', dt(run.started_at)],
    ['Завершено', run.finished_at ? dt(run.finished_at) : run.status === 'running' ? 'триває' : '—'],
    ['Тривалість', dur ? `${dur} хв, проходів: ${run.passes}` : '—'],
    ['Спосіб запуску', TRIGGER[run.trigger]],
    ['Ціна для розрахунку', run.calc_store ?? 'METRO'],
    ['Позицій (товар × магазин)', run.total],
    ['Перевірено', run.checked],
    ['Ціна змінилась', run.changed],
    ['Ціна для розрахунку змінилась (продуктів)', run.calc_changed],
    ['Немає в наявності', run.out_of_stock],
    ['Підозрілі зміни (ціну не замінено)', run.suspicious],
    ['Не відповіли / не знайдено', run.failed + run.gone],
  ]
  let r = 4
  for (const [k, v] of facts) {
    s1.getCell(r, 1).value = k
    s1.getCell(r, 1).font = { color: { argb: MUTED } }
    s1.getCell(r, 2).value = v
    s1.getCell(r, 2).font = { bold: true }
    s1.getCell(r, 2).alignment = { horizontal: 'left' }
    r++
  }
  r += 1
  if (run.by_store) {
    header(s1, r, ['Магазин', 'Позицій', 'Перевірено', 'Змінилось', 'Без наявності', 'Не відповіли'], false)
    r++
    const first = r
    for (const st of STORES) {
      const b = run.by_store[st]
      if (!b) continue
      s1.getRow(r).values = [st, b.total, b.checked, b.changed, b.oos, b.failed + b.gone]
      if (st === run.calc_store) s1.getRow(r).eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }))
      r++
    }
    s1.getRow(r).values = ['Разом', ...['B', 'C', 'D', 'E', 'F'].map((c) => ({ formula: `SUM(${c}${first}:${c}${r - 1})` }))]
    s1.getRow(r).font = { bold: true }
    s1.getRow(r).eachCell((c) => (c.border = { top: { style: 'thin' } }))
  }

  /* ---------- 2. Ціна для розрахунку ---------- */
  const calc = hist.filter((h) => h.store === CALC).sort(byName)
  const s2 = wb.addWorksheet('Ціна для розрахунку', { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }] })
  title(s2, 'Ціна для розрахунку собівартості', `${sub} · спершу продукти, у яких ціна змінилась`)
  s2.columns = [{ width: 38 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 10 }, { width: 11 }, { width: 18 }]
  header(s2, 4, ['Продукт', 'Категорія', 'Було, ₴', 'Стало, ₴', 'Од.', 'Зміна', 'Джерело ціни'])
  const calcRows = calc
    .map((h) => {
      const now = num(h.price_kg) ?? num(h.price_pcs)
      const was = num(h.prev_kg) ?? num(h.prev_pcs)
      return { h, now, was, ch: pct(was, now) }
    })
    .sort((a, b) => Number(Math.abs(b.ch ?? 0) > 0.0005) - Number(Math.abs(a.ch ?? 0) > 0.0005) || Math.abs(b.ch ?? 0) - Math.abs(a.ch ?? 0))
  r = 5
  for (const x of calcRows) {
    const row = s2.getRow(r)
    row.values = [name(x.h.product_id), cat(x.h.product_id), x.was, x.now, x.h.price_kg != null ? 'кг' : 'шт', null, x.h.source ?? '']
    row.getCell(3).numFmt = '#,##0.00'
    row.getCell(4).numFmt = '#,##0.00'
    colorPct(row.getCell(6), x.ch)
    row.eachCell((c) => (c.border = { bottom: { style: 'hair', color: { argb: LINE } } }))
    r++
  }

  /* ---------- 3. Усі ціни ---------- */
  const shop = hist.filter((h) => h.store !== CALC).sort((a, b) => byName(a, b) || STORES.indexOf(a.store) - STORES.indexOf(b.store))
  const s3 = wb.addWorksheet('Усі ціни', { views: [{ state: 'frozen', ySplit: 4, xSplit: 1 }] })
  title(s3, 'Усі перевірені ціни магазинів', `${sub} · звичайна ціна (без акцій)`)
  s3.columns = [{ width: 38 }, { width: 22 }, { width: 13 }, { width: 12 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 22 }]
  header(s3, 4, ['Продукт', 'Категорія', 'Магазин', 'Було, ₴/кг', 'Стало, ₴/кг', 'Зміна', 'Було, ₴/шт', 'Стало, ₴/шт', 'Ціна упаковки, ₴', 'Наявність', 'Примітка'])
  r = 5
  for (const h of shop) {
    const was = num(h.prev_kg) ?? num(h.prev_pcs)
    const now = num(h.price_kg) ?? num(h.price_pcs)
    const row = s3.getRow(r)
    row.values = [
      name(h.product_id),
      cat(h.product_id),
      h.store,
      num(h.prev_kg),
      num(h.price_kg),
      null,
      num(h.prev_pcs),
      num(h.price_pcs),
      num(h.pack_price),
      h.in_stock === false ? 'немає' : 'є',
      h.suspicious ? 'підозріла зміна — ціну не замінено' : '',
    ]
    for (const c of [4, 5, 7, 8, 9]) row.getCell(c).numFmt = '#,##0.00'
    colorPct(row.getCell(6), h.suspicious ? null : pct(was, now))
    if (h.in_stock === false) row.getCell(10).font = { color: { argb: MUTED }, italic: true }
    if (h.suspicious) row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN } }))
    row.eachCell((c) => (c.border = { ...(c.border ?? {}), bottom: { style: 'hair', color: { argb: LINE } } }))
    r++
  }

  /* ---------- 4. Не оновлено ---------- */
  if (items.length) {
    const s4 = wb.addWorksheet('Не оновлено')
    title(s4, 'Позиції, які не вдалося оновити', `${sub} · для них лишилась попередня ціна`)
    s4.columns = [{ width: 38 }, { width: 22 }, { width: 13 }, { width: 14 }, { width: 10 }, { width: 30 }]
    header(s4, 4, ['Продукт', 'Категорія', 'Магазин', 'Статус', 'Спроб', 'Причина'])
    r = 5
    const status: Record<string, string> = { failed: 'не відповів', gone: 'не знайдено', pending: 'у черзі' }
    for (const it of [...items].sort(byName)) {
      s4.getRow(r).values = [name(it.product_id), cat(it.product_id), it.store, status[it.status] ?? it.status, it.attempts, it.error ?? '']
      r++
    }
  }

  for (const ws of wb.worksheets) {
    ws.pageSetup = { paperSize: 9, orientation: ws.name === 'Звіт' ? 'portrait' : 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: GOLD_INK } }
  }

  const buf = await wb.xlsx.writeBuffer()
  const d = new Date(run.finished_at ?? run.started_at).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv' })
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Звіт оновлення цін ${d}.xlsx`)
}
