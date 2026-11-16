import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import { generatePassword, rpcError } from '../lib/password'

type Role = 'admin' | 'member'

interface Member {
  email: string
  role: Role
  created_at: string
}

interface Account {
  email: string
  has_account: boolean
  last_sign_in_at: string | null
  must_change_password: boolean
}

/** Пароль, який треба показати адміну один раз, щоб він передав його колезі. */
interface Issued {
  email: string
  password: string
  kind: 'created' | 'reset'
}

const ROLE: Record<Role, string> = { admin: 'Адміністратор', member: 'Учасник' }

export default function Team({ isAdmin, myEmail }: { isAdmin: boolean; myEmail: string }) {
  const [rows, setRows] = useState<Member[] | null>(null)
  const [accounts, setAccounts] = useState<Record<string, Account>>({})
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [password, setPassword] = useState(() => generatePassword())

  async function load() {
    const [{ data, error }, { data: acc, error: e2 }] = await Promise.all([
      supabase.from('team_members').select('*').order('created_at'),
      supabase.rpc('team_accounts'),
    ])
    if (error || e2) return setError((error ?? e2)!.message)
    setRows(data as Member[])
    setAccounts(Object.fromEntries(((acc ?? []) as Account[]).map((a) => [a.email, a])))
  }
  useEffect(() => {
    load()
  }, [])

  async function createAccount(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIssued(null)
    setBusy(true)
    const v = email.trim().toLowerCase()
    const { error } = await supabase.rpc('admin_create_account', { p_email: v, p_password: password, p_role: role })
    setBusy(false)
    if (error) return setError(rpcError(error.message))
    setIssued({ email: v, password, kind: 'created' })
    setEmail('')
    setPassword(generatePassword())
    load()
  }

  async function createFor(m: Member) {
    const pw = generatePassword()
    setError(null)
    setIssued(null)
    const { error } = await supabase.rpc('admin_create_account', { p_email: m.email, p_password: pw, p_role: m.role })
    if (error) return setError(rpcError(error.message))
    setIssued({ email: m.email, password: pw, kind: 'created' })
    load()
  }

  async function resetPassword(m: Member) {
    if (!confirm(`Задати новий тимчасовий пароль для ${m.email}? Поточний пароль перестане діяти, усі сесії буде завершено.`))
      return
    const pw = generatePassword()
    setError(null)
    setIssued(null)
    const { error } = await supabase.rpc('admin_set_password', { p_email: m.email, p_password: pw })
    if (error) return setError(rpcError(error.message))
    setIssued({ email: m.email, password: pw, kind: 'reset' })
    load()
  }

  async function changeRole(m: Member, r: Role) {
    const { error } = await supabase.from('team_members').update({ role: r }).eq('email', m.email)
    if (error) setError(error.message)
    else load()
  }

  async function remove(m: Member) {
    if (!confirm(`Прибрати ${m.email} з команди? Доступ до даних буде закрито одразу.`)) return
    setIssued(null)
    const { error } = await supabase.from('team_members').delete().eq('email', m.email)
    if (error) setError(error.message)
    else load()
  }

  function status(m: Member) {
    const a = accounts[m.email]
    if (!a?.has_account) return <span className="badge">Немає акаунта</span>
    if (a.must_change_password) return <span className="badge purchased">Тимчасовий пароль</span>
    return (
      <span className="badge confirmed" title={a.last_sign_in_at ? `Останній вхід: ${fmtDate(a.last_sign_in_at.slice(0, 10))}` : ''}>
        Активний
      </span>
    )
  }

  return (
    <div className="page">
      <h1>Команда</h1>
      <p className="muted">
        Працювати з платформою можуть лише люди з цього списку. Адміністратор створює колезі акаунт із тимчасовим паролем і
        передає його особисто; при першому вході система попросить задати власний пароль.
      </p>

      {isAdmin ? (
        <form className="card row-form" onSubmit={createAccount}>
          <label className="grow">
            Email колеги
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" />
          </label>
          <label>
            Роль
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">Учасник</option>
              <option value="admin">Адміністратор</option>
            </select>
          </label>
          <label>
            Тимчасовий пароль
            <span className="pw-field">
              <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mono" />
              <button type="button" className="ghost small" title="Згенерувати інший" onClick={() => setPassword(generatePassword())}>
                ↻
              </button>
            </span>
          </label>
          <button className="primary" disabled={busy}>{busy ? '…' : '+ Створити акаунт'}</button>
        </form>
      ) : (
        <div className="alert warn">Додавати учасників і задавати паролі може лише адміністратор.</div>
      )}

      {error && <div className="alert err" onClick={() => setError(null)}>{error}</div>}
      {issued && (
        <div className="card issued">
          <div>
            <b>{issued.kind === 'created' ? 'Акаунт створено.' : 'Тимчасовий пароль задано.'}</b> Передайте колезі дані для
            входу — пароль показується лише зараз:
          </div>
          <div className="creds">
            <div>
              Сайт: <span className="mono">{window.location.origin + window.location.pathname}</span>
            </div>
            <div>
              Email: <span className="mono">{issued.email}</span>
            </div>
            <div>
              Пароль: <span className="mono strong">{issued.password}</span>
            </div>
          </div>
          <div className="right">
            <button
              className="ghost"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(
                    `Сайт: ${window.location.origin + window.location.pathname}\nEmail: ${issued.email}\nТимчасовий пароль: ${issued.password}`,
                  )
                  .catch(() => {})
              }
            >
              Скопіювати
            </button>
            <button className="ghost" onClick={() => setIssued(null)}>Готово</button>
          </div>
        </div>
      )}

      <div className="card table-wrap">
        {!rows ? (
          <p className="muted">Завантаження…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Роль</th>
                <th>Акаунт</th>
                <th>Додано</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const me = m.email === myEmail
                const hasAccount = accounts[m.email]?.has_account
                return (
                  <tr key={m.email}>
                    <td>
                      {m.email} {me && <span className="unit-tag">це ви</span>}
                    </td>
                    <td>
                      {isAdmin && !me ? (
                        <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)}>
                          <option value="member">Учасник</option>
                          <option value="admin">Адміністратор</option>
                        </select>
                      ) : (
                        ROLE[m.role]
                      )}
                    </td>
                    <td>{status(m)}</td>
                    <td className="muted">{fmtDate(m.created_at.slice(0, 10))}</td>
                    <td className="actions">
                      {isAdmin && !me && (
                        <>
                          {hasAccount ? (
                            <button className="ghost small" onClick={() => resetPassword(m)}>Тимчасовий пароль</button>
                          ) : (
                            <button className="ghost small" onClick={() => createFor(m)}>Створити акаунт</button>
                          )}
                          <button className="ghost small danger" onClick={() => remove(m)}>Прибрати</button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
