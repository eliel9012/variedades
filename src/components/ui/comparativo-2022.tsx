import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ApuracaoHeader, ApuracaoRow, ApuracaoTotals, RoundTabs, placeTitle, statusSentence } from '@/components/ui/apuracao-cards'
import BrazilMap from '@/components/ui/brazil-map'
import { leaderColors, PARTY_COLORS, type Leader, type Summary } from '@/resumo-mapa'
import { canHaveSecondRound, states } from '@/data'
import type { Municipio } from '@/municipios'
import type { ResultRow, ResultSnapshot } from '@/types'
import { ShareWhatsApp } from '@/components/ui/share-whatsapp'
import './comparativo-2022.css'

// Seletor de cidade (busca + mapa da UF) só carrega quando alguém abre.
const CityPicker = lazy(() => import('./city-picker'))

// Resultado final de 2022 (dados abertos do TSE), servido pelo server/web.mjs
// em /data/2022/{cargo}/t{turno}/... (ver work/tse2022/out/README.md). Esses
// arquivos não mudam mais: um pedido por arquivo, guardado em memória.
const CARGO_DIR: Record<string, string> = {
  Presidente: 'presidente',
  Governador: 'governador',
  Senador: 'senador',
  'Deputado federal': 'deputado-federal',
  'Deputado estadual': 'deputado-estadual',
  'Deputado distrital': 'deputado-distrital',
}
const UFS = states.filter((item) => item !== 'Brasil')

type Totais2022 = { aptos: number; comparecimento: number; abstencoes: number; secoes: number; validos: number; brancos: number; nulos: number; anulados: number; legenda?: number }
type Candidato2022 = { sq: string; numero: number; nome: string; partido: string; agremiacao?: string; votos: number; pct_validos: number; situacao: string }
type Recorte2022 = { ano: number; turno: number; cargo: string; uf: string; cd_municipio?: string; nm_municipio?: string; totais: Totais2022; candidatos: Candidato2022[] }
// Deputados por município vêm compactos: [[sq, votos]], nomes no arquivo da UF.
type MunicipioCompacto = { cd_municipio: string; nm_municipio: string; totais: Totais2022; candidatos: Array<[string, number]> }
type ResumoBr2022 = { ufs: Record<string, { lider: Candidato2022 | null; segundo: Candidato2022 | null; validos: number }> }

const jsonCache = new Map<string, Promise<unknown>>()

/** null = arquivo não existe (404 ou outro erro HTTP): "dados indisponíveis". */
function load2022<T>(file: string): Promise<T | null> {
  const cached = jsonCache.get(file)
  if (cached) return cached as Promise<T | null>
  const promise = fetch(`/data/2022/${file}`)
    .then((response) => (response.ok ? (response.json() as Promise<T>) : null))
    .catch((error) => {
      jsonCache.delete(file)
      throw error
    })
  jsonCache.set(file, promise)
  return promise
}

type Loaded<T> = { key: string; data: T | null; error: boolean }

/** Carrega os arquivos de 2022 de `key` (null = nada a carregar). */
function useLoad<T>(key: string | null, loader: () => Promise<T | null>): { data: T | null; loading: boolean; error: boolean } {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    loader()
      .then((data) => alive && setLoaded({ key, data, error: false }))
      .catch(() => alive && setLoaded({ key, data: null, error: true }))
    return () => {
      alive = false
    }
    // O loader depende só do que já está em `key`.
  }, [key])
  if (!key) return { data: null, loading: false, error: false }
  if (!loaded || loaded.key !== key) return { data: null, loading: true, error: false }
  return { data: loaded.data, loading: false, error: loaded.error }
}

const isDeputado = (office: string) => office.startsWith('Deputado')

function rowFrom(candidato: Candidato2022, pct: number): ResultRow {
  return { candidateId: candidato.sq, votes: candidato.votos, share: pct, name: candidato.nome, number: String(candidato.numero), party: candidato.partido, status: candidato.situacao }
}

