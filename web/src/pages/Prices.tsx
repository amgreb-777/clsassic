import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import { errText } from '../lib/format'
import { uah } from '../lib/cost'
import Icon from '../components/Icon'
import { Alert, Empty, SearchInput, Skeleton, useConfirm, useToast } from '../components/ui'

const STORES = ['METRO', 'Сільпо', 'NOVUS', 'Auchan', 'MegaMarket'] as const
const CALC = 'Розрахунок'
const COLORS: Record<string, string> = {
  METRO: '#2b59c3',
  Сільпо: '#e07a1f',
  NOVUS: '#2f9e6a',
  Auchan: '#c0392b',
  MegaMarket: '#7b4fb3',
  [CALC]: 'var(--ink)',
}

type Run = {
  id: number
  trigger: 'manual' | 'schedule' | 'import'
  started_by: string | null
  status: 'running' | 'done' | 'error' | 'cancelled'
  started_at: string
  finished_at: string | null
  passes: number
  calc_store: string | null
  total: number
  checked: number
  changed: number
  failed: number
  gone: number
  out_of_stock: number
  suspicious: number
  calc_changed: number
  by_store: Record<string, { total: number; checked: number; failed: number; gone: number; changed: number; oos: number }> | null
  top_changes: { product_id: number; product: string; store: string; from: number; to: number; unit: string; pct: number }[] | null
  suspicious_list: { product_id: number; product: string; store: string; from: number; pack: number | null }[] | null
  calc_changes: { product_id: number; product: string; source: string | null; from: number; to: number; pct: number | null }[] | null
  error: string | null
}
type Progress = { run_id: number; store: string; total: number; done: number; pending: number; retrying: number; failed: number; gone: number; next_at: string | null }
type Hist = { product_id: number; store: string; price_kg: number | null; price_pcs: number | null; in_stock: boolean | null; suspicious: boolean; source: string | null; observed_at: string; run_id: number | null }
type Prod = { id: number; name: string; category: string | null; price_kg: number | null; price_pcs: number | null; price_source: string | null }

const TRIGGER: Record<Run['trigger'], string> = { manual: 'Вручну', schedule: 'За розкладом', import: 'Початкові ціни' }
const dt = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const d2 = (iso: string) => new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' })
const hm = (iso: string) => new Date(iso).toLocaleTimeString('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit' })
const pct = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 1000) / 10 : 0)
const pctTxt = (p: number) => `${p > 0 ? '+' : ''}${String(p).replace('.', ',')}%`
const val = (h: { price_kg: number | null; price_pcs: number | null }) => (h.price_kg != null ? Number(h.price_kg) : h.price_pcs != null ? Number(h.price_pcs) : null)
const unitOf = (h: { price_kg: number | null }) => (h.price_kg != null ? 'кг' : 'шт')

function duration(a: string, b: string | null) {
  if (!b) return ''
  const m = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))
  return m < 60 ? `${m} хв` : `${Math.floor(m / 60)} год ${m % 60} хв`
}

/** Наступний понеділок 8:00 за Києвом (або сьогодні, якщо ще не настав). */
function nextMonday8() {
  const now = new Date()
  const kyiv = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Kyiv' }))
  const add = (8 - kyiv.getDay()) % 7 // днів до понеділка
  const target = new Date(kyiv)
  target.setDate(kyiv.getDate() + add)
  target.setHours(8, 0, 0, 0)
  if (target <= kyiv) target.setDate(target.getDate() + 7)
  return target.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }) + ', 08:00'
}

