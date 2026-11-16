import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'err' | 'ok'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const redirect = window.location.origin + window.location.pathname
    const { data, error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
    setBusy(false)
    if (error) return setMsg({ type: 'err', text: error.message })
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
        <p className="muted">Платформа розрахунку закупівлі продуктів під вибрані страви</p>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
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
        {msg && <div className={msg.type === 'err' ? 'alert err' : 'alert ok'}>{msg.text}</div>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'in' ? 'Увійти' : 'Зареєструватися'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Немає акаунта? Зареєструватися' : 'Вже є акаунт? Увійти'}
        </button>
      </form>
    </div>
  )
}