/** Recorte de 2022 já em linhas da apuração (maior votação primeiro). */
async function loadRecorte(office: string, round: 1 | 2, uf: string, cityCd: string | null): Promise<Recorte2022 | null> {
  const dir = CARGO_DIR[office]
  if (!dir) return null
  if (uf === 'Brasil') return load2022<Recorte2022>(`${dir}/t${round}/br.json`)
  const ufFile = `${dir}/t${round}/${uf.toLowerCase()}.json`
  if (!cityCd) return load2022<Recorte2022>(ufFile)
  // Um arquivo por município (scripts/split-2022.py), não o da UF inteira.
  const [item, ufRecorte] = await Promise.all([load2022<Recorte2022 | MunicipioCompacto>(`${dir}/t${round}/municipios/${uf.toLowerCase()}/${cityCd}.json`), isDeputado(office) ? load2022<Recorte2022>(ufFile) : Promise.resolve(null)])
  if (!item) return null
  const compact = item.candidatos.length > 0 && Array.isArray(item.candidatos[0])
  if (!compact) return item as Recorte2022
  if (!ufRecorte) return null
  // Nome, número, partido e situação vêm do arquivo da UF, ligados por sq; o %
  // por município é votos / válidos do município (README dos dados de 2022).
  const bySq = new Map(ufRecorte.candidatos.map((candidato) => [candidato.sq, candidato]))
  const validos = item.totais.validos
  const candidatos = (item as MunicipioCompacto).candidatos.flatMap(([sq, votos]) => {
    const base = bySq.get(sq)
    return base ? [{ ...base, votos, pct_validos: validos > 0 ? Math.round((votos / validos) * 10000) / 100 : 0 }] : []
  })
  return { ano: 2022, turno: round, cargo: office, uf, cd_municipio: item.cd_municipio, nm_municipio: item.nm_municipio, totais: item.totais, candidatos }
}

const leaderOf = (candidato: Candidato2022 | null | undefined): Leader | null =>
  candidato ? { name: candidato.nome, party: candidato.partido, number: String(candidato.numero), votes: candidato.votos, share: String(candidato.pct_validos), status: candidato.situacao } : null

/** Quem teve mais votos em cada UF em 2022, no formato do resumo do mapa da
 * apuração (para reaproveitar leaderColors). Deputados: sem mapa colorido. */
async function loadMapa(office: string, round: 1 | 2): Promise<Summary | null> {
  if (office !== 'Presidente' && office !== 'Governador' && office !== 'Senador') return null
  // Presidente: mapa.json (scripts/split-2022.py), mesmo formato do br.json de
  // Governador/Senador, 1 pedido em vez de 27.
  const resumo = await load2022<ResumoBr2022>(`${CARGO_DIR[office]}/t${round}/${office === 'Presidente' ? 'mapa' : 'br'}.json`)
  if (!resumo?.ufs) return null
  const statesSummary: Summary['states'] = {}
  for (const [uf, value] of Object.entries(resumo.ufs)) {
    if (value.lider) statesSummary[uf] = { sectionsPct: null, updatedAt: null, leader: leaderOf(value.lider), second: leaderOf(value.segundo) }
  }
  return { generatedAt: '2022', states: statesSummary }
}

const intFormat = new Intl.NumberFormat('pt-BR')
const officeLabel = (office: string) => (office === 'Deputado distrital' ? 'Deputado Distrital' : office)
const TOP_DEPUTADOS = 10
const TOP_OUTROS = 12

export type Live2026 = {
  /** Snapshot oficial deste recorte (mesmo do App/apuração) ou null. */
  snapshot: ResultSnapshot | null
  rows: ResultRow[]
  status: ResultSnapshot['status']
  statusWord: string
  syncLabel: string
  syncDetail: string
}

type Props = {
  uf: string
  ufName?: string
  capital?: string
  city: Municipio | null
  cityName: string | null
  citySlug: string | null
  cityNotFound: boolean
  office: string
  offices: string[]
  round: 1 | 2
  onRound: (round: 1 | 2) => void
  live: Live2026
  photoById: Map<string, string | undefined>
  municipios: Municipio[] | null
  municipiosError: boolean
  cityPickerOpen: boolean
  onToggleCityPicker: () => void
  onCloseCityPicker: () => void
  onSelectOffice: (office: string) => void
  onSelectUf: (uf: string) => void
  onOpenCity: (municipio: Municipio) => void
  onBack: () => void
  /** Texto do botão Compartilhar (mesmo do botão flutuante do App). */
  shareText?: string
}

