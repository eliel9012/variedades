import { Fragment, useEffect, useMemo, useState } from 'react'
import { navigate, parseUfSegment, ufSegment, useRoute } from '../../router'
import { UfMapPicker } from './pesquisas-tracker'
import './historico-eleitoral.css'

type HistoricoPoint = { year: 2018 | 2022 | 2026; candidateName: string; party: string | null; percentage: number | null; isPoll: boolean }
type HistoricoState = {
  uf: string
  state: string
  pt: HistoricoPoint[]
  bolsonaro: HistoricoPoint[]
  outros: HistoricoPoint[]
  undecided2026: number | null
  blank2026: number | null
}
type HistoricoFile = {
  generatedAt: string
  note: string
  primaryReference: string | null
  sources: { publisher: string; usedFor: string; url: string }[]
  states: HistoricoState[]
}

type FetchStatus = 'loading' | 'loaded' | 'error'

const percentFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })

// Mesmas cores fixas da linha do tempo de Pesquisas (ver
// TIMELINE_FIXED_COLORS em pesquisas-tracker.tsx), pra Lula/PT e
// Bolsonaro/Flávio ficarem reconhecíveis em qualquer gráfico do site.
const PT_COLOR = '#ba1a1a'
const BOLSONARO_COLOR = '#6f7d1c'
const OUTROS_COLOR = '#75786f'

function parseHistoricoPath(pathname: string): string | null {
  const [, segment] = pathname.split('/').filter(Boolean)
  return parseUfSegment(segment)
}

function historicoPath(uf: string | null): string {
  return uf ? `/historico/${ufSegment(uf)}` : '/historico'
}

/** Gráfico de evolução por estado: 2018 e 2022 são resultado oficial (TSE),
 * 2026 é pesquisa (não é resultado), por isso o traço de 2022 pra 2026 vem
 * tracejado e o ponto de 2026 ganha um selo "pesquisa", nunca se mistura
 * visualmente com os dois pontos reais sem dizer qual é qual. */