export default function Prices({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [progress, setProgress] = useState<Progress[]>([])
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [tab, setTabState] = useState<'reports' | 'dynamics'>(() => {
    try {
      return (localStorage.getItem('pricesTab') as 'reports' | 'dynamics') || 'reports'
    } catch {
      return 'reports'
    }
  })
  const setTab = (t: 'reports' | 'dynamics') => {
    setTabState(t)
    try {
      localStorage.setItem('pricesTab', t)
    } catch {
      /* немає доступу */
    }
  }

  const running = runs?.find((r) => r.status === 'running') ?? null
  const wasRunning = useRef<number | null>(null)

  const loadRuns = useCallback(async () => {
    const { data, error: e } = await supabase.from('price_runs').select('*').order('id', { ascending: false }).limit(40)
    if (e) return setError(e.message)
    setRuns(data as Run[])
    const run = (data as Run[]).find((r) => r.status === 'running')
    if (run) {
      const { data: p } = await supabase.from('price_run_progress').select('*').eq('run_id', run.id)
      setProgress((p as Progress[]) ?? [])
    } else setProgress([])
  }, [])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // поки йде оновлення — оновлюємо прогрес кожні 4 с
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) {
        const done = runs?.find((r) => r.id === wasRunning.current)
        if (done?.status === 'done') toast(`Ціни оновлено: перевірено ${done.checked}, змінилось ${done.changed}`)
        if (done?.status === 'error') toast(`Оновлення не завершилось: ${done.error ?? ''}`, 'err')
        wasRunning.current = null
      }
      return
    }
    wasRunning.current = running.id
    const t = setInterval(loadRuns, 4000)
    return () => clearInterval(t)
  }, [running, runs, loadRuns, toast])

  async function start() {
    const ok = await confirm({
      title: 'Оновити ціни в усіх магазинах?',
      text: 'Ціни всіх продуктів буде перевірено в METRO, Сільпо, NOVUS, Auchan і MegaMarket. Оновлення йде на сервері за кілька проходів (≈ 5–15 хв), щоб не перевищити ліміти магазинів, — сторінку можна закрити. Ручні ціни не змінюються.',
      ok: 'Оновити',
    })
    if (!ok) return
    setStarting(true)
    try {
      const { data, error: e } = await supabase.functions.invoke<{ ok: boolean; run_id: number; error?: string }>('refresh-prices', { body: { action: 'start' } })
      if (e || !data?.ok) throw new Error(data?.error ?? (await fnError(e)))
      toast('Оновлення запущено — прогрес видно на цій сторінці')
      await loadRuns()
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setStarting(false)
    }
  }

  const last = runs?.find((r) => r.status === 'done')

  return (
    <div className="page">
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">Довідник</div>
          <h1>Оновлення цін</h1>
          <p>Ціни METRO, Сільпо, NOVUS, Auchan і MegaMarket з доставкою по Києву (звичайна ціна, без акцій). Кожне оновлення зберігає історію цін і звіт.</p>
        </div>
        {isAdmin && (
          <button className="btn primary" onClick={start} disabled={starting || !!running}>
            <Icon name="refresh" size={18} className={running || starting ? 'spin' : undefined} /> {running ? 'Оновлюється…' : 'Оновити зараз'}
          </button>
        )}
      </div>

      {error && <Alert kind="err">{error}</Alert>}

      <div className="stats three price-stats">
        <div className="stat">
          <div className="k"><Icon name="calendar" size={14} /> Автоматично</div>
          <div className="v sm">щопонеділка, 08:00</div>
          <div className="kbzv">наступне: {nextMonday8()}</div>
        </div>
        <div className="stat">
          <div className="k">Останнє оновлення</div>
          <div className="v sm">{last ? dt(last.finished_at ?? last.started_at) : '—'}</div>
          <div className="kbzv">{last ? `${TRIGGER[last.trigger].toLowerCase()} · перевірено ${last.checked} з ${last.total}` : ''}</div>
        </div>
        <div className="stat">
          <div className="k">Ціна для розрахунку</div>
          <div className="v sm">{last?.calc_store ?? 'METRO'}</div>
          <div className="kbzv">{last && last.trigger !== 'import' ? `змінилась у ${last.calc_changed} продуктів` : 'без наявності — мінімальна серед магазинів'}</div>
        </div>
      </div>

      {running && <RunProgress run={running} progress={progress} />}

      <div className="chips seg tabs-line" role="tablist" aria-label="Розділ">
        <button role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'chip active' : 'chip'} onClick={() => setTab('reports')}>
          Звіти оновлень
        </button>
        <button role="tab" aria-selected={tab === 'dynamics'} className={tab === 'dynamics' ? 'chip active' : 'chip'} onClick={() => setTab('dynamics')}>
          Динаміка цін
        </button>
      </div>

      {tab === 'reports' ? (
        !runs ? <Skeleton rows={4} /> : runs.length ? <div className="run-list">{runs.map((r) => <RunCard key={r.id} run={r} />)}</div> : <Empty icon="refresh" title="Оновлень ще не було" />
      ) : (
        <Dynamics runsKey={runs?.filter((r) => r.status === 'done').length ?? 0} />
      )}
    </div>
  )
}

