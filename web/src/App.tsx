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

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center muted">Завантаження…</div>
  if (!session) return <Login />

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
        </nav>
        <div className="user">
          <span className="muted small">{session.user.email}</span>
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
          <Route path="*" element={<Navigate to="/orders" replace />} />
        </Routes>
      </main>
    </div>
  )
}
