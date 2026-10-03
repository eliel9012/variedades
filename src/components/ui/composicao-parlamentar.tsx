import { useEffect, useMemo, useState } from 'react'
import type { Candidate, ResultSnapshot } from '../../types'
import { officeCodes } from '../../data'
import { Hemiciclo } from './hemiciclo'
import './composicao-parlamentar.css'

export type ComposicaoParlamentarProps = {
  candidates: Candidate[]
  snapshot: ResultSnapshot
  round: 1 | 2
  state: string
}

// Distribuição real de cadeiras de Deputado Federal por UF (513 ao todo),
// vigente para as Eleições 2026, tabela definida pela Resolução do TSE que
// fixa o número de lugares por UF a partir do art. 45 da Constituição e da
// Lei Complementar nº 78/1993 (mín. 8, máx. 70 por UF), sem alteração de
// quantitativo total desde o ajuste censitário aplicado em 2022. Conferida
// contra a lista divulgada pelo TSE e replicada por fontes de imprensa
// eleitoral (ex.: Correio Braziliense, "Quantos deputados federais cada
// estado elege em 2026?", set/2026) somando exatamente 513 cadeiras.
const DEPUTADO_FEDERAL_SEATS_BY_UF: Record<string, number> = {
  SP: 70,
  MG: 53,
  RJ: 46,
  BA: 39,
  RS: 31,
  PR: 30,
  PE: 25,
  CE: 22,
  MA: 18,
  GO: 17,
  PA: 17,
  SC: 16,
  PB: 12,
  ES: 10,
  PI: 10,
  AL: 9,
  AC: 8,
  AP: 8,
  AM: 8,
  DF: 8,
  MT: 8,
  MS: 8,
  RN: 8,
  RO: 8,
  RR: 8,
  SE: 8,
  TO: 8,
}

const TOTAL_SEATS = Object.values(DEPUTADO_FEDERAL_SEATS_BY_UF).reduce((sum, n) => sum + n, 0)

const UF_NAMES: Record<string, string> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
}

const UF_CODES = Object.keys(DEPUTADO_FEDERAL_SEATS_BY_UF).sort((a, b) => a.localeCompare(b))
const UF_CODES_BY_SEATS = [...UF_CODES].sort(
  (a, b) => DEPUTADO_FEDERAL_SEATS_BY_UF[b] - DEPUTADO_FEDERAL_SEATS_BY_UF[a] || a.localeCompare(b),
)

const numberFormat = new Intl.NumberFormat('pt-BR')

const ROSTER_PAGE_SIZE = 25

// "#NE" (não exibível) é o placeholder do TSE quando a situação da
// candidatura não foi divulgada; não é um status real, então não exibimos.
function displaySituation(value: string | undefined | null): string | null {
  const v = value?.trim()
  if (!v || v.toUpperCase() === '#NE') return null
  return v
}

type DeputyTab = 'federal' | 'estadual'
type SortKey = 'name' | 'party' | 'uf'