function EvolutionChart({ state }: { state: HistoricoState }) {
  const width = 640
  const height = 300
  const padding = { top: 20, right: 24, bottom: 36, left: 34 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const series = [
    { key: 'pt', label: 'Lula / Haddad (PT)', color: PT_COLOR, points: state.pt },
    { key: 'bolsonaro', label: 'Bolsonaro / Flávio Bolsonaro (PL)', color: BOLSONARO_COLOR, points: state.bolsonaro },
    { key: 'outros', label: 'Outros', color: OUTROS_COLOR, points: state.outros },
  ]

  const maxValue = Math.max(10, ...series.flatMap((item) => item.points.map((point) => point.percentage ?? 0)))
  const yMax = Math.min(100, Math.ceil((maxValue * 1.15) / 10) * 10)
  const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax]

  const xAt = (index: number) => padding.left + (index / 2) * plotW
  const yAt = (value: number) => padding.top + plotH - (value / yMax) * plotH

  // Rótulos de valor ficam 10px acima do ponto; quando duas séries estão
  // perto no mesmo ano, os textos se sobrepõem. Para cada ano, ordena os
  // rótulos de cima pra baixo e empurra o de baixo até ficar a pelo menos
  // LABEL_MIN_GAP px do anterior.
  const LABEL_MIN_GAP = 12
  const labelY = new Map<string, number>()
  for (const index of [0, 1, 2]) {
    const column = series
      .map((item) => ({ key: item.key, value: item.points[index]?.percentage }))
      .filter((entry): entry is { key: string; value: number } => entry.value != null)
      .map((entry) => ({ key: entry.key, y: yAt(entry.value) - 10 }))
      .sort((a, b) => a.y - b.y)
    for (let i = 1; i < column.length; i++) {
      if (column[i].y - column[i - 1].y < LABEL_MIN_GAP) column[i].y = column[i - 1].y + LABEL_MIN_GAP
    }
    for (const entry of column) labelY.set(`${entry.key}-${index}`, entry.y)
  }

  return (
    <div className="historico-eleitoral__chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Evolução eleitoral em ${state.state}: 2018, 2022 e pesquisa 2026`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line className="historico-eleitoral__grid" x1={padding.left} x2={width - padding.right} y1={yAt(tick)} y2={yAt(tick)} />
            <text className="historico-eleitoral__axis" x={padding.left - 8} y={yAt(tick) + 3} textAnchor="end">
              {Math.round(tick)}%
            </text>
          </g>
        ))}

        {[0, 1, 2].map((index) => (
          <text
            key={index}
            className="historico-eleitoral__axis"
            x={xAt(index)}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
          >
            {index === 2 ? '2026 (pesquisa)' : index === 1 ? '2022' : '2018'}
          </text>
        ))}

        {series.map((item) => {
          const values = item.points.map((point) => point.percentage)
          const solidPath = values[0] != null && values[1] != null ? `M ${xAt(0)} ${yAt(values[0]!)} L ${xAt(1)} ${yAt(values[1]!)}` : ''
          const dashedPath = values[1] != null && values[2] != null ? `M ${xAt(1)} ${yAt(values[1]!)} L ${xAt(2)} ${yAt(values[2]!)}` : ''
          return (
            <g key={item.key}>
              {solidPath && <path className="historico-eleitoral__line" d={solidPath} style={{ stroke: item.color }} />}
              {dashedPath && <path className="historico-eleitoral__line historico-eleitoral__line--poll" d={dashedPath} style={{ stroke: item.color }} />}
              {item.points.map((point, index) =>
                point.percentage == null ? null : (
                  <circle
                    key={point.year}
                    cx={xAt(index)}
                    cy={yAt(point.percentage)}
                    r={point.isPoll ? 5 : 4}
                    className={point.isPoll ? 'historico-eleitoral__dot historico-eleitoral__dot--poll' : 'historico-eleitoral__dot'}
                    style={{ fill: item.color }}
                  />
                ),
              )}
              {item.points.map((point, index) =>
                point.percentage == null ? null : (
                  <text
                    key={point.year}
                    className="historico-eleitoral__value"
                    x={xAt(index)}
                    y={labelY.get(`${item.key}-${index}`) ?? yAt(point.percentage) - 10}
                    textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}
                    style={{ fill: item.color }}
                  >
                    {percentFormat.format(point.percentage)}%
                  </text>
                ),
              )}
            </g>
          )
        })}
      </svg>

      <div className="historico-eleitoral__legend" role="list">
        {series.map((item) => (
          <span className="historico-eleitoral__legend-item" role="listitem" key={item.key}>
            <i style={{ background: item.color }} aria-hidden="true" />
            {item.label}
          </span>
        ))}
        <span className="historico-eleitoral__legend-item historico-eleitoral__legend-item--note" role="listitem">
          <i className="historico-eleitoral__legend-dash" aria-hidden="true" />
          traço tracejado = pesquisa de 2026, não é resultado
        </span>
      </div>
    </div>
  )
}

