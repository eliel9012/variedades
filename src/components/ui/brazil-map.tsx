import { useState } from 'react'
import { BRAZIL_STATES, type BrazilState } from '../../data/brazil-states'
import './brazil-map.css'

export type BrazilMapProps = {
  activeUf?: string
  onSelect?: (state: BrazilState) => void
  onHover?: (state: BrazilState | null) => void
  onSelectOffice?: (office: string) => void
  selectedOffice?: string
  candidateCount?: number
  className?: string
  ariaLabel?: string
}

const tooltipId = 'brazil-map-tooltip'

export function BrazilMap({ activeUf, onSelect, onHover, onSelectOffice, selectedOffice, candidateCount = 0, className = '', ariaLabel = 'Mapa do Brasil por estado' }: BrazilMapProps) {
  const [internalUf, setInternalUf] = useState<string | undefined>(activeUf)
  const [tooltipUf, setTooltipUf] = useState<string | null>(null)
  const selectedUf = activeUf ?? internalUf
  const selectedState = BRAZIL_STATES.find((state) => state.uf === selectedUf)
  const tooltipState = BRAZIL_STATES.find((state) => state.uf === tooltipUf)

  const showTooltip = (state: BrazilState) => {
    setTooltipUf(state.uf)
    onHover?.(state)
  }

  const hideTooltip = () => {
    setTooltipUf(null)
    onHover?.(null)
  }

  const selectState = (state: BrazilState) => {
    setInternalUf(state.uf)
    onSelect?.(state)
  }

  return (
    <section className={`brazil-map ${className}`.trim()} aria-label={ariaLabel}>
      <figure className="brazil-map__figure">
        <svg className="brazil-map__svg" data-testid="br-map" viewBox="0 0 520 550" role="radiogroup" aria-labelledby="brazil-map-title brazil-map-description">
          <title id="brazil-map-title">Brasil, estados selecionáveis</title>
          <desc id="brazil-map-description">Selecione um estado para ver candidatos e cargos disponíveis.</desc>
          {BRAZIL_STATES.map((state) => {
            const isActive = selectedUf === state.uf
            return (
              <g
                key={state.uf}
                data-uf={state.uf}
                className={`brazil-map__state${isActive ? ' brazil-map__state--active' : ''}`}
                role="radio"
                tabIndex={0}
                aria-label={`${state.name}, ${state.uf}. Capital: ${state.capital}.`}
                aria-checked={isActive}
                aria-describedby={tooltipUf === state.uf ? tooltipId : undefined}
                onPointerEnter={() => showTooltip(state)}
                onPointerLeave={hideTooltip}
                onFocus={() => showTooltip(state)}
                onBlur={hideTooltip}
                onClick={() => selectState(state)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    selectState(state)
                  }
                  if (event.key === 'Escape') hideTooltip()
                }}
              >
                <path d={state.path} style={{ fill: isActive ? 'var(--brazil-map-active)' : state.color }} />
                <text className="brazil-map__label" x={state.label[0]} y={state.label[1] + 3}>{state.uf}</text>
              </g>
            )
          })}
        </svg>
        <figcaption className="brazil-map__legend" aria-label="Legenda das regiões">
          <span><i /> Sudeste/Sul</span>
          <span><i /> Nordeste</span>
          <span><i /> Norte/Centro-Oeste</span>
          <span><i /> UF ativa</span>
        </figcaption>
      </figure>

      <aside className="brazil-map__details" data-testid="uf-menu" aria-live="polite">
        {selectedState ? (
          <>
            <p className="brazil-map__eyebrow">UF ativa</p>
            <h2>{selectedState.name}<span>{selectedState.uf}</span></h2>
            <p className="brazil-map__capital">Capital: {selectedState.capital} · Região {selectedState.region}</p>
            <p className="brazil-map__candidate-count" data-testid="candidate-count"><strong>{candidateCount.toLocaleString('pt-BR')}</strong> candidaturas no cargo selecionado</p>
            <div className="brazil-map__offices">
              <p>Cargos disponíveis</p>
              <ul>{selectedState.offices.map((office) => <li key={office}><button type="button" className={selectedOffice === office ? 'is-selected' : ''} aria-pressed={selectedOffice === office} onClick={() => onSelectOffice?.(office)}>{office}<span>↗</span></button></li>)}</ul>
            </div>
          </>
        ) : (
          <div className="brazil-map__empty">Selecione uma UF no mapa.</div>
        )}
      </aside>

      {tooltipState && (
        <div id={tooltipId} className="brazil-map__tooltip" data-testid="uf-tooltip" role="tooltip">
          <strong>{tooltipState.name} · {tooltipState.uf}</strong>
          <span>Capital: {tooltipState.capital} · Selecione para abrir candidatos</span>
        </div>
      )}
      <span className="brazil-map__status" aria-live="polite">{selectedState ? `UF ativa: ${selectedState.name}` : ''}</span>
    </section>
  )
}

export default BrazilMap
