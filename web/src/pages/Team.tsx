import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'

interface Member {
  email: string
  role: 'admin' | 'member'
  created_at: string
}

const ROLE: Record<Member['role'], string> = { admin: 'Адміністратор', member: 'Учасник' }

export default function Team({ isAdmin, myEmail }: { isAdmin: boolean; myEmail: string }) {
  const [rows, setRows] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('member')

  async function load() {
    const { data, error } = await supabase.from('team_members').select('*').order('created_at')
    if (error) setError(error.message)
    else setRows(data as Member[])
  }
  useEffect(() => {
    load()
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    const v = email.trim().toLowerCase()
    const { error } = await supabase.from('team_members').insert({ email: v, role })
    if (error) return setError(error.code === '23505' ? 'Цей email уже в команді' : error.message)
    setEmail('')
    setOk(`${v} додано. Тепер ця людина може зареєструватися на сайті з цим email.`)
    load()
  }

  async function changeRole(m: Member, r: Member['role']) {
    const { error } = await supabase.from('team_members').update({ role: r }).eq('email', m.email)
    if (error) setError(error.message)
    else load()
  }

  async function remove(m: Member) {
    if (!confirm(`Прибрати ${m.email} з команди? Доступ до даних буде закрито одразу.`)) return
    setOk(null)
    const { error } = await supabase.from('team_members').delete().eq('email', m.email)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div className="page">
      <h1>Команда</h1>
      <p className="muted">
        Зареєструватися й працювати з даними можуть лише люди з цього списку. Щоб додати колегу — внесіть його email, після
        чого він реєструється на сайті з цією адресою.
      </p>
      {isAdmin ? (
        <form className="card row-form" onSubmit={add}>
          <label className="grow">
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" />
          </label>
          <label>
            Роль
            <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
              <option value="member">Учасник</option>
              <option value="admin">Адміністратор</option>
            </select>
          </label>
          <button className="primary">+ Додати</button>
        </form>
      ) : (
        <div className="alert warn">Додавати й видаляти учасників може лише адміністратор.</div>
      )}
      {error && <div className="alert err" onClick={() => setError(null)}>{error}</div>}
      {ok && <div className="alert ok">{ok}</div>}
      <div className="card table-wrap">
        {!rows ? (
          <p className="muted">Завантаження…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Роль</th>
                <th>Додано</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const me = m.email === myEmail
                return (
                  <tr key={m.email}>
                    <td>
                      {m.email} {me && <span className="unit-tag">це ви</span>}
                    </td>
                    <td>
                      {isAdmin && !me ? (
                        <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Member['role'])}>
                          <option value="member">Учасник</option>
                          <option value="admin">Адміністратор</option>
                        </select>
                      ) : (
                        ROLE[m.role]
                      )}
                    </td>
                    <td className="muted">{fmtDate(m.created_at.slice(0, 10))}</td>
                    <td className="actions">
                      {isAdmin && !me && (
                        <button className="ghost small danger" onClick={() => remove(m)}>
                          Прибрати
                        </button>
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
