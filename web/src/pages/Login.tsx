import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'in' | 'up' | 'forgot'

export default function Login() {
  const [mode, setMode] = useState<Mode>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)
  const redirect = window.location.origin + window.location.pathname

  function go(m: Mode) {
    setMode(m)
    setMsg(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)

    if (mode === 'forgot') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect })
      setBusy(false)
      if (error)
        return setMsg({
          type: 'err',
          text: /rate limit|too many/i.test(error.message)
            ? 'Ліміт надсилання листів вичерпано. Спробуйте через годину або зверніться до адміністратора.'
            : error.message,
        })
      return setMsg({
        type: 'ok',
        text: 'Якщо такий акаунт існує, ми надіслали лист із посиланням для зміни пароля. Відкрийте його в цьому ж браузері.',
      })
    }

    const { data, error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
    setBusy(false)
    if (error)
      return setMsg({
        type: 'err',
        text: /TEAM_ONLY|Database error saving new user/i.test(error.message)
          ? 'Цього email немає в списку команди. Попросіть адміністратора додати вас у розділі «Команда».'
          : /invalid login credentials/i.test(error.message)
            ? 'Невірний email або пароль.'
            : /email not confirmed/i.test(error.message)
              ? 'Email ще не підтверджено — перейдіть за посиланням з листа.'
              : error.message,
      })
    if (mode === 'up' && !data.session)
      setMsg({ type: 'ok', text: 'Акаунт створено. Підтвердіть email за посиланням з листа, потім увійдіть.' })
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">C</span>
          <span>Classic · Закупівля</span>
        </div>
        <p className="muted">
          {mode === 'forgot'
            ? 'Вкажіть email — надішлемо посилання для встановлення нового пароля.'
            : 'Платформа розрахунку закупівлі продуктів під вибрані страви'}
        </p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {mode !== 'forgot' && (
          <label>
            Пароль
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            />
          </label>
        )}
        {mode === 'in' && (
          <button type="button" className="link left" onClick={() => go('forgot')}>
            Забули пароль?
          </button>
        )}
        {mode === 'up' && (
          <p className="muted small">Реєстрація лише для членів команди — ваш email має бути доданий адміністратором.</p>
        )}
        {msg && <div className={msg.type === 'err' ? 'alert err' : 'alert ok'}>{msg.text}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'in' ? 'Увійти' : mode === 'up' ? 'Зареєструватися' : 'Надіслати посилання'}
        </button>
        {mode === 'forgot' ? (
          <button type="button" className="link" onClick={() => go('in')}>
            ← Повернутися до входу
          </button>
        ) : (
          <button type="button" className="link" onClick={() => go(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'Немає акаунта? Зареєструватися' : 'Вже є акаунт? Увійти'}
          </button>
        )}
      </form>
    </div>
  )
}
