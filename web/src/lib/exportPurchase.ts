import type { Order, PurchaseRow, StorePrice } from './types'
import { ingredientCost } from './cost'
import { downloadBlob } from './format'

const GOLD = 'FFF3EAD9'
const GOLD_INK = 'FF7D6238'
const GREEN = 'FF2F7A55'
const HEAD = 'FF262422'
const LINE = 'FFE5DED3'
const MUTED = 'FF7A7169'
const fmtD = (d: string | null | undefined) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA') : '')
const n2 = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type Calc = { price_kg: number | null; price_pcs: number | null; price_source: string | null; price_at: string | null }

/** Кількість для закупки: г → кг, шт/л як є */
const buyQty = (r: PurchaseRow) => (r.unit === 'г' ? Number(r.gross_total) / 1000 : Number(r.gross_total))
const buyUnit = (r: PurchaseRow) => (r.unit === 'г' ? 'кг' : r.unit)

/** Ціна, за якою рахується позиція: для «шт» — за штуку (якщо є), інакше за кг / л */
function priceLabel(r: PurchaseRow, x: { price_kg: number | null; price_pcs: number | null } | undefined) {
  if (!x) return ''
  if (r.unit === 'шт' && x.price_pcs != null) return `${n2.format(Number(x.price_pcs))}/шт`
  if (x.price_kg != null) return `${n2.format(Number(x.price_kg))}/${r.unit === 'л' ? 'л' : 'кг'}`
  return ''
}

/**
 * Excel закупки з цінами всіх магазинів:
 *  «Закупка» — кожна позиція: кількість, ціна й сума в кожному магазині, сума для розрахунку, найдешевший магазин;
 *  «Порівняння магазинів» — вартість усієї закупки в кожному магазині, скільки позицій там немає,
 *   і «оптимальний кошик» (кожну позицію — там, де найдешевше).
 */