export function ComposicaoParlamentar({ candidates, snapshot, round, state }: ComposicaoParlamentarProps) {
  const defaultUf = UF_CODES.includes(state) ? state : 'SP'
  const [qeUf, setQeUf] = useState(defaultUf)
  const [tab, setTab] = useState<DeputyTab>('federal')
  const [ufFilter, setUfFilter] = useState('Todos')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [rosterLimit, setRosterLimit] = useState(ROSTER_PAGE_SIZE)

  // Volta para a primeira página sempre que o recorte muda.
  useEffect(() => {
    setRosterLimit(ROSTER_PAGE_SIZE)
  }, [tab, ufFilter, search, sortKey])

  const seats = DEPUTADO_FEDERAL_SEATS_BY_UF[qeUf]

  // Só tratamos o snapshot como fonte de votos válidos da UF escolhida
  // quando o escopo e o turno batem; o snapshot não carrega o cargo (não é
  // exclusivo de Deputado Federal), então sinalizamos essa limitação em vez
  // de fingir certeza sobre o cargo apurado.
  const scopeMatchesUf = snapshot.scope?.trim().toUpperCase() === qeUf
  const roundMatches = snapshot.round === round
  const hasUsableVotes = scopeMatchesUf && roundMatches && snapshot.totalVotes > 0 && snapshot.status !== 'waiting'
  const votosValidos = hasUsableVotes ? snapshot.totalVotes : null
  const quocienteEleitoral = votosValidos != null ? Math.floor(votosValidos / seats) : null

  const officeCode = tab === 'federal' ? officeCodes['Deputado federal'] : officeCodes['Deputado estadual']

  const tabCandidates = useMemo(() => candidates.filter((c) => c.officeCode === officeCode), [candidates, officeCode])

  const ufOptions = useMemo(() => {
    const set = new Set(tabCandidates.map((c) => c.uf))
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [tabCandidates])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const rows = tabCandidates.filter((c) => {
      if (ufFilter !== 'Todos' && c.uf !== ufFilter) return false
      if (!query) return true
      return (
        c.name.toLowerCase().includes(query) ||
        c.ballotName.toLowerCase().includes(query) ||
        c.partyName.toLowerCase().includes(query) ||
        c.party.toLowerCase().includes(query) ||
        String(c.number).includes(query)
      )
    })
    return rows.sort((a, b) => {
      if (sortKey === 'party') return a.party.localeCompare(b.party) || a.name.localeCompare(b.name)
      if (sortKey === 'uf') return a.uf.localeCompare(b.uf) || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
  }, [tabCandidates, ufFilter, search, sortKey])

  const visibleRows = filtered.slice(0, rosterLimit)
  const showSituation = useMemo(() => filtered.some((c) => displaySituation(c.situation) != null), [filtered])
  const columnCount = showSituation ? 5 : 4

  return (
    <section className="composicao-parlamentar" aria-labelledby="composicao-parlamentar-heading">
      <header className="composicao-parlamentar__header">
        <p className="eyebrow">Câmara dos Deputados · Eleições 2026</p>
        <h2 id="composicao-parlamentar-heading">Composição Parlamentar</h2>
        <p className="composicao-parlamentar__lede">
          Hemiciclo da Câmara com a bancada eleita em 2022 e a de 2026, preenchida conforme o TSE declara cada
          eleito, mais o quadro legal de cadeiras por UF, a matemática oficial de conversão de votos em vagas e o
          cadastro de candidaturas. Nenhuma cadeira é estimada: sem eleito declarado pelo TSE, ela fica "a definir".
        </p>
        <div className="composicao-parlamentar__stats">
          <div className="composicao-parlamentar__stat">
            <strong>{numberFormat.format(TOTAL_SEATS)}</strong>
            <span>cadeiras de Deputado Federal (total nacional, fixo por lei)</span>
          </div>
          <div className="composicao-parlamentar__stat">
            <strong>27</strong>
            <span>UFs com apuração por quociente eleitoral próprio</span>
          </div>
          <div className="composicao-parlamentar__stat">
            <strong>{numberFormat.format(tabCandidates.length)}</strong>
            <span>candidaturas a {tab === 'federal' ? 'Deputado Federal' : 'Deputado Estadual/Distrital'} carregadas</span>
          </div>
        </div>
      </header>

      <Hemiciclo defaultUf={UF_CODES.includes(state) ? state : undefined} />

      <div className="composicao-parlamentar__grid">
        <div className="panel composicao-parlamentar__calc">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Calculadora</p>
              <h2>Quociente Eleitoral por UF</h2>
            </div>
          </div>
          <label className="composicao-parlamentar__field">
            <span>Unidade da Federação</span>
            <select value={qeUf} onChange={(e) => setQeUf(e.target.value)}>
              {UF_CODES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf} · {UF_NAMES[uf]}
                </option>
              ))}
            </select>
          </label>

          <dl className="composicao-parlamentar__formula">
            <div>
              <dt>Cadeiras em disputa ({qeUf})</dt>
              <dd>{seats}</dd>
            </div>
            <div>
              <dt>Votos válidos (Dep. Federal, {qeUf}, {round}º turno)</dt>
              <dd className={votosValidos == null ? 'is-unavailable' : undefined}>
                {votosValidos != null ? numberFormat.format(votosValidos) : 'aguardando apuração oficial'}
              </dd>
            </div>
            <div className="composicao-parlamentar__formula-result">
              <dt>QE = Votos válidos ÷ Cadeiras</dt>
              <dd className={quocienteEleitoral == null ? 'is-unavailable' : undefined}>
                {quocienteEleitoral != null ? numberFormat.format(quocienteEleitoral) : 'dado indisponível'}
              </dd>
            </div>
          </dl>
          {votosValidos != null ? (
            <p className="composicao-parlamentar__note">
              Votos válidos lidos do snapshot ativo (escopo {qeUf}, {round}º turno). O snapshot não registra o cargo
              apurado. Confirme no filtro de cargo da página que o recorte corrente é Deputado Federal antes de usar
              este número.
            </p>
          ) : (
            <p className="composicao-parlamentar__note">
              O snapshot carregado no momento não cobre votos válidos de Deputado Federal para {qeUf} no {round}º
              turno. Nenhum valor é estimado: assim que o TSE publicar o boletim para esta UF, o cálculo passa a
              aparecer automaticamente.
            </p>
          )}
        </div>

        <div className="panel composicao-parlamentar__limitation">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Transparência de dados</p>
              <h2>De onde vem o hemiciclo</h2>
            </div>
          </div>
          <p>
            Quem ocupa cada cadeira (eleito por quociente partidário ou por média) é resultado de um cálculo que o TSE
            fecha UF por UF, com os votos nominais e de legenda de todos os candidatos. O hemiciclo de 2026 não faz
            esse cálculo por conta própria: ele só conta os candidatos que o próprio TSE já marcou como eleitos nos
            arquivos oficiais de cada UF. Até lá, a cadeira aparece como "a definir".
          </p>
          <ul className="composicao-parlamentar__limitation-list">
            <li><span>Bancada eleita em 2022</span><strong>resultado final do TSE</strong></li>
            <li><span>Bancada 2026</span><strong>eleitos declarados pelo TSE</strong></li>
            <li><span>Projeção de cadeiras antes do TSE</span><strong>não fazemos</strong></li>
            <li><span>Cadeiras por UF (apportionment legal)</span><strong>dado real, abaixo</strong></li>
          </ul>
        </div>
      </div>

      <div className="composicao-parlamentar__method">
        <p className="eyebrow">Metodologia normativa</p>
        <h2>Quociente Eleitoral, Quociente Partidário e sobras</h2>
        <p className="composicao-parlamentar__method-source">
          Regras vigentes desde as Eleições 2024 e mantidas para 2026: Código Eleitoral (art. 106–109) com a redação
          dada pela Lei nº 14.211/2021 (cláusula de desempenho 80/20) e o julgamento do STF na ADI 5.420 (Plenário,
          28/02/2024), que retirou a exigência de 80% do QE para participar da 3ª fase de distribuição das sobras.
        </p>
        <div className="composicao-parlamentar__steps">
          <div className="composicao-parlamentar__step">
            <span className="composicao-parlamentar__step-tag">Etapa 1</span>
            <h3>Quociente Eleitoral (QE)</h3>
            <p>Divide o total de votos válidos (nominais + de legenda) pelo número de cadeiras da UF.</p>
            <code>QE = Votos válidos da UF ÷ Cadeiras da UF</code>
          </div>
          <div className="composicao-parlamentar__step">
            <span className="composicao-parlamentar__step-tag">Etapa 2</span>
            <h3>Quociente Partidário (QP) + cláusula 80/20</h3>
            <p>
              Cada partido/federação recebe vagas diretas enquanto seus votos (legenda + nominais) comportarem um QE
              inteiro. Só disputa vaga direta quem atingir 80% do QE (partido) e o candidato que tiver ao menos 20%
              do QE.
            </p>
            <code>QP = Votos do partido ÷ QE (parte inteira)</code>
          </div>
          <div className="composicao-parlamentar__step">
            <span className="composicao-parlamentar__step-tag">Etapa 3</span>
            <h3>Sobras pelo método da maior média</h3>
            <p>
              Cadeiras não preenchidas pelo QP vão para quem tiver a maior média a cada rodada. Desde a ADI 5.420,
              todos os partidos/federações concorrem às sobras, sem precisar ter batido 80% do QE antes.
            </p>
            <code>Média = Votos do partido ÷ (vagas obtidas + 1)</code>
          </div>
        </div>
      </div>

      <div className="panel composicao-parlamentar__table-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Apportionment legal · 27 UFs</p>
            <h2>Cadeiras de Deputado Federal por Unidade da Federação</h2>
          </div>
          <span className="result-count">{numberFormat.format(TOTAL_SEATS)} cadeiras no total</span>
        </div>
        <div className="composicao-parlamentar__table-scroll">
          <table className="composicao-parlamentar__uf-table">
            <thead>
              <tr>
                <th>UF</th>
                <th>Cadeiras</th>
                <th>Votos válidos</th>
                <th>Quociente Eleitoral</th>
              </tr>
            </thead>
            <tbody>
              {UF_CODES_BY_SEATS.map((uf) => {
                const isSelected = uf === qeUf
                const rowVotes = isSelected ? votosValidos : null
                const rowQe = isSelected ? quocienteEleitoral : null
                return (
                  <tr key={uf} className={isSelected ? 'is-selected' : undefined}>
                    <td>
                      <strong>{uf}</strong> <span>{UF_NAMES[uf]}</span>
                    </td>
                    <td>{DEPUTADO_FEDERAL_SEATS_BY_UF[uf]}</td>
                    <td className={rowVotes == null ? 'is-unavailable' : undefined}>
                      {rowVotes != null ? numberFormat.format(rowVotes) : 'aguardando apuração'}
                    </td>
                    <td className={rowQe == null ? 'is-unavailable' : undefined}>
                      {rowQe != null ? numberFormat.format(rowQe) : 'indisponível'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="source-note">
          Cadeiras: tabela legal de representação por UF (fixa por lei, soma 513). Votos válidos/QE: calculados ao
          vivo apenas quando o snapshot ativo cobre a UF selecionada acima; as demais linhas aguardam boletim
          oficial e nunca são preenchidas com estimativas.
        </p>
      </div>

      <div className="panel composicao-parlamentar__roster">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Cadastro de candidaturas</p>
            <h2>Candidatos a Deputado Federal e Estadual</h2>
          </div>
          <span className="result-count">
            {numberFormat.format(visibleRows.length)} de {numberFormat.format(filtered.length)} exibidos
          </span>
        </div>
        <div className="view-tabs composicao-parlamentar__tabs">
          <button
            type="button"
            className={`view-tabs__tab${tab === 'federal' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('federal')
              setUfFilter('Todos')
            }}
          >
            Deputado Federal
          </button>
          <button
            type="button"
            className={`view-tabs__tab${tab === 'estadual' ? ' is-active' : ''}`}
            onClick={() => {
              setTab('estadual')
              setUfFilter('Todos')
            }}
          >
            Deputado Estadual/Distrital
          </button>
        </div>

        <div className="composicao-parlamentar__roster-controls">
          <label className="composicao-parlamentar__field composicao-parlamentar__field--uf">
            <span>UF</span>
            <select value={ufFilter} onChange={(e) => setUfFilter(e.target.value)}>
              <option value="Todos">Todos os Estados</option>
              {ufOptions.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </select>
          </label>
          <label className="composicao-parlamentar__field composicao-parlamentar__field--search">
            <span>Buscar</span>
            <input
              type="search"
              placeholder="Nome, partido ou número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="composicao-parlamentar__sort">
            <span>Ordenar por</span>
            <button type="button" className={sortKey === 'name' ? 'is-active' : undefined} onClick={() => setSortKey('name')}>
              Nome
            </button>
            <button type="button" className={sortKey === 'party' ? 'is-active' : undefined} onClick={() => setSortKey('party')}>
              Partido
            </button>
            <button type="button" className={sortKey === 'uf' ? 'is-active' : undefined} onClick={() => setSortKey('uf')}>
              UF
            </button>
          </div>
        </div>

        <div className="composicao-parlamentar__table-scroll">
          <table className="composicao-parlamentar__roster-table">
            <thead>
              <tr>
                <th>Número</th>
                <th>Candidato(a)</th>
                <th>Partido</th>
                <th>UF</th>
                {showSituation ? <th>Situação</th> : null}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((c) => (
                <tr key={c.sqCandidate}>
                  <td className="composicao-parlamentar__cell-number" data-label="Número">{c.number}</td>
                  <td className="composicao-parlamentar__cell-name">
                    <strong>{c.ballotName}</strong>
                    <span className="composicao-parlamentar__full-name">{c.name}</span>
                  </td>
                  <td className="composicao-parlamentar__cell-party">
                    <span className="composicao-parlamentar__party">{c.party}</span>
                    <span className="composicao-parlamentar__party-name">{c.partyName}</span>
                  </td>
                  <td className="composicao-parlamentar__cell-uf" data-label="UF">{c.uf}</td>
                  {showSituation ? (
                    <td className="composicao-parlamentar__cell-situation">{displaySituation(c.situation) ?? ''}</td>
                  ) : null}
                </tr>
              ))}
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="empty">
                    Nenhuma candidatura encontrada para este filtro.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {filtered.length > visibleRows.length ? (
          <div className="composicao-parlamentar__more">
            <button
              type="button"
              className="composicao-parlamentar__more-button"
              onClick={() => setRosterLimit((n) => n + ROSTER_PAGE_SIZE)}
            >
              Carregar mais
            </button>
          </div>
        ) : null}
        <p className="source-note">
          Lista de registro de candidaturas (TSE), sem contagem de votos: este cadastro não informa votação nem
          resultado, apenas quem está concorrendo.
        </p>
      </div>
    </section>
  )
}

export default ComposicaoParlamentar