async function fnError(e: unknown): Promise<string> {
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

/* ---------------- Прогрес поточного оновлення ---------------- */
function RunProgress({ run, progress }: { run: Run; progress: Progress[] }) {
  const sum = (k: keyof Progress) => progress.reduce((s, p) => s + Number(p[k] ?? 0), 0)
  const total = sum('total') || run.total
  const finished = sum('done') + sum('failed') + sum('gone')
  const retrying = sum('retrying')
  const nextAt = progress.map((p) => p.next_at).filter(Boolean).sort()[0]
  const share = total ? Math.round((finished / total) * 100) : 0
  return (
    <section className="card run-progress" aria-live="polite">
      <div className="rp-head">
        <h3><Icon name="refresh" size={18} className="spin" /> Оновлення триває · прохід {Math.max(1, run.passes)}</h3>
        <b>{share}%</b>
      </div>
      <div className="bar"><i style={{ width: `${share}%` }} /></div>
      <p className="muted small">
        Перевірено {finished} з {total}. {retrying > 0 && <>Магазин обмежив частоту запитів — {retrying} товарів повторимо {nextAt && new Date(nextAt).getTime() > Date.now() + 30_000 ? `о ${hm(nextAt)}` : 'незабаром'}. </>}
        Наступний прохід стартує автоматично щохвилини; сторінку можна закрити.
      </p>
      <div className="rp-stores">
        {STORES.map((st) => {
          const p = progress.find((x) => x.store === st)
          if (!p) return null
          const f = p.done + p.failed + p.gone
          return (
            <div key={st} className="rp-store">
              <div className="rp-name"><i style={{ background: COLORS[st] }} />{st}<span>{f} / {p.total}</span></div>
              <div className="bar thin"><i style={{ width: `${p.total ? (f / p.total) * 100 : 0}%`, background: COLORS[st] }} /></div>
              {(p.retrying > 0 || p.failed > 0) && (
                <div className="rp-note">{p.retrying > 0 && `повтор: ${p.retrying}`}{p.retrying > 0 && p.failed > 0 && ' · '}{p.failed > 0 && `не відповіли: ${p.failed}`}</div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ---------------- Звіт одного оновлення ---------------- */
function RunCard({ run }: { run: Run }) {
  const imp = run.trigger === 'import'
  return (
    <details className={`card run-card ${run.status}`}>
      <summary>
        <div className="rc-main">
          <div className="rc-date">{dt(run.finished_at ?? run.started_at)}</div>
          <div className="rc-meta">
            <span className={`badge ${run.trigger === 'schedule' ? 'confirmed' : run.trigger === 'import' ? 'plain' : 'draft'}`}>{TRIGGER[run.trigger]}</span>
            {run.status === 'running' && <span className="badge purchased">триває</span>}
            {run.status === 'error' && <span className="badge danger-b">помилка</span>}
            {!imp && run.started_by && <span className="muted small">{run.started_by}</span>}
            {!imp && run.finished_at && <span className="muted small">· {duration(run.started_at, run.finished_at)}{run.passes > 1 ? `, ${run.passes} проходи` : ''}</span>}
          </div>
        </div>
        {run.status === 'running' ? (
          <div className="rc-nums"><span><b>…</b><small>прогрес — вище</small></span></div>
        ) : (
        <div className="rc-nums">
          <span><b>{run.checked}</b> з {run.total}<small>перевірено</small></span>
          {!imp && <span><b>{run.changed}</b><small>змінилось</small></span>}
          {!imp && <span className={run.calc_changed ? 'gold' : ''}><b>{run.calc_changed}</b><small>у розрахунку</small></span>}
          {!imp && run.suspicious > 0 && <span className="warn"><b>{run.suspicious}</b><small>підозрілі</small></span>}
          {!imp && run.failed + run.gone > 0 && <span className="muted"><b>{run.failed + run.gone}</b><small>без відповіді</small></span>}
        </div>
        )}
      </summary>
      <div className="rc-body">
        {run.error && <Alert kind="err">{run.error}</Alert>}
        {imp ? (
          <p className="muted">Початкова точка історії: ціни, зібрані 22.11.2026 (Сільпо — через MCP, METRO / NOVUS / Auchan / MegaMarket — через zakaz.ua).</p>
        ) : (
          <>
            {run.by_store && (
              <div className="table-wrap">
                <table className="rc-table">
                  <thead>
                    <tr><th>Магазин</th><th className="num">Перевірено</th><th className="num">Змінилось</th><th className="num">Без наявності</th><th className="num">Не відповіли</th></tr>
                  </thead>
                  <tbody>
                    {STORES.filter((s) => run.by_store?.[s]).map((s) => {
                      const b = run.by_store![s]
                      return (
                        <tr key={s}>
                          <td><i className="dot" style={{ background: COLORS[s] }} /> {s}</td>
                          <td className="num">{b.checked} / {b.total}</td>
                          <td className="num">{b.changed}</td>
                          <td className="num">{b.oos}</td>
                          <td className="num">{b.failed + b.gone}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!!run.calc_changes?.length && (
              <ChangeList
                title={`Ціна для розрахунку (${run.calc_store ?? 'METRO'}) змінилась у ${run.calc_changes.length} продуктів`}
                rows={run.calc_changes.map((c) => ({ key: `c${c.product_id}`, name: c.product, sub: c.source ?? '', from: c.from, to: c.to, pct: c.pct ?? pct(c.from, c.to) }))}
              />
            )}
            {!!run.top_changes?.length && (
              <ChangeList
                title="Найбільші зміни в магазинах"
                rows={run.top_changes.map((c) => ({ key: `t${c.product_id}${c.store}`, name: c.product, sub: `${c.store} · за ${c.unit}`, from: c.from, to: c.to, pct: c.pct }))}
              />
            )}
            {!!run.suspicious_list?.length && (
              <div className="rc-block">
                <h4>Підозрілі зміни — ціну не замінено</h4>
                <p className="muted small">Ціна упаковки змінилась більш ніж у 2,5 раза — ймовірно, інше фасування. Перевірте товар і за потреби внесіть ручну ціну.</p>
                <ul className="chg-list">
                  {run.suspicious_list.map((s) => (
                    <li key={`s${s.product_id}${s.store}`}>
                      <span>{s.product} <small className="muted">· {s.store}</small></span>
                      <span>{uah(s.from)}{s.pack ? ` → упаковка ${uah(s.pack)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!run.changed && !run.calc_changed && run.status === 'done' && <p className="muted">Ціни не змінились.</p>}
          </>
        )}
      </div>
    </details>
  )
}

function ChangeList({ title, rows }: { title: string; rows: { key: string; name: string; sub: string; from: number; to: number; pct: number }[] }) {
  const [all, setAll] = useState(false)
  const list = all ? rows : rows.slice(0, 10)
  return (
    <div className="rc-block">
      <h4>{title}</h4>
      <ul className="chg-list">
        {list.map((r) => (
          <li key={r.key}>
            <span>{r.name} {r.sub && <small className="muted">· {r.sub}</small>}</span>
            <span className={r.to > r.from ? 'up' : 'down'}>
              {uah(r.from)} → {uah(r.to)} <b>{pctTxt(r.pct)}</b>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > 10 && (
        <button className="btn ghost sm" onClick={() => setAll(!all)}>{all ? 'Згорнути' : `Показати всі ${rows.length}`}</button>
      )}
    </div>
  )
}

/* ---------------- Динаміка цін ---------------- */
type DynRow = { p: Prod; series: Hist[]; now: number | null; unit: string; prev: number | null; first: number | null }

function Dynamics({ runsKey }: { runsKey: number }) {
  const [rows, setRows] = useState<DynRow[] | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'up' | 'down' | 'name' | 'total'>('up')
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [prods, hist] = await Promise.all([
          fetchAll<Prod>((f, t) => supabase.from('products').select('id, name, category, price_kg, price_pcs, price_source').order('name').range(f, t)),
          fetchAll<Hist>((f, t) =>
            supabase.from('price_history').select('product_id, store, price_kg, price_pcs, in_stock, suspicious, source, observed_at, run_id').eq('store', CALC).order('observed_at').range(f, t),
          ),
        ])
        const by = new Map<number, Hist[]>()
        for (const h of hist) by.set(h.product_id, [...(by.get(h.product_id) ?? []), h])
        setRows(
          prods.map((p) => {
            const s = by.get(p.id) ?? []
            const vals = s.map(val).filter((x): x is number => x != null)
            const now = p.price_kg != null ? Number(p.price_kg) : p.price_pcs != null ? Number(p.price_pcs) : null
            return { p, series: s, now, unit: p.price_kg != null ? 'кг' : 'шт', prev: vals.length > 1 ? vals[vals.length - 2] : null, first: vals[0] ?? null }
          }),
        )
      } catch (e) {
        setErr(errText(e))
      }
    })()
  }, [runsKey])

  const list = useMemo(() => {
    if (!rows) return []
    const n = q.trim().toLowerCase()
    const xs = rows.filter((r) => !n || r.p.name.toLowerCase().includes(n) || (r.p.category ?? '').toLowerCase().includes(n))
    const ch = (r: DynRow) => (r.prev != null && r.now != null ? pct(r.prev, r.now) : 0)
    const tot = (r: DynRow) => (r.first != null && r.now != null ? pct(r.first, r.now) : 0)
    return xs.sort((a, b) =>
      sort === 'name' ? a.p.name.localeCompare(b.p.name, 'uk') : sort === 'up' ? ch(b) - ch(a) || tot(b) - tot(a) : sort === 'down' ? ch(a) - ch(b) || tot(a) - tot(b) : Math.abs(tot(b)) - Math.abs(tot(a)),
    )
  }, [rows, q, sort])

  if (err) return <Alert kind="err">{err}</Alert>
  if (!rows) return <Skeleton rows={6} />
  const runsCount = Math.max(...rows.map((r) => r.series.length), 0)
  return (
    <section className="card flush dyn">
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Знайти продукт або категорію…" />
        <label className="field sort-field">
          <span className="sr-only">Сортування</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="up">Найбільше подорожчали</option>
            <option value="down">Найбільше подешевшали</option>
            <option value="total">Найбільша зміна за весь час</option>
            <option value="name">За назвою</option>
          </select>
        </label>
      </div>
      {runsCount < 2 && (
        <p className="dyn-hint muted small"><Icon name="info" size={16} /> Динаміка з'явиться після наступного оновлення: зараз у історії одна точка — ціни від 22.11.2026.</p>
      )}
      <div className="dyn-head" aria-hidden="true">
        <span>Продукт</span><span>Ціна для розрахунку</span><span>З минулого</span><span>За весь час</span><span>Динаміка</span>
      </div>
      <ul className="dyn-list">
        {list.map((r) => {
          const ch = r.prev != null && r.now != null ? pct(r.prev, r.now) : null
          const tot = r.first != null && r.now != null && r.series.length > 1 ? pct(r.first, r.now) : null
          const isOpen = open === r.p.id
          return (
            <li key={r.p.id} className={isOpen ? 'open' : ''}>
              <button className="dyn-row" onClick={() => setOpen(isOpen ? null : r.p.id)} aria-expanded={isOpen}>
                <span className="dn">
                  <b>{r.p.name}</b>
                  <small className="muted">{r.p.category ?? ''}{r.p.price_source ? ` · ${r.p.price_source}` : ''}</small>
                </span>
                <span className="dp">{r.now != null ? `${uah(r.now)}/${r.unit}` : '—'}</span>
                <span data-label="з минулого " className={`dc ${ch == null || ch === 0 ? '' : ch > 0 ? 'up' : 'down'}`}>{ch == null ? '—' : ch === 0 ? '0%' : pctTxt(ch)}</span>
                <span data-label="за весь час " className={`dc ${tot == null || tot === 0 ? '' : tot > 0 ? 'up' : 'down'}`}>{tot == null ? '—' : tot === 0 ? '0%' : pctTxt(tot)}</span>
                <span className="ds"><Spark values={r.series.map(val)} /></span>
              </button>
              {isOpen && <ProductHistory product={r.p} />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Spark({ values }: { values: (number | null)[] }) {
  const v = values.filter((x): x is number => x != null)
  if (v.length < 2) return <svg className="spark" viewBox="0 0 80 24" aria-hidden="true"><line x1="0" y1="12" x2="80" y2="12" className="flat" /></svg>
  const mn = Math.min(...v)
  const mx = Math.max(...v)
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 78 + 1},${mx === mn ? 12 : 22 - ((x - mn) / (mx - mn)) * 20}`).join(' ')
  const up = v[v.length - 1] > v[0]
  return (
    <svg className={`spark ${v[v.length - 1] === v[0] ? '' : up ? 'up' : 'down'}`} viewBox="0 0 80 24" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  )
}

/** Історія цін продукту в усіх магазинах: графік і таблиця за датами оновлень. */
function ProductHistory({ product }: { product: Prod }) {
  const [hist, setHist] = useState<Hist[] | null>(null)
  useEffect(() => {
    supabase
      .from('price_history')
      .select('product_id, store, price_kg, price_pcs, in_stock, suspicious, source, observed_at, run_id')
      .eq('product_id', product.id)
      .order('observed_at')
      .then(({ data }) => setHist((data as Hist[]) ?? []))
  }, [product.id])
  if (!hist) return <div className="ph"><Skeleton rows={2} /></div>
  const stores = [CALC, ...STORES].filter((s) => hist.some((h) => h.store === s))
  // точки — оновлення (run_id), по одній на дату
  const runIds = [...new Set(hist.map((h) => h.run_id ?? 0))]
  const when = new Map<number, string>()
  for (const h of hist) if (!when.has(h.run_id ?? 0) || h.store === CALC) when.set(h.run_id ?? 0, h.observed_at)
  runIds.sort((a, b) => (when.get(a) ?? '').localeCompare(when.get(b) ?? ''))
  const cell = (s: string, r: number) => hist.find((h) => h.store === s && (h.run_id ?? 0) === r)
  const unit = hist.find((h) => h.store === CALC) ? unitOf(hist.find((h) => h.store === CALC)!) : 'кг'
  return (
    <div className="ph">
      <HistoryChart stores={stores} runIds={runIds} when={when} cell={cell} />
      <div className="table-wrap">
        <table className="ph-table">
          <thead>
            <tr>
              <th>Дата</th>
              {stores.map((s) => (
                <th key={s} className="num"><i className="dot" style={{ background: COLORS[s] }} /> {s === CALC ? 'Розрахунок' : s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...runIds].reverse().map((r) => (
              <tr key={r}>
                <td className="nowrap">{when.get(r) ? dt(when.get(r)!) : '—'}</td>
                {stores.map((s) => {
                  const h = cell(s, r)
                  const v = h ? val(h) : null
                  return (
                    <td key={s} className={`num ${h?.in_stock === false ? 'oos' : ''} ${s === CALC ? 'strong' : ''}`} title={h?.in_stock === false ? 'немає в наявності' : h?.suspicious ? 'підозріла зміна — ціну не змінено' : h?.source ?? undefined}>
                      {v != null ? uah(v) : '—'}
                      {h?.suspicious && ' ⚠'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Ціни за {unit === 'кг' ? '1 кг' : '1 шт'}; сірим — товару не було в наявності. «Розрахунок» — ціна, за якою рахується собівартість.</p>
    </div>
  )
}

function HistoryChart({ stores, runIds, when, cell }: { stores: string[]; runIds: number[]; when: Map<number, string>; cell: (s: string, r: number) => Hist | undefined }) {
  const W = 640
  const H = 180
  const P = { l: 56, r: 12, t: 12, b: 26 }
  const all = stores.flatMap((s) => runIds.map((r) => cell(s, r)).map((h) => (h ? val(h) : null))).filter((x): x is number => x != null)
  if (!all.length) return null
  let mn = Math.min(...all)
  let mx = Math.max(...all)
  if (mn === mx) {
    mn *= 0.9
    mx *= 1.1
  }
  const x = (i: number) => (runIds.length === 1 ? (P.l + W - P.r) / 2 : P.l + (i / (runIds.length - 1)) * (W - P.l - P.r))
  const y = (v: number) => P.t + (1 - (v - mn) / (mx - mn)) * (H - P.t - P.b)
  const ticks = [mn, (mn + mx) / 2, mx]
  return (
    <div className="ph-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Графік цін за датами оновлень">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="ax">{Math.round(t)}</text>
          </g>
        ))}
        {runIds.map((r, i) => (
          <text key={r} x={x(i)} y={H - 6} textAnchor="middle" className="ax">{when.get(r) ? d2(when.get(r)!) : ''}</text>
        ))}
        {stores.map((s) => {
          const pts = runIds.map((r, i) => {
            const h = cell(s, r)
            const v = h ? val(h) : null
            return v == null ? null : { x: x(i), y: y(v), oos: h?.in_stock === false }
          })
          const line = pts.filter(Boolean) as { x: number; y: number; oos: boolean }[]
          return (
            <g key={s} style={{ color: COLORS[s] }}>
              {line.length > 1 && <polyline points={line.map((p) => `${p.x},${p.y}`).join(' ')} className={s === CALC ? 'ln calc' : 'ln'} />}
              {line.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={s === CALC ? 4 : 3} className={p.oos ? 'pt oos' : 'pt'} />)}
            </g>
          )
        })}
      </svg>
      <div className="ph-legend">
        {stores.map((s) => (
          <span key={s}><i style={{ background: COLORS[s] }} />{s}</span>
        ))}
      </div>
    </div>
  )
}
