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
    <section className="min-h-[26rem] bg-background flex flex-col justify-center py-5 md:py-8" aria-label="Resumo da apuração">
      <div className="grid grid-cols-1 md:grid-cols-6 md:grid-rows-2 gap-4 max-w-7xl mx-auto w-full">
        <div className="md:col-span-3 md:row-span-2 bg-primary rounded-3xl p-8 md:p-10 flex flex-col justify-between overflow-hidden relative min-h-[20rem]">
          <div className="absolute bottom-0 left-0 right-0 top-0 bg-[repeating-linear-gradient(45deg,#808080_0px_1px,transparent_1px_10px)] opacity-30 mask-[radial-gradient(ellipse_80%_50%_at_100%_0%,#000_70%,transparent_110%)] pointer-events-none" />
          <div className="relative">
            <span className="inline-block px-3 py-1 bg-primary-foreground/10 rounded-full text-[10px] font-semibold text-primary-foreground/60 uppercase tracking-widest mb-6">Seções apuradas</span>
            <p className="text-6xl md:text-7xl tracking-tighter text-primary-foreground font-semibold">{percentage}</p>
            <p className="mt-3 text-primary-foreground/60 text-sm">{sections} seções</p>
          </div>
          <p className="relative text-primary-foreground/60 text-sm max-w-xs">{office} · {scope} · {round}º turno. Percentual baseado no acompanhamento oficial do TSE.</p>
        </div>

        <div className="md:col-span-3 bg-muted rounded-3xl p-7 md:p-8 border border-border flex items-center justify-between min-h-[9rem]">
          <div><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1">Votos contabilizados</p><p className="text-3xl text-foreground tracking-tight">{votes}</p></div>
          <div className="flex gap-1 items-end h-8" aria-hidden="true">{bars.map((height, index) => <div key={index} className="w-1.5 bg-foreground rounded-full" style={{ height: `${height}%` }} />)}</div>
        </div>

        <div className="md:col-span-1 bg-card rounded-3xl p-6 border border-border flex flex-col justify-center text-center min-h-[8rem]"><p className="text-2xl text-foreground">{numberFormat.format(candidateCount)}</p><p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Candidaturas</p></div>

        <div className="md:col-span-2 bg-muted rounded-3xl p-6 flex items-center gap-4 min-h-[8rem]"><div className="size-10 text-2xl rounded-full bg-background text-foreground flex items-center justify-center shrink-0 shadow-sm font-semibold" aria-hidden="true">●</div><div><p className="text-sm text-foreground leading-none">{syncLabel}</p><p className="text-xs font-semibold text-muted-foreground mt-1">Última consulta · {lastChecked}</p><p className="text-xs text-muted-foreground mt-1">{syncDetail}</p></div></div>
      </div>
    </section>
  )
}

export default StatsBento
