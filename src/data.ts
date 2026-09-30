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

export type Office = 'Presidente' | 'Governador' | 'Senador' | 'Deputado federal' | 'Deputado estadual' | 'Deputado distrital'

export const offices: Office[] = ['Presidente', 'Governador', 'Senador', 'Deputado federal', 'Deputado estadual', 'Deputado distrital']
export const states = ['Brasil', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']

export const officeCodes: Record<Office, number> = {
  Presidente: 1,
  Governador: 3,
  Senador: 5,
  'Deputado federal': 6,
  'Deputado estadual': 7,
  'Deputado distrital': 8,
}

export function canHaveSecondRound(office: string) {
  return office === 'Presidente' || office === 'Governador'
}

export function statesForOffice(office: string) {
  if (office === 'Presidente') return ['Brasil']
  if (office === 'Deputado distrital') return ['DF']
  return states.filter((state) => state !== 'Brasil')
}
