import { useEffect, useMemo, useState } from 'react'
import type { Candidate, ResultSnapshot } from '../../types'
import { BRAZIL_STATE_BY_UF } from '../../data/brazil-states'
import { BrazilMap } from './brazil-map'
import './pesquisas-tracker.css'

export type PesquisasTrackerProps = {
  candidates: Candidate[]
  snapshot: ResultSnapshot
  round: 1 | 2
  state: string
}

type PollResult = {
  candidateName: string
  party: string | null
  percentage: number
}

type Poll = {
  id: string
  office: 'Presidente' | 'Governador'
  uf: string
  institute: string
  commissioner: string | null
  fieldDates: { start: string; end: string } | null
  publishedAt: string
  sampleSize: number | null
  marginOfError: number | null
  round: 1 | 2 | null
  scenarioLabel: string | null
  results: PollResult[]
  sourceUrl: string | null
}

type PollsFile = {
  generatedAt: string
  source: string | null
  polls: Poll[]
}

type SenadoResult = {
  candidateName: string
  party: string | null
  percentage: number | null
  notes: string | null
}

type SenadoState = {
  uf: string
  state: string
  pollster: string | null
  fieldwork: string | null
  sample: string | number | null
  marginOfError: string | null
  tseRegistration: string | null
  basis: string
  completeness: string
  source: string
  sourceUrl: string | null
  results: SenadoResult[]
  percentageSum: number
}

type SenadoFile = {
  generatedAt: string
  compiledManually: true
  note: string
  readme: string[]
  sources: { publisher: string; usedFor: string; url: string }[]
  states: SenadoState[]
}

type PresidenteEstadoResult = {
  candidateName: string
  party: string | null
  percentage: number
}

type PresidenteEstadoWave = {
  vintage: string
  pollster: string | null
  fieldwork: string | null
  sample: string | number | null
  completeness: string
  results: PresidenteEstadoResult[]
  undecided: number | null
  blank: number | null
  percentageSum: number
  sourceUrl: string | null
}

type PresidenteEstadoState = {
  uf: string
  state: string
  region: string | null
  waves: PresidenteEstadoWave[]
}

type PresidenteEstadosFile = {
  generatedAt: string
  compiledManually: true
  note: string
  readme: string[]
  sources: { publisher: string; usedFor: string; url: string }[]
  states: PresidenteEstadoState[]
}

type FetchStatus = 'loading' | 'loaded' | 'error'
type OfficeFilter = 'Todos' | 'Presidente' | 'Governador'
type RoundFilter = 'Todos' | 1 | 2
type PresidenteView = 'Nacional' | 'PorEstado' | 'LinhaDoTempo'
type GovernadorView = 'Atual' | 'LinhaDoTempo'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const percentFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const sampleFormat = new Intl.NumberFormat('pt-BR')

// Janela do "quadro atual" (cards de pesquisa individuais). O histórico
// completo (`scripts/sync-polls.mjs` guarda ~400 dias) alimenta a linha do
// tempo logo abaixo, que não tem esse corte.
const RECENT_WINDOW_DAYS = 30

// Paleta categórica validada (ver skill dataviz, references/palette.md):
// ordem fixa, passa os critérios de daltonismo em pares adjacentes (uso de
// linha/legenda, não "all-pairs"). Cor por candidato é atribuída por ordem
// alfabética do nome, não por posição no ranking, pra não repintar quando a
// liderança muda ao longo do tempo.
const TIMELINE_SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
const TIMELINE_OTHERS_COLOR = '#75786f'
const TIMELINE_MAX_SERIES = 5

function formatIsoDate(value: string, formatter: Intl.DateTimeFormat) {
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? value : formatter.format(parsed)
}

function firstUrl(value: string | null) {
  if (!value) return null
  return value.split(';')[0].trim()
}

function raceKey(poll: Poll) {
  return `${poll.office}|${poll.uf}`
}

function raceLabel(office: Poll['office'], uf: string) {
  if (office === 'Presidente') return 'Presidente da República · Brasil'
  const stateName = BRAZIL_STATE_BY_UF[uf]?.name ?? uf
  return `Governador · ${stateName}`
}

/** Base "reduzida a 100%" soma bem perto de 100; qualquer outra coisa é
 * ressalva real de qualidade de dado (não é erro de soma nosso). */
function isReducedBasis(basis: string) {
  return basis.toLowerCase().startsWith('2 votes consolidated')
}

function completenessLabelPt(completeness: string) {
  const lower = completeness.toLowerCase()
  if (lower.startsWith('full candidate list')) return 'Lista completa de candidatos'
  if (lower.startsWith('leaders only')) return 'Só os líderes (conforme divulgado pela fonte)'
  if (lower.includes('undecided') || lower.includes('blank')) return 'Líderes + indecisos/brancos (conforme divulgado pela fonte)'
  return completeness
}

/** Várias fontes incluem linhas pseudo-candidato no array de resultados
 * ("Indecisos", "Votos nulos, brancos ou em nenhum candidato", "Não sabe/Não
 * opinou" etc.). Elas não são candidatos e não devem ganhar o selo de
 * "Líder" mesmo quando somam o maior percentual da pesquisa. Não dá para
 * usar "tem partido" como critério: algumas fontes (ex.: Vox Brasil) não
 * informam partido nem para o candidato que de fato lidera. */
function isPseudoCandidateRow(candidateName: string) {
  return /indecis|branco|\bnulo|não sabe|nao sabe|não soube|nao soube|não opin|nao opin|não respond|nao respond|nenhum candidato|não vai votar|nao vai votar|outras respostas|^outros\b/i.test(
    candidateName,
  )
}

/** Marca o resultado líder de uma pesquisa (maior percentual) para destaque
 * visual. Só marca quando há mais de um candidato, o percentual é um número
 * real (nunca em cards com "dado indisponível" ou candidato único) e a linha
 * não é um pseudo-candidato (indecisos/brancos/nulos/etc.). */
