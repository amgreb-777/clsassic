const nf = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 })
const nf3 = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 3 })

export const fmt = (n: number | null | undefined) => (n == null ? '—' : nf.format(Number(n)))

/** Кількість з одиницею; грами за бажанням переводимо в кг. */
export function qty(value: number, unit: string, inKg: boolean): string {
  const v = Number(value)
  if (unit === 'г' && inKg) return `${nf3.format(v / 1000)} кг`
  return `${nf.format(v)} ${unit}`
}

export const fmtDate = (d: string | null) =>
  d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('uk-UA') : '—'

/** CSV з BOM і роздільником «;» — коректно відкривається в Excel з кирилицею. */
export function downloadCsv(filename: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    if (v == null) return ''
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))
