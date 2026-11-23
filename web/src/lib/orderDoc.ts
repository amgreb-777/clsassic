import type { Order } from './types'
import { downloadBlob } from './format'

/** Порядок розділів меню в документі (як подають на заході). */
const CAT_ORDER = [
  'Холодні закуски',
  'Брускети',
  'Канапки та тости',
  'Сендвічі та круасани',
  'Тарти та кіші',
  'Салати',
  'Супи',
  'Гарячі страви',
  'Гарніри та овочі',
  'Соуси',
  'Бокси та сети',
  'Млинці',
  'Профітролі',
  'Десерти та фрукти',
]
export const OTHER_CAT = 'Інше'

export type DocLine = {
  id: number
  name: string
  category: string
  portion: number | null // вихід 1 порції, г
  qty: number // порцій
  kcal: number | null // на порцію
  cost: number | null // собівартість порції, ₴
}
export type DocGroup = { name: string; lines: DocLine[] }
export type DocTotals = {
  dishes: number
  portions: number
  weight: number // г, усього
  kcal: number // усього
  cost: number
  missingCost: number
}

export function groupLines(lines: DocLine[]): DocGroup[] {
  const m = new Map<string, DocLine[]>()
  for (const l of lines) m.set(l.category, [...(m.get(l.category) ?? []), l])
  const rank = (c: string) => {
    const i = CAT_ORDER.indexOf(c)
    return i < 0 ? CAT_ORDER.length : i
  }
  return [...m.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'uk'))
    .map(([name, ls]) => ({ name, lines: ls.sort((a, b) => a.name.localeCompare(b.name, 'uk')) }))
}

export function totalsOf(lines: DocLine[]): DocTotals {
  return lines.reduce<DocTotals>(
    (t, l) => ({
      dishes: t.dishes + 1,
      portions: t.portions + l.qty,
      weight: t.weight + (l.portion ?? 0) * l.qty,
      kcal: t.kcal + (l.kcal ?? 0) * l.qty,
      cost: t.cost + (l.cost ?? 0) * l.qty,
      missingCost: t.missingCost + (l.cost == null ? 1 : 0),
    }),
    { dishes: 0, portions: 0, weight: 0, kcal: 0, cost: 0, missingCost: 0 },
  )
}

export const docFileName = (order: Order, ext: string) =>
  `Classic Catering — ${order.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()}${order.event_date ? ` ${order.event_date.split('-').reverse().join('.')}` : ''}.${ext}`

/* ---------------- Excel ---------------- */

const INK = 'FF1D1B19'
const INK2 = 'FF4C4441'
const MUTED = 'FF7A7169'
const GOLD = 'FFA8875A'
const GOLD_INK = 'FF7D6238'
const IVORY = 'FFFBF7F0'
const GOLD_SOFT = 'FFF3EAD9'
const LINE = 'FFE5DED3'
const DISPLAY = 'Century Gothic'
const BODY = 'Calibri'

const fmtD = (d: string | null | undefined) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

