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
  updatedAt: string | null
  totalVotes: number
  countedSections: number
  totalSections: number
  rows: ResultRow[]
  status: 'official' | 'waiting' | 'offline'
}
