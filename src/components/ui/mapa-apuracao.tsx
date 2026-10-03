import { BrazilMap } from './brazil-map'
import { useResumoMapa } from '@/resumo-mapa'
import './mapa-apuracao.css'

/** Mapa ao vivo: quem é o mais votado para Presidente em cada UF, a partir do
 * resumo que o ingest monta com os arquivos oficiais do TSE. Some enquanto não
 * houver voto apurado. */
export function MapaApuracao() {
  const { summary, fillByUf, legend, ufsWithLeader } = useResumoMapa('Presidente')

  if (ufsWithLeader === 0) return null
  const br = summary?.states.BR

  return (
    <section className="mapa-apuracao panel" aria-labelledby="mapa-apuracao-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">presidente · apuração ao vivo</p>
          <h2 id="mapa-apuracao-title">Quem lidera em cada estado</h2>
        </div>
        {br?.sectionsPct && <span className="result-count">{br.sectionsPct}% das seções no país</span>}
      </div>
      <div className="mapa-apuracao__body">
        <BrazilMap fillByUf={fillByUf} hideDetailsPanel ariaLabel="Mapa da apuração de Presidente: candidato mais votado em cada estado" />
        <ul className="mapa-apuracao__legend">
          {legend.map((item) => (
            <li key={item.key}>
              <span className="mapa-apuracao__dot" style={{ background: item.color }} aria-hidden="true" />
              <span>
                <strong>{item.leader.name}</strong> ({item.leader.party}) lidera em {item.ufs.length} {item.ufs.length === 1 ? 'estado' : 'estados'}
                <small>{item.ufs.join(', ')}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="source-note">
        Mais votado em cada UF segundo os arquivos oficiais do TSE, atualizado a cada 30 segundos. Liderar numa UF com poucas
        seções apuradas pode mudar ao longo da noite.
      </p>
    </section>
  )
}
