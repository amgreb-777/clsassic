import type { Product, StorePrice } from './types'
import { downloadBlob } from './format'

type Row = Product & { dish_ingredients?: { count: number }[] }

const GOLD = 'FFF3EAD9'
const GOLD_INK = 'FF7D6238'
const GREEN = 'FF2F7A55'
const HEAD = 'FF262422'
const LINE = 'FFE5DED3'
const fmtD = (d: string | null | undefined) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA') : '')
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v))

/**
 * Excel з цінами всіх магазинів:
 *  «Ціни» — продукт × магазин (₴/кг і ₴/шт), ціна для розрахунку, найдешевший магазин;
 *  «Товари в магазинах» — кожен знайдений товар: назва в магазині, фасування, наявність, дата, посилання.
 * ExcelJS завантажується лише під час експорту.
 */
export async function exportPricesXlsx(opts: {
  products: Row[]
  prices: Map<number, Record<string, StorePrice>>
  stores: string[]
  calcStore: string
}) {
  const { default: ExcelJS } = await import('exceljs')
  const { products, prices, stores, calcStore } = opts
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Classic Catering'
  wb.created = new Date()
  const dates = [...prices.values()].flatMap((r) => Object.values(r).map((x) => x.collected_at)).filter(Boolean).sort()
  const collected = fmtD(dates[dates.length - 1])

  /* ---------- Аркуш 1: зведена таблиця ---------- */
  const ws = wb.addWorksheet('Ціни', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] })
  ws.getCell('A1').value = 'Ціни продуктів у магазинах Києва (звичайна ціна, без акцій)'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A2').value = `Зібрано: ${collected} · для розрахунку собівартості: ${calcStore === 'Середня' ? 'середня по магазинах' : calcStore} (якщо немає — мінімальна з наявних в інших магазинах; ручна ціна має пріоритет) · вивантажено ${new Date().toLocaleDateString('uk-UA')}`
  ws.getCell('A2').font = { color: { argb: 'FF7A7169' }, size: 10 }

  // заголовок у два рядки: магазин / ₴/кг, ₴/шт
  const fixed = ['№', 'Продукт', 'Категорія', 'У стравах', 'Для розрахунку, ₴/кг', 'Для розрахунку, ₴/шт', 'Джерело ціни розрахунку']
  const head1: (string | null)[] = [...fixed]
  const head2: (string | null)[] = fixed.map(() => null)
  for (const st of stores) {
    head1.push(st === 'Середня' ? 'Середня ціна' : st, null)
    head2.push('₴/кг', '₴/шт')
  }
  head1.push('Найдешевше (₴/кг)', null)
  head2.push('магазин', '₴/кг')
  ws.getRow(3).values = head1
  ws.getRow(4).values = head2
  fixed.forEach((_, i) => ws.mergeCells(3, i + 1, 4, i + 1))
  stores.forEach((_, i) => ws.mergeCells(3, fixed.length + 1 + i * 2, 3, fixed.length + 2 + i * 2))
  const lastCol = fixed.length + stores.length * 2 + 2
  ws.mergeCells(3, lastCol - 1, 3, lastCol)
  for (const r of [3, 4]) {
    const row = ws.getRow(r)
    row.height = r === 3 ? 30 : 18
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    }
  }
  const calcIdx = stores.indexOf(calcStore)
  if (calcIdx >= 0)
    for (const r of [3, 4])
      for (const c of [fixed.length + 1 + calcIdx * 2, fixed.length + 2 + calcIdx * 2]) {
        const cell = ws.getRow(r).getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
        cell.font = { bold: true, color: { argb: GOLD_INK } }
      }

  products.forEach((p, i) => {
    const r = prices.get(p.id) ?? {}
    const vals: (string | number | null)[] = [
      i + 1,
      p.name,
      p.category ?? '',
      p.dish_ingredients?.[0]?.count ?? 0,
      num(p.price_kg),
      num(p.price_pcs),
      [p.price_source, p.price_source === 'Вручну' ? fmtD(p.price_at) : ''].filter(Boolean).join(' від ') || '—',
    ]
    let best: [string, number] | null = null
    for (const st of stores) {
      const x = r[st]
      const kg = num(x?.price_kg)
      vals.push(kg, num(x?.price_pcs))
      if (kg != null && st !== 'Вручну' && st !== 'Середня' && (!best || kg < best[1])) best = [st, kg]
    }
    vals.push(best?.[0] ?? '', best?.[1] ?? null)
    const row = ws.addRow(vals)
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } }
      if (c >= 5 && c !== 7 && c !== lastCol - 1) cell.numFmt = '#,##0.00'
    })
    row.getCell(5).font = { bold: true }
    if (calcIdx >= 0)
      for (const c of [fixed.length + 1 + calcIdx * 2, fixed.length + 2 + calcIdx * 2])
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } }
    if (best) {
      const c = fixed.length + 1 + stores.indexOf(best[0]) * 2
      row.getCell(c).font = { bold: true, color: { argb: GREEN } }
    }
    // ціна магазину — клікабельне посилання на товар (число лишається числом для сортування/фільтрів)
    stores.forEach((st, k) => {
      const x = r[st]
      if (x?.url && x.price_kg != null) {
        const cell = row.getCell(fixed.length + 1 + k * 2)
        cell.value = { formula: `HYPERLINK("${x.url.replace(/"/g, '""')}",${Number(x.price_kg)})`, result: Number(x.price_kg) } as never
      }
    })
  })
  ws.columns.forEach((col, i) => {
    col.width = i === 0 ? 5 : i === 1 ? 34 : i === 2 ? 24 : i === 3 ? 9 : i === 6 ? 22 : i === lastCol - 2 ? 14 : 11
  })
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + products.length, column: lastCol } }

  /* ---------- Аркуш 2: товари в магазинах ---------- */
  const wd = wb.addWorksheet('Товари в магазинах', { views: [{ state: 'frozen', ySplit: 1 }] })
  wd.columns = [
    { header: 'Продукт', key: 'p', width: 32 },
    { header: 'Категорія', key: 'c', width: 22 },
    { header: 'Магазин', key: 's', width: 13 },
    { header: '₴/кг', key: 'kg', width: 11, style: { numFmt: '#,##0.00' } },
    { header: '₴/шт', key: 'pcs', width: 10, style: { numFmt: '#,##0.00' } },
    { header: 'Товар у магазині', key: 'i', width: 48 },
    { header: 'Фасування', key: 'pk', width: 11 },
    { header: 'Наявність / примітка', key: 'n', width: 40 },
    { header: 'Дата', key: 'd', width: 11 },
    { header: 'Посилання', key: 'u', width: 14 },
  ]
  wd.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD } }
  })
  for (const p of products) {
    const r = prices.get(p.id) ?? {}
    for (const st of stores) {
      const x = r[st]
      if (!x || st === 'Середня') continue
      const row = wd.addRow({
        p: p.name,
        c: p.category ?? '',
        s: st,
        kg: num(x.price_kg),
        pcs: num(x.price_pcs),
        i: x.item ?? '',
        pk: x.pack ?? '',
        n: x.note ?? '',
        d: fmtD(x.collected_at),
        u: x.url ? { text: 'відкрити', hyperlink: x.url } : '',
      })
      if (x.url) row.getCell('u').font = { color: { argb: 'FF1F5FBF' }, underline: true }
      if (st === calcStore) row.getCell('s').font = { bold: true, color: { argb: GOLD_INK } }
      if (/наявн/.test(x.note ?? '')) row.getCell('n').font = { color: { argb: 'FF9A6200' } }
    }
  }
  wd.autoFilter = { from: { row: 1, column: 1 }, to: { row: wd.rowCount, column: 10 } }

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `Ціни магазинів ${new Date().toLocaleDateString('uk-UA')}.xlsx`,
  )
}
