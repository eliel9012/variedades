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
  share: number
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
