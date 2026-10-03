import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { formatCityName, searchMunicipios, type Municipio } from '@/municipios'
import './city-picker.css'

// Malha já projetada em SVG por scripts/build-municipios.mjs: chave = código
// TSE do município. Só é baixada quando o seletor abre (MG passa de 200 KB).
type Malha = { viewBox: string; paths: Record<string, string> }
const malhaCache = new Map<string, Promise<Malha>>()

function loadMalha(uf: string): Promise<Malha> {
  const key = uf.toLowerCase()
  const cached = malhaCache.get(key)
  if (cached) return cached
  const promise = fetch(`/data/malhas/${key}.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Malha>) : Promise.reject(new Error(`malha ${response.status}`))))
    .catch((error) => {
      malhaCache.delete(key)
      throw error
    })
  malhaCache.set(key, promise)
  return promise
}

type CityPickerProps = {
  uf: string
  ufName: string
  municipios: Municipio[] | null
  loadError?: boolean
  activeCd?: string
  onSelect: (municipio: Municipio) => void
  onClose: () => void
}

export default function CityPicker({ uf, ufName, municipios, loadError = false, activeCd, onSelect, onClose }: CityPickerProps) {
  const baseId = useId()
  const inputId = `${baseId}-input`
  const listId = `${baseId}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const figureRef = useRef<HTMLElement>(null)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const [malha, setMalha] = useState<{ uf: string; data: Malha | null; error: boolean } | null>(null)
  const [hover, setHover] = useState<{ cd: string; x: number; y: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let alive = true
    loadMalha(uf)
      .then((data) => alive && setMalha({ uf, data, error: false }))
      .catch(() => alive && setMalha({ uf, data: null, error: true }))
    return () => {
      alive = false
    }
  }, [uf])

  const byCd = useMemo(() => new Map((municipios ?? []).map((item) => [item.cd, item])), [municipios])
  const results = useMemo(() => (municipios ? searchMunicipios(municipios, query) : []), [municipios, query])
  const open = results.length > 0
  const activeIndex = open ? Math.min(highlight, results.length - 1) : -1
  const highlighted = activeIndex >= 0 ? results[activeIndex] : undefined
  const currentMalha = malha && malha.uf === uf ? malha : null

  // 645+ paths renderizados uma vez por malha; hover/destaque vão numa camada
  // por cima, sem re-renderizar o mapa inteiro.
  const pathElements = useMemo(() => {
    if (!currentMalha?.data) return null
    return Object.entries(currentMalha.data.paths).map(([cd, d]) => <path key={cd} d={d} data-cd={cd} className="city-picker__shape" />)
  }, [currentMalha])

  const choose = (municipio: Municipio | undefined) => {
    if (municipio) onSelect(municipio)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (!open) return
      event.preventDefault()
      setHighlight((activeIndex + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      if (!open) return
      event.preventDefault()
      setHighlight((activeIndex - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      if (!highlighted) return
      event.preventDefault()
      choose(highlighted)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query) setQuery('')
      else onClose()
    }
  }

  const cdFromEvent = (target: EventTarget | null) => (target instanceof SVGPathElement ? target.dataset.cd : undefined)

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const cd = cdFromEvent(event.target)
    const rect = figureRef.current?.getBoundingClientRect()
    if (!cd || !rect) {
      if (hover) setHover(null)
      return
    }
    // Mantém o nome dentro do mapa perto das bordas (celular).
    const margin = Math.min(110, rect.width / 2)
    const x = Math.min(Math.max(event.clientX - rect.left, margin), rect.width - margin)
    setHover({ cd, x, y: event.clientY - rect.top })
  }

  const hoverCity = hover ? byCd.get(hover.cd) : undefined
  const overlayCd = hover?.cd ?? highlighted?.cd
  const paths = currentMalha?.data?.paths
  const totalLabel = municipios ? `${municipios.length.toLocaleString('pt-BR')} municípios` : 'carregando municípios'

  return (
    <div className="city-picker" role="region" aria-label={`Escolher cidade em ${ufName}`}>
      <div className="city-picker__search">
        <div className="city-picker__head">
          <label htmlFor={inputId}>Buscar cidade em {ufName}</label>
          <button type="button" className="city-picker__close" onClick={onClose} aria-label="Fechar seletor de cidade">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="city-picker__field">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={highlighted ? `${listId}-${highlighted.cd}` : undefined}
            placeholder="Digite o nome, ex.: Campinas"
            value={query}
            disabled={!municipios}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlight(0)
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <ul id={listId} role="listbox" aria-label="Cidades encontradas" className="city-picker__list" hidden={!open}>
          {results.map((item, index) => (
            <li
              key={item.cd}
              id={`${listId}-${item.cd}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`city-picker__option${index === activeIndex ? ' is-highlighted' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(item)}
            >
              <span>{formatCityName(item.nm)}</span>
              {item.capital && <small>capital</small>}
            </li>
          ))}
        </ul>
        <p className="city-picker__hint" aria-live="polite">
          {loadError
            ? 'Não foi possível carregar a lista de municípios.'
            : query && municipios && !open
              ? 'Nenhuma cidade encontrada com esse nome.'
              : open
                ? `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}. Setas para navegar, Enter para abrir.`
                : `${totalLabel}. Busque pelo nome ou toque no mapa.`}
        </p>
      </div>

      <figure className="city-picker__map" ref={figureRef}>
        {currentMalha?.data ? (
          <svg
            className="city-picker__svg"
            viewBox={currentMalha.data.viewBox}
            role="img"
            aria-label={`Mapa dos municípios de ${ufName}. Para escolher pelo teclado, use a busca.`}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHover(null)}
            onClick={(event) => choose(byCd.get(cdFromEvent(event.target) ?? ''))}
          >
            <g>{pathElements}</g>
            {activeCd && paths?.[activeCd] && <path d={paths[activeCd]} className="city-picker__shape is-active" aria-hidden="true" />}
            {overlayCd && paths?.[overlayCd] && overlayCd !== activeCd && <path d={paths[overlayCd]} className="city-picker__shape is-hover" aria-hidden="true" />}
          </svg>
        ) : (
          <div className="city-picker__map-empty">{currentMalha?.error ? 'Mapa indisponível. Use a busca.' : 'Carregando mapa…'}</div>
        )}
        {hover && hoverCity && (
          <div className="city-picker__tooltip" style={{ left: hover.x, top: hover.y }} aria-hidden="true">
            {formatCityName(hoverCity.nm)}
          </div>
        )}
      </figure>
    </div>
  )
}
