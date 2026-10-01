import type { Candidate, ResultSnapshot } from '../../types'
import './estatisticas-abstencao.css'

export type EstatisticasAbstencaoProps = {
  candidates: Candidate[]
  snapshot: ResultSnapshot
  round: 1 | 2
  state: string
}

const numberFormat = new Intl.NumberFormat('pt-BR')
const updatedAtFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const STATUS_LABEL: Record<ResultSnapshot['status'], string> = {
  official: 'Resultado oficial (TSE)',
  waiting: 'Aguardando boletim oficial',
  offline: 'Sem conexão · último dado salvo',
}

// Placeholders de indisponibilidade: nenhuma dessas seções recebe números
// inventados. O snapshot/candidates recebidos não trazem eleitorado,
// comparecimento/abstenção, nem votos válidos/nulos/brancos — apenas
// totalVotes, countedSections/totalSections, rows (por candidato) e status.
const UNAVAILABLE_BREAKDOWNS: { title: string; detail: string }[] = [
  {
    title: 'Abstenção por macrorregião',
    detail: 'Pede o recorte de comparecimento por UF que o TSE publica à parte. Este painel ainda só consome totais nacionais de votos e seções.',
  },
  {
    title: 'Abstenção por faixa etária',
    detail: 'Pede o perfil do eleitorado por idade do cadastro eleitoral do TSE, fonte distinta da apuração de votos que este painel acompanha.',
  },
]

export function EstatisticasAbstencao({ candidates, snapshot, round, state }: EstatisticasAbstencaoProps) {
  const coverage = snapshot.totalSections > 0 ? Math.round((snapshot.countedSections / snapshot.totalSections) * 100) : null
  const hasUpdatedAt = typeof snapshot.updatedAt === 'string' && snapshot.updatedAt.length > 0 && !Number.isNaN(Date.parse(snapshot.updatedAt))

  return (
    <section className="estatisticas-abstencao" aria-labelledby="estatisticas-abstencao-title">
      <div className="estatisticas-abstencao__heading">
        <p className="estatisticas-abstencao__eyebrow">apuração · {state} · {round}º turno</p>
        <h2 id="estatisticas-abstencao-title">Estatísticas &amp; Abstenção</h2>
        <p className="estatisticas-abstencao__lede">Os números abaixo refletem só o que o painel efetivamente recebe do TSE neste recorte. Onde não há fonte oficial integrada, o espaço fica reservado e marcado como indisponível em vez de mostrar um valor estimado.</p>
      </div>

      <div className="estatisticas-abstencao__stats" role="list">
        <article className="estatisticas-abstencao__stat" role="listitem">
          <p className="estatisticas-abstencao__label">Cobertura da apuração</p>
          {coverage !== null ? (
            <>
              <p className="estatisticas-abstencao__value">{coverage}%</p>
              <p className="estatisticas-abstencao__caption">{numberFormat.format(snapshot.countedSections)} de {numberFormat.format(snapshot.totalSections)} seções apuradas</p>
              <div className="estatisticas-abstencao__progress"><span style={{ width: `${Math.min(100, Math.max(0, coverage))}%` }} /></div>
            </>
          ) : (
            <p className="estatisticas-abstencao__unavailable-inline">Dado indisponível, sem fonte oficial integrada</p>
          )}
        </article>

        <article className="estatisticas-abstencao__stat" role="listitem">
          <p className="estatisticas-abstencao__label">Votos apurados</p>
          <p className="estatisticas-abstencao__value">{numberFormat.format(snapshot.totalVotes)}</p>
          <p className="estatisticas-abstencao__caption">total nacional somado pelo painel</p>
        </article>

        <article className="estatisticas-abstencao__stat" role="listitem">
          <p className="estatisticas-abstencao__label">Candidaturas no snapshot</p>
          <p className="estatisticas-abstencao__value">{numberFormat.format(candidates.length)}</p>
          <p className="estatisticas-abstencao__caption">registradas no recorte nacional carregado</p>
        </article>

        <article className="estatisticas-abstencao__stat" role="listitem">
          <p className="estatisticas-abstencao__label">Status da apuração</p>
          <p className="estatisticas-abstencao__status-value">{STATUS_LABEL[snapshot.status]}</p>
          <p className="estatisticas-abstencao__caption">{hasUpdatedAt ? `atualizado às ${updatedAtFormat.format(new Date(snapshot.updatedAt as string))}` : 'sem horário de atualização registrado'}</p>
        </article>
      </div>

      <div className="estatisticas-abstencao__breakdown-heading">
        <p className="estatisticas-abstencao__eyebrow">comparecimento e distribuição eleitoral</p>
        <h3>Abstenção e eleitorado</h3>
        <p className="estatisticas-abstencao__lede">O eleitorado apto e a abstenção pedem um dado de comparecimento do TSE que este painel ainda não consulta. A estrutura abaixo já está pronta para recebê-lo quando essa integração existir.</p>
      </div>

      <div className="estatisticas-abstencao__breakdowns">
        {UNAVAILABLE_BREAKDOWNS.map((item) => (
          <article className="estatisticas-abstencao__breakdown-card" key={item.title}>
            <p className="estatisticas-abstencao__breakdown-title">{item.title}</p>
            <p className="estatisticas-abstencao__unavailable">Dado indisponível, sem fonte oficial integrada</p>
            <p className="estatisticas-abstencao__breakdown-detail">{item.detail}</p>
          </article>
        ))}
      </div>

      <article className="estatisticas-abstencao__breakdown-card estatisticas-abstencao__breakdown-card--wide">
        <p className="estatisticas-abstencao__breakdown-title">Distribuição de votos válidos, nulos e brancos</p>
        <p className="estatisticas-abstencao__unavailable">Dado indisponível, sem fonte oficial integrada</p>
        <p className="estatisticas-abstencao__breakdown-detail">A apuração consultada por este painel traz votos por candidato, mas não discrimina nulos e brancos separadamente. Isso exige outro retorno do TSE, ainda não ligado aqui.</p>
      </article>
    </section>
  )
}

export default EstatisticasAbstencao