/** Документ замовлення в Excel: шапка Classic Catering, меню за розділами, підсумки. */
export async function exportOrderXlsx(opts: { order: Order; groups: DocGroup[]; totals: DocTotals; withCost: boolean }) {
  const { order, groups, totals, withCost } = opts
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Classic Catering'
  wb.created = new Date()
  const ws = wb.addWorksheet('Замовлення', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&L&8Classic Catering · даруємо емоції…&R&8&P / &N' },
  })

  // B — страва, C — вихід, D — порцій, E — вага, (F — собів./порц., G — сума); A і остання — поля
  const cols = withCost ? [3, 46, 12, 10, 13, 15, 15, 3] : [3, 52, 13, 11, 14, 3]
  ws.columns = cols.map((width) => ({ width }))
  const last = cols.length - 1 // остання колонка з даними (1-based: last)
  const L = (i: number) => String.fromCharCode(64 + i) // 1 → A
  const span = (r: number) => ws.mergeCells(`B${r}:${L(last)}${r}`)
  const fillRow = (r: number, argb: string) => {
    for (let c = 1; c <= cols.length; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }
  }

  let r = 1
  ws.getRow(r).height = 14
  r++
  // Логотип
  span(r)
  Object.assign(ws.getCell(r, 2), { value: 'Classic' })
  ws.getCell(r, 2).font = { name: DISPLAY, size: 30, color: { argb: INK } }
  ws.getCell(r, 2).alignment = { horizontal: 'center', vertical: 'bottom' }
  ws.getRow(r).height = 40
  r++
  span(r)
  ws.getCell(r, 2).value = 'C A T E R I N G'
  ws.getCell(r, 2).font = { name: DISPLAY, size: 9, color: { argb: INK2 } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  r++
  span(r)
  ws.getCell(r, 2).value = 'даруємо емоції…'
  ws.getCell(r, 2).font = { name: 'Georgia', size: 11, italic: true, color: { argb: GOLD_INK } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  ws.getRow(r).height = 20
  r++
  span(r)
  ws.getCell(r, 2).value = '—  ◆  —'
  ws.getCell(r, 2).font = { name: DISPLAY, size: 9, color: { argb: GOLD } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  r += 2

  // Назва заходу
  span(r)
  ws.getCell(r, 2).value = 'М Е Н Ю   З А Х О Д У'
  ws.getCell(r, 2).font = { name: DISPLAY, size: 9, bold: true, color: { argb: GOLD_INK } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  r++
  span(r)
  ws.getCell(r, 2).value = order.title
  ws.getCell(r, 2).font = { name: DISPLAY, size: 20, color: { argb: INK } }
  ws.getCell(r, 2).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  ws.getRow(r).height = 32
  r++
  span(r)
  ws.getCell(r, 2).value = [fmtD(order.event_date), order.guests ? `${order.guests} ${plural(order.guests, 'гість', 'гості', 'гостей')}` : null].filter(Boolean).join('   ·   ')
  ws.getCell(r, 2).font = { name: BODY, size: 11, color: { argb: MUTED } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  r++
  if (order.notes?.trim()) {
    span(r)
    ws.getCell(r, 2).value = order.notes.trim()
    ws.getCell(r, 2).font = { name: BODY, size: 10, italic: true, color: { argb: INK2 } }
    ws.getCell(r, 2).alignment = { horizontal: 'center', wrapText: true }
    ws.getRow(r).height = Math.max(16, Math.ceil(order.notes.length / 90) * 15)
    r++
  }
  r++

  // Заголовок таблиці
  const head = ['Страва', 'Вихід, г', 'Порцій', 'Вага, кг', ...(withCost ? ['Собів. / порц.', 'Сума, ₴'] : [])]
  head.forEach((h, i) => {
    const c = ws.getCell(r, i + 2)
    c.value = h.toUpperCase()
    c.font = { name: DISPLAY, size: 8.5, bold: true, color: { argb: GOLD_INK } }
    c.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' }
    c.border = { top: { style: 'thin', color: { argb: GOLD } }, bottom: { style: 'thin', color: { argb: GOLD } } }
  })
  fillRow(r, GOLD_SOFT)
  ws.getRow(r).height = 22
  const headRow = r
  r++

  for (const g of groups) {
    r++
    span(r)
    ws.getCell(r, 2).value = g.name.toUpperCase()
    ws.getCell(r, 2).font = { name: DISPLAY, size: 10, bold: true, color: { argb: GOLD_INK } }
    ws.getCell(r, 2).border = { bottom: { style: 'hair', color: { argb: GOLD } } }
    ws.getRow(r).height = 20
    r++
    for (const l of g.lines) {
      const vals: (string | number | null)[] = [
        l.name,
        l.portion ?? null,
        l.qty,
        l.portion != null ? (l.portion * l.qty) / 1000 : null,
        ...(withCost ? [l.cost, l.cost != null ? l.cost * l.qty : null] : []),
      ]
      vals.forEach((v, i) => {
        const c = ws.getCell(r, i + 2)
        c.value = v
        c.font = { name: i === 0 ? DISPLAY : BODY, size: i === 0 ? 11 : 10.5, color: { argb: i === 0 ? INK : INK2 } }
        c.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle', wrapText: i === 0 }
        c.border = { bottom: { style: 'hair', color: { argb: LINE } } }
        if (i === 1) c.numFmt = '#,##0'
        if (i === 2) c.numFmt = '#,##0'
        if (i === 3) c.numFmt = '#,##0.00'
        if (i >= 4) c.numFmt = '#,##0.00'
      })
      ws.getRow(r).height = l.name.length > 44 ? 30 : 19
      r++
    }
  }

  // Підсумки
  r++
  const sumRows: [string, string | number, string?][] = [
    ['Страв у меню', totals.dishes],
    ['Порцій', totals.portions],
    ['Загальна вага', totals.weight / 1000, 'кг'],
  ]
  if (order.guests) {
    sumRows.push(['Вага на 1 гостя', Math.round(totals.weight / order.guests), 'г'])
    sumRows.push(['Калорійність на 1 гостя', Math.round(totals.kcal / order.guests), 'ккал'])
  }
  if (withCost) {
    sumRows.push(['Собівартість меню', totals.cost, '₴'])
    if (order.guests) sumRows.push(['Собівартість на 1 гостя', totals.cost / order.guests, '₴'])
  }
  const valCol = last
  const first = r
  for (const [k, v, unit] of sumRows) {
    ws.mergeCells(`B${r}:${L(valCol - 1)}${r}`)
    const kc = ws.getCell(r, 2)
    kc.value = k
    kc.font = { name: DISPLAY, size: 10.5, color: { argb: INK2 } }
    kc.alignment = { horizontal: 'right' }
    const vc = ws.getCell(r, valCol)
    vc.value = v
    vc.numFmt = typeof v === 'number' && !Number.isInteger(v) ? `#,##0.00" ${unit ?? ''}"` : `#,##0" ${unit ?? ''}"`
    vc.font = { name: DISPLAY, size: 11, bold: true, color: { argb: INK } }
    vc.alignment = { horizontal: 'right' }
    r++
  }
  for (let c = 2; c <= valCol; c++) ws.getCell(first, c).border = { top: { style: 'thin', color: { argb: GOLD } } }
  if (withCost && totals.missingCost) {
    span(r)
    ws.getCell(r, 2).value = `* для ${totals.missingCost} страв немає собівартості`
    ws.getCell(r, 2).font = { name: BODY, size: 9, italic: true, color: { argb: MUTED } }
    ws.getCell(r, 2).alignment = { horizontal: 'right' }
    r++
  }

  r += 2
  span(r)
  ws.getCell(r, 2).value = `Classic Catering  ·  документ сформовано ${new Date().toLocaleDateString('uk-UA')}`
  ws.getCell(r, 2).font = { name: DISPLAY, size: 8.5, color: { argb: MUTED } }
  ws.getCell(r, 2).alignment = { horizontal: 'center' }
  ws.getCell(r, 2).border = { top: { style: 'hair', color: { argb: GOLD } } }

  // тло «слонова кістка» на всю сторінку
  for (let i = 1; i <= r + 1; i++) {
    for (let c = 1; c <= cols.length; c++) {
      const cell = ws.getCell(i, c)
      if (!cell.fill || (cell.fill as { fgColor?: { argb?: string } }).fgColor?.argb !== GOLD_SOFT)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: IVORY } }
    }
  }
  ws.pageSetup.printArea = `A1:${L(cols.length)}${r + 1}`
  ws.pageSetup.printTitlesRow = `${headRow}:${headRow}`

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), docFileName(order, 'xlsx'))
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return one
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few
  return many
}