function CandidateList({ rows, deputado, photoById, label }: { rows: ResultRow[]; deputado: boolean; photoById?: Map<string, string | undefined>; label: string }) {
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const q = search.trim().toLocaleLowerCase('pt-BR')
  const filtered = q ? rows.filter((row) => `${row.name ?? ''} ${row.party ?? ''} ${row.number ?? ''}`.toLocaleLowerCase('pt-BR').includes(q)) : rows
  const limit = deputado ? TOP_DEPUTADOS : TOP_OUTROS
  const visible = showAll || q ? filtered : filtered.slice(0, limit)
  return (
    <>
      {deputado && (
        <div className="search-wrap">
          <span aria-hidden="true">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, partido ou número" aria-label={`Buscar candidato em ${label}`} />
        </div>
      )}
      <ol className="apc-list cmp-list">
        {visible.map((row, index) => <ApuracaoRow key={`${row.candidateId}-${index}`} row={row} photo={photoById?.get(row.candidateId)} leader={index === 0 && !q} />)}
        {visible.length === 0 && <p className="empty">Nenhuma candidatura encontrada neste recorte.</p>}
      </ol>
      {!q && filtered.length > limit && (
        <button type="button" className="cmp-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Mostrar menos' : `Ver todos (${intFormat.format(filtered.length)})`}
        </button>
      )}
    </>
  )
}

