import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { BRAZIL_STATES, BRAZIL_STATE_BY_UF } from '../../data/brazil-states'
import { BrazilMap } from './brazil-map'
import './cenarios-ia.css'

export type CenariosIAProps = {
  /** UF atualmente selecionada no resto do painel (prop `state` compartilhada
   * com as outras abas). Usada só como sugestão inicial, igual ao que
   * pesquisas-tracker.tsx faz com os próprios seletores de UF. */
  state: string
}

type Office = 'Presidente' | 'Governador'
type PresidenteView = 'Nacional' | 'PorEstado'

type MarginSource = 'reported' | 'estimated_from_sample_size'

type ScenarioCandidate = {
  candidateName: string
  party: string | null
  percentage: number
  marginSource?: MarginSource
  leadProbability?: number
}

type SourcePoll = {
  pollster: string | null
  commissioner?: string | null
  state?: string
  fieldwork: string | null
  publishedAt?: string | null
  vintage?: string
  scenarioLabel?: string | null
  completeness?: string
  sampleSize: number | null
  marginOfErrorPp: number | null
  marginSource?: MarginSource
  sourceUrl: string | null
}

type ScenarioResponse = {
  office: Office
  uf: string | null
  round: 1 | 2
  simulatable: boolean
  reason: string | null
  simulations?: number
  candidates: ScenarioCandidate[]
  leadProbability: Record<string, number> | null
  outrightWinProbability: number | null
  runoffProbability: number | null
  completenessWarning: string | null
  methodologyNote: string
  sourcePoll: SourcePoll
}

type ScenarioErrorResponse = { error: string; detail?: string }

type AskResponse = { answer: string; scenario: ScenarioResponse; groundedOn: string }
type AskErrorResponse = { error: string; detail?: string }

type FetchStatus = 'idle' | 'loading' | 'loaded' | 'error'

type ChatEntry = {
  id: string
  question: string
  status: 'pending' | 'answered' | 'error'
  answer?: string
  errorDetail?: string
}

const percentFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const probabilityFormat = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 })

function sourcePollLine(poll: SourcePoll): string {
  const parts: string[] = []
  if (poll.pollster) parts.push(poll.pollster)
  if (poll.publishedAt) parts.push(`divulgada em ${poll.publishedAt}`)
  if (poll.vintage) parts.push(poll.vintage)
  if (poll.fieldwork) parts.push(`campo: ${poll.fieldwork}`)
  if (poll.sampleSize != null) parts.push(`${poll.sampleSize} entrevistas`)
  if (poll.marginOfErrorPp != null) {
    const estimated = poll.marginSource === 'estimated_from_sample_size'
    parts.push(`margem ${estimated ? 'estimada' : 'declarada'} ±${percentFormat.format(poll.marginOfErrorPp)} p.p.`)
  }
  return parts.join(' · ')
}

/** Mini seletor de UF (mapa + <select> para telas estreitas), inspirado no
 * UfMapPicker de pesquisas-tracker.tsx. Duplicado em vez de importado: esse
 * componente não é exportado por aquele arquivo, que acabou de ser
 * redesenhado e não deve ser tocado por esta feature. */
function UfPicker({ activeUf, onSelect }: { activeUf: string | null; onSelect: (uf: string) => void }) {
  return (
    <div className="cenarios-ia__map-wrap">
      <select
        className="cenarios-ia__uf-select"
        aria-label="Escolher estado para o cenário"
        value={activeUf ?? ''}
        onChange={(event) => {
          if (event.target.value) onSelect(event.target.value)
        }}
      >
        <option value="" disabled>
          Selecione um estado
        </option>
        {BRAZIL_STATES.map((item) => (
          <option key={item.uf} value={item.uf}>
            {item.name} ({item.uf})
          </option>
        ))}
      </select>
      <BrazilMap
        activeUf={activeUf ?? undefined}
        onSelect={(selected) => onSelect(selected.uf)}
        hideDetailsPanel
        className="cenarios-ia__map"
        ariaLabel="Mapa para escolher estado - Cenários (IA)"
      />
    </div>
  )
}

