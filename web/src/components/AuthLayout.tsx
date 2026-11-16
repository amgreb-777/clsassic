import type { ReactNode } from 'react'

/** Екран входу: фото бренду ліворуч, форма праворуч (на телефоні — фото зверху). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-hero" aria-hidden="true">
        <img src="./img/login-hero.webp" alt="" />
        <div className="auth-quote">
          <div className="script">даруємо емоції…</div>
          <p>Меню заходу → список закупівлі за технологічними картами за кілька кліків.</p>
        </div>
      </div>
      <div className="auth-panel">{children}</div>
    </div>
  )
}
