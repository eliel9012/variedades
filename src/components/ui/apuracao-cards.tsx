import type { ResultRow, ResultSnapshot, ResultTally } from '@/types'

// Preposição de cada UF ("em São Paulo", "no Rio de Janeiro", "na Bahia").
const UF_PREPOSITION: Record<string, 'no' | 'na' | 'em'> = {
  AC: 'no', AP: 'no', AM: 'no', CE: 'no', DF: 'no', ES: 'no', MA: 'no', PA: 'no', PR: 'no', PI: 'no', RJ: 'no', RN: 'no', RS: 'no', TO: 'no',
  BA: 'na', PB: 'na',
}

export function placeTitle(uf: string, ufName: string | undefined, cityName: string | null) {
  if (cityName) return `Eleições em ${cityName}`
  if (uf === 'Brasil' || !ufName) return 'Eleições no Brasil'
  return `Eleições ${UF_PREPOSITION[uf] ?? 'em'} ${ufName}`
}

const intFormat = new Intl.NumberFormat('pt-BR')
const pctFormat = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const updatedFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })

function formatUpdated(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(updatedFormat.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.hour}:${parts.minute}:${parts.second} de ${parts.day}/${parts.month}/${parts.year}`
}

// Situação publicada pelo TSE (cand.st). Nada é inferido do percentual.
export function badgeFor(status: string | undefined): 'eleito' | 'segundo' | null {
  if (!status) return null
  if (/não eleit/i.test(status)) return null
  if (/^eleit/i.test(status)) return 'eleito'
  if (/2º turno/i.test(status)) return 'segundo'
  return null
}

const who = (row: ResultRow) => (row.party ? `${row.name ?? 'Candidatura'} (${row.party})` : row.name ?? 'Candidatura')
const joinNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`)

function statusSentence(rows: ResultRow[]) {
  const elected = rows.filter((row) => badgeFor(row.status) === 'eleito')
  if (elected.length > 0) return `Eleito segundo o TSE: ${joinNames(elected.map((row) => `${who(row)}, com ${pctFormat.format(row.share)}% dos votos válidos`))}.`
  const runoff = rows.filter((row) => badgeFor(row.status) === 'segundo')
  if (runoff.length > 0) return `Disputa do 2º turno segundo o TSE: ${joinNames(runoff.map(who))}.`
  return null
}

type HeaderProps = {
  title: string
  /** Snapshot já conferido como deste recorte/cargo; null mostra N/D. */
  snapshot: ResultSnapshot | null
  rows: ResultRow[]
}

export function ApuracaoHeader({ title, snapshot, rows }: HeaderProps) {
  const share = snapshot ? (snapshot.sectionsShare ?? (snapshot.totalSections ? (snapshot.countedSections / snapshot.totalSections) * 100 : undefined)) : undefined
  const updated = formatUpdated(snapshot?.updatedAt ?? null)
  const sentence = statusSentence(rows)
  return (
    <header className="apc-header">
      <div className="apc-header__top">
        <h2 className="apc-header__title">{title}</h2>
        <p className="apc-header__share" aria-label={share === undefined ? 'Seções apuradas: N/D' : `${pctFormat.format(share)}% das seções apuradas`}>
          {share === undefined ? 'N/D' : `${pctFormat.format(share)}%`}
        </p>
      </div>
      <div className="apc-header__line" aria-hidden="true"><i style={{ width: `${Math.min(100, share ?? 0)}%` }} /></div>
      <p className="apc-header__meta">
        seções apuradas: {snapshot && snapshot.totalSections ? <><strong>{intFormat.format(snapshot.countedSections)}</strong> de {intFormat.format(snapshot.totalSections)}</> : 'N/D'}
      </p>
      <p className="apc-header__meta apc-header__meta--small">{updated ? `última atualização em ${updated} (horário de Brasília)` : 'última atualização: N/D'}</p>
      {sentence && <p className="apc-header__sentence">{sentence}</p>}
    </header>
  )
}

export function RoundTabs({ round, onChange }: { round: 1 | 2; onChange: (round: 1 | 2) => void }) {
  return (
    <div className="apc-tabs" role="tablist" aria-label="Turno">
      {([1, 2] as const).map((value) => (
        <button key={value} type="button" role="tab" aria-selected={round === value} className={`apc-tab${round === value ? ' is-active' : ''}`} onClick={() => onChange(value)}>
          {value}º turno
        </button>
      ))}
    </div>
  )
}

type RowProps = { row: ResultRow; photo?: string; leader: boolean }

export function ApuracaoRow({ row, photo, leader }: RowProps) {
  const badge = badgeFor(row.status)
  const anulado = row.voteDestination && row.voteDestination !== 'Válido'
  return (
    <li className={`apc-row${leader ? ' is-leader' : ''}`}>
      <div className="apc-avatar">{photo ? <img src={photo} alt="" loading="lazy" /> : <span>{(row.name ?? '?').slice(0, 1)}</span>}</div>
      <div className="apc-row__info">
        <strong className="apc-row__name">{row.name ?? 'Candidatura'}</strong>
        <span className="apc-row__party">
          {[row.party, row.number ? `nº ${row.number}` : null].filter(Boolean).join(' · ')}
          {badge && <em className={`apc-badge apc-badge--${badge}`}>{badge === 'eleito' ? 'Eleito' : '2º turno'}</em>}
          {!badge && row.status && /não eleit|suplente/i.test(row.status) && <em className="apc-badge apc-badge--muted">{row.status}</em>}
        </span>
      </div>
      <div className="apc-row__numbers">
        {anulado ? <span className="apc-row__share apc-row__share--muted">{row.voteDestination}</span> : <span className="apc-row__share">{pctFormat.format(row.share)}%</span>}
        <span className="apc-row__votes">{intFormat.format(row.votes)} votos</span>
      </div>
      {!anulado && <div className="apc-row__bar" aria-hidden="true"><i style={{ width: `${Math.min(100, row.share)}%` }} /></div>}
    </li>
  )
}

const TOTALS: Array<{ key: keyof NonNullable<ResultSnapshot['totals']>; label: string }> = [
  { key: 'turnout', label: 'Total' },
  { key: 'valid', label: 'Válidos' },
  { key: 'blank', label: 'Brancos' },
  { key: 'nulls', label: 'Nulos' },
  { key: 'abstention', label: 'Abstenções' },
]

function tallyText(value: ResultTally | undefined, showPct: boolean) {
  if (!value) return 'N/D'
  const count = intFormat.format(value.count)
  return showPct && value.pct !== undefined ? `${count} (${pctFormat.format(value.pct)}%)` : count
}

export function ApuracaoTotals({ snapshot }: { snapshot: ResultSnapshot | null }) {
  const totals = snapshot?.totals
  return (
    <dl className="apc-totals">
      {TOTALS.map(({ key, label }) => (
        <div key={key} className="apc-totals__item">
          <dt>{label}</dt>
          <dd>{tallyText(totals?.[key], key !== 'turnout')}</dd>
        </div>
      ))}
    </dl>
  )
}
