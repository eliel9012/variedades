import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sourceZip = join(root, 'work/tse/consulta_cand_2026.zip')
const photoZip = join(root, 'work/tse/foto_cand2026_BR_div.zip')
const photoZipDir = join(root, 'work/tse/photos')
const outputDir = join(root, 'public/data')
const photoDir = join(outputDir, 'photos')
mkdirSync(photoDir, { recursive: true })

if (!existsSync(sourceZip)) {
  throw new Error('Missing work/tse/consulta_cand_2026.zip. Download official TSE candidate archive first.')
}

const csv = execFileSync('unzip', ['-p', sourceZip, 'consulta_cand_2026_BRASIL.csv'], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1')

function parseLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"' && quoted) {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ';' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }
  values.push(value)
  return values
}

const lines = csv.trim().split(/\r?\n/)
const header = parseLine(lines.shift())
const index = Object.fromEntries(header.map((key, position) => [key, position]))
const read = (row, key) => row[index[key]] ?? ''
const candidates = lines.map(parseLine)
  .map((row) => ({
    sqCandidate: read(row, 'SQ_CANDIDATO'),
    number: Number(read(row, 'NR_CANDIDATO')),
    name: read(row, 'NM_CANDIDATO'),
    ballotName: read(row, 'NM_URNA_CANDIDATO'),
    uf: read(row, 'SG_UF'),
    office: read(row, 'DS_CARGO'),
    officeCode: Number(read(row, 'CD_CARGO')),
    party: read(row, 'SG_PARTIDO'),
    partyName: read(row, 'NM_PARTIDO'),
    situation: read(row, 'DS_SITUACAO_CANDIDATURA'),
    photo: `/data/photos/F${read(row, 'SG_UF')}${read(row, 'SQ_CANDIDATO')}_div.jpg`,
  }))

writeFileSync(join(outputDir, 'candidates.json'), `${JSON.stringify(candidates)}\n`)
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  election: 2026,
  generatedAt: new Date().toISOString(),
  sources: {
    candidates: 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip',
    candidatePhotos: 'https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes2026/fotos/foto_cand2026_BR_div.zip',
    results: 'https://resultados.tse.jus.br/',
  },
  records: {
    candidates: candidates.length,
    byOffice: Object.fromEntries(candidates.reduce((counts, candidate) => counts.set(candidate.office, (counts.get(candidate.office) || 0) + 1), new Map())),
  },
  notes: 'Snapshot local de todas as candidaturas do arquivo oficial, sem dados pessoais sensíveis. Resultados entram somente após publicação oficial do TSE.',
}, null, 2)}\n`)

const photoZips = existsSync(photoZipDir)
  ? readdirSync(photoZipDir).filter((name) => name.endsWith('.zip')).map((name) => join(photoZipDir, name))
  : existsSync(photoZip) ? [photoZip] : []

for (const photoArchive of photoZips) {
  const names = execFileSync('unzip', ['-Z1', photoArchive], { maxBuffer: 8 * 1024 * 1024 }).toString('utf8').trim().split(/\r?\n/).filter(Boolean)
  for (const name of names) {
    const target = join(photoDir, name.split('/').at(-1))
    const image = execFileSync('unzip', ['-p', photoArchive, name])
    writeFileSync(target, image)
  }
}

console.log(`TSE snapshot: ${candidates.length} candidaturas + ${photoZips.length} arquivo(s) de fotos`)
