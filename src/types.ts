export type Candidate = {
  sqCandidate: string
  number: number
  name: string
  ballotName: string
  uf: string
  office: string
  officeCode: number
  party: string
  partyName: string
  situation: string
  photo?: string
}

export type ResultRow = {
  candidateId: string
  votes: number
  /** % sobre votos válidos, já calculado pelo TSE (pvapn). */
  share: number
  /** Campos abaixo vêm do próprio arquivo do TSE (opcionais: snapshots antigos não têm). */
  name?: string
  number?: string
  party?: string
  /** Situação publicada pelo TSE ("Eleito", "2º turno", "Não eleito", "Suplente"...). Nunca calculada aqui. */
  status?: string
  /** Destinação do voto: "Válido", "Anulado", "Anulado sub judice"... */
  voteDestination?: string
}

export type ResultSnapshot = {
  election: string
  round: 1 | 2
  scope: string
  /** Cargo do recorte (ex.: 'Presidente', 'Governador'); ausente em snapshots antigos. */
  office?: string
  updatedAt: string | null
  totalVotes: number
  countedSections: number
  totalSections: number
  rows: ResultRow[]
  /**
   * `offline` is a read-only presentation condition (see
   * docs/sync-protocol.md "Comportamento offline"): it is derived from
   * `SyncMeta.phase` at render time and must never be written onto a
   * fetched/cached/compared snapshot. The sync layer only ever produces
   * `official` or `waiting`; UI code derives `offline` for display.
   */
  status: 'official' | 'waiting' | 'offline'
  source?: string
}

export type SyncPhase = 'idle' | 'syncing' | 'live' | 'waiting' | 'offline' | 'retrying'

export type SyncMeta = {
  phase: SyncPhase
  lastCheckedAt: string | null
  lastOfficialAt: string | null
  nextPollAt: string | null
  error: string | null
  attempt: number
}
