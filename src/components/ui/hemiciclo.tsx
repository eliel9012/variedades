import { useEffect, useMemo, useState } from 'react'
import './hemiciclo.css'

// Bancada por UF e partido. 2022: public/data/hemiciclo-2022.json (resultado
// final, scripts/build-hemiciclo-2022.py). 2026: /data/hemiciclo-2026.json,
// agregado pelo servidor a partir do espelho do TSE (server/hemiciclo.mjs),
// só com quem o TSE já marcou como eleito.
type UfBancada = { vagas: number; eleitos: Record<string, number>; totalizado?: boolean; secoesTotalizadas?: string; atualizado?: string | null }
type BancadaFile = { ano: number; fonte: string; vagas: number; ufs: Record<string, UfBancada> }
type Year = 2022 | 2026

// Ordem esquerda > direita usada só para posicionar e colorir os partidos no
// hemiciclo. É uma classificação editorial do site (não é dado do TSE),
// próxima da usada pela imprensa e por levantamentos com especialistas.
// Partido fora da lista vai para o centro, em cinza.
const SPECTRUM = [
  'PCO', 'PSTU', 'UP', 'PCB', 'PSOL', 'PCDOB', 'PT', 'REDE', 'PV', 'PDT', 'PSB',
  'SOLIDARIEDADE', 'CIDADANIA', 'AVANTE', 'PROS', 'MOBILIZA', 'PMN', 'MDB', 'PSDB', 'PSD',
  'AGIR', 'DC', 'PODE', 'PRD', 'PTB', 'PATRIOTA', 'REPUBLICANOS', 'UNIÃO', 'PP', 'PSC',
  'DEMOCRATA', 'MISSÃO', 'PRTB', 'NOVO', 'PL',
]

const PARTY_LABEL: Record<string, string> = { PCDOB: 'PCdoB', PODE: 'Podemos', UNIÃO: 'União', REPUBLICANOS: 'Republicanos', SOLIDARIEDADE: 'Solidariedade', CIDADANIA: 'Cidadania', AVANTE: 'Avante', PATRIOTA: 'Patriota', MOBILIZA: 'Mobiliza', DEMOCRATA: 'Democrata', MISSÃO: 'Missão', AGIR: 'Agir', REDE: 'Rede', NOVO: 'Novo' }

const UF_NAMES: Record<string, string> = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' }

const UNKNOWN_COLOR = '#8f8a84'
const PENDING_COLOR = '#e3ded4'
const RED = [183, 28, 28]
const MID = [139, 108, 150]
const BLUE = [21, 67, 150]
const POLL_MS = 60_000

const numberFormat = new Intl.NumberFormat('pt-BR')

function partyLabel(key: string) {
  return PARTY_LABEL[key] ?? key
}

function spectrumIndex(key: string) {
  const index = SPECTRUM.indexOf(key)
  return index === -1 ? null : index
}