function isLeadingResult(
  candidateName: string,
  percentage: number | null | undefined,
  topPercentage: number,
  resultsCount: number,
) {
  return (
    resultsCount > 1 &&
    topPercentage > 0 &&
    percentage != null &&
    percentage === topPercentage &&
    !isPseudoCandidateRow(candidateName)
  )
}

/** Mapa interativo (reaproveitado de brazil-map.tsx) usado como seletor de
 * estado nas 3 seções "por estado" de Pesquisas, com um <select> equivalente
 * reservado para telas estreitas, onde acertar um estado pequeno no SVG é
 * difícil de tocar com precisão. */
function UfMapPicker({
  options,
  activeUf,
  onSelect,
  mapAriaLabel,
  selectAriaLabel,
}: {
  options: { uf: string; name: string }[]
  activeUf: string | null
  onSelect: (uf: string) => void
  mapAriaLabel: string
  selectAriaLabel: string
}) {
  return (
    <div className="pesquisas-tracker__map-wrap">
      <select
        className="pesquisas-tracker__uf-select"
        aria-label={selectAriaLabel}
        value={activeUf ?? ''}
        onChange={(event) => {
          if (event.target.value) onSelect(event.target.value)
        }}
      >
        <option value="" disabled>
          Selecione um estado
        </option>
        {options.map((option) => (
          <option key={option.uf} value={option.uf}>
            {option.name} ({option.uf})
          </option>
        ))}
      </select>
      <BrazilMap
        activeUf={activeUf ?? undefined}
        onSelect={(selected) => onSelect(selected.uf)}
        hideDetailsPanel
        className="pesquisas-tracker__map"
        ariaLabel={mapAriaLabel}
      />
    </div>
  )
}

type TimelineSeries = { name: string; color: string; points: (number | null)[] }
type TimelineData = { days: string[]; series: TimelineSeries[] }

/** Agrupa pesquisas reais de uma mesma corrida (já filtradas por cargo/UF/
 * turno) por dia de divulgação. Quando mais de um instituto publica no mesmo
 * dia, usamos a média simples entre eles (dado real, só resumido pra caber
 * num ponto por dia), nunca um número inventado. Só os até
 * `TIMELINE_MAX_SERIES` candidatos com maior percentual já observado ganham
 * linha própria; o resto (candidatos menores + pseudo-linhas de
 * indecisos/brancos/nulos) é somado numa série "Outros". */
function buildTimelineSeries(polls: Poll[]): TimelineData {
  const byDay = new Map<string, Map<string, number[]>>()
  for (const poll of polls) {
    const day = poll.publishedAt.slice(0, 10)
    const dayMap = byDay.get(day) ?? new Map<string, number[]>()
    byDay.set(day, dayMap)
    for (const result of poll.results) {
      if (result.percentage == null) continue
      const values = dayMap.get(result.candidateName) ?? []
      values.push(result.percentage)
      dayMap.set(result.candidateName, values)
    }
  }

  const days = [...byDay.keys()].sort()
  const avgByDay = new Map<string, Map<string, number>>()
  const maxByCandidate = new Map<string, number>()
  for (const day of days) {
    const dayMap = byDay.get(day)!
    const avgMap = new Map<string, number>()
    for (const [name, values] of dayMap) {
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length
      avgMap.set(name, avg)
      maxByCandidate.set(name, Math.max(maxByCandidate.get(name) ?? 0, avg))
    }
    avgByDay.set(day, avgMap)
  }

  const allNames = [...maxByCandidate.keys()]
  const realNames = allNames.filter((name) => !isPseudoCandidateRow(name))
  const ranked = [...realNames].sort((a, b) => (maxByCandidate.get(b) ?? 0) - (maxByCandidate.get(a) ?? 0))
  const topNames = ranked.slice(0, TIMELINE_MAX_SERIES).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const otherNames = new Set(allNames.filter((name) => !topNames.includes(name)))

  const series: TimelineSeries[] = topNames.map((name, index) => ({
    name,
    color: TIMELINE_SERIES_COLORS[index % TIMELINE_SERIES_COLORS.length],
    points: days.map((day) => avgByDay.get(day)?.get(name) ?? null),
  }))

  if (otherNames.size > 0) {
    series.push({
      name: 'Outros (inclui indecisos/brancos quando a fonte informa)',
      color: TIMELINE_OTHERS_COLOR,
      points: days.map((day) => {
        const avgMap = avgByDay.get(day)
        if (!avgMap) return null
        let sum = 0
        let any = false
        for (const name of otherNames) {
          const value = avgMap.get(name)
          if (value != null) {
            sum += value
            any = true
          }
        }
        return any ? sum : null
      }),
    })
  }

  return { days, series }
}

