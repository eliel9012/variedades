import { useEffect, useState } from 'react'
import './election-day-banner.css'

// Datas oficiais do pleito de 2026 (1º turno 04/10, 2º turno 25/10). Votação
// das 8h às 17h, horário de Brasília, em todo o país.
const ROUNDS = [
  { round: 1, date: '2026-10-04' },
  { round: 2, date: '2026-10-25' },
] as const

type Phase = { kind: 'voting' | 'counting'; round: 1 | 2 } | null

function currentPhase(now: number): Phase {
  for (const { round, date } of ROUNDS) {
    const opens = Date.parse(`${date}T08:00:00-03:00`)
    const closes = Date.parse(`${date}T17:00:00-03:00`)
    const fades = Date.parse(`${date}T23:59:59-03:00`) + 24 * 3_600_000
    if (now >= opens && now < closes) return { kind: 'voting', round }
    if (now >= closes && now < fades) return { kind: 'counting', round }
  }
  return null
}

/** ?simular=votacao | ?simular=apuracao força a fase (para conferir o visual antes do dia). */
function simulated(): Phase {
  const value = new URLSearchParams(window.location.search).get('simular')
  if (value === 'votacao') return { kind: 'voting', round: 1 }
  if (value === 'apuracao') return { kind: 'counting', round: 1 }
  return null
}

type Props = {
  /** Aba atual: em Pesquisas e Cenários o aviso lembra que aquilo não é resultado. */
  isPreElectionTab: boolean
  isResultsTab: boolean
  onGoToResults: () => void
}

export function ElectionDayBanner({ isPreElectionTab, isResultsTab, onGoToResults }: Props) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const phase = simulated() ?? currentPhase(now)
  if (!phase) return null
  const turno = `${phase.round}º turno`

  if (phase.kind === 'voting') {
    return (
      <aside className="election-day-banner" role="status">
        <p>
          <strong>Hoje é dia de eleição ({turno}).</strong> A votação vai até as 17h, horário de Brasília. A apuração
          oficial do TSE começa logo depois, aqui no site.
        </p>
      </aside>
    )
  }

  return (
    <aside className="election-day-banner election-day-banner--counting" role="status">
      <p>
        <strong>Urnas fechadas: apuração oficial do TSE em andamento ({turno}).</strong>
        {isPreElectionTab && ' As pesquisas e cenários desta aba são de antes da eleição e não são resultado.'}
      </p>
      {!isResultsTab && (
        <button type="button" className="election-day-banner__cta" onClick={onGoToResults}>
          Ver apuração
        </button>
      )}
    </aside>
  )
}
