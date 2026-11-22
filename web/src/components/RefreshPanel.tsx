import Icon from './Icon'
import { uah } from '../lib/cost'

export type PriceChange = { product_id: number; product: string; store: string; from: number; to: number; title?: string }
export type RefreshResult = {
  ok: boolean
  at: string | null
  calcStore: string
  total: number
  updated: number
  changed: number
  failed: number
  gone: number
  skipped: number
  suspicious: PriceChange[]
  timeout: number
  topChanges: PriceChange[]
}
export type StoreLine = { store: string; updated: number; changed: number; failed: number; gone: number; total: number; error?: string }
export type RefreshReport = { byStore: StoreLine[]; topChanges: PriceChange[]; suspicious: PriceChange[]; at: string | null; error: string | null }

/** Текст помилки Edge Function (тіло відповіді, якщо воно є). */
export async function fnError(e: unknown): Promise<string> {
  const ctx = (e as { context?: Response } | null)?.context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const j = await ctx.clone().json()
      if (j?.error) return String(j.error)
    } catch {
      /* не JSON */
    }
  }
  return e instanceof Error ? e.message : String(e ?? 'помилка')
}

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const pct = (c: PriceChange) => (c.from ? Math.round(((c.to - c.from) / c.from) * 100) : 0)

export default function RefreshPanel({ report, onClose }: { report: RefreshReport; onClose: () => void }) {
  const failed = report.byStore.reduce((s, x) => s + x.failed, 0)
  const top = report.topChanges.slice(0, 10)
  return (
    <section className="card refresh-panel">
      <div className="refresh-head">
        <h3>
          <Icon name={report.error ? 'alert' : 'check'} size={18} /> Оновлення цін{report.at && <> · {dateTime(report.at)}</>}
        </h3>
        <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Закрити">
          <Icon name="x" size={18} />
        </button>
      </div>
      {report.error && <p className="refresh-err">Перерахунок собівартості не вдався: {report.error}</p>}
      <div className="refresh-stores">
        {report.byStore.map((s) => (
          <div key={s.store} className={`refresh-store ${s.error ? 'bad' : ''}`}>
            <b>{s.store}</b>
            {s.error ? (
              <span>помилка: {s.error}</span>
            ) : (
              <span>
                перевірено {s.updated} з {s.total} · змінилось {s.changed}
                {s.failed > 0 && <> · не відповіли {s.failed}</>}
                {s.gone > 0 && <> · немає в наявності {s.gone}</>}
              </span>
            )}
          </div>
        ))}
      </div>
      {failed > 0 && (
        <p className="muted small">
          Магазини обмежують кількість запитів — для {failed} позицій лишилися попередні ціни. Натисніть «Оновити ціни» ще раз через кілька хвилин: спершу оновлюються найстаріші ціни.
        </p>
      )}
      {top.length > 0 && (
        <>
          <h4>Найбільші зміни</h4>
          <ul className="refresh-list">
            {top.map((c) => (
              <li key={`${c.product_id}-${c.store}`}>
                <span>{c.product} <small className="muted">· {c.store}</small></span>
                <span className={c.to > c.from ? 'up' : 'down'}>
                  {uah(c.from)} → {uah(c.to)} ({pct(c) > 0 ? '+' : ''}{pct(c)}%)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.suspicious.length > 0 && (
        <>
          <h4>Підозрілі зміни — ціну не замінено</h4>
          <p className="muted small">Ціна змінилась більш ніж у 2,5 раза — можливо, магазин замінив фасування. Перевірте товар і за потреби внесіть ручну ціну.</p>
          <ul className="refresh-list">
            {report.suspicious.map((c) => (
              <li key={`s-${c.product_id}-${c.store}`}>
                <span>{c.product} <small className="muted">· {c.store}{c.title ? ` · ${c.title}` : ''}</small></span>
                <span>{uah(c.from)} → {uah(c.to)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
