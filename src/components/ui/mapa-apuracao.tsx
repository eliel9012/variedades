import { useEffect, useMemo, useState } from 'react'
import { BrazilMap } from './brazil-map'
import './mapa-apuracao.css'

type Leader = { name: string; party: string; number: string; votes: number; share: string; status: string | null }
type StateSummary = { sectionsPct: string | null; updatedAt: string | null; leader: Leader | null; second: Leader | null }
type Summary = { generatedAt: string; states: Record<string, StateSummary> }

// Cores fixas por posição no ranking nacional de líderes (quem lidera em mais
// UFs ganha a primeira cor), para a legenda não trocar de cor a cada minuto.
const PALETTE = ['#1f6f8b', '#c0392b', '#d68910', '#6c3483', '#117a65', '#5d6d7e']
const REFRESH_MS = 30_000

/** Mapa ao vivo: quem é o mais votado para Presidente em cada UF, a partir do
 * resumo que o ingest monta com os arquivos oficiais do TSE. Some enquanto não
 * houver voto apurado. */
export function MapaApuracao() {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch('/tse/resumo-presidente.json', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: Summary | null) => alive && data && setSummary(data))
        .catch(() => undefined)
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const { fillByUf, legend, ufsWithLeader } = useMemo(() => {
    const entries = Object.entries(summary?.states ?? {}).filter(([uf, value]) => uf !== 'BR' && value.leader)
    const counts = new Map<string, { leader: Leader; ufs: string[] }>()
    for (const [uf, value] of entries) {
      const key = `${value.leader!.name}|${value.leader!.party}`
      const item = counts.get(key) ?? { leader: value.leader!, ufs: [] }
      item.ufs.push(uf)
      counts.set(key, item)
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1].ufs.length - a[1].ufs.length)
    const colorByKey = new Map(ranked.map(([key], index) => [key, PALETTE[index % PALETTE.length]]))
    const fill: Record<string, string> = {}
    for (const [uf, value] of entries) fill[uf] = colorByKey.get(`${value.leader!.name}|${value.leader!.party}`)!
    return {
      fillByUf: fill,
      legend: ranked.map(([key, item]) => ({ key, color: colorByKey.get(key)!, ...item })),
      ufsWithLeader: entries.length,
    }
  }, [summary])

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
                <small>{item.ufs.sort().join(', ')}</small>
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
