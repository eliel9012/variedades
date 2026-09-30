"use client"

import React from 'react'

const numberFormat = new Intl.NumberFormat('pt-BR')

export type StatsBentoProps = {
  office: string
  scope: string
  round: 1 | 2
  coverage: number
  countedSections: number
  totalSections: number
  totalVotes: number
  candidateCount: number
  syncLabel: string
  lastChecked: string
  syncDetail: string
}

export const StatsBento = ({ office, scope, round, coverage, countedSections, totalSections, totalVotes, candidateCount, syncLabel, lastChecked, syncDetail }: StatsBentoProps) => {
  const bars = [22, 31, 40, 34, 52, 48, 61, 70, 79, 88, 100]
  const percentage = coverage ? `${coverage}%` : '—'
  const votes = totalVotes ? numberFormat.format(totalVotes) : '—'
  const sections = countedSections ? `${numberFormat.format(countedSections)} / ${numberFormat.format(totalSections)}` : 'aguardando TSE'

  return (
    <section className="stats-bento" aria-label="Resumo da apuração">
      <div className="stats-bento__grid">
        <article className="stats-bento__primary">
          <div className="stats-bento__texture" aria-hidden="true" />
          <div className="stats-bento__content">
            <span className="stats-bento__kicker">Seções apuradas</span>
            <p className="stats-bento__value">{percentage}</p>
            <p className="stats-bento__secondary">{sections} seções</p>
          </div>
          <p className="stats-bento__note">{office} · {scope} · {round}º turno. Percentual baseado no acompanhamento oficial do TSE.</p>
        </article>

        <article className="stats-bento__votes">
          <div>
            <p className="stats-bento__label">Votos contabilizados</p>
            <p className="stats-bento__metric">{votes}</p>
          </div>
          <div className="stats-bento__bars" aria-hidden="true">{bars.map((height, index) => <span key={index} style={{ height: `${height}%` }} />)}</div>
        </article>

        <article className="stats-bento__candidates">
          <p className="stats-bento__metric">{numberFormat.format(candidateCount)}</p>
          <p className="stats-bento__label">Candidaturas</p>
        </article>

        <article className="stats-bento__sync">
          <span className="stats-bento__signal" aria-hidden="true">●</span>
          <div>
            <p className="stats-bento__sync-label">{syncLabel}</p>
            <p className="stats-bento__label">Última consulta · {lastChecked}</p>
            <p className="stats-bento__detail">{syncDetail}</p>
          </div>
        </article>
      </div>
    </section>
  )
}

export default StatsBento