export default function HistoricoEleitoral({ state: globalState }: { state: string }) {
  const pathname = useRoute()
  const [file, setFile] = useState<HistoricoFile | null>(null)
  const [status, setStatus] = useState<FetchStatus>('loading')
  const [selectedUf, setSelectedUf] = useState<string | null>(() => parseHistoricoPath(pathname))

  useEffect(() => {
    let cancelled = false
    fetch('/data/polls-presidente-historico.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<HistoricoFile>
      })
      .then((data) => {
        if (cancelled) return
        setFile(data)
        setStatus('loaded')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const ufFromUrl = parseHistoricoPath(pathname)
    if (ufFromUrl !== selectedUf) setSelectedUf(ufFromUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const states = useMemo(() => file?.states ?? [], [file])

  useEffect(() => {
    if (selectedUf || states.length === 0) return
    const fallback = globalState !== 'Brasil' && states.some((item) => item.uf === globalState) ? globalState : states[0].uf
    setSelectedUf(fallback)
  }, [states, selectedUf, globalState])

  const selectedState = states.find((item) => item.uf === selectedUf) ?? null

  return (
    <section className="historico-eleitoral">
      <div className="historico-eleitoral__banner" role="note">
        <span className="historico-eleitoral__banner-icon" aria-hidden="true">!</span>
        <p>
          <strong>2018 e 2022 são resultado oficial de 1º turno (TSE).</strong> 2026 é pesquisa de intenção de voto,
          não é resultado: veja o traço tracejado no gráfico.
        </p>
      </div>

      <header className="historico-eleitoral__header">
        <p className="eyebrow">evolução por estado · 2018, 2022 e pesquisa 2026</p>
        <h2>Histórico eleitoral por estado</h2>
        <p className="historico-eleitoral__intro">
          Compara, estado por estado, o resultado real de Haddad/Bolsonaro em 2018, Lula/Bolsonaro em 2022, e a
          pesquisa Quaest/TV Globo por estado para Lula x Flávio Bolsonaro em 2026. Na maioria dos estados o
          número de 2026 vem da rodada completa de agosto/2026; São Paulo, Pernambuco,
          Pará e Ceará já usam a rodada de setembro, e o Piauí vem da AtlasIntel (a Quaest não pesquisou lá). Veja
          as fontes no fim da página.
        </p>
      </header>

      {status === 'loading' && <p className="historico-eleitoral__status">Carregando histórico…</p>}
      {status === 'error' && (
        <p className="historico-eleitoral__status historico-eleitoral__status--empty">
          Dado indisponível: não foi possível carregar o histórico eleitoral.
        </p>
      )}

      {status === 'loaded' && selectedState && (
        <>
          <div className="historico-eleitoral__state-picker">
            <UfMapPicker
              options={states.map((item) => ({ uf: item.uf, name: item.state }))}
              activeUf={selectedUf}
              onSelect={(uf) => {
                setSelectedUf(uf)
                navigate(historicoPath(uf))
              }}
              mapAriaLabel="Mapa para escolher estado - histórico eleitoral"
              selectAriaLabel="Escolher estado para o histórico eleitoral"
            />

            <div className="historico-eleitoral__state-result">
              <h3 className="historico-eleitoral__state-title">{selectedState.state}</h3>
              <EvolutionChart state={selectedState} />

              {(selectedState.undecided2026 != null || selectedState.blank2026 != null) && (
                <p className="historico-eleitoral__caveat" role="note">
                  Na pesquisa de 2026: {selectedState.undecided2026 != null && `${percentFormat.format(selectedState.undecided2026)}% indecisos`}
                  {selectedState.undecided2026 != null && selectedState.blank2026 != null && ' · '}
                  {selectedState.blank2026 != null && `${percentFormat.format(selectedState.blank2026)}% brancos/nulos/não votaria`}.
                  Isso explica porque os três traços de 2026 não somam 100% sozinhos.
                </p>
              )}
            </div>
          </div>

          {file && (
            <details className="historico-eleitoral__sources-details">
              <summary>Fontes usadas na compilação ({file.sources.length})</summary>
              {file.primaryReference && <p className="historico-eleitoral__primary-reference">{file.primaryReference}</p>}
              <ul className="historico-eleitoral__sources-list">
                {file.sources.map((src) => (
                  <li key={src.url}>
                    {/* o campo url pode trazer várias URLs separadas por ";": um link por URL */}
                    {src.url
                      .split(';')
                      .map((url) => url.trim())
                      .filter(Boolean)
                      .map((url, urlIndex) => (
                        <Fragment key={url}>
                          {urlIndex > 0 && ' · '}
                          <a href={url} target="_blank" rel="noreferrer">
                            {src.publisher}
                            {urlIndex > 0 ? ` (${urlIndex + 1})` : ''}
                          </a>
                        </Fragment>
                      ))}
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
  )
}
