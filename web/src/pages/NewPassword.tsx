import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Встановлення нового пароля: після переходу з листа або зі сторінки «Змінити пароль». */
export default function NewPassword({
  email,
  note,
  afterSave,
  onDone,
  onCancel,
}: {
  email?: string
  note?: string
  afterSave?: () => Promise<void>
  onDone: () => void
  onCancel?: () => void
}) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw !== pw2) return setError('Паролі не збігаються')
    if (pw.length < 8) return setError('Пароль закороткий — мінімум 8 символів')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (!error && afterSave) {
      try {
        await afterSave()
      } catch (e) {
        setBusy(false)
        return setError(e instanceof Error ? e.message : String(e))
      }
    }
    setBusy(false)
    if (error)
      return setError(
        /should be different/i.test(error.message)
          ? 'Новий пароль має відрізнятися від старого'
          : /at least/i.test(error.message)
            ? 'Пароль закороткий — мінімум 8 символів'
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
        {note && !done && <div className="alert warn">{note}</div>}
        {done ? (
          <>
            <div className="alert ok">Пароль змінено.</div>
            <button type="button" className="primary" onClick={onDone}>Перейти до платформи</button>
          </>
        ) : (
          <>
            <label>
              Новий пароль
              <input type="password" required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Повторіть пароль
              <input type="password" required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
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
