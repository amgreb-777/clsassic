// Публічні (publishable) ключі — їх безпечно тримати у фронтенді: доступ до даних
// контролюють RLS-політики в базі (лише авторизовані користувачі).
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://gnsgayyhmajofcjlilbq.supabase.co'
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Ws2cWWEU4h-6dg4gQdlkKg_4vZ4cS-g'
