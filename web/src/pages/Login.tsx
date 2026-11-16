import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'err' | 'info'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error)
      setMsg({
        type: 'err',
        text: /invalid login credentials/i.test(error.message)
          ? 'Невірний email або пароль.'
          : /email not confirmed/i.test(error.message)
            ? 'Email не підтверджено. Попросіть адміністратора створити вам акаунт на сторінці «Команда».'
            : error.message,
      })
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <button
          type="button"
          className="link left"
          onClick={() =>
            setMsg({
              type: 'info',
              text: 'Зверніться до адміністратора команди — він задасть вам тимчасовий пароль на сторінці «Команда». Після входу система попросить встановити власний.',
            })
          }
        >
          Забули пароль?
        </button>
        {msg && <div className={msg.type === 'err' ? 'alert err' : 'alert ok'}>{msg.text}</div>}
        <button className="primary" disabled={busy}>{busy ? '…' : 'Увійти'}</button>
        <p className="muted small center-text">
          Доступ лише для команди. Акаунт створює адміністратор.
        </p>
      </form>
    </div>
  )
}