export async function exportPurchaseXlsx(opts: {
  order: Order
  rows: PurchaseRow[] // уже впорядковані (за відділами)
  category: (r: PurchaseRow) => string
  calc: Map<number, Calc>
  storePrices: Map<number, Record<string, StorePrice>>
  stores: string[]
  calcStore: string
}) {
  const { default: ExcelJS } = await import('exceljs')
  const { order, rows, category, calc, storePrices, stores, calcStore } = opts
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Classic Catering'
  wb.created = new Date()
  const dates = [...storePrices.values()].flatMap((r) => Object.values(r).map((x) => x.collected_at)).filter(Boolean).sort()

  /* ---------- Аркуш 1: позиції ---------- */
  const ws = wb.addWorksheet('Закупка', { views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }] })
  ws.getCell('A1').value = `Закупка: ${order.title}`
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = [
    order.event_date ? `Дата заходу: ${fmtD(order.event_date)}` : null,
    order.guests ? `гостей: ${order.guests}` : null,
    `ціни зібрано ${fmtD(dates[dates.length - 1])} (звичайна ціна, без акцій і доставки)`,
    `для розрахунку — ${calcStore === 'Середня' ? 'середня по магазинах' : calcStore}`,
  ]
    .filter(Boolean)
    .join(' · ')
  ws.getCell('A2').font = { color: { argb: MUTED }, size: 10 }
  ws.getCell('A3').value = 'Сума = брутто × ціна. Фактична сума в магазині може бути більшою через фасування (купується ціла упаковка).'
  ws.getCell('A3').font = { color: { argb: MUTED }, size: 10, italic: true }

  const fixed = ['№', 'Відділ', 'Продукт', 'Кількість (брутто)', 'Од.', 'Для розрахунку: ціна', 'Для розрахунку: сума, ₴', 'Джерело']
  const head1: (string | null)[] = [...fixed]
  const head2: (string | null)[] = fixed.map(() => null)
  for (const st of stores) {
    head1.push(st, null)
    head2.push('ціна', 'сума, ₴')
  }
  head1.push('Найдешевше', null)
  head2.push('магазин', 'сума, ₴')
  const H1 = 4
  const H2 = 5
  ws.getRow(H1).values = head1
  ws.getRow(H2).values = head2
  fixed.forEach((_, i) => ws.mergeCells(H1, i + 1, H2, i + 1))
  stores.forEach((_, i) => ws.mergeCells(H1, fixed.length + 1 + i * 2, H1, fixed.length + 2 + i * 2))
  const lastCol = fixed.length + stores.length * 2 + 2
  ws.mergeCells(H1, lastCol - 1, H1, lastCol)
  for (const r of [H1, H2]) {
    const row = ws.getRow(r)
    row.height = r === H1 ? 30 : 18
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    }
  }
  const storeSumCol = (k: number) => fixed.length + 2 + k * 2
  const calcIdx = stores.indexOf(calcStore)
  if (calcIdx >= 0)
    for (const r of [H1, H2])
      for (const c of [storeSumCol(calcIdx) - 1, storeSumCol(calcIdx)]) {
        const cell = ws.getRow(r).getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
        cell.font = { bold: true, color: { argb: GOLD_INK } }
      }

  // підсумки по магазинах
  const totals = stores.map(() => ({ sum: 0, priced: 0, missing: [] as string[], oos: [] as string[] }))
  const isOos = (x?: StorePrice) => /наявн/.test(x?.note ?? '')
  let calcTotal = 0
  let optimal = 0
  let optimalMissing = 0
  const firstData = H2 + 1

  rows.forEach((r, i) => {
    const c = calc.get(r.product_id)
    const calcCost = ingredientCost(r.unit, Number(r.gross_total), Number(r.net_total), c)
    if (calcCost != null) calcTotal += calcCost
    const vals: (string | number | null)[] = [
      i + 1,
      category(r),
      r.product,
      Math.round(buyQty(r) * 1000) / 1000,
      buyUnit(r),
      priceLabel(r, c ?? undefined),
      calcCost == null ? null : Math.round(calcCost * 100) / 100,
      c?.price_source ?? '—',
    ]
    let best: [number, number] | null = null // [індекс магазину, сума]
    const sp = storePrices.get(r.product_id) ?? {}
    const oosCols: number[] = []
    stores.forEach((st, k) => {
      const x = sp[st]
      const cost = x ? ingredientCost(r.unit, Number(r.gross_total), Number(r.net_total), x) : null
      const oos = cost != null && isOos(x)
      vals.push(priceLabel(r, x) + (oos ? ' (нема)' : ''), cost == null ? null : Math.round(cost * 100) / 100)
      if (cost == null) totals[k].missing.push(r.product)
      else {
        totals[k].sum += cost
        totals[k].priced++
        if (oos) {
          totals[k].oos.push(r.product)
          oosCols.push(storeSumCol(k))
        }
        // найдешевше — лише серед товарів у наявності; ручна ціна не магазин
        if (st !== 'Вручну' && !oos && (!best || cost < best[1])) best = [k, cost]
      }
    })
    const b = best as [number, number] | null
    if (b) optimal += b[1]
    else optimalMissing++
    vals.push(b ? stores[b[0]] : '', b ? Math.round(b[1] * 100) / 100 : null)
    const row = ws.addRow(vals)
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } }
      if (col === 4) cell.numFmt = '#,##0.###'
      if (col === 7 || col === lastCol || (col > fixed.length && (col - fixed.length) % 2 === 0)) cell.numFmt = '#,##0.00'
      if (col > fixed.length && (col - fixed.length) % 2 === 1 && col < lastCol - 1) cell.font = { color: { argb: MUTED }, size: 9 }
    })
    row.getCell(7).font = { bold: true }
    if (calcIdx >= 0)
      for (const col of [storeSumCol(calcIdx) - 1, storeSumCol(calcIdx)])
        row.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
    for (const col of oosCols) row.getCell(col).font = { color: { argb: 'FF9A6200' } }
    if (b) row.getCell(storeSumCol(b[0])).font = { bold: true, color: { argb: GREEN } }
  })
  const lastData = firstData + rows.length - 1

  // рядок «Разом» з формулами
  const colL = (c: number) => ws.getColumn(c).letter
  const sumF = (c: number, result: number) => ({ formula: `SUM(${colL(c)}${firstData}:${colL(c)}${lastData})`, result: Math.round(result * 100) / 100 })
  const total = ws.addRow([])
  total.getCell(3).value = 'Разом'
  total.getCell(7).value = sumF(7, calcTotal) as never
  stores.forEach((_, k) => (total.getCell(storeSumCol(k)).value = sumF(storeSumCol(k), totals[k].sum) as never))
  total.getCell(lastCol).value = sumF(lastCol, optimal) as never
  const miss = ws.addRow([])
  miss.getCell(3).value = 'Позицій без ціни'
  stores.forEach((_, k) => (miss.getCell(storeSumCol(k)).value = totals[k].missing.length))
  miss.getCell(lastCol).value = optimalMissing
  const oosRow = ws.addRow([])
  oosRow.getCell(3).value = 'З них немає в наявності (ціна з картки)'
  stores.forEach((_, k) => (oosRow.getCell(storeSumCol(k)).value = totals[k].oos.length))
  for (const row of [total, miss, oosRow])
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastCol) return
      cell.font = { bold: true }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1ECE4' } }
      if (row === total && col >= 7) cell.numFmt = '#,##0.00'
    })
  if (order.guests) {
    const per = ws.addRow([])
    per.getCell(3).value = 'На 1 гостя'
    per.getCell(7).value = Math.round((calcTotal / order.guests) * 100) / 100
    stores.forEach((_, k) => (per.getCell(storeSumCol(k)).value = Math.round((totals[k].sum / order.guests!) * 100) / 100))
    per.getCell(lastCol).value = Math.round((optimal / order.guests) * 100) / 100
    per.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > lastCol) return
      cell.font = { italic: true }
      if (col >= 7) cell.numFmt = '#,##0.00'
    })
  }
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 5 : i === 1 ? 20 : i === 2 ? 30 : i === 3 ? 11 : i === 4 ? 5 : i === 5 ? 13 : i === 6 ? 12 : i === 7 ? 16 : i === lastCol - 2 ? 13 : (i - fixed.length) % 2 === 0 ? 12 : 11
  })
  ws.autoFilter = { from: { row: H2, column: 1 }, to: { row: lastData, column: lastCol } }

  /* ---------- Аркуш 2: порівняння магазинів ---------- */
  const wc = wb.addWorksheet('Порівняння магазинів')
  wc.columns = [
    { header: 'Варіант закупки', key: 's', width: 40 },
    { header: 'Сума, ₴', key: 'sum', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'На 1 гостя, ₴', key: 'per', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'Позицій з ціною', key: 'ok', width: 16 },
    { header: 'Немає в магазині', key: 'no', width: 16 },
    { header: 'Чого немає', key: 'list', width: 60 },
    { header: 'Немає в наявності (ціна з картки)', key: 'oos', width: 50 },
  ]
  wc.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
  })
  const per = (v: number) => (order.guests ? Math.round((v / order.guests) * 100) / 100 : null)
  const add = (label: string, sum: number, ok: number, missing: string[], style?: 'calc' | 'best', oos: string[] = []) => {
    const row = wc.addRow({ s: label, sum: Math.round(sum * 100) / 100, per: per(sum), ok, no: missing.length, list: missing.join(', '), oos: oos.join(', ') })
    row.getCell('oos').alignment = { wrapText: true, vertical: 'top' }
    if (style === 'calc') row.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }))
    if (style === 'best') row.font = { bold: true, color: { argb: GREEN } }
    row.getCell('list').alignment = { wrapText: true, vertical: 'top' }
  }
  add(
    calcStore === 'Середня'
      ? 'Для розрахунку (середня по магазинах; ручні ціни — пріоритет)'
      : `Для розрахунку (${calcStore}, якщо немає — мінімальна з наявних; ручні ціни — пріоритет)`,
    calcTotal,
    rows.filter((r) => ingredientCost(r.unit, Number(r.gross_total), Number(r.net_total), calc.get(r.product_id)) != null).length,
    rows.filter((r) => ingredientCost(r.unit, Number(r.gross_total), Number(r.net_total), calc.get(r.product_id)) == null).map((r) => r.product),
    'calc',
  )
  stores
    .map((st, k) => ({ st, k }))
    .sort((a, b) => totals[a.k].missing.length - totals[b.k].missing.length || totals[a.k].sum - totals[b.k].sum)
    .forEach(({ st, k }) => add(`Усе в ${st}`, totals[k].sum, totals[k].priced, totals[k].missing, undefined, totals[k].oos))
  add('Оптимальний кошик (кожна позиція — де найдешевше з наявних)', optimal, rows.length - optimalMissing, [], 'best')
  wc.addRow([])
  const note = wc.addRow(['Сума «Усе в …» — лише за позиціями, які є в цьому магазині; порівнюйте разом з колонкою «Немає в магазині». Позиції «немає в наявності» пораховані за ціною з картки товару.'])
  note.font = { italic: true, color: { argb: MUTED } }

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `Закупка з цінами магазинів - ${order.title}.xlsx`.replace(/[\\/:*?"<>|]/g, '_'),
  )
}
