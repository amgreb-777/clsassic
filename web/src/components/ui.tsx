import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import Icon, { type IconName } from './Icon'

/* ---------------- Логотип у стилі бренду ---------------- */
export function Logo({ size, script }: { size?: 'lg'; script?: boolean }) {
  return (
    <span className={`logo ${size ?? ''}`} aria-label="Classic Catering">
      <span className="logo-word">Classic</span>
      <span className="logo-sub">CATERING</span>
      {script && <span className="logo-script">даруємо емоції…</span>}
    </span>
  )
}

/* ---------------- Тости ---------------- */
type Toast = { id: number; text: string; kind: 'ok' | 'err' }
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {})
export const useToast = () => useContext(ToastCtx)

/* ---------------- Підтвердження (замість window.confirm) ---------------- */
type ConfirmOpts = { title: string; text?: string; ok?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false)
export const useConfirm = () => useContext(ConfirmCtx)

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-2), { id, text, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 6000 : 3200)
  }, [])

  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })), [])
  const close = (v: boolean) => {
    dialog?.resolve(v)
    setDialog(null)
  }

  return (
    <ToastCtx.Provider value={toast}>
      <ConfirmCtx.Provider value={confirm}>
        {children}
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>
              <Icon name={t.kind === 'err' ? 'alert' : 'check'} size={18} />
              <span>{t.text}</span>
              <button className="x" aria-label="Закрити" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
        </div>
        {dialog && <ConfirmDialog {...dialog} onClose={close} />}
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  )
}

function ConfirmDialog({ title, text, ok, danger, onClose }: ConfirmOpts & { onClose: (v: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h3 id="dlg-title">{title}</h3>
        {text && <p>{text}</p>}
        <div className="right">
          <button className="btn ghost" onClick={() => onClose(false)}>Скасувати</button>
          <button ref={okRef} className={danger ? 'btn primary danger-solid' : 'btn primary'} onClick={() => onClose(true)}>
            {ok ?? 'Підтвердити'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Дрібні компоненти ---------------- */
export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} size={28} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function Alert({ kind, children, onClose }: { kind: 'err' | 'ok' | 'warn' | 'info'; children: ReactNode; onClose?: () => void }) {
  const icon: IconName = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert'
  return (
    <div className={`alert ${kind}`} role={kind === 'err' ? 'alert' : undefined}>
      <Icon name={icon} size={18} />
      <div className="grow">{children}</div>
      {onClose && (
        <button className="btn ghost icon sm" aria-label="Закрити" onClick={onClose} style={{ marginTop: -6, marginRight: -6 }}>
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  )
}

export function Skeleton({ rows = 6, card }: { rows?: number; card?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Завантаження">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skeleton ${card ? 'sk-card' : 'sk-row'}`} />
      ))}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="input-icon grow">
      <Icon name="search" size={18} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  )
}

/** Тема: системна / світла / темна, зберігається в localStorage. */
export function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark' | null>(() => {
    try {
      return (localStorage.getItem('theme') as 'light' | 'dark' | null) ?? null
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
    try {
      if (theme) localStorage.setItem('theme', theme)
      else localStorage.removeItem('theme')
    } catch {
      /* немає доступу до localStorage */
    }
  }, [theme])
  const isDark = theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  return { isDark, toggle: () => setTheme(isDark ? 'light' : 'dark') }
}