function ScenarioPanel({ data }: { data: ScenarioResponse }) {
  if (!data.simulatable) {
    return (
      <div className="cenarios-ia__panel">
        <p className="cenarios-ia__not-simulatable" role="note">
          {data.reason}
        </p>
        <div className="cenarios-ia__raw-bars">
          {data.candidates.map((candidate) => (
            <div className="cenarios-ia__bar-row" key={candidate.candidateName}>
              <span className="cenarios-ia__bar-label">
                <span className="cenarios-ia__bar-name">{candidate.candidateName}</span>
                {candidate.party && <span className="cenarios-ia__party-chip">{candidate.party}</span>}
              </span>
              <div className="cenarios-ia__bar-track">
                <span className="cenarios-ia__bar-fill cenarios-ia__bar-fill--raw" style={{ width: `${Math.min(100, candidate.percentage)}%` }} />
              </div>
              <span className="cenarios-ia__bar-value">{percentFormat.format(candidate.percentage)}%</span>
            </div>
          ))}
        </div>
        <p className="cenarios-ia__methodology">{data.methodologyNote}</p>
        <p className="cenarios-ia__source-line">{sourcePollLine(data.sourcePoll)}</p>
        {data.sourcePoll.sourceUrl && (
          <a className="cenarios-ia__source-link" href={data.sourcePoll.sourceUrl} target="_blank" rel="noreferrer">
            Ver fonte original ↗
          </a>
        )}
      </div>
    )
  }

  const sorted = [...data.candidates].sort((a, b) => (b.leadProbability ?? 0) - (a.leadProbability ?? 0))

  return (
    <div className="cenarios-ia__panel">
      <div className="cenarios-ia__bars">
        {sorted.map((candidate, index) => (
          <div className="cenarios-ia__bar-row" key={candidate.candidateName}>
            <span className="cenarios-ia__bar-label">
              <span className="cenarios-ia__bar-name">{candidate.candidateName}</span>
              {index === 0 && (candidate.leadProbability ?? 0) > 0 && <span className="cenarios-ia__leader-badge">Mais provável</span>}
              {candidate.party && <span className="cenarios-ia__party-chip">{candidate.party}</span>}
            </span>
            <div className="cenarios-ia__bar-track">
              <span
                className="cenarios-ia__bar-fill"
                style={{ width: `${Math.min(100, (candidate.leadProbability ?? 0) * 100)}%` }}
              />
            </div>
            <span className="cenarios-ia__bar-value">
              {probabilityFormat.format(candidate.leadProbability ?? 0)} de liderar
              <span className="cenarios-ia__bar-subvalue"> · {percentFormat.format(candidate.percentage)}% na pesquisa</span>
            </span>
          </div>
        ))}
      </div>

      {data.outrightWinProbability != null && data.runoffProbability != null && (
        <div className="cenarios-ia__stat-row" role="group" aria-label="Probabilidade de vitória em 1º turno vs 2º turno">
          <div className="cenarios-ia__stat-card">
            <span className="cenarios-ia__stat-label">Vitória direta no 1º turno (&gt;50%)</span>
            <span className="cenarios-ia__stat-value">{probabilityFormat.format(data.outrightWinProbability)}</span>
          </div>
          <div className="cenarios-ia__stat-card">
            <span className="cenarios-ia__stat-label">Vai para o 2º turno</span>
            <span className="cenarios-ia__stat-value">{probabilityFormat.format(data.runoffProbability)}</span>
          </div>
        </div>
      )}

      {data.completenessWarning && (
        <p className="cenarios-ia__caveat" role="note">
          {data.completenessWarning}
        </p>
      )}

      <p className="cenarios-ia__methodology">{data.methodologyNote}</p>
      <p className="cenarios-ia__source-line">{sourcePollLine(data.sourcePoll)}</p>
      {data.sourcePoll.sourceUrl && (
        <a className="cenarios-ia__source-link" href={data.sourcePoll.sourceUrl} target="_blank" rel="noreferrer">
          Ver fonte original ↗
        </a>
      )}
    </div>
  )
}

