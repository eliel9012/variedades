import { useEffect, useMemo, useState } from 'react'
import type { Candidate, ResultSnapshot } from '../../types'
import { BRAZIL_STATE_BY_UF } from '../../data/brazil-states'
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
  results: PollResult[]
  sourceUrl: string | null
}

type PollsFile = {
  generatedAt: string
  source: string | null
  polls: Poll[]
}

type FetchStatus = 'loading' | 'loaded' | 'error'
type OfficeFilter = 'Todos' | 'Presidente' | 'Governador'

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
const shortDateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' })
const percentFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
const sampleFormat = new Intl.NumberFormat('pt-BR')

function formatIsoDate(value: string, formatter: Intl.DateTimeFormat) {
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(parsed.getTime()) ? value : formatter.format(parsed)
}

function raceKey(poll: Poll) {
  return `${poll.office}|${poll.uf}`
}

function raceLabel(office: Poll['office'], uf: string) {
  if (office === 'Presidente') return 'Presidente da República · Brasil'
  const stateName = BRAZIL_STATE_BY_UF[uf]?.name ?? uf
  return `Governador · ${stateName}`
}

export function PesquisasTracker({ candidates: _candidates, snapshot: _snapshot, round: _round, state }: PesquisasTrackerProps) {
  const [pollsFile, setPollsFile] = useState<PollsFile | null>(null)
  const [status, setStatus] = useState<FetchStatus>('loading')
  const [officeFilter, setOfficeFilter] = useState<OfficeFilter>('Todos')
  const [ufFilter, setUfFilter] = useState<string>('all')

  useEffect(() => {
    fetch('/data/polls.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('polls unavailable'))))
      .then((data: PollsFile) => {
        setPollsFile(data)
        setStatus('loaded')
      })
      .catch(() => setStatus('error'))
  }, [])

  const polls = pollsFile?.polls ?? []

  const governorUFs = useMemo(
    () => Array.from(new Set(polls.filter((poll) => poll.office === 'Governador').map((poll) => poll.uf))).sort((a, b) => (BRAZIL_STATE_BY_UF[a]?.name ?? a).localeCompare(BRAZIL_STATE_BY_UF[b]?.name ?? b, 'pt-BR')),
    [polls],
  )

  // Atalho usando a UF já selecionada no resto do painel (prop `state`), só
  // quando ela de fato tem pesquisa de governador nos últimos 30 dias.
  const quickJumpUf = state !== 'Brasil' && governorUFs.includes(state) ? state : null

  const filteredPolls = useMemo(
    () =>
      polls.filter((poll) => {
        if (officeFilter !== 'Todos' && poll.office !== officeFilter) return false
        if (officeFilter === 'Governador' && ufFilter !== 'all' && poll.uf !== ufFilter) return false
        return true
      }),
    [polls, officeFilter, ufFilter],
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

  const hasAnySourceData = status === 'loaded' && pollsFile != null && pollsFile.source != null && polls.length > 0

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

        {officeFilter === 'Governador' && (
          <div className="pesquisas-tracker__uf-select">
            <label htmlFor="pesquisas-uf-filter">Estado</label>
            <select id="pesquisas-uf-filter" value={ufFilter} onChange={(event) => setUfFilter(event.target.value)}>
              <option value="all">Todos os Estados</option>
              {governorUFs.map((uf) => (
                <option key={uf} value={uf}>
                  {BRAZIL_STATE_BY_UF[uf]?.name ?? uf}
                </option>
              ))}
            </select>
            {quickJumpUf && quickJumpUf !== ufFilter && (
              <button type="button" className="pesquisas-tracker__jump" onClick={() => setUfFilter(quickJumpUf)}>
                Ver {BRAZIL_STATE_BY_UF[quickJumpUf]?.name ?? quickJumpUf}
              </button>
            )}
          </div>
        )}
      </div>

      {status === 'loading' && <p className="pesquisas-tracker__status">Carregando pesquisas…</p>}

      {status !== 'loading' && !hasAnySourceData && (
        <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">
          Nenhuma pesquisa disponível no momento. Fonte de dados ainda não integrada.
        </p>
      )}

      {hasAnySourceData && groups.length === 0 && (
        <p className="pesquisas-tracker__status pesquisas-tracker__status--empty">Nenhuma pesquisa encontrada para esse filtro nos últimos 30 dias.</p>
      )}

      {hasAnySourceData &&
        groups.map((group) => (
          <section key={group.key} className="pesquisas-tracker__race" aria-label={raceLabel(group.office, group.uf)}>
            <h3 className="pesquisas-tracker__race-title">{raceLabel(group.office, group.uf)}</h3>
            <div className="pesquisas-tracker__grid">
              {group.items.map((poll) => {
                const topPercentage = poll.results[0]?.percentage || 1
                return (
                  <article className="pesquisas-tracker__card" key={poll.id}>
                    <div className="pesquisas-tracker__card-head">
                      <div>
                        <strong className="pesquisas-tracker__institute">{poll.institute}</strong>
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
                            {result.candidateName}
                            {result.party && <span className="pesquisas-tracker__bar-party"> ({result.party})</span>}
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
              })}
            </div>
          </section>
        ))}
    </section>
  )
}

export default PesquisasTracker
