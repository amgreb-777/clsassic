import { RI, divN, energySplit, gFmt, kcalFmt, type Nutr } from '../lib/nutrition'
import Icon from './Icon'

/** Харчова цінність замовлення: усього і на 1 гостя, розподіл енергії БЖВ, % добової норми. */
export default function NutritionCard({ total, guests, missing }: { total: Nutr; guests: number | null; missing: number }) {
  const per = guests ? divN(total, guests) : null
  const split = energySplit(total)
  const rows: { k: keyof Nutr; label: string; unit: string }[] = [
    { k: 'kcal', label: 'Калорійність', unit: 'ккал' },
    { k: 'protein', label: 'Білки', unit: 'г' },
    { k: 'fat', label: 'Жири', unit: 'г' },
    { k: 'carbs', label: 'Вуглеводи', unit: 'г' },
  ]
  return (
    <section className="card nutrition" aria-label="Харчова цінність">
      <div className="card-head">
        <div>
          <h3>Харчова цінність</h3>
          <p>Розраховано за технологічними картами (їстівна частина продуктів, без втрат при термообробці).</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="nutr-table">
          <thead>
            <tr>
              <th />
              <th className="num">Усе замовлення</th>
              <th className="num">На 1 гостя</th>
              <th className="num hide-sm" title="Референтна добова величина (Регламент ЄС 1169/2011) для дорослого, 2000 ккал">
                % добової норми*
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td className={r.k === 'kcal' ? 'strong' : ''}>
                  <span className={`dot-${r.k}`} /> {r.label}
                </td>
                <td className="num">
                  {r.k === 'kcal' ? kcalFmt(total.kcal) : gFmt(total[r.k])} {r.unit}
                </td>
                <td className="num strong">
                  {per ? `${r.k === 'kcal' ? kcalFmt(per.kcal) : gFmt(per[r.k])} ${r.unit}` : '—'}
                </td>
                <td className="num hide-sm muted">{per ? `${Math.round((per[r.k] / RI[r.k]) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="macro-bar" aria-label={`Енергія: білки ${split.p}%, жири ${split.f}%, вуглеводи ${split.c}%`}>
        <i className="p" style={{ width: `${split.p}%` }} />
        <i className="f" style={{ width: `${split.f}%` }} />
        <i className="c" style={{ width: `${split.c}%` }} />
      </div>
      <div className="macro-legend small">
        <span><span className="dot-protein" /> Білки {split.p}%</span>
        <span><span className="dot-fat" /> Жири {split.f}%</span>
        <span><span className="dot-carbs" /> Вуглеводи {split.c}%</span>
        <span className="muted">частка енергії</span>
      </div>
      {!guests && (
        <p className="small muted" style={{ marginTop: 10 }}>
          <Icon name="info" size={14} /> Вкажіть кількість гостей у «Даних заходу», щоб бачити значення на 1 гостя.
        </p>
      )}
      {missing > 0 && (
        <p className="small warn-text" style={{ marginTop: 6 }}>
          Для {missing} інгредієнтів не задано КБЖВ — розрахунок неповний. Заповніть їх у розділі «Продукти».
        </p>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>* Референтні добові величини ЄС для дорослого (2000 ккал, білки 50 г, жири 70 г, вуглеводи 260 г).</p>
    </section>
  )
}
