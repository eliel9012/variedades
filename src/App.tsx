import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import StatsBento from '@/components/ui/stats-bento'
import BrazilMap from '@/components/ui/brazil-map'
import StateCandidatesPanel from '@/components/ui/state-candidates-panel'
import ComposicaoParlamentar from '@/components/ui/composicao-parlamentar'
import EstatisticasAbstencao from '@/components/ui/estatisticas-abstencao'
import PesquisasTracker from '@/components/ui/pesquisas-tracker'
import CenariosIA from '@/components/ui/cenarios-ia'
import CookieBanner from '@/components/ui/cookie-banner'
import AdSlot from '@/components/ui/ad-slot'
import FavoriteButton from '@/components/ui/favorite-button'
import { useFavoriteCandidates } from './hooks/use-favorites'
import { BRAZIL_STATE_BY_UF, type BrazilState } from './data/brazil-states'
import { candidateSeed, canHaveSecondRound, initialSnapshot, officeCodes, statesForOffice } from './data'
import { fetchTSESnapshot } from './tse-results'
import { navigate, parseUfSegment, ufSegment, useRoute } from './router'
import type { Candidate, ResultSnapshot, SyncMeta, SyncPhase } from './types'

type ViewTab = 'presidente' | 'governadorSenador' | 'composicaoParlamentar' | 'pesquisas' | 'estatisticas' | 'cenarios'
const TAB_ORDER: ViewTab[] = ['presidente', 'governadorSenador', 'composicaoParlamentar', 'pesquisas', 'estatisticas', 'cenarios']

// Antes do 1º turno (4 out 2026), a home abre em Pesquisas, que é o que tem
// dado novo pra mostrar. No dia da eleição em diante (1º e 2º turno), abre
// direto na apuração, que passa a ser o conteúdo relevante. Horário de
// Brasília (-03:00) pra não trocar ~3h adiantado por causa do UTC.
const ELECTION_DAY_UTC_MS = Date.parse('2026-10-04T00:00:00-03:00')
function getDefaultTab(): ViewTab {
  return Date.now() >= ELECTION_DAY_UTC_MS ? 'governadorSenador' : 'pesquisas'
}

// URL por aba (ver src/router.ts): path é a fonte da verdade pra navegação
// direta/voltar-avançar; os cliques continuam chamando os handlers de
// sempre, que agora também empurram a URL correspondente.
function tabFromPath(pathname: string): ViewTab {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first === 'apuracao') return second === 'presidente' ? 'presidente' : 'governadorSenador'
  if (first === 'composicao-parlamentar') return 'composicaoParlamentar'
  if (first === 'pesquisas') return 'pesquisas'
  if (first === 'estatisticas') return 'estatisticas'
  if (first === 'cenarios') return 'cenarios'
  return getDefaultTab()
}

function ufFromApuracaoPath(pathname: string): string | null {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first !== 'apuracao') return null
  return parseUfSegment(second)
}

function pathForTab(tab: ViewTab, uf?: string): string {
  if (tab === 'presidente') return '/apuracao/presidente'
  if (tab === 'governadorSenador') return uf && uf !== 'Brasil' ? `/apuracao/${ufSegment(uf)}` : '/apuracao'
  if (tab === 'composicaoParlamentar') return '/composicao-parlamentar'
  if (tab === 'pesquisas') return '/pesquisas'
  if (tab === 'estatisticas') return '/estatisticas'
  return '/cenarios'
}

const format = new Intl.NumberFormat('pt-BR')
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// Cadência documentada em docs/sync-protocol.md ("Intervalos" e "Timeout e backoff").
const POLL_MS = 15_000
const STABLE_INTERVAL_MS = 60_000
const BACKGROUND_STABLE_INTERVAL_MS = 5 * 60_000
const STABLE_CYCLES_FOR_SLOWDOWN = 3
const STABLE_DURATION_FOR_BACKGROUND_MS = 5 * 60_000
const BACKOFF_SCHEDULE_MS = [2_000, 4_000, 8_000, 16_000]
const BACKOFF_CEILING_MS = 30_000

