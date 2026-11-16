import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Login from './pages/Login'
import Orders from './pages/Orders'
import OrderEdit from './pages/OrderEdit'
import Dishes from './pages/Dishes'
import DishEdit from './pages/DishEdit'
import Products from './pages/Products'
import Team from './pages/Team'
import NewPassword from './pages/NewPassword'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // undefined — перевіряємо; null — не в команді; інакше роль
  const [role, setRole] = useState<'admin' | 'member' | null | undefined>(undefined)
  const email = session?.user.email?.toLowerCase() ?? ''
  const [changingPw, setChangingPw] = useState(false)
  const mustChange = session?.user.app_metadata?.must_change_password === true

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

  if (session === undefined) return <div className="center muted">Завантаження…</div>
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
  if (role === undefined) return <div className="center muted">Перевірка доступу…</div>
  if (role === null)
    return (
      <div className="center">
        <div className="card login">
          <h3>Немає доступу</h3>
          <p className="muted">
            Акаунт <b>{session.user.email}</b> не входить до команди. Попросіть адміністратора додати цей email у
            розділі «Команда».
          </p>
          <button className="primary" onClick={() => supabase.auth.signOut()}>Вийти</button>
        </div>
      </div>
    )

  return (
    <div className="layout">
      <header className="topbar no-print">
        <div className="brand">
          <span className="logo">C</span>
          <span>Classic · Закупівля</span>
        </div>
        <nav>
          <NavLink to="/orders">Замовлення</NavLink>
          <NavLink to="/dishes">Страви</NavLink>
          <NavLink to="/products">Продукти</NavLink>
          <NavLink to="/team">Команда</NavLink>
        </nav>
        <div className="user">
          <span className="muted small">{session.user.email}</span>
          <button className="ghost" onClick={() => setChangingPw(true)}>Змінити пароль</button>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>Вийти</button>
        </div>
      </header>
      <main>
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
    </div>
  )
}