function mix(a: number[], b: number[], t: number) {
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(' ')})`
}

/** t = 0 vermelho (esquerda), 1 azul (direita), passando por um roxo. */
function gradient(t: number) {
  return t < 0.5 ? mix(RED, MID, t * 2) : mix(MID, BLUE, (t - 0.5) * 2)
}

function sortKey(key: string) {
  return spectrumIndex(key) ?? (SPECTRUM.length - 1) / 2
}

type Seat = { x: number; y: number; angle: number }

/** Posições das cadeiras em fileiras concêntricas, da esquerda pra direita. */
function seatLayout(total: number): { seats: Seat[]; radius: number } {
  if (total <= 0) return { seats: [], radius: 0 }
  const rows = Math.max(1, Math.round(Math.sqrt(total / 3.5)))
  const inner = rows === 1 ? 1 : 0.42
  const radii = Array.from({ length: rows }, (_, i) => (rows === 1 ? 1 : inner + ((1 - inner) * i) / (rows - 1)))
  const radiusSum = radii.reduce((sum, r) => sum + r, 0)
  const raw = radii.map((r) => (total * r) / radiusSum)
  const counts = raw.map(Math.floor)
  let left = total - counts.reduce((sum, n) => sum + n, 0)
  raw
    .map((value, i) => ({ i, rest: value - Math.floor(value) }))
    .sort((a, b) => b.rest - a.rest)
    .forEach(({ i }) => {
      if (left > 0) {
        counts[i] += 1
        left -= 1
      }
    })
  const seats: Seat[] = []
  radii.forEach((r, row) => {
    const n = counts[row]
    for (let k = 0; k < n; k += 1) {
      const angle = n === 1 ? Math.PI / 2 : Math.PI - (Math.PI * k) / (n - 1)
      seats.push({ x: r * Math.cos(angle), y: r * Math.sin(angle), angle })
    }
  })
  seats.sort((a, b) => b.angle - a.angle || a.y - b.y)
  const rowGap = rows === 1 ? 0.5 : (1 - inner) / (rows - 1)
  const arcGap = Math.min(...radii.map((r, i) => (counts[i] > 1 ? (Math.PI * r) / (counts[i] - 1) : 1)))
  return { seats, radius: Math.min(rowGap, arcGap) * 0.42 }
}

function useBancada(year: Year) {
  const [files, setFiles] = useState<Partial<Record<Year, BancadaFile | 'error'>>>({})
  useEffect(() => {
    let cancelled = false
    const url = year === 2022 ? '/data/hemiciclo-2022.json' : '/data/hemiciclo-2026.json'
    const load = () => {
      if (document.visibilityState === 'hidden') return
      fetch(url)
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
        .then((data: BancadaFile) => !cancelled && setFiles((current) => ({ ...current, [year]: data })))
        .catch(() => !cancelled && setFiles((current) => (current[year] ? current : { ...current, [year]: 'error' })))
    }
    load()
    // 2022 não muda; 2026 vai sendo preenchido conforme o TSE declara eleitos.
    const timer = year === 2026 ? window.setInterval(load, POLL_MS) : undefined
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [year])
  return files[year]
}

export function Hemiciclo({ defaultUf }: { defaultUf?: string }) {
  const [year, setYear] = useState<Year>(2026)
  const [scope, setScope] = useState<string>('BR')
  const file = useBancada(year)
  const data = file && file !== 'error' ? file : null

  const view = useMemo(() => {
    if (!data) return null
    const ufs = scope === 'BR' ? Object.values(data.ufs) : data.ufs[scope] ? [data.ufs[scope]] : []
    const vagas = ufs.reduce((sum, uf) => sum + uf.vagas, 0)
    const byParty = new Map<string, number>()
    for (const uf of ufs) for (const [party, n] of Object.entries(uf.eleitos)) byParty.set(party, (byParty.get(party) ?? 0) + n)
    const sorted = [...byParty.entries()].map(([key, seats]) => ({ key, seats })).sort((a, b) => sortKey(a.key) - sortKey(b.key) || b.seats - a.seats)
    // Cor pela posição entre os partidos presentes no recorte (não na lista
    // inteira), pra vizinhos ficarem distinguíveis.
    const ranked = sorted.filter((p) => spectrumIndex(p.key) !== null)
    const parties = sorted.map((p) => {
      const rank = ranked.indexOf(p)
      return { ...p, color: rank === -1 ? UNKNOWN_COLOR : gradient(ranked.length === 1 ? 0.5 : rank / (ranked.length - 1)) }
    })
    const elected = parties.reduce((sum, p) => sum + p.seats, 0)
    const pending = Math.max(0, vagas - elected)
    // Cadeira ainda sem eleito fica no meio, entre esquerda e direita.
    const middle = (SPECTRUM.length - 1) / 2
    const leftSide = parties.filter((p) => sortKey(p.key) < middle)
    const rightSide = parties.filter((p) => sortKey(p.key) >= middle)
    const fills: { color: string; label: string }[] = []
    for (const p of leftSide) for (let i = 0; i < p.seats; i += 1) fills.push({ color: p.color, label: partyLabel(p.key) })
    for (let i = 0; i < pending; i += 1) fills.push({ color: PENDING_COLOR, label: 'A definir' })
    for (const p of rightSide) for (let i = 0; i < p.seats; i += 1) fills.push({ color: p.color, label: partyLabel(p.key) })
    const totalized = ufs.filter((uf) => uf.totalizado).length
    return { vagas, parties, elected, pending, fills, totalized, ufCount: ufs.length, layout: seatLayout(vagas) }
  }, [data, scope])

  const ufOptions = Object.keys(UF_NAMES).sort((a, b) => a.localeCompare(b))
  const placeName = scope === 'BR' ? 'Câmara dos Deputados' : `Bancada de ${UF_NAMES[scope]}`
  const width = 2.12
  const height = 1.12

  return (
    <div className="panel hemiciclo">
      <div className="panel-heading hemiciclo__heading">
        <div>
          <p className="eyebrow">Hemiciclo · Deputado Federal</p>
          <h2>{placeName}{year === 2022 ? ' eleita em 2022' : ' em 2026'}</h2>
        </div>
        <div className="hemiciclo__years" role="group" aria-label="Ano da eleição">
          {([2022, 2026] as Year[]).map((y) => (
            <button key={y} type="button" className={year === y ? 'is-active' : undefined} aria-pressed={year === y} onClick={() => setYear(y)}>
              {y}
            </button>
          ))}
        </div>
      </div>

      <label className="hemiciclo__scope">
        <span>Recorte</span>
        <select value={scope} onChange={(event) => setScope(event.target.value)}>
          <option value="BR">Brasil (513 cadeiras)</option>
          {ufOptions.map((uf) => (
            <option key={uf} value={uf}>
              {uf} · {UF_NAMES[uf]}{uf === defaultUf ? ' (aberto na apuração)' : ''}
            </option>
          ))}
        </select>
      </label>

      {file === 'error' && <p className="hemiciclo__status">Não foi possível carregar a bancada agora. Tente de novo em instantes.</p>}
      {!file && <p className="hemiciclo__status">Carregando bancada…</p>}

      {view && view.vagas > 0 && (
        <>
          <svg
            className="hemiciclo__chart"
            viewBox={`${-width / 2} ${-height + 0.06} ${width} ${height}`}
            role="img"
            aria-label={`${placeName}: ${view.parties.map((p) => `${partyLabel(p.key)} ${p.seats}`).join(', ') || 'nenhum eleito definido'}${view.pending ? `, ${view.pending} cadeiras a definir` : ''}.`}
          >
            {view.layout.seats.map((seat, i) => (
              <circle key={i} cx={seat.x} cy={-seat.y} r={view.layout.radius} fill={view.fills[i]?.color ?? PENDING_COLOR}>
                <title>{view.fills[i]?.label ?? 'A definir'}</title>
              </circle>
            ))}
            <text x="0" y="-0.08" textAnchor="middle" className="hemiciclo__total">{numberFormat.format(view.vagas)}</text>
            <text x="0" y="0.02" textAnchor="middle" className="hemiciclo__total-caption">cadeiras</text>
          </svg>

          <div className="hemiciclo__axis" aria-hidden="true">
            <span>Esquerda</span>
            <span>Direita</span>
          </div>

          {year === 2026 && (
            <p className="hemiciclo__status">
              {view.elected === 0
                ? 'O TSE ainda não declarou nenhum eleito. As cadeiras vão sendo coloridas conforme o TSE marca cada eleito.'
                : `${numberFormat.format(view.elected)} de ${numberFormat.format(view.vagas)} cadeiras com eleito declarado pelo TSE. ${view.totalized} de ${view.ufCount} ${view.ufCount === 1 ? 'UF totalizada' : 'UFs totalizadas'}.`}
            </p>
          )}

          <ul className="hemiciclo__legend">
            {view.parties.map((p) => (
              <li key={p.key}>
                <span className="hemiciclo__swatch" style={{ background: p.color }} aria-hidden="true" />
                <span className="hemiciclo__party">{partyLabel(p.key)}</span>
                <strong>{p.seats}</strong>
              </li>
            ))}
            {view.pending > 0 && (
              <li>
                <span className="hemiciclo__swatch hemiciclo__swatch--pending" aria-hidden="true" />
                <span className="hemiciclo__party">A definir</span>
                <strong>{view.pending}</strong>
              </li>
            )}
          </ul>

          {scope === 'BR' && (
            <p className="hemiciclo__note">Maioria absoluta: 257 cadeiras. Emenda à Constituição: 308 (3/5).</p>
          )}
        </>
      )}

      <p className="source-note">
        Fonte: {data?.fonte ?? 'TSE'}. A ordem esquerda/direita e as cores são uma classificação editorial do Apura
        Brasil, não um dado do TSE. Partidos fora da classificação aparecem em cinza.
      </p>
    </div>
  )
}

export default Hemiciclo
