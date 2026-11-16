import { useState } from 'react'

const LIMIT = 6

/**
 * Фільтр категорій: чипи переносяться на кілька рядків (усі групи видно),
 * найбільші категорії першими, решта — за кнопкою «Ще N».
 */
export default function CategoryChips({
  cats,
  value,
  onChange,
  total,
}: {
  cats: [string, number][]
  value: string
  onChange: (v: string) => void
  total: number
}) {
  const [open, setOpen] = useState(false)
  let visible = open ? cats : cats.slice(0, LIMIT)
  // обрана категорія завжди видима, навіть якщо згорнута
  if (value && !visible.some(([c]) => c === value)) {
    const sel = cats.find(([c]) => c === value)
    if (sel) visible = [...visible, sel]
  }
  const hidden = cats.length - visible.length

  return (
    <div className="chips wrap" role="group" aria-label="Категорії">
      <button type="button" className={!value ? 'chip active' : 'chip'} aria-pressed={!value} onClick={() => onChange('')}>
        Усі<span className="count">{total}</span>
      </button>
      {visible.map(([c, n]) => (
        <button
          type="button"
          key={c}
          className={value === c ? 'chip active' : 'chip'}
          aria-pressed={value === c}
          onClick={() => onChange(value === c ? '' : c)}
        >
          {c}
          <span className="count">{n}</span>
        </button>
      ))}
      {(hidden > 0 || open) && cats.length > LIMIT && (
        <button type="button" className="chip more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Згорнути' : `Ще ${hidden}`}
        </button>
      )}
    </div>
  )
}
