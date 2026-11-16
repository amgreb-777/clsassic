/** Нормалізація для пошуку: регістр, апострофи, ё/е, зайві пробіли. */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[’ʼ`´]/g, "'")
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim()
}

export const NO_CAT = 'Без категорії'
export const catOf = (d: { category: string | null }) => d.category || NO_CAT

/** Страва підходить, якщо кожне слово запиту є в назві або в категорії. */
export function dishMatches(d: { name: string; category: string | null }, q: string): boolean {
  const words = norm(q).split(' ').filter(Boolean)
  if (!words.length) return true
  const hay = `${norm(d.name)} ${norm(catOf(d))}`
  return words.every((w) => hay.includes(w))
}

/** Кількість страв у кожній категорії з урахуванням пошуку; від більших до менших. */
export function categoryCounts<T extends { name: string; category: string | null }>(items: T[], q: string): [string, number][] {
  const c = new Map<string, number>()
  for (const d of items) if (dishMatches(d, q)) c.set(catOf(d), (c.get(catOf(d)) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'uk'))
}