function withJitter(delayMs: number, maxJitterRatio: number) {
  return Math.round(delayMs * (1 + Math.random() * maxJitterRatio))
}

// Tabela de backoff de docs/sync-protocol.md: 2s/4s/8s/16s/30s+, com até 20% de jitter.
function computeBackoffDelay(attempt: number) {
  const base = attempt >= 1 && attempt <= BACKOFF_SCHEDULE_MS.length ? BACKOFF_SCHEDULE_MS[attempt - 1] : BACKOFF_CEILING_MS
  return withJitter(base, 0.2)
}

// Intervalo estável de docs/sync-protocol.md: 15s enquanto `waiting`/mudando;
// 60s depois de 3 ciclos oficiais consecutivos sem alteração; 5 minutos se
// estável há mais de 5 minutos e a aba está em segundo plano. Até 10% de jitter.
function computeSteadyIntervalMs(stableCycles: number, stableSinceMs: number | null) {
  if (stableCycles < STABLE_CYCLES_FOR_SLOWDOWN) return withJitter(POLL_MS, 0.1)
  const stableForMs = stableSinceMs != null ? Date.now() - stableSinceMs : 0
  const isBackground = typeof document !== 'undefined' && document.hidden
  if (stableForMs >= STABLE_DURATION_FOR_BACKGROUND_MS && isBackground) return withJitter(BACKGROUND_STABLE_INTERVAL_MS, 0.1)
  return withJitter(STABLE_INTERVAL_MS, 0.1)
}

function readableSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('aborted') || message.includes('Timeout')) return 'tempo esgotado'
  if (message.includes('TSE 404')) return 'endpoint ainda não publicado'
  if (message.includes('election unavailable')) return 'configuração 2026 ainda não publicada'
  return 'TSE indisponível'
}

// docs/data-contract.md + docs/sync-protocol.md ("Validação e deduplicação"):
// estrutura mínima que uma resposta precisa ter antes de ser aplicada.
function isValidSnapshot(value: unknown): value is ResultSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.election !== 'string' || !v.election) return false
  if (typeof v.scope !== 'string' || !v.scope) return false
  if (v.round !== 1 && v.round !== 2) return false
  if (v.updatedAt !== null && (typeof v.updatedAt !== 'string' || Number.isNaN(Date.parse(v.updatedAt)))) return false
  if (!Number.isInteger(v.totalVotes) || (v.totalVotes as number) < 0) return false
  if (!Number.isInteger(v.countedSections) || (v.countedSections as number) < 0) return false
  if (!Number.isInteger(v.totalSections) || (v.totalSections as number) < 0) return false
  if ((v.totalSections as number) > 0 && (v.countedSections as number) > (v.totalSections as number)) return false
  if (!Array.isArray(v.rows)) return false
  if (
    !v.rows.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        typeof (row as Record<string, unknown>).candidateId === 'string' &&
        typeof (row as Record<string, unknown>).votes === 'number' &&
        typeof (row as Record<string, unknown>).share === 'number',
    )
  )
    return false
  if (v.status !== 'official' && v.status !== 'waiting' && v.status !== 'offline') return false
  return true
}

// docs/sync-protocol.md ("Validação e deduplicação"): um snapshot novo só
// substitui o atual se for de outro recorte (mudança explícita do usuário,
// que sempre deve refletir na tela) ou se tiver `updatedAt` mais novo ou igual
// (no-op estável). Uma resposta mais antiga, que pode chegar fora de ordem por
// causa de retries/aborts, nunca sobrescreve um snapshot mais novo já exibido.
function isNewerSnapshot(prev: ResultSnapshot, next: ResultSnapshot) {
  if (prev.election !== next.election || prev.scope !== next.scope || prev.round !== next.round) return true
  if (next.updatedAt == null) return prev.updatedAt == null
  if (prev.updatedAt == null) return true
  const prevTime = Date.parse(prev.updatedAt)
  const nextTime = Date.parse(next.updatedAt)
  if (Number.isNaN(nextTime)) return false
  if (Number.isNaN(prevTime)) return true
  return nextTime >= prevTime
}