export default function Comparativo2022({ uf, ufName, capital, city, cityName, citySlug, cityNotFound, office, offices, round, onRound, live, photoById, municipios, municipiosError, cityPickerOpen, onToggleCityPicker, onCloseCityPicker, onSelectOffice, onSelectUf, onOpenCity, onBack, shareText }: Props) {
  const federal = uf === 'Brasil'
  const deputado = isDeputado(office)
  const cityCd = city?.cd ?? null
  // Cidade da URL ainda carregando (ou inexistente): não mostra o recorte da UF.
  const recorteKey = citySlug && !cityCd ? null : `${office}|${round}|${uf}|${cityCd ?? ''}`
  const recorte = useLoad(recorteKey, () => loadRecorte(office, round, uf, cityCd))
  const mapKey = citySlug ? null : `${office}|${round}`
  const mapa = useLoad(mapKey, () => loadMapa(office, round))
  const leader = useMemo(() => leaderColors(mapa.data, office === 'Presidente' ? 'candidate' : 'party', PARTY_COLORS), [mapa.data, office])

  const rows2022 = useMemo(() => {
    if (!recorte.data) return []
    return [...recorte.data.candidatos].sort((a, b) => b.votos - a.votos).map((candidato) => rowFrom(candidato, candidato.pct_validos))
  }, [recorte.data])
  const totals2022 = recorte.data
    ? { totals: { turnout: { count: recorte.data.totais.comparecimento }, valid: { count: recorte.data.totais.validos }, blank: { count: recorte.data.totais.brancos }, nulls: { count: recorte.data.totais.nulos }, abstention: { count: recorte.data.totais.abstencoes } } }
    : null
  const eleitos = deputado ? rows2022.filter((row) => /^eleit/i.test(row.status ?? '')).length : 0
  const sentence = deputado ? (eleitos > 0 && !cityCd ? `${intFormat.format(eleitos)} candidaturas eleitas segundo o TSE.` : null) : statusSentence(rows2022)

  const placeLabel = cityName ? `${cityName} (${uf})` : federal ? 'Brasil' : ufName ?? uf
  const title = placeTitle(uf, ufName, cityName)
  const secondRound = canHaveSecondRound(office)
  const missingText = office === 'Governador' && round === 2 ? `Em 2022 não houve 2º turno de Governador ${title.replace(/^Eleições /, '')}.` : 'Dados de 2022 indisponíveis para este recorte.'
  const live2026Rows = live.snapshot ? live.rows : []

  return (
    <div className="cmp">
      <section className="state-header-block cmp-head" aria-label="Recorte do comparativo">
        <div className={`state-header${citySlug ? ' state-header--city' : ''}`}>
          <span className="state-header__badge">{federal ? 'BR' : uf}</span>
          <div className="state-header__info">
            <div className="state-header__title-row">
              <h2 id="cmp-title" tabIndex={-1}>{citySlug ? cityName ?? (cityNotFound ? 'Cidade não encontrada' : 'Carregando cidade…') : placeLabel}</h2>
              <span className="state-header__chip">2022 x 2026</span>
            </div>
            <p className="state-header__meta">
              {cityNotFound
                ? `Não achamos esse município na lista de ${ufName ?? uf}. Volte e escolha pela busca.`
                : citySlug
                  ? `Município · ${ufName ?? uf}${city?.capital ? ' · capital' : ''} · resultado de 2022 ao lado da apuração de 2026`
                  : federal
                    ? 'Presidente no Brasil. Escolha uma UF no mapa para Governador, Senador e Deputados.'
                    : `Capital ${capital ?? ''} · resultado de 2022 ao lado da apuração de 2026`}
            </p>
          </div>
          {citySlug ? (
            <div className="state-header__actions">
              {!cityNotFound && <ShareWhatsApp variant="inline" text={shareText} />}
              <button type="button" className="state-header__back" onClick={onBack}>
                <span aria-hidden="true">←</span> Voltar para {uf}
              </button>
            </div>
          ) : (
            <>
            <div className="state-switcher">
              <label htmlFor="cmp-state-select">{federal ? 'Escolher estado' : `Trocar Estado (${uf})`}</label>
              <select id="cmp-state-select" className="state-switcher__select" value={federal ? '' : uf} onChange={(event) => onSelectUf(event.target.value)}>
                <option value="">Brasil</option>
                {UFS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="state-header__actions">
              <ShareWhatsApp variant="inline" text={shareText} />
            </div>
            </>
          )}
        </div>
        <div className="office-pill-switcher" role="group" aria-label="Cargo do comparativo">
          {offices.map((item) => (
            <button key={item} type="button" className={`office-pill${office === item ? ' is-active' : ''}`} aria-pressed={office === item} onClick={() => onSelectOffice(item)}>
              {officeLabel(item)}
            </button>
          ))}
          {!federal && (
            <button type="button" className={`office-pill office-pill--city${cityPickerOpen ? ' is-open' : ''}`} aria-expanded={cityPickerOpen} aria-controls="cmp-city-picker" onClick={onToggleCityPicker}>
              {citySlug ? 'Trocar cidade' : 'Cidade'}
            </button>
          )}
        </div>
        {!federal && ufName && cityPickerOpen && (
          <div id="cmp-city-picker">
            <Suspense fallback={<p className="state-header__empty">Carregando seletor de cidades…</p>}>
              <CityPicker uf={uf} ufName={ufName} municipios={municipios} loadError={municipiosError} activeCd={city?.cd} onSelect={onOpenCity} onClose={onCloseCityPicker} />
            </Suspense>
          </div>
        )}
        {secondRound && <RoundTabs round={round} onChange={onRound} />}
      </section>

      {!citySlug && (
        <section className="map-section cmp-map" aria-labelledby="cmp-map-title">
          <div className="map-section__heading">
            <div><p className="eyebrow">mapa de 2022 · {round}º turno</p><h2 id="cmp-map-title">{deputado ? 'Escolha uma UF.' : office === 'Presidente' ? 'Quem venceu em cada UF em 2022.' : `${officeLabel(office)}: partido mais votado em cada UF em 2022.`}</h2></div>
            <p>{deputado ? 'O mapa colorido vale para Presidente, Governador e Senador. Clique numa UF para abrir o comparativo dela.' : 'Clique numa UF para abrir o comparativo dela. UF sem disputa no turno fica em cinza.'}</p>
          </div>
          <BrazilMap activeUf={federal ? undefined : uf} onSelect={(item) => onSelectUf(item.uf)} fillByUf={leader.fillByUf} grayscale hideDetailsPanel ariaLabel={`Mapa do Brasil de 2022, ${officeLabel(office)}`} />
          {mapa.loading && !deputado && <p className="state-header__empty">Carregando mapa de 2022…</p>}
          {!mapa.loading && !deputado && leader.legend.length === 0 && <p className="state-header__empty">Mapa de 2022 indisponível para este cargo e turno.</p>}
          {leader.legend.length > 0 && (
            <ul className="map-leader-legend" aria-label={`Mais votado de ${officeLabel(office)} em cada UF em 2022`}>
              {leader.legend.map((item) => (
                <li key={item.key}><i style={{ background: item.color }} aria-hidden="true" /><span><strong>{office === 'Presidente' ? `${item.leader.name} (${item.leader.party})` : item.leader.party}</strong> mais votado em {item.ufs.length} {item.ufs.length === 1 ? 'UF' : 'UFs'}: {item.ufs.join(', ')}</span></li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="content-grid cmp-grid" aria-label={`Comparativo de ${officeLabel(office)} ${title.replace(/^Eleições /, '')}`}>
        <article className="panel apc-card cmp-card" aria-labelledby="cmp-2022-title">
          <header className="apc-header">
            <div className="apc-header__top">
              <h2 className="apc-header__title" id="cmp-2022-title">2022</h2>
              <p className="apc-header__share cmp-final">resultado final</p>
            </div>
            <div className="apc-header__line" aria-hidden="true"><i style={{ width: recorte.data ? '100%' : '0%' }} /></div>
            <p className="apc-header__meta">{title} · {round}º turno</p>
            <p className="apc-header__meta apc-header__meta--small">{recorte.data ? <>seções: <strong>{intFormat.format(recorte.data.totais.secoes)}</strong> · eleitorado apto: {intFormat.format(recorte.data.totais.aptos)}</> : 'seções: N/D'}</p>
            {sentence && <p className="apc-header__sentence">{sentence}</p>}
          </header>
          <div className="apc-office">
            <h3>{officeLabel(office)}</h3>
            <span className="result-count">{rows2022.length > 0 ? `${intFormat.format(rows2022.length)} candidaturas · TSE 2022` : 'TSE 2022'}</span>
          </div>
          {recorte.loading ? (
            <p className="empty">Carregando dados de 2022…</p>
          ) : recorte.error ? (
            <p className="empty">Não foi possível carregar os dados de 2022. Tente de novo em instantes.</p>
          ) : !recorteKey ? (
            <p className="empty">{cityNotFound ? 'Cidade não encontrada.' : 'Carregando cidade…'}</p>
          ) : rows2022.length === 0 ? (
            <p className="empty">{missingText}</p>
          ) : (
            <CandidateList key={recorteKey} rows={rows2022} deputado={deputado} label="2022" />
          )}
          <ApuracaoTotals snapshot={totals2022} />
          <p className="source-note">Fonte: TSE, dados abertos da eleição de 2022 (resultado final, votos nominais). Percentuais sobre votos válidos.</p>
        </article>

        <article className="panel apc-card cmp-card" aria-label="Apuração de 2026">
          <ApuracaoHeader title="2026" snapshot={live.snapshot} rows={live2026Rows} />
          <div className="apc-office">
            <h3>{officeLabel(office)}</h3>
            <span className={`state-header__chip is-${live.status}`}>{live.statusWord}</span>
          </div>
          {live2026Rows.length > 0 ? (
            <CandidateList key={`2026-${recorteKey ?? ''}`} rows={live2026Rows} deputado={deputado} photoById={photoById} label="2026" />
          ) : (
            <div className="cmp-wait" role="note">
              <p>A apuração de 2026 começa depois do fim da votação, às 17h (horário de Brasília). Os números de {placeLabel} aparecem aqui assim que o TSE publicar o primeiro boletim.</p>
              <p className="cmp-wait__sync">{live.syncLabel}. {live.syncDetail}</p>
            </div>
          )}
          <ApuracaoTotals snapshot={live.snapshot} />
          <p className="source-note">Apuração de 2026: mesma fonte e cadência da aba de apuração (dados oficiais do TSE).</p>
        </article>
      </section>
    </div>
  )
}
