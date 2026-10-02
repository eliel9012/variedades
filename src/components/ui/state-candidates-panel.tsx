import { useEffect, useMemo, useRef, useState } from 'react'
import type { BrazilState } from '../../data/brazil-states'
import { offices, officeCodes, statesForOffice } from '../../data'
import type { Candidate } from '../../types'
import { useFavoriteCandidates } from '../../hooks/use-favorites'
import FavoriteButton from './favorite-button'

export type StateCandidatesPanelProps = {
  state: BrazilState | null
  candidates: Candidate[]
  onClose: () => void
}

// Painel lateral (desktop) / seção embutida (mobile) com todos os cargos de
// uma UF, exceto Presidente, que já tem sua própria aba. Abre a cada clique
// no mapa, independente do filtro de cargo usado na lista principal.
export function StateCandidatesPanel({ state, candidates, onClose }: StateCandidatesPanelProps) {
  const { isFavorite, toggleFavorite } = useFavoriteCandidates()
  const [search, setSearch] = useState('')
  const [renderedState, setRenderedState] = useState<BrazilState | null>(state)
  const [selectedOffice, setSelectedOffice] = useState<string>('Todos')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const isOpen = state !== null

  useEffect(() => {
    if (state) {
      setRenderedState(state)
      setSearch('')
      const officesForState = offices.filter((office) => office !== 'Presidente' && statesForOffice(office).includes(state.uf))
      setSelectedOffice(officesForState[0] ?? 'Todos')
    }
  }, [state])

  useEffect(() => {
    if (!isOpen) return
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [isOpen, state?.uf])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  const groups = useMemo(() => {
    if (!renderedState) return []
    const q = search.trim().toLocaleLowerCase('pt-BR')
    return offices
      .filter((office) => office !== 'Presidente' && statesForOffice(office).includes(renderedState.uf))
      .map((office) => ({
        office,
        candidates: candidates
          .filter((candidate) => candidate.officeCode === officeCodes[office] && candidate.uf === renderedState.uf)
          .filter((candidate) => !q || `${candidate.ballotName} ${candidate.party} ${candidate.number}`.toLocaleLowerCase('pt-BR').includes(q)),
      }))
  }, [candidates, renderedState, search])

  const visibleGroups = selectedOffice === 'Todos' ? groups : groups.filter((group) => group.office === selectedOffice)

  const totalResults = visibleGroups.reduce((sum, group) => sum + group.candidates.length, 0)

  return (
    <div className={`state-panel-overlay${isOpen ? ' is-open' : ''}`} aria-hidden={!isOpen}>
      <div
        className="state-panel"
        role="dialog"
        aria-modal="false"
        aria-label={renderedState ? `Candidaturas em ${renderedState.name}` : 'Candidaturas por estado'}
      >
        <header className="state-panel__header">
          <div>
            <p className="state-panel__eyebrow">candidaturas no estado</p>
            <h2>{renderedState?.name} <span>{renderedState?.uf}</span></h2>
          </div>
          <button type="button" className="state-panel__close" onClick={onClose} aria-label="Fechar painel">×</button>
        </header>
        <div className="state-panel__search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar nome, partido ou número"
            aria-label={`Buscar candidato em ${renderedState?.name ?? 'estado selecionado'}`}
          />
        </div>
        <div className="state-panel__office-toggle" role="group" aria-label="Filtrar por cargo">
          <button
            type="button"
            className={`state-panel__pill${selectedOffice === 'Todos' ? ' is-active' : ''}`}
            aria-pressed={selectedOffice === 'Todos'}
            onClick={() => setSelectedOffice('Todos')}
          >
            Todos
          </button>
          {groups.map((group) => (
            <button
              key={group.office}
              type="button"
              className={`state-panel__pill${selectedOffice === group.office ? ' is-active' : ''}`}
              aria-pressed={selectedOffice === group.office}
              onClick={() => setSelectedOffice(group.office)}
            >
              {group.office}
            </button>
          ))}
        </div>
        <p className="state-panel__count">{totalResults} candidatura(s) encontrada(s)</p>
        <div className="state-panel__body">
          {visibleGroups.map((group) => (
            <section className="state-panel__office-group" key={group.office}>
              <h3>{group.office}</h3>
              {group.candidates.length === 0 ? (
                <p className="empty">Nenhuma candidatura encontrada.</p>
              ) : (
                group.candidates.map((candidate) => (
                  <div className="state-panel__candidate" key={candidate.sqCandidate}>
                    <div className="avatar">{candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidate.ballotName.slice(0, 1)}</span>}</div>
                    <div className="candidate-info">
                      <strong>{candidate.ballotName}</strong>
                      <span>{candidate.party} · nº {candidate.number}</span>
                    </div>
                    <FavoriteButton active={isFavorite(candidate.sqCandidate)} onToggle={() => toggleFavorite(candidate.sqCandidate)} label={candidate.ballotName} />
                  </div>
                ))
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export default StateCandidatesPanel
