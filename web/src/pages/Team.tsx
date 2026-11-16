import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import { generatePassword, rpcError } from '../lib/password'
import Icon from '../components/Icon'
import { Alert, Skeleton, useConfirm, useToast } from '../components/ui'

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

/** Дані для входу, які треба показати адміну один раз, щоб він передав їх колезі. */
interface Issued {
  email: string
  password: string
  kind: 'created' | 'reset'
}

const ROLE: Record<Role, string> = { admin: 'Адміністратор', member: 'Учасник' }
const siteUrl = () => window.location.origin + window.location.pathname

export default function Team({ isAdmin, myEmail }: { isAdmin: boolean; myEmail: string }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Member[] | null>(null)
  const [accounts, setAccounts] = useState<Record<string, Account>>({})
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
    if (error || e2) return toast((error ?? e2)!.message, 'err')
    setRows(data as Member[])
    setAccounts(Object.fromEntries(((acc ?? []) as Account[]).map((a) => [a.email, a])))
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createAccount(e: FormEvent) {
    e.preventDefault()
    setIssued(null)
    setBusy(true)
    const v = email.trim().toLowerCase()
    const { error } = await supabase.rpc('admin_create_account', { p_email: v, p_password: password, p_role: role })
    setBusy(false)
    if (error) return toast(rpcError(error.message), 'err')
    setIssued({ email: v, password, kind: 'created' })
    setEmail('')
    setPassword(generatePassword())
    load()
  }

  async function createFor(m: Member) {
    const pw = generatePassword()
    setIssued(null)
    const { error } = await supabase.rpc('admin_create_account', { p_email: m.email, p_password: pw, p_role: m.role })
    if (error) return toast(rpcError(error.message), 'err')
    setIssued({ email: m.email, password: pw, kind: 'created' })
    load()
  }

  async function resetPassword(m: Member) {
    const ok = await confirm({
      title: 'Задати тимчасовий пароль?',
      text: `Поточний пароль ${m.email} перестане діяти, усі сесії буде завершено. Ви отримаєте новий тимчасовий пароль для передачі колезі.`,
      ok: 'Задати пароль',
    })
    if (!ok) return
    const pw = generatePassword()
    setIssued(null)
    const { error } = await supabase.rpc('admin_set_password', { p_email: m.email, p_password: pw })
    if (error) return toast(rpcError(error.message), 'err')
    setIssued({ email: m.email, password: pw, kind: 'reset' })
    load()
  }

  async function changeRole(m: Member, r: Role) {
    const { error } = await supabase.from('team_members').update({ role: r }).eq('email', m.email)
    if (error) return toast(error.message, 'err')
    toast(`${m.email}: ${ROLE[r].toLowerCase()}`)
    load()
  }

  async function remove(m: Member) {
    const ok = await confirm({ title: 'Прибрати з команди?', text: `${m.email} одразу втратить доступ до даних платформи.`, ok: 'Прибрати', danger: true })
    if (!ok) return
    setIssued(null)
    const { error } = await supabase.from('team_members').delete().eq('email', m.email)
    if (error) return toast(error.message, 'err')
    toast('Учасника прибрано')
    load()
  }

  function copyCreds() {
    if (!issued) return
    navigator.clipboard
      ?.writeText(`Classic Catering · Закупівля\nСайт: ${siteUrl()}\nEmail: ${issued.email}\nТимчасовий пароль: ${issued.password}`)
      .then(() => toast('Скопійовано — надішліть колезі'))
      .catch(() => toast('Не вдалося скопіювати — виділіть текст вручну', 'err'))
  }

  function status(m: Member) {
    const a = accounts[m.email]
    if (!a?.has_account) return <span className="badge">Немає акаунта</span>
    if (a.must_change_password) return <span className="badge purchased">Тимчасовий пароль</span>
    return <span className="badge ok">Активний</span>
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Доступ</div>
          <h1>Команда</h1>
          <p>Працювати з платформою можуть лише люди з цього списку. Адміністратор створює акаунт із тимчасовим паролем і передає його особисто — при першому вході система попросить задати власний.</p>
        </div>
      </div>

      {isAdmin ? (
        <form className="card" onSubmit={createAccount}>
          <div className="card-head"><h3>Додати колегу</h3></div>
          <div className="form-grid">
            <label className="field span-2">
              <span>Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@example.com" />
            </label>
            <label className="field">
              <span>Роль</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">Учасник</option>
                <option value="admin">Адміністратор</option>
              </select>
            </label>
            <label className="field">
              <span>Тимчасовий пароль</span>
              <span className="pw-field">
                <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Тимчасовий пароль" />
                <button type="button" className="btn icon" title="Згенерувати інший" aria-label="Згенерувати інший пароль" onClick={() => setPassword(generatePassword())}>
                  <Icon name="refresh" size={18} />
                </button>
              </span>
            </label>
            <button className="btn primary" disabled={busy}>
              <Icon name="plus" size={18} /> {busy ? 'Створення…' : 'Створити акаунт'}
            </button>
          </div>
        </form>
      ) : (
        <Alert kind="info">Додавати учасників і задавати паролі може лише адміністратор.</Alert>
      )}

      {issued && (
        <section className="card issued" aria-live="polite">
          <div className="row" style={{ gap: 10 }}>
            <Icon name="check" size={20} />
            <h3>{issued.kind === 'created' ? 'Акаунт створено' : 'Тимчасовий пароль задано'}</h3>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>Передайте колезі дані для входу. Пароль показується лише зараз.</p>
          <div className="creds">
            <div><span className="k">Сайт</span> <span className="mono">{siteUrl()}</span></div>
            <div><span className="k">Email</span> <span className="mono">{issued.email}</span></div>
            <div><span className="k">Пароль</span> <span className="mono strong" style={{ fontSize: '1.05rem' }}>{issued.password}</span></div>
          </div>
          <div className="right">
            <button className="btn ghost" onClick={() => setIssued(null)}>Готово</button>
            <button className="btn primary" onClick={copyCreds}><Icon name="copy" size={18} /> Скопіювати</button>
          </div>
        </section>
      )}

      <section className="card flush">
        {!rows ? (
          <div style={{ padding: 16 }}><Skeleton rows={3} /></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Учасник</th>
                  <th>Роль</th>
                  <th>Акаунт</th>
                  <th className="hide-sm">Останній вхід</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => {
                  const me = m.email === myEmail
                  const a = accounts[m.email]
                  return (
                    <tr key={m.email}>
                      <td>
                        <div className="row" style={{ gap: 10 }}>
                          <span className="avatar" aria-hidden="true">{m.email[0]}</span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 500, wordBreak: 'break-all' }}>{m.email}</div>
                            {me && <span className="small muted">це ви</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {isAdmin && !me ? (
                          <select value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} aria-label={`Роль ${m.email}`} style={{ minWidth: 150 }}>
                            <option value="member">Учасник</option>
                            <option value="admin">Адміністратор</option>
                          </select>
                        ) : (
                          ROLE[m.role]
                        )}
                      </td>
                      <td>{status(m)}</td>
                      <td className="muted hide-sm tnum">{a?.last_sign_in_at ? fmtDate(a.last_sign_in_at.slice(0, 10)) : '—'}</td>
                      <td className="actions">
                        {isAdmin && !me && (
                          <>
                            {a?.has_account ? (
                              <button className="btn ghost sm" onClick={() => resetPassword(m)} title="Задати тимчасовий пароль">
                                <Icon name="key" size={16} /> <span className="hide-sm">Тимчасовий пароль</span>
                              </button>
                            ) : (
                              <button className="btn ghost sm" onClick={() => createFor(m)}>
                                <Icon name="plus" size={16} /> Створити акаунт
                              </button>
                            )}
                            <button className="btn ghost icon sm danger" onClick={() => remove(m)} aria-label={`Прибрати ${m.email}`} title="Прибрати з команди">
                              <Icon name="trash" size={17} />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
