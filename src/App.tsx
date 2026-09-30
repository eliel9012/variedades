import { useEffect, useMemo, useState } from 'react'
import StatsBento from '@/components/ui/stats-bento'
import BrazilMap from '@/components/ui/brazil-map'
import type { BrazilState } from './data/brazil-states'
import { candidateSeed, canHaveSecondRound, initialSnapshot, officeCodes, offices, statesForOffice } from './data'
import { fetchTSESnapshot } from './tse-results'
import type { Candidate, ResultSnapshot, SyncMeta } from './types'

const format = new Intl.NumberFormat('pt-BR')
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const POLL_MS = 15_000

function readableSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('aborted') || message.includes('Timeout')) return 'tempo esgotado'
  if (message.includes('TSE 404')) return 'endpoint ainda não publicado'
  if (message.includes('election unavailable')) return 'configuração 2026 ainda não publicada'
  return 'TSE indisponível'
}

function App() {
  const [round, setRound] = useState<1 | 2>(1)
  const [state, setState] = useState('Brasil')
  const [office, setOffice] = useState('Presidente')
  const [snapshot, setSnapshot] = useState<ResultSnapshot>(initialSnapshot)
  const [candidates, setCandidates] = useState<Candidate[]>(candidateSeed)
  const [online, setOnline] = useState(navigator.onLine)
  const [search, setSearch] = useState('')
  const [syncNonce, setSyncNonce] = useState(0)
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ phase: 'idle', lastCheckedAt: null, lastOfficialAt: null, nextPollAt: null, error: null, attempt: 0 })
  const availableStates = statesForOffice(office)
  const secondRoundAvailable = canHaveSecondRound(office)
  const activeRound: 1 | 2 = secondRoundAvailable ? round : 1

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    let alive = true
    let timer: number | undefined
    let controller: AbortController | undefined
    let attempt = 0

    const poll = async () => {
      if (!navigator.onLine) {
        setSyncMeta((current) => ({ ...current, phase: 'offline', nextPollAt: null, error: null }))
        return
      }
      const checkedAt = new Date().toISOString()
      controller = new AbortController()
      setSyncMeta((current) => ({ ...current, phase: 'syncing', lastCheckedAt: checkedAt, error: null, attempt }))
      try {
        const next = await fetchTSESnapshot(activeRound, state === 'Brasil' ? 'BR' : state, office, controller.signal)
        if (!alive) return
        setSnapshot(next)
        if (next.status === 'official') localStorage.setItem('apura-brasil:last-snapshot', JSON.stringify(next))
        attempt = 0
        const nextPollAt = new Date(Date.now() + POLL_MS).toISOString()
        setSyncMeta((current) => ({ ...current, phase: next.status === 'official' ? 'live' : 'waiting', lastCheckedAt: checkedAt, lastOfficialAt: next.status === 'official' ? next.updatedAt : current.lastOfficialAt, nextPollAt, error: null, attempt: 0 }))
        timer = window.setTimeout(poll, POLL_MS)
      } catch (error) {
        if (!alive) return
        attempt += 1
        const delay = Math.min(120_000, POLL_MS * 2 ** Math.min(attempt, 3))
        const nextPollAt = new Date(Date.now() + delay).toISOString()
        setSyncMeta((current) => ({ ...current, phase: navigator.onLine ? 'retrying' : 'offline', lastCheckedAt: checkedAt, nextPollAt, error: readableSyncError(error), attempt }))
        timer = window.setTimeout(poll, delay)
      }
    }

    poll()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
      controller?.abort()
    }
  }, [activeRound, office, online, state, syncNonce])

  useEffect(() => {
    fetch('/data/candidates.json')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('candidates unavailable'))))
      .then((data: Candidate[]) => data.length && setCandidates(data))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const cache = localStorage.getItem('apura-brasil:last-snapshot')
    if (cache) {
      try {
        setSnapshot(JSON.parse(cache) as ResultSnapshot)
      } catch {
        localStorage.removeItem('apura-brasil:last-snapshot')
      }
    }
    fetch('/data/results/latest.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('results unavailable'))))
      .then((data: ResultSnapshot) => {
        if (data.status === 'official' || !cache) {
          setSnapshot(data)
          localStorage.setItem('apura-brasil:last-snapshot', JSON.stringify(data))
        }
      })
      .catch(() => undefined)
  }, [])

  const visibleCandidates = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR')
    return candidates
      .filter((candidate) => candidate.officeCode === officeCodes[office as keyof typeof officeCodes])
      .filter((candidate) => state === 'Brasil' || candidate.uf === state)
      .filter((candidate) => !q || `${candidate.ballotName} ${candidate.party} ${candidate.number}`.toLocaleLowerCase('pt-BR').includes(q))
      .slice(0, 8)
  }, [candidates, office, search, state])

  const selectedCandidateCount = useMemo(() => candidates.filter((candidate) => candidate.officeCode === officeCodes[office as keyof typeof officeCodes]).filter((candidate) => state === 'Brasil' || candidate.uf === state).length, [candidates, office, state])

  const sync = () => setSyncNonce((value) => value + 1)
  const changeOffice = (nextOffice: string) => {
    setOffice(nextOffice)
    if (!canHaveSecondRound(nextOffice)) setRound(1)
    const nextStates = statesForOffice(nextOffice)
    if (!nextStates.includes(state)) setState(nextStates[0])
  }
  const selectMapState = (nextState: BrazilState) => {
    setState(nextState.uf)
    if (office === 'Presidente' || (office === 'Deputado distrital' && nextState.uf !== 'DF')) {
      setOffice('Governador')
      setRound(1)
    }
  }

  const coverage = snapshot.totalSections ? Math.round((snapshot.countedSections / snapshot.totalSections) * 100) : 0
  const syncLabel = syncMeta.phase === 'live' ? 'TSE ao vivo' : syncMeta.phase === 'syncing' ? 'consultando TSE' : syncMeta.phase === 'retrying' ? 'tentando novamente' : syncMeta.phase === 'offline' ? 'offline · cache local' : 'aguardando TSE'
  const lastChecked = syncMeta.lastCheckedAt ? timeFormat.format(new Date(syncMeta.lastCheckedAt)) : '—'
  const syncDetail = syncMeta.error ? `Falha: ${syncMeta.error}.` : syncMeta.nextPollAt ? `Próxima consulta: ${timeFormat.format(new Date(syncMeta.nextPollAt))}.` : 'A leitura começa no primeiro boletim oficial.'

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Apura Brasil, início">
          <span className="brand-mark">AB</span>
          <span><strong>apura</strong><em>brasil</em></span>
        </a>
        <div className="topbar-meta">
          <span className={`connection ${online ? 'is-online' : 'is-offline'}`}><i />{online ? 'conectado' : 'offline'}</span>
          <span className="edition">Eleições 2026</span>
        </div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">central de apuração · TSE</p>
          <h1>O país<br /><span>conta junto.</span></h1>
          <p className="hero-lede">Resultado oficial, contexto local e sinal claro de atualização — mesmo quando a rede cai.</p>
          <div className="hero-actions">
            <button className="primary-button" onClick={sync}>Atualizar dados <span>↗</span></button>
            <span className="hero-note">1º turno · 04 out 2026</span>
          </div>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit-ring ring-one" />
          <div className="orbit-ring ring-two" />
          <div className="orbit-center"><span>BR</span><small>2026</small></div>
          <div className="orbit-dot dot-a" /><div className="orbit-dot dot-b" /><div className="orbit-dot dot-c" />
        </div>
      </section>

      <section className="control-strip" aria-label="Filtros de apuração">
        <div className="control-block"><label htmlFor="round">turno</label><select id="round" value={activeRound} onChange={(event) => { const nextRound = Number(event.target.value) as 1 | 2; setRound(nextRound === 2 && !secondRoundAvailable ? 1 : nextRound) }}><option value="1">1º turno</option>{secondRoundAvailable && <option value="2">2º turno</option>}</select></div>
        <div className="control-block"><label htmlFor="state">território</label><select id="state" value={state} onChange={(event) => setState(event.target.value)}>{availableStates.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div className="control-block"><label htmlFor="office">cargo</label><select id="office" value={office} onChange={(event) => changeOffice(event.target.value)}>{offices.map((item) => <option key={item}>{item}</option>)}</select></div>
        <button className="filter-button" onClick={sync}>Aplicar <span aria-hidden="true">⌁</span></button>
      </section>

      <section className="map-section" aria-labelledby="map-title">
        <div className="map-section__heading"><div><p className="eyebrow">território eleitoral</p><h2 id="map-title">Escolha uma UF. Veja a disputa local.</h2></div><p>Mapa, menu e candidatos trabalham juntos. No DF, o cargo local é deputado distrital.</p></div>
        <BrazilMap activeUf={state === 'Brasil' ? undefined : state} selectedOffice={office} candidateCount={selectedCandidateCount} onSelect={selectMapState} onSelectOffice={changeOffice} />
      </section>

      <StatsBento office={office} scope={state} round={activeRound} coverage={coverage} countedSections={snapshot.countedSections} totalSections={snapshot.totalSections} totalVotes={snapshot.totalVotes} candidateCount={candidates.length} syncLabel={syncLabel} lastChecked={lastChecked} syncDetail={syncDetail} />

      <section className="content-grid">
        <article className="panel leaderboard-panel">
          <div className="panel-heading"><div><p className="eyebrow">candidaturas</p><h2>Quem está na disputa</h2></div><span className="result-count">{format.format(selectedCandidateCount)} no recorte · {format.format(candidates.length)} no snapshot</span></div>
          <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, partido ou número" aria-label="Buscar candidato" /></div>
          <div className="candidate-list">{visibleCandidates.map((candidate) => <div className="candidate-row" key={candidate.sqCandidate}><div className="avatar">{candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidate.ballotName.slice(0, 1)}</span>}</div><div className="candidate-info"><strong>{candidate.ballotName}</strong><span>{candidate.party} · nº {candidate.number}</span></div><span className="candidate-state">{candidate.uf}</span><span className="candidate-status">{candidate.situation === '#NE' ? 'cadastro TSE' : candidate.situation}</span></div>)}{visibleCandidates.length === 0 && <p className="empty">Nenhuma candidatura encontrada neste recorte.</p>}</div>
          <p className="source-note">Candidaturas e fotos: TSE · snapshot local. 2º turno só existe para presidente/governador; senador e deputados ficam no 1º.</p>
        </article>
        <aside className="panel explain-panel"><p className="eyebrow">leia antes</p><h2>Apuração sem ruído.</h2><p>Os números só aparecem quando o TSE publica boletim oficial. Enquanto isso, este painel mostra a base de candidatos e mantém o último snapshot íntegro no aparelho.</p><div className="legend"><div><span className="legend-dot official" />oficial</div><div><span className="legend-dot cached" />salvo no aparelho</div><div><span className="legend-dot waiting" />aguardando publicação</div></div><button className="text-button" onClick={() => window.alert('Fonte: Portal de Dados Abertos do TSE e resultados.tse.jus.br')}>Ver origem dos dados <span>↗</span></button></aside>
      </section>

      <footer><span>APURA BRASIL / 2026</span><span>Dados públicos · feito para continuar funcionando</span><span>Polling TSE · 15s · cache offline</span></footer>
    </main>
  )
}

export default App
