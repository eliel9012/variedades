import type { Candidate, ResultSnapshot } from './types'

export const candidateSeed: Candidate[] = [
  {
    sqCandidate: '280002542548',
    number: 13,
    name: 'LUIZ INÁCIO LULA DA SILVA',
    ballotName: 'LULA',
    uf: 'BR',
    office: 'PRESIDENTE',
    officeCode: 1,
    party: 'PT',
    partyName: 'PARTIDO DOS TRABALHADORES',
    situation: '#NE',
    photo: '/data/photos/FBR280002542548_div.jpg',
  },
  {
    sqCandidate: '280002538811',
    number: 80,
    name: 'SAMARA MARTINS DA SILVA FEITOSA',
    ballotName: 'SAMARA',
    uf: 'BR',
    office: 'PRESIDENTE',
    officeCode: 1,
    party: 'UP',
    partyName: 'UNIDADE POPULAR',
    situation: '#NE',
    photo: '/data/photos/FBR280002538811_div.jpg',
  },
]

export const initialSnapshot: ResultSnapshot = {
  election: 'Eleições Gerais 2026',
  round: 1,
  scope: 'BR',
  updatedAt: null,
  totalVotes: 0,
  countedSections: 0,
  totalSections: 0,
  rows: [],
  status: 'waiting',
}

export const offices = ['Presidente', 'Governador', 'Senador', 'Deputado federal']
export const states = ['Brasil', 'SP', 'RJ', 'MG', 'BA', 'PR', 'RS', 'PE']
