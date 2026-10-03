import { useEffect, useMemo, useState } from 'react'

// Resumo "quem lidera em cada UF" que o ingest monta a partir dos arquivos
// oficiais espelhados (scripts/ingest-tse.mjs, writeSummary). Um arquivo
// pequeno por cargo, servido pelo espelho com cache da Cloudflare.
export type Leader = { name: string; party: string; number: string; votes: number; share: string; status: string | null }
export type StateSummary = { sectionsPct: string | null; updatedAt: string | null; leader: Leader | null; second: Leader | null }
export type Summary = { generatedAt: string; states: Record<string, StateSummary> }

const FILES: Record<string, string> = {
  Presidente: '/tse/resumo-presidente.json',
  Governador: '/tse/resumo-governador.json',
  Senador: '/tse/resumo-senador.json',
}
const REFRESH_MS = 30_000

// Cores fixas por posição no ranking de quem lidera em mais UFs, para a
// legenda não trocar de cor a cada atualização.
const PALETTE = ['#1f6f8b', '#c0392b', '#d68910', '#6c3483', '#117a65', '#2e4053', '#a04000', '#7d6608', '#1a5276', '#943126', '#0e6655', '#5b2c6f']

export function hasSummary(office: string) {
  return office in FILES
}

/** Lê o resumo do cargo a cada 30 s, só com a aba visível. Cargo sem resumo
 * (deputados) não faz pedido. */
export function useResumoMapa(office: string | null) {
  const [summary, setSummary] = useState<{ office: string; data: Summary } | null>(null)
  const url = office ? FILES[office] : undefined

  useEffect(() => {
    if (!url || !office) return
    let alive = true
    const load = () => {
      if (document.visibilityState === 'hidden') return
      fetch(url, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: Summary | null) => alive && data && setSummary({ office, data }))
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [url, office])

  const current = summary && summary.office === office ? summary.data : null
  return useMemo(() => leaderColors(current, office === 'Presidente' ? 'candidate' : 'party'), [current, office])
}

/** Presidente agrupa por candidatura; Governador e Senador por partido (cada
 * UF tem candidatos próprios). UF sem voto apurado fica fora de fillByUf. */
/** Cores fixas por partido, para quem pede (comparativo 2022): PT vermelho,
 * PL verde militar. A paleta por ranking pula o vermelho para não repetir. */
export const PARTY_COLORS: Record<string, string> = { PT: '#c0392b', PL: '#4b5320' }

export function leaderColors(summary: Summary | null, groupBy: 'candidate' | 'party', fixed: Record<string, string> = {}) {
  const entries = Object.entries(summary?.states ?? {}).filter(([uf, value]) => uf !== 'BR' && value.leader)
  const keyOf = (leader: Leader) => (groupBy === 'party' ? leader.party : `${leader.name}|${leader.party}`)
  const groups = new Map<string, { leader: Leader; ufs: string[] }>()
  for (const [uf, value] of entries) {
    const key = keyOf(value.leader!)
    const item = groups.get(key) ?? { leader: value.leader!, ufs: [] }
    item.ufs.push(uf)
    groups.set(key, item)
  }
  const ranked = [...groups.entries()].sort((a, b) => b[1].ufs.length - a[1].ufs.length || a[0].localeCompare(b[0]))
  const reserved = new Set(Object.values(fixed))
  const palette = PALETTE.filter((color) => !reserved.has(color))
  let next = 0
  const colorByKey = new Map(ranked.map(([key, item]) => [key, fixed[item.leader.party] ?? palette[next++ % palette.length]]))
  const fillByUf: Record<string, string> = {}
  for (const [uf, value] of entries) fillByUf[uf] = colorByKey.get(keyOf(value.leader!))!
  return {
    summary,
    fillByUf,
    legend: ranked.map(([key, item]) => ({ key, color: colorByKey.get(key)!, ...item, ufs: [...item.ufs].sort() })),
    ufsWithLeader: entries.length,
  }
}
