import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import AuthLayout from '../components/AuthLayout'
import Icon from '../components/Icon'
import { Alert, Logo } from '../components/ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'err' | 'info'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error)
      setMsg({
        kind: 'err',
        text: /invalid login credentials/i.test(error.message)
          ? 'Невірний email або пароль.'
          : /email not confirmed/i.test(error.message)
            ? 'Email не підтверджено. Попросіть адміністратора створити вам акаунт.'
            : error.message,
      })
  }

  return (
    <AuthLayout>
      <form className="auth-card" onSubmit={submit} noValidate={false}>
        <div className="center-text"><Logo size="lg" /></div>
        <div>
          <h1>Вхід до платформи</h1>
          <p className="lead" style={{ marginTop: 6 }}>Закупівля продуктів під меню заходу</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" placeholder="name@example.com" autoFocus />
        </label>
        <label className="field">
          <span className="row" style={{ justifyContent: 'space-between' }}>
            Пароль
            <button
              type="button"
              className="btn-link small"
              onClick={() =>
                setMsg({
                  kind: 'info',
                  text: 'Зверніться до адміністратора команди — він задасть вам тимчасовий пароль. Після входу система попросить встановити власний.',
                })
              }
            >
              Забули пароль?
            </button>
          </span>
          <span className="input-icon" style={{ position: 'relative' }}>
            <input
              type={show ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={{ paddingLeft: 12, paddingRight: 44 }}
            />
            <button
              type="button"
              className="btn ghost icon sm"
              style={{ position: 'absolute', right: 4, top: 4 }}
              aria-label={show ? 'Сховати пароль' : 'Показати пароль'}
              onClick={() => setShow(!show)}
            >
              <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
        </label>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <button className="btn primary lg block" disabled={busy}>
          {busy ? <span className="loader" style={{ width: 18, height: 18, borderWidth: 2 }} /> : 'Увійти'}
        </button>
        <p className="small muted center-text">Доступ лише для команди Classic Catering. Акаунт створює адміністратор.</p>
      </form>
    </AuthLayout>
  )
}