export function CenariosIA({ state }: CenariosIAProps) {
  const [office, setOffice] = useState<Office>('Presidente')
  const [presidenteView, setPresidenteView] = useState<PresidenteView>('Nacional')
  const [selectedUf, setSelectedUf] = useState<string | null>(state !== 'Brasil' ? state : null)

  const [scenario, setScenario] = useState<ScenarioResponse | null>(null)
  const [scenarioStatus, setScenarioStatus] = useState<FetchStatus>('idle')
  const [scenarioError, setScenarioError] = useState<string | null>(null)

  const [question, setQuestion] = useState('')
  const [chatLog, setChatLog] = useState<ChatEntry[]>([])
  const [isAsking, setIsAsking] = useState(false)
  const chatRequestId = useRef(0)

  const needsUf = office === 'Governador' || (office === 'Presidente' && presidenteView === 'PorEstado')
  const effectiveUf = office === 'Presidente' && presidenteView === 'Nacional' ? null : selectedUf

  const queryParams = useMemo(() => {
    if (office === 'Presidente' && presidenteView === 'Nacional') return { office, uf: 'BR' as const }
    if (!effectiveUf) return null
    return { office, uf: effectiveUf }
  }, [office, presidenteView, effectiveUf])

  useEffect(() => {
    if (!queryParams) {
      setScenario(null)
      setScenarioStatus('idle')
      return
    }
    let alive = true
    setScenarioStatus('loading')
    setScenarioError(null)
    fetch(`/api/scenario?office=${encodeURIComponent(queryParams.office)}&uf=${encodeURIComponent(queryParams.uf)}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          const errBody = body as ScenarioErrorResponse | null
          throw new Error(errBody?.detail ?? `Falha ao calcular cenário (HTTP ${response.status}).`)
        }
        return body as ScenarioResponse
      })
      .then((data) => {
        if (!alive) return
        setScenario(data)
        setScenarioStatus('loaded')
      })
      .catch((error: unknown) => {
        if (!alive) return
        setScenarioStatus('error')
        setScenarioError(error instanceof Error ? error.message : 'Erro desconhecido ao calcular cenário.')
      })
    return () => {
      alive = false
    }
  }, [queryParams])

  const changeOffice = (nextOffice: Office) => {
    setOffice(nextOffice)
    if (nextOffice === 'Governador' && !selectedUf) {
      setSelectedUf(state !== 'Brasil' ? state : BRAZIL_STATES[0].uf)
    }
  }

  const raceLabel =
    office === 'Presidente'
      ? presidenteView === 'Nacional'
        ? 'Presidente da República · Brasil'
        : `Presidente da República · ${selectedUf ? (BRAZIL_STATE_BY_UF[selectedUf]?.name ?? selectedUf) : 'selecione um estado'}`
      : `Governador · ${selectedUf ? (BRAZIL_STATE_BY_UF[selectedUf]?.name ?? selectedUf) : 'selecione um estado'}`

  const handleAsk = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed || isAsking) return
    const id = `q-${Date.now()}-${chatRequestId.current++}`
    setChatLog((log) => [...log, { id, question: trimmed, status: 'pending' }])
    setQuestion('')
    setIsAsking(true)
    try {
      const askOffice = office
      const askUf = office === 'Presidente' && presidenteView === 'Nacional' ? 'BR' : selectedUf ?? 'BR'
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, office: askOffice, uf: askUf }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const errBody = body as AskErrorResponse | null
        setChatLog((log) => log.map((entry) => (entry.id === id ? { ...entry, status: 'error', errorDetail: errBody?.detail ?? `Erro HTTP ${response.status}` } : entry)))
        return
      }
      const data = body as AskResponse
      setChatLog((log) => log.map((entry) => (entry.id === id ? { ...entry, status: 'answered', answer: data.answer } : entry)))
    } catch (error) {
      setChatLog((log) =>
        log.map((entry) =>
          entry.id === id
            ? { ...entry, status: 'error', errorDetail: error instanceof Error ? error.message : 'Falha de rede ao falar com a IA local.' }
            : entry,
        ),
      )
    } finally {
      setIsAsking(false)
    }
  }

  return (
    <section className="cenarios-ia">
      <div className="cenarios-ia__banner" role="note">
        <span className="cenarios-ia__banner-icon" aria-hidden="true">i</span>
        <p>
          <strong>Isto é uma simulação estatística simples a partir da pesquisa mais recente, não é uma previsão eleitoral.</strong>{' '}
          A IA abaixo só explica esses números já calculados, ela não gera nem inventa probabilidade. O navegador vai pedir usuário
          e senha na primeira pergunta feita à IA.
        </p>
      </div>

      <header className="cenarios-ia__header">
        <p className="eyebrow">cenários estatísticos · experimental</p>
        <h2>Cenários (IA)</h2>
      </header>

      <div className="cenarios-ia__filters" role="group" aria-label="Escolher cargo">
        {(['Presidente', 'Governador'] as Office[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`cenarios-ia__pill${office === option ? ' is-active' : ''}`}
            aria-pressed={office === option}
            onClick={() => changeOffice(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {office === 'Presidente' && (
        <div className="cenarios-ia__filters" role="group" aria-label="Nacional ou por estado">
          {(['Nacional', 'PorEstado'] as PresidenteView[]).map((option) => (
            <button
              key={option}
              type="button"
              className={`cenarios-ia__pill cenarios-ia__pill--uf${presidenteView === option ? ' is-active' : ''}`}
              aria-pressed={presidenteView === option}
              onClick={() => setPresidenteView(option)}
            >
              {option === 'Nacional' ? 'Nacional' : 'Por estado'}
            </button>
          ))}
        </div>
      )}

      {needsUf && (
        <div className="cenarios-ia__state-picker">
          <UfPicker activeUf={selectedUf} onSelect={setSelectedUf} />
          <div className="cenarios-ia__state-result">
            <h3 className="cenarios-ia__race-title">{raceLabel}</h3>
            {!selectedUf && <p className="cenarios-ia__status">Selecione um estado no mapa para calcular o cenário.</p>}
            {selectedUf && scenarioStatus === 'loading' && <p className="cenarios-ia__status">Calculando cenário…</p>}
            {selectedUf && scenarioStatus === 'error' && (
              <p className="cenarios-ia__status cenarios-ia__status--empty">Não foi possível calcular o cenário: {scenarioError}</p>
            )}
            {selectedUf && scenarioStatus === 'loaded' && scenario && <ScenarioPanel data={scenario} />}
          </div>
        </div>
      )}

      {!needsUf && (
        <div className="cenarios-ia__state-result cenarios-ia__state-result--national">
          <h3 className="cenarios-ia__race-title">{raceLabel}</h3>
          {scenarioStatus === 'loading' && <p className="cenarios-ia__status">Calculando cenário…</p>}
          {scenarioStatus === 'error' && <p className="cenarios-ia__status cenarios-ia__status--empty">Não foi possível calcular o cenário: {scenarioError}</p>}
          {scenarioStatus === 'loaded' && scenario && <ScenarioPanel data={scenario} />}
        </div>
      )}

      <section className="cenarios-ia__chat" aria-label="Perguntar à IA sobre este cenário">
        <h3 className="cenarios-ia__chat-title">Pergunte sobre este cenário</h3>
        <p className="cenarios-ia__chat-note">
          A IA local só pode repetir os números calculados acima. Se perguntar algo fora dos dados carregados, ela deve dizer que
          não tem esse dado, não inventar um.
        </p>

        <div className="cenarios-ia__chat-log" role="log" aria-live="polite">
          {chatLog.length === 0 && <p className="cenarios-ia__chat-empty">Nenhuma pergunta ainda.</p>}
          {chatLog.map((entry) => (
            <div className="cenarios-ia__chat-entry" key={entry.id}>
              <p className="cenarios-ia__chat-question">
                <strong>Você:</strong> {entry.question}
              </p>
              {entry.status === 'pending' && <p className="cenarios-ia__chat-pending">Consultando a IA local…</p>}
              {entry.status === 'answered' && (
                <p className="cenarios-ia__chat-answer">
                  <strong>IA:</strong> {entry.answer}
                </p>
              )}
              {entry.status === 'error' && (
                <p className="cenarios-ia__chat-error" role="alert">
                  IA local indisponível. Rode <code>ollama serve</code> e confirme que o modelo configurado em{' '}
                  <code>OLLAMA_MODEL</code> está baixado (<code>ollama pull &lt;modelo&gt;</code>). Os números acima continuam
                  válidos mesmo sem a IA.
                  {entry.errorDetail && <span className="cenarios-ia__chat-error-detail"> Detalhe: {entry.errorDetail}</span>}
                </p>
              )}
            </div>
          ))}
        </div>

        <form className="cenarios-ia__chat-form" onSubmit={handleAsk}>
          <textarea
            className="cenarios-ia__chat-textarea"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ex.: qual a chance de ir pro 2º turno nesse cenário?"
            aria-label="Pergunta para a IA"
            rows={2}
          />
          <button type="submit" className="cenarios-ia__chat-submit" disabled={isAsking || !question.trim()}>
            {isAsking ? 'Perguntando…' : 'Perguntar'}
          </button>
        </form>
      </section>
    </section>
  )
}

export default CenariosIA
