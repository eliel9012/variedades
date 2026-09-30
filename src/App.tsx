import { useEffect, useMemo, useState } from 'react'
import { candidateSeed, initialSnapshot, offices, states } from './data'
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
        const next = await fetchTSESnapshot(round, state === 'Brasil' ? 'BR' : state, office, controller.signal)
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
  }, [office, online, round, state, syncNonce])

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
      .filter((candidate) => candidate.office === office.toUpperCase() || (office === 'Presidente' && candidate.officeCode === 1))
      .filter((candidate) => state === 'Brasil' || candidate.uf === state)
      .filter((candidate) => !q || `${candidate.ballotName} ${candidate.party} ${candidate.number}`.toLocaleLowerCase('pt-BR').includes(q))
      .slice(0, 8)
  }, [candidates, office, search, state])

  const sync = () => setSyncNonce((value) => value + 1)

  const coverage = snapshot.totalSections ? Math.round((snapshot.countedSections / snapshot.totalSections) * 100) : 0
  const syncLabel = syncMeta.phase === 'live' ? 'TSE ao vivo' : syncMeta.phase === 'syncing' ? 'consultando TSE' : syncMeta.phase === 'retrying' ? 'tentando novamente' : syncMeta.phase === 'offline' ? 'offline · cache local' : 'aguardando TSE'
  const lastChecked = syncMeta.lastCheckedAt ? timeFormat.format(new Date(syncMeta.lastCheckedAt)) : '—'

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
        <div className="control-block"><label htmlFor="round">turno</label><select id="round" value={round} onChange={(event) => setRound(Number(event.target.value) as 1 | 2)}><option value="1">1º turno</option><option value="2">2º turno</option></select></div>
        <div className="control-block"><label htmlFor="state">território</label><select id="state" value={state} onChange={(event) => setState(event.target.value)}>{states.map((item) => <option key={item}>{item}</option>)}</select></div>
        <div className="control-block"><label htmlFor="office">cargo</label><select id="office" value={office} onChange={(event) => setOffice(event.target.value)}>{offices.map((item) => <option key={item}>{item}</option>)}</select></div>
        <button className="filter-button" onClick={sync}>Aplicar <span aria-hidden="true">⌁</span></button>
      </section>

      <section className="status-grid">
        <article className="status-card status-card-main">
          <div className="card-heading"><div><p className="eyebrow">placar nacional</p><h2>{office} <span>· {state}</span></h2></div><span className="round-chip">{round}º turno</span></div>
          <div className="status-number">{snapshot.totalVotes ? format.format(snapshot.totalVotes) : '—'}</div>
          <div className="status-caption">votos contabilizados</div>
          <div className="coverage-row"><span>seções apuradas</span><strong>{snapshot.countedSections ? `${format.format(snapshot.countedSections)} de ${format.format(snapshot.totalSections)}` : 'aguardando TSE'}</strong></div>
          <div className="progress-track"><span style={{ width: `${coverage}%` }} /></div>
          <div className="status-foot"><span className={`live-dot ${snapshot.status === 'official' ? 'is-live' : ''}`} />{syncLabel} · última consulta {lastChecked}</div>
        </article>
        <article className="status-card radar-card"><div className="card-heading"><div><p className="eyebrow">última leitura</p><h2>ritmo da apuração</h2></div><span className="radar-spark">↗</span></div><div className="mini-chart"><span style={{ height: '22%' }} /><span style={{ height: '34%' }} /><span style={{ height: '31%' }} /><span style={{ height: '48%' }} /><span style={{ height: '44%' }} /><span style={{ height: '70%' }} /><span style={{ height: '61%' }} /><span style={{ height: '86%' }} /></div><p className="muted">Consulta automática a cada 15s.<br />{syncMeta.error ? `Falha: ${syncMeta.error}.` : syncMeta.nextPollAt ? `Próxima consulta: ${timeFormat.format(new Date(syncMeta.nextPollAt))}.` : 'A leitura começa no primeiro boletim oficial.'}</p></article>
      </section>

      <section className="content-grid">
        <article className="panel leaderboard-panel">
          <div className="panel-heading"><div><p className="eyebrow">candidaturas</p><h2>Quem está na disputa</h2></div><span className="result-count">{format.format(candidates.length)} nomes no snapshot</span></div>
          <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, partido ou número" aria-label="Buscar candidato" /></div>
          <div className="candidate-list">{visibleCandidates.map((candidate) => <div className="candidate-row" key={candidate.sqCandidate}><div className="avatar">{candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidate.ballotName.slice(0, 1)}</span>}</div><div className="candidate-info"><strong>{candidate.ballotName}</strong><span>{candidate.party} · nº {candidate.number}</span></div><span className="candidate-state">{candidate.uf}</span><span className="candidate-status">{candidate.situation === '#NE' ? 'cadastro TSE' : candidate.situation}</span></div>)}{visibleCandidates.length === 0 && <p className="empty">Nenhuma candidatura encontrada neste recorte.</p>}</div>
          <p className="source-note">Candidaturas e fotos: TSE · snapshot de 30 set 2026. Dados pessoais sensíveis ficam fora da interface.</p>
        </article>
        <aside className="panel explain-panel"><p className="eyebrow">leia antes</p><h2>Apuração sem ruído.</h2><p>Os números só aparecem quando o TSE publica boletim oficial. Enquanto isso, este painel mostra a base de candidatos e mantém o último snapshot íntegro no aparelho.</p><div className="legend"><div><span className="legend-dot official" />oficial</div><div><span className="legend-dot cached" />salvo no aparelho</div><div><span className="legend-dot waiting" />aguardando publicação</div></div><button className="text-button" onClick={() => window.alert('Fonte: Portal de Dados Abertos do TSE e resultados.tse.jus.br')}>Ver origem dos dados <span>↗</span></button></aside>
      </section>

      <footer><span>APURA BRASIL / 2026</span><span>Dados públicos · feito para continuar funcionando</span><span>Polling TSE · 15s · cache offline</span></footer>
    </main>
  )
}

export default App
