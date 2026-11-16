import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import AuthLayout from '../components/AuthLayout'
import Icon from '../components/Icon'
import { Alert, Logo } from '../components/ui'

/** Встановлення власного пароля: після тимчасового від адміна або через «Змінити пароль». */
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
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const checks = [
    { ok: pw.length >= 8, text: 'Щонайменше 8 символів' },
    { ok: /\d/.test(pw) && /[a-zа-яіїєґ]/i.test(pw), text: 'Літери та цифри' },
    { ok: pw.length > 0 && pw === pw2, text: 'Паролі збігаються' },
  ]

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
    <AuthLayout>
      <form className="auth-card" onSubmit={submit}>
        <div className="center-text"><Logo /></div>
        <div>
          <h1>{done ? 'Пароль змінено' : 'Новий пароль'}</h1>
          {email && <p className="lead" style={{ marginTop: 6 }}>{email}</p>}
        </div>
        {done ? (
          <>
            <Alert kind="ok">Готово! Надалі входьте з новим паролем.</Alert>
            <button type="button" className="btn primary lg block" onClick={onDone}>
              Перейти до платформи <Icon name="next" size={18} />
            </button>
          </>
        ) : (
          <>
            {note && <Alert kind="info">{note}</Alert>}
            <label className="field">
              <span>Новий пароль</span>
              <input type={show ? 'text' : 'password'} required minLength={8} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" autoFocus />
            </label>
            <label className="field">
              <span>Повторіть пароль</span>
              <input type={show ? 'text' : 'password'} required minLength={8} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="check small">
              <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Показати паролі
            </label>
            <ul className="pw-checks" aria-live="polite">
              {checks.map((c) => (
                <li key={c.text} className={c.ok ? 'ok' : ''}>
                  <Icon name={c.ok ? 'check' : 'minus'} size={16} /> {c.text}
                </li>
              ))}
            </ul>
            {error && <Alert kind="err">{error}</Alert>}
            <button className="btn primary lg block" disabled={busy}>{busy ? 'Збереження…' : 'Зберегти пароль'}</button>
            {onCancel && (
              <button type="button" className="btn ghost block" onClick={onCancel}>Скасувати</button>
            )}
          </>
        )}
      </form>
    </AuthLayout>
  )
}
