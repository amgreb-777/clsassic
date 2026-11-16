import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Icon, { type IconName } from './components/Icon'
import { Logo, useTheme } from './components/ui'
import Login from './pages/Login'
import Orders from './pages/Orders'
import OrderEdit from './pages/OrderEdit'
import Dishes from './pages/Dishes'
import DishEdit from './pages/DishEdit'
import Products from './pages/Products'
import Team from './pages/Team'
import NewPassword from './pages/NewPassword'

const NAV: { to: string; label: string; icon: IconName }[] = [
  { to: '/orders', label: 'Замовлення', icon: 'orders' },
  { to: '/dishes', label: 'Страви', icon: 'dishes' },
  { to: '/products', label: 'Продукти', icon: 'products' },
  { to: '/team', label: 'Команда', icon: 'team' },
]

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // undefined — перевіряємо; null — не в команді; інакше роль
  const [role, setRole] = useState<'admin' | 'member' | null | undefined>(undefined)
  const email = session?.user.email?.toLowerCase() ?? ''
  const [changingPw, setChangingPw] = useState(false)
  const mustChange = session?.user.app_metadata?.must_change_password === true
  const { isDark, toggle } = useTheme()
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!email) return
    let cancelled = false
    supabase
      .from('team_members')
      .select('role')
      .eq('email', email)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRole((data?.role as 'admin' | 'member' | undefined) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [email])

  // Прокрутка вгору при зміні сторінки
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [location.pathname])

  if (session === undefined)
    return (
      <div className="center-screen">
        <div className="loader" aria-label="Завантаження" />
      </div>
    )
  if (!session) return <Login />
  if (mustChange || changingPw)
    return (
      <NewPassword
        email={session.user.email}
        note={mustChange ? 'Ви увійшли з тимчасовим паролем від адміністратора. Задайте власний пароль.' : undefined}
        afterSave={
          mustChange
            ? async () => {
                const { error } = await supabase.rpc('clear_must_change_password')
                if (error) throw new Error(error.message)
              }
            : undefined
        }
        onDone={async () => {
          setChangingPw(false)
          // оновлюємо токен, щоб прибрати прапорець тимчасового пароля з сесії
          if (mustChange) await supabase.auth.refreshSession()
        }}
        onCancel={mustChange ? undefined : () => setChangingPw(false)}
      />
    )
  if (role === undefined)
    return (
      <div className="center-screen">
        <div className="loader" aria-label="Перевірка доступу" />
      </div>
    )
  if (role === null)
    return (
      <div className="center-screen">
        <div className="card auth-card" style={{ padding: 28 }}>
          <Logo />
          <h1>Немає доступу</h1>
          <p className="lead">
            Акаунт <b>{session.user.email}</b> не входить до команди. Попросіть адміністратора створити вам акаунт.
          </p>
          <button className="btn primary block" onClick={() => supabase.auth.signOut()}>
            <Icon name="logout" size={18} /> Вийти
          </button>
        </div>
      </div>
    )

  const initial = (session.user.email ?? '?').slice(0, 1)

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Головне меню">
        <Logo />
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to}>
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <div className="me-text">
              <div className="me-email" title={session.user.email}>{session.user.email}</div>
              <div className="small muted">{role === 'admin' ? 'Адміністратор' : 'Учасник'}</div>
            </div>
          </div>
          <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={toggle}>
            <Icon name={isDark ? 'sun' : 'moon'} size={18} /> {isDark ? 'Світла тема' : 'Темна тема'}
          </button>
          <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => setChangingPw(true)}>
            <Icon name="key" size={18} /> Змінити пароль
          </button>
          <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => supabase.auth.signOut()}>
            <Icon name="logout" size={18} /> Вийти
          </button>
        </div>
      </aside>

      <header className="mobile-top">
        <Logo />
        <div className="row">
          <button className="btn ghost icon" aria-label={isDark ? 'Світла тема' : 'Темна тема'} onClick={toggle}>
            <Icon name={isDark ? 'sun' : 'moon'} />
          </button>
          <button className="btn ghost icon" aria-label="Змінити пароль" onClick={() => setChangingPw(true)}>
            <Icon name="key" />
          </button>
          <button className="btn ghost icon" aria-label="Вийти" onClick={() => supabase.auth.signOut()}>
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <main className="main" id="main">
        <Routes>
          <Route path="/" element={<Navigate to="/orders" replace />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/:id" element={<OrderEdit />} />
          <Route path="/dishes" element={<Dishes />} />
          <Route path="/dishes/:id" element={<DishEdit />} />
          <Route path="/products" element={<Products />} />
          <Route path="/team" element={<Team isAdmin={role === 'admin'} myEmail={email} />} />
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Навігація">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to}>
            <Icon name={n.icon} size={22} />
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
