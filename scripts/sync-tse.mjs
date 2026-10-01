import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const ELECTION_YEAR = process.env.TSE_ELECTION_YEAR || '2026'
const sourceZip = join(root, `work/tse/consulta_cand_${ELECTION_YEAR}.zip`)
const sourceCsvName = `consulta_cand_${ELECTION_YEAR}_BRASIL.csv`
const photoZip = join(root, `work/tse/foto_cand${ELECTION_YEAR}_BR_div.zip`)
const photoZipDir = join(root, 'work/tse/photos')
const outputDir = join(root, 'public/data')
const photoDir = join(outputDir, 'photos')
const MIN_PLAUSIBLE_CANDIDATES = 1000
mkdirSync(photoDir, { recursive: true })

if (!existsSync(sourceZip)) {
  throw new Error(`Missing work/tse/consulta_cand_${ELECTION_YEAR}.zip. Download official TSE candidate archive first.`)
}

// Pre-flight: make sure the `unzip` binary is available before relying on it below.
try {
  execFileSync('which', ['unzip'], { stdio: 'ignore' })
} catch {
  throw new Error("comando 'unzip' não encontrado no PATH. Instale o pacote unzip antes de rodar o sync.")
}

// Make sure the archive actually contains the CSV we expect before trying to stream it out.
const sourceZipEntries = execFileSync('unzip', ['-l', sourceZip], { maxBuffer: 8 * 1024 * 1024 }).toString('utf8')
if (!sourceZipEntries.includes(sourceCsvName)) {
  throw new Error(`consulta_cand_${ELECTION_YEAR}.zip não contém ${sourceCsvName} — verifique se o TSE renomeou o arquivo.`)
}

const csv = execFileSync('unzip', ['-p', sourceZip, sourceCsvName], { maxBuffer: 64 * 1024 * 1024 }).toString('latin1')

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

// NOTE: this parser does not support fields with embedded newlines inside quotes
// (full RFC4180 multi-line quoting). The TSE candidate CSV has not been observed
// to use embedded newlines, so this is a known, accepted limitation rather than
// a full CSV/semicolon parser.
const trimmedCsv = csv.trim()
// Strip a leading BOM (﻿, U+FEFF) if present so it doesn't get prepended to the
// first header column's name (which would otherwise silently break lookups).
const bomStrippedCsv = trimmedCsv.charCodeAt(0) === 0xfeff ? trimmedCsv.slice(1) : trimmedCsv
const lines = bomStrippedCsv.split(/\r?\n/)
const header = parseLine(lines.shift())
const index = Object.fromEntries(header.map((key, position) => [key, position]))
const read = (row, key) => row[index[key]] ?? ''

const REQUIRED_COLUMNS = [
  'SQ_CANDIDATO',
  'NR_CANDIDATO',
  'NM_CANDIDATO',
  'NM_URNA_CANDIDATO',
  'SG_UF',
  'DS_CARGO',
  'CD_CARGO',
  'SG_PARTIDO',
  'NM_PARTIDO',
  'DS_SITUACAO_CANDIDATURA',
]
const missingColumns = REQUIRED_COLUMNS.filter((column) => !(column in index))
if (missingColumns.length > 0) {
  throw new Error(`Colunas ausentes no CSV do TSE: ${missingColumns.join(', ')}. O layout do arquivo pode ter mudado.`)
}

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

if (candidates.length < MIN_PLAUSIBLE_CANDIDATES) {
  throw new Error(`Apenas ${candidates.length} candidaturas encontradas (esperado pelo menos ${MIN_PLAUSIBLE_CANDIDATES}). Abortando para não sobrescrever os dados com um snapshot incompleto — verifique o arquivo de origem.`)
}

writeFileSync(join(outputDir, 'candidates.json'), `${JSON.stringify(candidates)}\n`)
writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  election: Number(ELECTION_YEAR),
  generatedAt: new Date().toISOString(),
  sources: {
    candidates: `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${ELECTION_YEAR}.zip`,
    candidatePhotos: `https://cdn.tse.jus.br/estatistica/sead/eleicoes/eleicoes${ELECTION_YEAR}/fotos/foto_cand${ELECTION_YEAR}_BR_div.zip`,
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

let copiedPhotos = 0
let skippedPhotos = 0
for (const photoArchive of photoZips) {
  let names = []
  try {
    names = execFileSync('unzip', ['-Z1', photoArchive], { maxBuffer: 8 * 1024 * 1024 }).toString('utf8').trim().split(/\r?\n/).filter(Boolean)
  } catch (error) {
    console.warn(`Aviso: não foi possível listar ${photoArchive} (${error.message}). Pulando este arquivo.`)
    continue
  }
  for (const name of names) {
    try {
      const target = join(photoDir, name.split('/').at(-1))
      const image = execFileSync('unzip', ['-p', photoArchive, name])
      writeFileSync(target, image)
      copiedPhotos += 1
    } catch (error) {
      skippedPhotos += 1
      console.warn(`Aviso: falha ao copiar foto "${name}" de ${photoArchive} (${error.message}). Pulando e continuando.`)
    }
  }
}

console.log(`TSE snapshot: ${candidates.length} candidaturas + ${photoZips.length} arquivo(s) de fotos (${copiedPhotos} fotos copiadas, ${skippedPhotos} puladas)`)
