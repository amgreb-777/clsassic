import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

// PKCE: код із листа (підтвердження, скидання пароля) приходить у ?code=…,
// а не в #-фрагменті, який використовує HashRouter.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'pkce' },
})

/**
 * Прапорець «користувач перейшов за посиланням скидання пароля».
 * Підписуємося одразу після створення клієнта, щоб не пропустити подію
 * PASSWORD_RECOVERY, яку клієнт надсилає під час ініціалізації.
 */
let recovery = false
const listeners = new Set<() => void>()
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recovery = true
    listeners.forEach((l) => l())
  }
})
export const passwordRecovery = {
  get: () => recovery,
  clear: () => {
    recovery = false
    listeners.forEach((l) => l())
  },
  subscribe: (l: () => void) => {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
}

/** Supabase віддає максимум 1000 рядків за запит — догружаємо сторінками. */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < pageSize) return out
  }
}