// docs/sync-protocol.md ("Comportamento offline"): `offline` é exposto apenas
// na camada de apresentação, nunca gravado no snapshot comparado/persistido.
function presentationStatus(snapshot: ResultSnapshot, phase: SyncPhase): ResultSnapshot['status'] {
  return phase === 'offline' ? 'offline' : snapshot.status
}

function App() {
  const { isFavorite, toggleFavorite } = useFavoriteCandidates()
  const [round, setRound] = useState<1 | 2>(1)
  const [state, setState] = useState('Brasil')
  const [office, setOffice] = useState('Presidente')
  const [activeTab, setActiveTab] = useState<ViewTab>(getDefaultTab)
  const pathname = useRoute()

  // "/" não é uma aba de verdade, redireciona pro caminho canônico da aba
  // padrão (muda sozinha no dia da eleição, ver getDefaultTab).
  useEffect(() => {
    if (pathname === '/') navigate(pathForTab(getDefaultTab()), { replace: true })
  }, [pathname])

  // Entrada via URL direta ou botão voltar/avançar: reconcilia activeTab (e,
  // na aba de apuração por estado, a UF) com o que a URL diz agora. Os
  // cliques (changeTab/selectMapState/changeStateViaSwitcher) já fazem o
  // caminho inverso (estado -> URL) nos próprios handlers, então aqui só
  // mexe quando o valor realmente mudou, pra não brigar com esses handlers.
  useEffect(() => {
    const nextTab = tabFromPath(pathname)
    setActiveTab(nextTab)
    if (nextTab === 'governadorSenador') {
      setState(ufFromApuracaoPath(pathname) ?? 'Brasil')
    } else if (nextTab === 'presidente') {
      setState('Brasil')
    }
  }, [pathname])
  const [panelState, setPanelState] = useState<BrazilState | null>(null)
  const [snapshot, setSnapshot] = useState<ResultSnapshot>(initialSnapshot)
  const [candidates, setCandidates] = useState<Candidate[]>(candidateSeed)
  const [online, setOnline] = useState(navigator.onLine)
  const [search, setSearch] = useState('')
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ phase: 'idle', lastCheckedAt: null, lastOfficialAt: null, nextPollAt: null, error: null, attempt: 0 })
  const availableStates = statesForOffice(office)
  const secondRoundAvailable = canHaveSecondRound(office)
  const activeRound: 1 | 2 = secondRoundAvailable ? round : 1
  // Cargos reachable na aba "Governador & Senador": só Governador/Senador, e
  // Deputado distrital quando a UF selecionada é DF (mesma exceção de
  // selectMapState). Deputado federal/estadual ficam em Composição Parlamentar.
  const governadorSenadorOffices = useMemo(() => {
    const base = state === 'DF' ? ['Governador', 'Senador', 'Deputado distrital'] : ['Governador', 'Senador']
    return activeRound === 2 ? base.filter((item) => canHaveSecondRound(item)) : base
  }, [activeRound, state])
  const selectedBrazilState = state === 'Brasil' ? undefined : BRAZIL_STATE_BY_UF[state]

  // Lido de forma síncrona dentro do laço de polling para comparar contra a
  // resposta recebida sem depender de uma closure desatualizada do state.
  const snapshotRef = useRef(snapshot)
  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  // Rastreia ciclos oficiais consecutivos sem alteração de `updatedAt`, usado
  // para alternar entre o intervalo de 15s e os intervalos estáveis (60s/5min).
  const stableRef = useRef<{ count: number; since: number | null; updatedAt: string | null }>({ count: 0, since: null, updatedAt: null })

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
        if (!isValidSnapshot(next)) throw new Error('TSE resposta inválida')
        if (isNewerSnapshot(snapshotRef.current, next)) {
          setSnapshot(next)
          snapshotRef.current = next
          if (next.status === 'official') localStorage.setItem('apura-brasil:last-snapshot', JSON.stringify(next))
        }
        if (next.status === 'official') {
          stableRef.current =
            stableRef.current.updatedAt === next.updatedAt
              ? { count: stableRef.current.count + 1, since: stableRef.current.since ?? Date.now(), updatedAt: next.updatedAt }
              : { count: 1, since: Date.now(), updatedAt: next.updatedAt }
        } else {
          stableRef.current = { count: 0, since: null, updatedAt: null }
        }
        attempt = 0
        const interval = next.status === 'official' ? computeSteadyIntervalMs(stableRef.current.count, stableRef.current.since) : withJitter(POLL_MS, 0.1)
        const nextPollAt = new Date(Date.now() + interval).toISOString()
        setSyncMeta((current) => ({ ...current, phase: next.status === 'official' ? 'live' : 'waiting', lastCheckedAt: checkedAt, lastOfficialAt: next.status === 'official' ? next.updatedAt : current.lastOfficialAt, nextPollAt, error: null, attempt: 0 }))
        timer = window.setTimeout(poll, interval)
      } catch (error) {
        if (!alive) return
        attempt += 1
        const delay = computeBackoffDelay(attempt)
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
  }, [activeRound, office, online, state])

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

  const changeOffice = (nextOffice: string) => {
    setOffice(nextOffice)
    if (!canHaveSecondRound(nextOffice)) setRound(1)
    const nextStates = statesForOffice(nextOffice)
    if (!nextStates.includes(state)) setState(nextStates[0])
  }
  // Guarda usada pelo seletor de cargo em pílula e pelo seletor de cargo
  // embutido no BrazilMap: na aba "Governador & Senador" só Governador,
  // Senador e (no DF) Deputado distrital podem ser escolhidos; Deputado
  // federal/estadual pertencem só à Composição Parlamentar.
  const selectGovernadorSenadorOffice = (nextOffice: string) => {
    if (!governadorSenadorOffices.includes(nextOffice)) return
    changeOffice(nextOffice)
  }
  const selectMapState = (nextState: BrazilState) => {
    setState(nextState.uf)
    if (office === 'Presidente' || (office === 'Deputado distrital' && nextState.uf !== 'DF')) {
      setOffice('Governador')
      setRound(1)
    }
    setPanelState(nextState)
    navigate(pathForTab('governadorSenador', nextState.uf))
  }
  // Troca de estado pelo dropdown "Trocar Estado" (atalho redundante ao
  // clique no mapa). Mantém a mesma exceção de deputado distrital usada em
  // selectMapState: fora do DF esse cargo não existe.
  const changeStateViaSwitcher = (nextUf: string) => {
    setState(nextUf)
    if (office === 'Deputado distrital' && nextUf !== 'DF') {
      setOffice('Governador')
      setRound(1)
    }
    navigate(pathForTab('governadorSenador', nextUf))
  }
  const closeStatePanel = () => {
    const uf = panelState?.uf
    setPanelState(null)
    if (uf) {
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`.brazil-map [data-uf="${uf}"]`)?.focus()
      })
    }
  }
  const changeTab = (nextTab: ViewTab) => {
    setActiveTab(nextTab)
    setPanelState(null)
    if (nextTab === 'presidente') {
      setOffice('Presidente')
      setState('Brasil')
      navigate(pathForTab('presidente'))
    } else if (nextTab === 'governadorSenador') {
      let nextOffice = office
      if (office === 'Presidente' || office === 'Deputado federal' || office === 'Deputado estadual') {
        nextOffice = 'Governador'
      }
      if (nextOffice !== office) {
        setOffice(nextOffice)
        if (!canHaveSecondRound(nextOffice)) setRound(1)
      }
      const nextStates = statesForOffice(nextOffice)
      const nextState = nextStates.includes(state) ? state : nextStates[0]
      if (nextState !== state) setState(nextState)
      navigate(pathForTab('governadorSenador', nextState))
    } else {
      navigate(pathForTab(nextTab))
    }
  }
  const handleTabKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      const currentIndex = TAB_ORDER.indexOf(activeTab)
      const delta = event.key === 'ArrowRight' ? 1 : -1
      const nextIndex = (currentIndex + delta + TAB_ORDER.length) % TAB_ORDER.length
      changeTab(TAB_ORDER[nextIndex])
    }
  }

  const coverage = snapshot.totalSections ? Math.round((snapshot.countedSections / snapshot.totalSections) * 100) : 0
  const syncLabel = syncMeta.phase === 'live' ? 'TSE ao vivo' : syncMeta.phase === 'syncing' ? 'consultando TSE' : syncMeta.phase === 'retrying' ? 'tentando novamente' : syncMeta.phase === 'offline' ? 'offline · cache local' : 'aguardando TSE'
  const lastChecked = syncMeta.lastCheckedAt ? timeFormat.format(new Date(syncMeta.lastCheckedAt)) : 'N/D'
  const syncDetail = syncMeta.error ? `Falha: ${syncMeta.error}.` : syncMeta.nextPollAt ? `Próxima consulta: ${timeFormat.format(new Date(syncMeta.nextPollAt))}.` : 'A leitura começa no primeiro boletim oficial.'
  const scoreboardStatus = presentationStatus(snapshot, syncMeta.phase)
  const scoreboardStatusWord = scoreboardStatus === 'official' ? 'oficial' : scoreboardStatus === 'offline' ? 'offline, dados salvos localmente' : 'aguardando publicação do TSE'
  const syncAnnouncement = `${syncLabel}. ${syncDetail} Status: ${scoreboardStatusWord}.`

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

      <AdSlot slot="header" />

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">central de apuração · TSE</p>
          <h1>O país<br /><span>conta junto.</span></h1>
          <p className="hero-lede">Resultado oficial e contexto local, com sinal claro de atualização. Tudo isso continua funcionando mesmo quando a rede cai.</p>
          <div className="hero-actions">
            <span className={`connection ${online ? 'is-online' : 'is-offline'}`}><i />{syncLabel}</span>
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

      <div className="view-tabs" role="tablist" aria-label="Modo de visualização">
        <button
          type="button"
          role="tab"
          id="tab-presidente"
          aria-selected={activeTab === 'presidente'}
          tabIndex={activeTab === 'presidente' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'presidente' ? ' is-active' : ''}`}
          onClick={() => changeTab('presidente')}
          onKeyDown={handleTabKeyDown}
        >
          Presidente da República
        </button>
        <button
          type="button"
          role="tab"
          id="tab-governador-senador"
          aria-selected={activeTab === 'governadorSenador'}
          tabIndex={activeTab === 'governadorSenador' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'governadorSenador' ? ' is-active' : ''}`}
          onClick={() => changeTab('governadorSenador')}
          onKeyDown={handleTabKeyDown}
        >
          Governador & Senador
        </button>
        <button
          type="button"
          role="tab"
          id="tab-composicao-parlamentar"
          aria-selected={activeTab === 'composicaoParlamentar'}
          tabIndex={activeTab === 'composicaoParlamentar' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'composicaoParlamentar' ? ' is-active' : ''}`}
          onClick={() => changeTab('composicaoParlamentar')}
          onKeyDown={handleTabKeyDown}
        >
          Composição Parlamentar
        </button>
        <button
          type="button"
          role="tab"
          id="tab-pesquisas"
          aria-selected={activeTab === 'pesquisas'}
          tabIndex={activeTab === 'pesquisas' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'pesquisas' ? ' is-active' : ''}`}
          onClick={() => changeTab('pesquisas')}
          onKeyDown={handleTabKeyDown}
        >
          Pesquisas
        </button>
        <button
          type="button"
          role="tab"
          id="tab-estatisticas"
          aria-selected={activeTab === 'estatisticas'}
          tabIndex={activeTab === 'estatisticas' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'estatisticas' ? ' is-active' : ''}`}
          onClick={() => changeTab('estatisticas')}
          onKeyDown={handleTabKeyDown}
        >
          Estatísticas & Abstenção
        </button>
        <button
          type="button"
          role="tab"
          id="tab-cenarios"
          aria-selected={activeTab === 'cenarios'}
          tabIndex={activeTab === 'cenarios' ? 0 : -1}
          className={`view-tabs__tab${activeTab === 'cenarios' ? ' is-active' : ''}`}
          onClick={() => changeTab('cenarios')}
          onKeyDown={handleTabKeyDown}
        >
          Cenários (IA)
        </button>
      </div>

      {(activeTab === 'presidente' || activeTab === 'governadorSenador') && (
        <section className="control-strip" aria-label="Filtros de apuração">
          <div className="control-block"><label htmlFor="round">turno</label><select id="round" value={activeRound} onChange={(event) => { const nextRound = Number(event.target.value) as 1 | 2; setRound(nextRound === 2 && !secondRoundAvailable ? 1 : nextRound) }}><option value="1">1º turno</option>{secondRoundAvailable && <option value="2">2º turno</option>}</select></div>
        </section>
      )}

      {activeTab === 'governadorSenador' && (
        <section className="state-header-block" aria-label="Estado selecionado">
          {selectedBrazilState ? (
            <div className="state-header">
              <span className="state-header__badge">{selectedBrazilState.uf}</span>
              <div className="state-header__info">
                <div className="state-header__title-row">
                  <h2>{selectedBrazilState.name}</h2>
                  <span className={`state-header__chip is-${scoreboardStatus}`}>{scoreboardStatusWord}</span>
                </div>
                <p className="state-header__meta">Colégio eleitoral · capital {selectedBrazilState.capital}</p>
              </div>
              <div className="state-switcher">
                <label htmlFor="state-switcher-select">Trocar Estado ({selectedBrazilState.uf})</label>
                <select id="state-switcher-select" className="state-switcher__select" value={state} onChange={(event) => changeStateViaSwitcher(event.target.value)}>
                  {availableStates.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <p className="state-header__empty">Selecione um estado no mapa para ver governador e senador.</p>
          )}
          <div className="office-pill-switcher" role="group" aria-label="Cargo em disputa no estado">
            {governadorSenadorOffices.map((item) => (
              <button
                key={item}
                type="button"
                className={`office-pill${office === item ? ' is-active' : ''}`}
                aria-pressed={office === item}
                onClick={() => selectGovernadorSenadorOffice(item)}
              >
                {item === 'Deputado distrital' ? 'Deputado Distrital' : item}
              </button>
            ))}
            <button type="button" className="office-pill is-disabled" aria-disabled="true" disabled title="Dado regional ainda não disponível">
              Mesorregiões
            </button>
          </div>
        </section>
      )}

      {activeTab === 'presidente' && (
        <section className="map-section map-section--national" aria-labelledby="map-title">
          <div className="map-section__heading"><div><p className="eyebrow">território eleitoral</p><h2 id="map-title">Resultado nacional</h2></div><p>A eleição presidencial tem um único recorte nacional, sem seleção de UF.</p></div>
        </section>
      )}

      {activeTab === 'governadorSenador' && (
        <section className="map-section" aria-labelledby="map-title">
          <div className="map-section__heading"><div><p className="eyebrow">território eleitoral</p><h2 id="map-title">Escolha uma UF. Veja a disputa local.</h2></div><p>Mapa, menu e candidatos trabalham juntos. No DF, o cargo local é deputado distrital.</p></div>
          <BrazilMap activeUf={state === 'Brasil' ? undefined : state} selectedOffice={office} candidateCount={selectedCandidateCount} onSelect={selectMapState} onSelectOffice={selectGovernadorSenadorOffice} />
        </section>
      )}

      <StateCandidatesPanel state={activeTab === 'governadorSenador' ? panelState : null} candidates={candidates} onClose={closeStatePanel} />

      {/* Região viva de acessibilidade (docs/sync-qa.md A11Y-01/A11Y-02): anuncia
          status/erro de sincronização sem depender de cor/posição. Visualmente
          oculta pois o StatsBento abaixo já mostra o mesmo conteúdo. */}
      <p
        role="status"
        aria-live={syncMeta.error ? 'assertive' : 'polite'}
        style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
      >
        {syncAnnouncement}
      </p>

      {activeTab === 'composicaoParlamentar' && (
        <ComposicaoParlamentar candidates={candidates} snapshot={snapshot} round={activeRound} state={state} />
      )}

      {activeTab === 'pesquisas' && (
        <PesquisasTracker candidates={candidates} snapshot={snapshot} round={activeRound} state={state} />
      )}

      {activeTab === 'estatisticas' && (
        <EstatisticasAbstencao candidates={candidates} snapshot={snapshot} round={activeRound} state={state} />
      )}

      {activeTab === 'cenarios' && <CenariosIA state={state} />}

      {(activeTab === 'presidente' || activeTab === 'governadorSenador') && (
        <>
          <StatsBento office={office} scope={state} round={activeRound} coverage={coverage} countedSections={snapshot.countedSections} totalSections={snapshot.totalSections} totalVotes={snapshot.totalVotes} candidateCount={candidates.length} syncLabel={syncLabel} lastChecked={lastChecked} syncDetail={syncDetail} />

          <section className="content-grid">
            <article className="panel leaderboard-panel">
              <div className="panel-heading"><div><p className="eyebrow">candidaturas</p><h2>Quem está na disputa</h2></div><span className="result-count">{format.format(selectedCandidateCount)} no recorte · {format.format(candidates.length)} no snapshot</span></div>
              <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nome, partido ou número" aria-label="Buscar candidato" /></div>
              <div className="candidate-list">{visibleCandidates.map((candidate) => <div className="candidate-row" key={candidate.sqCandidate}><div className="avatar">{candidate.photo ? <img src={candidate.photo} alt="" /> : <span>{candidate.ballotName.slice(0, 1)}</span>}</div><div className="candidate-info"><strong>{candidate.ballotName}</strong><span>{candidate.party} · nº {candidate.number}</span></div><span className="candidate-state">{candidate.uf}</span><span className="candidate-status">{candidate.situation === '#NE' ? 'cadastro TSE' : candidate.situation}</span><FavoriteButton active={isFavorite(candidate.sqCandidate)} onToggle={() => toggleFavorite(candidate.sqCandidate)} label={candidate.ballotName} /></div>)}{visibleCandidates.length === 0 && <p className="empty">Nenhuma candidatura encontrada neste recorte.</p>}</div>
              <p className="source-note">Candidaturas e fotos: TSE · snapshot local. 2º turno só existe para presidente/governador; senador e deputados ficam no 1º.</p>
            </article>
            <aside className="panel explain-panel"><p className="eyebrow">leia antes</p><h2>Apuração sem ruído.</h2><p>Os números só aparecem quando o TSE publica boletim oficial. Enquanto isso, este painel mostra a base de candidatos e mantém o último snapshot íntegro no aparelho.</p><div className="legend"><div><span className="legend-dot official" />oficial</div><div><span className="legend-dot cached" />salvo no aparelho</div><div><span className="legend-dot waiting" />aguardando publicação</div></div><button className="text-button" onClick={() => window.alert('Fonte: Portal de Dados Abertos do TSE e resultados.tse.jus.br')}>Ver origem dos dados <span>↗</span></button></aside>
          </section>
        </>
      )}

      <AdSlot slot="footer" />
      <footer><span>APURA BRASIL / 2026</span><span>Dados públicos · feito para continuar funcionando</span><span>Polling TSE · 15s · cache offline</span></footer>
      <CookieBanner />
    </main>
  )
}

export default App
