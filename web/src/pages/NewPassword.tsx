import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Встановлення нового пароля: після переходу з листа або зі сторінки «Змінити пароль». */
export default function NewPassword({ email, onDone, onCancel }: { email?: string; onDone: () => void; onCancel?: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw !== pw2) return setError('Паролі не збігаються')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error)
      return setError(
        /should be different/i.test(error.message)
          ? 'Новий пароль має відрізнятися від старого'
          : /at least/i.test(error.message)
            ? 'Пароль закороткий — мінімум 6 символів'
            : error.message,
      )
    setDone(true)
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">C</span>
          <span>Новий пароль</span>
        </div>
        {email && <p className="muted">Акаунт: {email}</p>}
        {done ? (
          <>
            <div className="alert ok">Пароль змінено.</div>
            <button type="button" className="primary" onClick={onDone}>Перейти до платформи</button>
          </>
        ) : (
          <>
            <label>
              Новий пароль
              <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Повторіть пароль
              <input type="password" required minLength={6} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </label>
            {error && <div className="alert err">{error}</div>}
            <button className="primary" disabled={busy}>{busy ? '…' : 'Зберегти пароль'}</button>
            {onCancel && (
              <button type="button" className="link" onClick={onCancel}>
                Скасувати
              </button>
            )}
          </>
        )}
      </form>
    </div>
  )
}