function TimelineChart({ data, title }: { data: TimelineData; title: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const { days, series } = data

  if (days.length < 2) {
    return (
      <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
        Pouco histórico pra desenhar uma linha do tempo aqui ainda (só {days.length} dia(s) com pesquisa).
      </p>
    )
  }

  const width = 720
  const height = 320
  const padding = { top: 16, right: 16, bottom: 28, left: 34 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const maxValue = Math.max(10, ...series.flatMap((item) => item.points.filter((value): value is number => value != null)))
  const yMax = Math.min(100, Math.ceil((maxValue * 1.15) / 10) * 10)
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax]

  const xAt = (index: number) => padding.left + (days.length === 1 ? plotW / 2 : (index / (days.length - 1)) * plotW)
  const yAt = (value: number) => padding.top + plotH - (value / yMax) * plotH

  const linePath = (points: (number | null)[]) => {
    let d = ''
    let drawing = false
    points.forEach((value, index) => {
      if (value == null) {
        drawing = false
        return
      }
      const x = xAt(index)
      const y = yAt(value)
      d += drawing ? ` L ${x} ${y}` : `${d ? ' ' : ''}M ${x} ${y}`
      drawing = true
    })
    return d
  }

  const showEndLabels = series.length <= 4
  const hoverDay = hoverIndex != null ? days[hoverIndex] : null

  return (
    <div className="pesquisas-tracker__timeline">
      <svg
        className="pesquisas-tracker__timeline-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Linha do tempo: ${title}`}
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const relX = ((event.clientX - rect.left) / rect.width) * width
          const ratio = Math.min(1, Math.max(0, (relX - padding.left) / plotW))
          setHoverIndex(Math.round(ratio * (days.length - 1)))
        }}
      >
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              className="pesquisas-tracker__timeline-grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={yAt(tick)}
              y2={yAt(tick)}
            />
            <text className="pesquisas-tracker__timeline-axis" x={padding.left - 8} y={yAt(tick) + 3} textAnchor="end">
              {Math.round(tick)}%
            </text>
          </g>
        ))}

        <text className="pesquisas-tracker__timeline-axis" x={padding.left} y={height - 6}>
          {formatIsoDate(days[0], shortDateFormat)}
        </text>
        <text className="pesquisas-tracker__timeline-axis" x={width - padding.right} y={height - 6} textAnchor="end">
          {formatIsoDate(days[days.length - 1], shortDateFormat)}
        </text>

        {hoverIndex != null && (
          <line
            className="pesquisas-tracker__timeline-crosshair"
            x1={xAt(hoverIndex)}
            x2={xAt(hoverIndex)}
            y1={padding.top}
            y2={height - padding.bottom}
          />
        )}

        {series.map((item) => (
          <g key={item.name}>
            <path className="pesquisas-tracker__timeline-line" d={linePath(item.points)} style={{ stroke: item.color }} />
            {item.points.map((value, index) =>
              value == null ? null : (
                <circle
                  key={index}
                  className="pesquisas-tracker__timeline-dot"
                  cx={xAt(index)}
                  cy={yAt(value)}
                  r={index === hoverIndex ? 5 : 4}
                  style={{ fill: item.color }}
                />
              ),
            )}
            {showEndLabels &&
              (() => {
                for (let index = item.points.length - 1; index >= 0; index -= 1) {
                  const value = item.points[index]
                  if (value == null) continue
                  return (
                    <text
                      className="pesquisas-tracker__timeline-end-label"
                      x={xAt(index) + 6}
                      y={yAt(value) + 3}
                      style={{ fill: item.color }}
                    >
                      {percentFormat.format(value)}%
                    </text>
                  )
                }
                return null
              })()}
          </g>
        ))}
      </svg>

      <div className="pesquisas-tracker__timeline-legend" role="list">
        {series.map((item) => {
          const valueAtHover = hoverIndex != null ? item.points[hoverIndex] : item.points[item.points.length - 1]
          return (
            <span className="pesquisas-tracker__timeline-legend-item" role="listitem" key={item.name}>
              <i style={{ background: item.color }} aria-hidden="true" />
              {item.name}
              <strong>{valueAtHover != null ? `${percentFormat.format(valueAtHover)}%` : 'sem dado'}</strong>
            </span>
          )
        })}
      </div>

      {hoverDay && (
        <p className="pesquisas-tracker__timeline-caption">Ponto em destaque: {formatIsoDate(hoverDay, dateFormat)}</p>
      )}

      <details className="pesquisas-tracker__sources-details">
        <summary>Ver como tabela ({days.length} dia(s) com pesquisa)</summary>
        <div className="pesquisas-tracker__timeline-table-wrap">
          <table className="pesquisas-tracker__timeline-table">
            <thead>
              <tr>
                <th>Data</th>
                {series.map((item) => (
                  <th key={item.name}>{item.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, index) => (
                <tr key={day}>
                  <td>{formatIsoDate(day, dateFormat)}</td>
                  {series.map((item) => (
                    <td key={item.name}>{item.points[index] != null ? `${percentFormat.format(item.points[index]!)}%` : ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="pesquisas-tracker__caveat" role="note">
        Cada ponto é uma pesquisa real divulgada naquele dia (média simples quando mais de um instituto publicou no mesmo
        dia); os traços entre pontos só conectam visualmente, não são estimativa dos dias sem pesquisa.
      </p>
    </div>
  )
}

function PollCard({ poll }: { poll: Poll }) {
  const topPercentage = poll.results.reduce((max, item) => Math.max(max, item.percentage), 0) || 1
  return (
    <article className="pesquisas-tracker__card">
      <div className="pesquisas-tracker__card-head">
        <div className="pesquisas-tracker__card-head-main">
          <strong className="pesquisas-tracker__institute">{poll.institute}</strong>
          {poll.scenarioLabel && <span className="pesquisas-tracker__scenario-chip">{poll.scenarioLabel}</span>}
          {poll.commissioner && <span className="pesquisas-tracker__commissioner"> · contratante: {poll.commissioner}</span>}
        </div>
        {poll.round && <span className="pesquisas-tracker__round-chip">{poll.round}º turno</span>}
      </div>

      <p className="pesquisas-tracker__meta">
        {formatIsoDate(poll.publishedAt, dateFormat)}
        {poll.fieldDates && (
          <> · campo {formatIsoDate(poll.fieldDates.start, shortDateFormat)}–{formatIsoDate(poll.fieldDates.end, shortDateFormat)}</>
        )}
        {poll.sampleSize != null && <> · {sampleFormat.format(poll.sampleSize)} entrevistas</>}
        {poll.marginOfError != null && <> · margem ±{percentFormat.format(poll.marginOfError)} p.p.</>}
      </p>

      <div className="pesquisas-tracker__bars">
        {poll.results.map((result) => (
          <div className="pesquisas-tracker__bar-row" key={result.candidateName}>
            <span className="pesquisas-tracker__bar-label">
              <span className="pesquisas-tracker__bar-name">{result.candidateName}</span>
              {isLeadingResult(result.candidateName, result.percentage, topPercentage, poll.results.length) && (
                <span className="pesquisas-tracker__leader-badge">Líder</span>
              )}
              {result.party && <span className="pesquisas-tracker__party-chip">{result.party}</span>}
            </span>
            <div className="pesquisas-tracker__bar-track">
              <span
                className="pesquisas-tracker__bar-fill"
                style={{ width: `${Math.min(100, (result.percentage / topPercentage) * 100)}%` }}
              />
            </div>
            <span className="pesquisas-tracker__bar-value">{percentFormat.format(result.percentage)}%</span>
          </div>
        ))}
      </div>

      {poll.sourceUrl && (
        <a className="pesquisas-tracker__source" href={poll.sourceUrl} target="_blank" rel="noreferrer">
          Ver fonte original ↗
        </a>
      )}
    </article>
  )
}

function SenadoCard({ state }: { state: SenadoState }) {
  const reduced = isReducedBasis(state.basis)
  const sumLooksOff = state.percentageSum > 102 || state.percentageSum < 95
  const showCaveat = !reduced || sumLooksOff
  const topPercentage = state.results.reduce((max, item) => Math.max(max, item.percentage ?? 0), 0) || 1

  return (
    <article className="pesquisas-tracker__card pesquisas-tracker__card--senado">
      <div className="pesquisas-tracker__card-head">
        <div className="pesquisas-tracker__card-head-main">
          <strong className="pesquisas-tracker__institute">{state.pollster ?? 'Instituto não informado'}</strong>
          <span className="pesquisas-tracker__scenario-chip">{completenessLabelPt(state.completeness)}</span>
        </div>
      </div>

      <p className="pesquisas-tracker__meta">
        Fonte: {state.source}
        {state.fieldwork && <> · campo {state.fieldwork}</>}
        {state.sample != null && <> · amostra {typeof state.sample === 'number' ? sampleFormat.format(state.sample) : state.sample}</>}
        {state.marginOfError && <> · margem {state.marginOfError}</>}
      </p>

      <div className="pesquisas-tracker__bars">
        {state.results.map((result) => (
          <div className="pesquisas-tracker__bar-row" key={result.candidateName}>
            <span className="pesquisas-tracker__bar-label">
              <span className="pesquisas-tracker__bar-name">{result.candidateName}</span>
              {isLeadingResult(result.candidateName, result.percentage, topPercentage, state.results.length) && (
                <span className="pesquisas-tracker__leader-badge">Líder</span>
              )}
              {result.party && <span className="pesquisas-tracker__party-chip">{result.party}</span>}
            </span>
            <div className="pesquisas-tracker__bar-track">
              {result.percentage != null ? (
                <span
                  className="pesquisas-tracker__bar-fill"
                  style={{ width: `${Math.min(100, (result.percentage / topPercentage) * 100)}%` }}
                />
              ) : null}
            </div>
            <span className="pesquisas-tracker__bar-value">
              {result.percentage != null ? `${percentFormat.format(result.percentage)}%` : 'dado indisponível'}
            </span>
          </div>
        ))}
      </div>

      {showCaveat && (
        <p className="pesquisas-tracker__caveat" role="note">
          Os números somam {percentFormat.format(state.percentageSum)}% porque a fonte não consolidou os dois votos de
          Senador numa base única (base informada: "{state.basis}"). Isso não é erro de soma nosso, é como a pesquisa
          foi divulgada.
        </p>
      )}

      {state.sourceUrl && (
        <a className="pesquisas-tracker__source" href={state.sourceUrl} target="_blank" rel="noreferrer">
          Ver fonte original ↗
        </a>
      )}
    </article>
  )
}

function PresidenteEstadoCard({ state, roundFilter }: { state: PresidenteEstadoState; roundFilter: RoundFilter }) {
  if (roundFilter === 2) {
    return (
      <article className="pesquisas-tracker__card pesquisas-tracker__card--presidente-uf">
        <p className="pesquisas-tracker__meta">
          Esta compilação por estado só tem dado de 1º turno. Nenhuma das fontes usadas testou um cenário de 2º turno
          para {state.state}.
        </p>
      </article>
    )
  }

  return (
    <>
      {state.waves.map((wave, index) => {
        const topPercentage = wave.results.reduce((max, item) => Math.max(max, item.percentage), 0) || 1
        const sumLooksOff = wave.completeness === 'Full candidate list' && (wave.percentageSum > 102 || wave.percentageSum < 95)
        return (
          <article className="pesquisas-tracker__card pesquisas-tracker__card--presidente-uf" key={`${state.uf}-${index}`}>
            <div className="pesquisas-tracker__card-head">
              <div className="pesquisas-tracker__card-head-main">
                <strong className="pesquisas-tracker__institute">{wave.pollster ?? 'Instituto não informado'}</strong>
                <span className="pesquisas-tracker__scenario-chip">{wave.vintage}</span>
              </div>
              <span className="pesquisas-tracker__round-chip">1º turno</span>
            </div>

            <p className="pesquisas-tracker__meta">
              {completenessLabelPt(wave.completeness)}
              {wave.fieldwork && <> · campo {wave.fieldwork}</>}
              {wave.sample != null && <> · amostra {typeof wave.sample === 'number' ? sampleFormat.format(wave.sample) : wave.sample}</>}
            </p>

            <div className="pesquisas-tracker__bars">
              {wave.results.map((result) => (
                <div className="pesquisas-tracker__bar-row" key={result.candidateName}>
                  <span className="pesquisas-tracker__bar-label">
                    <span className="pesquisas-tracker__bar-name">{result.candidateName}</span>
                    {isLeadingResult(result.candidateName, result.percentage, topPercentage, wave.results.length) && (
                      <span className="pesquisas-tracker__leader-badge">Líder</span>
                    )}
                    {result.party && <span className="pesquisas-tracker__party-chip">{result.party}</span>}
                  </span>
                  <div className="pesquisas-tracker__bar-track">
                    <span
                      className="pesquisas-tracker__bar-fill"
                      style={{ width: `${Math.min(100, (result.percentage / topPercentage) * 100)}%` }}
                    />
                  </div>
                  <span className="pesquisas-tracker__bar-value">{percentFormat.format(result.percentage)}%</span>
                </div>
              ))}
              {wave.undecided != null && (
                <div className="pesquisas-tracker__bar-row pesquisas-tracker__bar-row--muted">
                  <span className="pesquisas-tracker__bar-label">Indecisos</span>
                  <div className="pesquisas-tracker__bar-track" />
                  <span className="pesquisas-tracker__bar-value">{percentFormat.format(wave.undecided)}%</span>
                </div>
              )}
              {wave.blank != null && (
                <div className="pesquisas-tracker__bar-row pesquisas-tracker__bar-row--muted">
                  <span className="pesquisas-tracker__bar-label">Brancos/nulos</span>
                  <div className="pesquisas-tracker__bar-track" />
                  <span className="pesquisas-tracker__bar-value">{percentFormat.format(wave.blank)}%</span>
                </div>
              )}
            </div>

            {sumLooksOff && (
              <p className="pesquisas-tracker__caveat" role="note">
                Os números somam {percentFormat.format(wave.percentageSum)}% conforme divulgado pela fonte original,
                sem ajuste nosso.
              </p>
            )}

            {firstUrl(wave.sourceUrl) && (
              <a className="pesquisas-tracker__source" href={firstUrl(wave.sourceUrl)!} target="_blank" rel="noreferrer">
                Ver fonte original ↗
              </a>
            )}
          </article>
        )
      })}
    </>
  )
}

export function PesquisasTracker({ candidates: _candidates, snapshot: _snapshot, round: _round, state }: PesquisasTrackerProps) {
  const [presidenteNacionalFile, setPresidenteNacionalFile] = useState<PollsFile | null>(null)
  const [presidenteNacionalStatus, setPresidenteNacionalStatus] = useState<FetchStatus>('loading')
  const [governadorFile, setGovernadorFile] = useState<PollsFile | null>(null)
  const [governadorStatus, setGovernadorStatus] = useState<FetchStatus>('loading')
  const [senadoFile, setSenadoFile] = useState<SenadoFile | null>(null)
  const [senadoStatus, setSenadoStatus] = useState<FetchStatus>('loading')
  const [presidenteEstadosFile, setPresidenteEstadosFile] = useState<PresidenteEstadosFile | null>(null)
  const [presidenteEstadosStatus, setPresidenteEstadosStatus] = useState<FetchStatus>('loading')

  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('Todos')
  const [roundFilter, setRoundFilter] = useState<RoundFilter>('Todos')
  const [ufFilter, setUfFilter] = useState<string>('all')
  const [senadoUf, setSenadoUf] = useState<string | null>(null)
  const [presidenteView, setPresidenteView] = useState<PresidenteView>('Nacional')
  const [governadorView, setGovernadorView] = useState<GovernadorView>('Atual')
  const [presidenteEstadoUf, setPresidenteEstadoUf] = useState<string | null>(null)

  useEffect(() => {
    fetch('/data/polls-presidente-nacional.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('presidente nacional unavailable'))))
      .then((data: PollsFile) => {
        setPresidenteNacionalFile(data)
        setPresidenteNacionalStatus('loaded')
      })
      .catch(() => setPresidenteNacionalStatus('error'))

    fetch('/data/polls-governador-estados.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('governador unavailable'))))
      .then((data: PollsFile) => {
        setGovernadorFile(data)
        setGovernadorStatus('loaded')
      })
      .catch(() => setGovernadorStatus('error'))

    fetch('/data/polls-senado.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('senado polls unavailable'))))
      .then((data: SenadoFile) => {
        setSenadoFile(data)
        setSenadoStatus('loaded')
      })
      .catch(() => setSenadoStatus('error'))

    fetch('/data/polls-presidente-estados.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('presidente por estado unavailable'))))
      .then((data: PresidenteEstadosFile) => {
        setPresidenteEstadosFile(data)
        setPresidenteEstadosStatus('loaded')
      })
      .catch(() => setPresidenteEstadosStatus('error'))
  }, [])

  const polls = useMemo(
    () => [...(presidenteNacionalFile?.polls ?? []), ...(governadorFile?.polls ?? [])],
    [presidenteNacionalFile, governadorFile],
  )
  const pollsStatus: FetchStatus =
    presidenteNacionalStatus === 'loading' || governadorStatus === 'loading'
      ? 'loading'
      : presidenteNacionalStatus === 'loaded' || governadorStatus === 'loaded'
        ? 'loaded'
        : 'error'
  const senadoStates = useMemo(
    () => [...(senadoFile?.states ?? [])].sort((a, b) => a.state.localeCompare(b.state, 'pt-BR')),
    [senadoFile],
  )
  const presidenteEstados = useMemo(
    () => [...(presidenteEstadosFile?.states ?? [])].sort((a, b) => a.state.localeCompare(b.state, 'pt-BR')),
    [presidenteEstadosFile],
  )

  const governorUFs = useMemo(
    () => Array.from(new Set(polls.filter((poll) => poll.office === 'Governador').map((poll) => poll.uf))).sort((a, b) => (BRAZIL_STATE_BY_UF[a]?.name ?? a).localeCompare(BRAZIL_STATE_BY_UF[b]?.name ?? b, 'pt-BR')),
    [polls],
  )

  // Atalho usando a UF já selecionada no resto do painel (prop `state`), só
  // quando ela de fato tem pesquisa de governador nos últimos 30 dias.
  const quickJumpUf = state !== 'Brasil' && governorUFs.includes(state) ? state : null

  useEffect(() => {
    if (!senadoUf && senadoStates.length > 0) {
      const fallback = state !== 'Brasil' && senadoStates.some((item) => item.uf === state) ? state : senadoStates[0].uf
      setSenadoUf(fallback)
    }
  }, [senadoStates, senadoUf, state])

  useEffect(() => {
    if (!presidenteEstadoUf && presidenteEstados.length > 0) {
      const fallback =
        state !== 'Brasil' && presidenteEstados.some((item) => item.uf === state) ? state : presidenteEstados[0].uf
      setPresidenteEstadoUf(fallback)
    }
  }, [presidenteEstados, presidenteEstadoUf, state])

  // `polls` guarda ~400 dias de histórico (pra linha do tempo). Os cards de
  // "quadro atual" continuam olhando só os últimos RECENT_WINDOW_DAYS, como
  // antes da linha do tempo existir.
  const recentCutoff = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS)
    return cutoff.toISOString()
  }, [])

  const filteredPolls = useMemo(
    () =>
      polls.filter((poll) => {
        if (poll.publishedAt < recentCutoff) return false
        if (officeFilter !== 'Todos' && poll.office !== officeFilter) return false
        if (officeFilter === 'Governador' && ufFilter !== 'all' && poll.uf !== ufFilter) return false
        if (roundFilter !== 'Todos' && poll.round !== roundFilter) return false
        return true
      }),
    [polls, officeFilter, ufFilter, roundFilter, recentCutoff],
  )

  const groups = useMemo(() => {
    const byKey = new Map<string, Poll[]>()
    for (const poll of filteredPolls) {
      const key = raceKey(poll)
      const bucket = byKey.get(key)
      if (bucket) bucket.push(poll)
      else byKey.set(key, [poll])
    }
    const entries = Array.from(byKey.entries()).map(([key, items]) => ({
      key,
      office: items[0].office,
      uf: items[0].uf,
      items: [...items].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0)),
    }))
    entries.sort((a, b) => {
      if (a.office !== b.office) return a.office === 'Presidente' ? -1 : 1
      return raceLabel(a.office, a.uf).localeCompare(raceLabel(b.office, b.uf), 'pt-BR')
    })
    return entries
  }, [filteredPolls])

  const presidenteGroups = groups.filter((group) => group.office === 'Presidente')
  const governadorGroups = groups.filter((group) => group.office === 'Governador')

  // Linhas do tempo usam o histórico completo (`polls`, ~400 dias), não o
  // recorte de 30 dias dos cards de "quadro atual" acima.
  const presidenteTimelineR1 = useMemo(
    () => buildTimelineSeries(polls.filter((poll) => poll.office === 'Presidente' && poll.round === 1)),
    [polls],
  )
  const presidenteTimelineR2 = useMemo(
    () => buildTimelineSeries(polls.filter((poll) => poll.office === 'Presidente' && poll.round === 2)),
    [polls],
  )
  const governadorTimelineR1 = useMemo(
    () =>
      ufFilter === 'all'
        ? null
        : buildTimelineSeries(polls.filter((poll) => poll.office === 'Governador' && poll.uf === ufFilter && poll.round === 1)),
    [polls, ufFilter],
  )
  const governadorTimelineR2 = useMemo(
    () =>
      ufFilter === 'all'
        ? null
        : buildTimelineSeries(polls.filter((poll) => poll.office === 'Governador' && poll.uf === ufFilter && poll.round === 2)),
    [polls, ufFilter],
  )

  const hasAnySourceData = polls.length > 0
  const showPresidenteSection = officeFilter === 'Todos' || officeFilter === 'Presidente'
  const showGovernadorSection = officeFilter === 'Todos' || officeFilter === 'Governador'

  const selectedSenadoState = senadoStates.find((item) => item.uf === senadoUf) ?? null
  const selectedPresidenteEstado = presidenteEstados.find((item) => item.uf === presidenteEstadoUf) ?? null

  return (
    <section className="pesquisas-tracker">
      <div className="pesquisas-tracker__banner" role="note">
        <span className="pesquisas-tracker__banner-icon" aria-hidden="true">!</span>
        <p>
          <strong>Pesquisa de intenção de voto é opinião, não voto contado.</strong> Os números abaixo vêm de institutos de pesquisa, não do TSE, e têm margem de
          erro. O resultado oficial da eleição fica somente nas abas de apuração.
        </p>
      </div>

      <header className="pesquisas-tracker__header">
        <p className="eyebrow">pesquisas eleitorais · últimos 30 dias</p>
        <h2>Pesquisas de intenção de voto</h2>
      </header>

      <div className="pesquisas-tracker__filters" role="group" aria-label="Filtrar pesquisas por cargo">
        {(['Todos', 'Presidente', 'Governador'] as OfficeFilter[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`pesquisas-tracker__pill${officeFilter === option ? ' is-active' : ''}`}
            aria-pressed={officeFilter === option}
            onClick={() => setOfficeFilter(option)}
          >
            {option === 'Todos' ? 'Todos os cargos' : option}
          </button>
        ))}
      </div>

      <div className="pesquisas-tracker__filters" role="group" aria-label="Filtrar pesquisas por turno">
        {(['Todos', 1, 2] as RoundFilter[]).map((option) => (
          <button
            key={String(option)}
            type="button"
            className={`pesquisas-tracker__pill pesquisas-tracker__pill--round${roundFilter === option ? ' is-active' : ''}`}
            aria-pressed={roundFilter === option}
            onClick={() => setRoundFilter(option)}
          >
            {option === 'Todos' ? 'Todos os turnos' : `${option}º turno`}
          </button>
        ))}
      </div>

      {pollsStatus === 'loading' && <p className="pesquisas-tracker__status">Carregando pesquisas…</p>}

      {pollsStatus !== 'loading' && !hasAnySourceData && (
        <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
          Nenhuma pesquisa disponível no momento. Fonte de dados ainda não integrada.
        </p>
      )}

      {hasAnySourceData && showPresidenteSection && (
        <section className="pesquisas-tracker__office-section" aria-label="Pesquisas para Presidente">
          <div className="pesquisas-tracker__office-head">
            <h3 className="pesquisas-tracker__office-title">Presidente</h3>

            <div className="pesquisas-tracker__filters" role="group" aria-label="Ver Presidente nacional, por estado ou linha do tempo">
              {(['Nacional', 'PorEstado', 'LinhaDoTempo'] as PresidenteView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`pesquisas-tracker__pill pesquisas-tracker__pill--uf${presidenteView === option ? ' is-active' : ''}`}
                  aria-pressed={presidenteView === option}
                  onClick={() => setPresidenteView(option)}
                >
                  {option === 'Nacional' ? 'Nacional' : option === 'PorEstado' ? 'Por estado' : 'Linha do tempo'}
                </button>
              ))}
            </div>

            <p className="pesquisas-tracker__office-note">
              {presidenteView === 'Nacional' && (
                <>
                  Pesquisas presidenciais desta fonte são nacionais: não existe corte por estado para Presidente aqui,
                  só por turno e por instituto.
                </>
              )}
              {presidenteView === 'PorEstado' &&
                (presidenteEstadosFile?.note ?? 'Carregando a nota sobre como esta compilação por estado foi feita…')}
              {presidenteView === 'LinhaDoTempo' && (
                <>
                  Evolução da pesquisa nacional para Presidente desde que a fonte começou a registrar (não só os
                  últimos 30 dias dos outros modos aqui).
                </>
              )}
            </p>
          </div>

          {presidenteView === 'Nacional' &&
            (presidenteGroups.length === 0 ? (
              <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                Nenhuma pesquisa de Presidente encontrada para esse filtro nos últimos 30 dias.
              </p>
            ) : (
              presidenteGroups.map((group) => (
                <div className="pesquisas-tracker__grid" key={group.key}>
                  {group.items.map((poll) => (
                    <PollCard poll={poll} key={poll.id} />
                  ))}
                </div>
              ))
            ))}

          {presidenteView === 'PorEstado' && (
            <>
              {presidenteEstadosStatus === 'loading' && (
                <p className="pesquisas-tracker__status">Carregando pesquisas de Presidente por estado…</p>
              )}

              {presidenteEstadosStatus === 'error' && (
                <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                  Dado indisponível: não foi possível carregar as pesquisas de Presidente por estado.
                </p>
              )}

              {presidenteEstadosStatus === 'loaded' && presidenteEstados.length > 0 && (
                <>
                  <div className="pesquisas-tracker__state-picker">
                    <UfMapPicker
                      options={presidenteEstados.map((item) => ({ uf: item.uf, name: item.state }))}
                      activeUf={presidenteEstadoUf}
                      onSelect={(uf) => setPresidenteEstadoUf(uf)}
                      mapAriaLabel="Mapa para escolher estado - pesquisas de Presidente"
                      selectAriaLabel="Escolher estado para Presidente"
                    />

                    <div className="pesquisas-tracker__state-result">
                      {selectedPresidenteEstado ? (
                        <>
                          <h4 className="pesquisas-tracker__race-title">Presidente · {selectedPresidenteEstado.state}</h4>
                          <div className="pesquisas-tracker__grid">
                            <PresidenteEstadoCard state={selectedPresidenteEstado} roundFilter={roundFilter} />
                          </div>
                        </>
                      ) : (
                        <p className="pesquisas-tracker__status">Selecione um estado no mapa para ver as pesquisas.</p>
                      )}
                    </div>
                  </div>

                  {presidenteEstadosFile && presidenteEstadosFile.sources.length > 0 && (
                    <details className="pesquisas-tracker__sources-details">
                      <summary>
                        Fontes usadas na compilação de Presidente por estado ({presidenteEstadosFile.sources.length})
                      </summary>
                      <ul className="pesquisas-tracker__sources-list">
                        {presidenteEstadosFile.sources.map((src) => (
                          <li key={src.url}>
                            <a href={src.url} target="_blank" rel="noreferrer">
                              {src.publisher}
                            </a>
                            {' · '}
                            {src.usedFor}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </>
          )}

          {presidenteView === 'LinhaDoTempo' && (
            <>
              <h4 className="pesquisas-tracker__race-title">Presidente · 1º turno (nacional)</h4>
              <TimelineChart data={presidenteTimelineR1} title="Presidente, 1º turno, nacional" />

              <h4 className="pesquisas-tracker__race-title">Presidente · 2º turno (nacional)</h4>
              {presidenteTimelineR2.days.length > 0 ? (
                <>
                  <p className="pesquisas-tracker__office-note">
                    O confronto testado no 2º turno pode mudar de pesquisa pra pesquisa (nem toda pesquisa simula o
                    mesmo par de candidatos), então o mesmo nome aqui pode estar respondendo por adversários
                    diferentes em dias diferentes.
                  </p>
                  <TimelineChart data={presidenteTimelineR2} title="Presidente, 2º turno, nacional" />
                </>
              ) : (
                <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                  Nenhuma pesquisa de 2º turno para Presidente nesta fonte ainda.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {hasAnySourceData && showGovernadorSection && (
        <section className="pesquisas-tracker__office-section" aria-label="Pesquisas para Governador">
          <div className="pesquisas-tracker__office-head">
            <h3 className="pesquisas-tracker__office-title">Governador por estado</h3>
            <p className="pesquisas-tracker__office-note">
              Hoje só os estados abaixo têm pesquisa de governador nesta fonte. Escolha um estado para filtrar os
              cards.
            </p>
          </div>

          <div className="pesquisas-tracker__state-picker">
            <div className="pesquisas-tracker__map-col">
              <UfMapPicker
                options={governorUFs.map((uf) => ({ uf, name: BRAZIL_STATE_BY_UF[uf]?.name ?? uf }))}
                activeUf={ufFilter === 'all' ? null : ufFilter}
                onSelect={(uf) => setUfFilter(uf)}
                mapAriaLabel="Mapa para escolher estado - pesquisas de Governador"
                selectAriaLabel="Escolher estado para Governador"
              />
              <div className="pesquisas-tracker__map-actions">
                <button
                  type="button"
                  className={`pesquisas-tracker__link-btn${ufFilter === 'all' ? ' is-active' : ''}`}
                  aria-pressed={ufFilter === 'all'}
                  onClick={() => setUfFilter('all')}
                >
                  Ver todos os estados
                </button>
                {quickJumpUf && quickJumpUf !== ufFilter && (
                  <button type="button" className="pesquisas-tracker__jump" onClick={() => setUfFilter(quickJumpUf)}>
                    Ver {BRAZIL_STATE_BY_UF[quickJumpUf]?.name ?? quickJumpUf}
                  </button>
                )}
              </div>
            </div>

            <div className="pesquisas-tracker__state-result">
              {ufFilter !== 'all' && (
                <div className="pesquisas-tracker__filters" role="group" aria-label="Ver pesquisas atuais ou linha do tempo de Governador">
                  {(['Atual', 'LinhaDoTempo'] as GovernadorView[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`pesquisas-tracker__pill pesquisas-tracker__pill--uf${governadorView === option ? ' is-active' : ''}`}
                      aria-pressed={governadorView === option}
                      onClick={() => setGovernadorView(option)}
                    >
                      {option === 'Atual' ? 'Pesquisas atuais' : 'Linha do tempo'}
                    </button>
                  ))}
                </div>
              )}

              {(ufFilter === 'all' || governadorView === 'Atual') &&
                (governadorGroups.length === 0 ? (
                  <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                    Nenhuma pesquisa de Governador encontrada para esse filtro nos últimos 30 dias.
                  </p>
                ) : (
                  governadorGroups.map((group) => (
                    <div key={group.key}>
                      <h4 className="pesquisas-tracker__race-title">{raceLabel(group.office, group.uf)}</h4>
                      <div className="pesquisas-tracker__grid">
                        {group.items.map((poll) => (
                          <PollCard poll={poll} key={poll.id} />
                        ))}
                      </div>
                    </div>
                  ))
                ))}

              {ufFilter !== 'all' && governadorView === 'LinhaDoTempo' && (
                <>
                  <h4 className="pesquisas-tracker__race-title">
                    Governador · {BRAZIL_STATE_BY_UF[ufFilter]?.name ?? ufFilter} · 1º turno
                  </h4>
                  {governadorTimelineR1 && governadorTimelineR1.days.length > 0 ? (
                    <TimelineChart data={governadorTimelineR1} title={`Governador 1º turno, ${ufFilter}`} />
                  ) : (
                    <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                      Sem histórico de 1º turno pra este estado ainda.
                    </p>
                  )}

                  <h4 className="pesquisas-tracker__race-title">
                    Governador · {BRAZIL_STATE_BY_UF[ufFilter]?.name ?? ufFilter} · 2º turno
                  </h4>
                  {governadorTimelineR2 && governadorTimelineR2.days.length > 0 ? (
                    <>
                      <p className="pesquisas-tracker__office-note">
                        O confronto testado no 2º turno pode mudar de pesquisa pra pesquisa, então o mesmo nome aqui
                        pode estar respondendo por adversários diferentes em dias diferentes.
                      </p>
                      <TimelineChart data={governadorTimelineR2} title={`Governador 2º turno, ${ufFilter}`} />
                    </>
                  ) : (
                    <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
                      Nenhuma pesquisa de 2º turno pra este estado nesta fonte ainda.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="pesquisas-tracker__office-section" aria-label="Pesquisas para Senador">
        <div className="pesquisas-tracker__office-head">
          <h3 className="pesquisas-tracker__office-title">Senador por estado</h3>
          <p className="pesquisas-tracker__office-note">
            Não existe 2º turno para Senado no Brasil, a eleição é em turno único e cada estado elege 2 senadores.
            Este dado é uma compilação manual feita a partir de matérias jornalísticas reais (veja a lista de fontes
            abaixo), não um feed atualizado automaticamente como as pesquisas de Presidente e Governador acima.
          </p>
        </div>

        {senadoStatus === 'loading' && <p className="pesquisas-tracker__status">Carregando pesquisas de Senado…</p>}

        {senadoStatus === 'error' && (
          <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
            Dado indisponível: não foi possível carregar as pesquisas de Senado.
          </p>
        )}

        {senadoStatus === 'loaded' && senadoStates.length > 0 && (
          <>
            <div className="pesquisas-tracker__state-picker">
              <UfMapPicker
                options={senadoStates.map((item) => ({ uf: item.uf, name: item.state }))}
                activeUf={senadoUf}
                onSelect={(uf) => setSenadoUf(uf)}
                mapAriaLabel="Mapa para escolher estado - pesquisas de Senador"
                selectAriaLabel="Escolher estado para Senador"
              />

              <div className="pesquisas-tracker__state-result">
                {selectedSenadoState ? (
                  <>
                    <h4 className="pesquisas-tracker__race-title">Senador · {selectedSenadoState.state}</h4>
                    <div className="pesquisas-tracker__grid">
                      <SenadoCard state={selectedSenadoState} />
                    </div>
                  </>
                ) : (
                  <p className="pesquisas-tracker__status">Selecione um estado no mapa para ver as pesquisas.</p>
                )}
              </div>
            </div>

            {senadoFile && senadoFile.sources.length > 0 && (
              <details className="pesquisas-tracker__sources-details">
                <summary>Fontes usadas na compilação de Senado ({senadoFile.sources.length})</summary>
                <ul className="pesquisas-tracker__sources-list">
                  {senadoFile.sources.map((src) => (
                    <li key={src.url}>
                      <a href={src.url} target="_blank" rel="noreferrer">
                        {src.publisher}
                      </a>
                      {' · '}
                      {src.usedFor}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>
    </section>
  )
}

export default PesquisasTracker
