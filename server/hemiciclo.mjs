import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

// Bancada de Deputado Federal 2026 por UF e partido, montada a partir dos 27
// arquivos de UF do cargo 6 que o ingest já espelha do TSE
// (oficial/ele2026/6259/dados/{uf}/{uf}-c0006-e006259-u.json). Não faz
// pedido nenhum ao TSE: só lê o espelho. Conta como eleito o candidato que o
// próprio TSE marca como eleito (e = "s"); cadeira sem eleito definido fica
// de fora e o front mostra como "a definir".
const UFS = ['ac', 'al', 'am', 'ap', 'ba', 'ce', 'df', 'es', 'go', 'ma', 'mg', 'ms', 'mt', 'pa', 'pb', 'pe', 'pi', 'pr', 'rj', 'rn', 'ro', 'rr', 'rs', 'sc', 'se', 'sp', 'to']
const REBUILD_MIN_MS = 10_000

function fileFor(mirrorDir, uf) {
  return path.join(mirrorDir, 'oficial', 'ele2026', '6259', 'dados', uf, `${uf}-c0006-e006259-u.json`)
}

function partyKey(sigla) {
  return String(sigla || '').toUpperCase().replace(/\s+/g, '')
}

function summarizeUf(data) {
  const cargo = data.carg?.[0]
  if (!cargo) return null
  const eleitos = {}
  for (const agr of cargo.agr || []) {
    for (const par of agr.par || []) {
      for (const cand of par.cand || []) {
        if (cand.e === 's') eleitos[partyKey(par.sg)] = (eleitos[partyKey(par.sg)] || 0) + 1
      }
    }
  }
  return {
    vagas: Number(cargo.nv) || 0,
    eleitos,
    // tf = "s" quando o TSE fecha a totalização do cargo na UF.
    totalizado: data.tf === 's',
    secoesTotalizadas: data.s?.pst ?? '0,00',
    atualizado: data.dg && data.hg ? `${data.dg} ${data.hg}` : null,
  }
}

let cached = null
let builtAt = 0
let building = null

async function build(mirrorDir) {
  const ufs = {}
  let signature = ''
  await Promise.all(
    UFS.map(async (uf) => {
      const file = fileFor(mirrorDir, uf)
      try {
        const info = await stat(file)
        const summary = summarizeUf(JSON.parse(await readFile(file, 'utf8')))
        if (summary) ufs[uf.toUpperCase()] = summary
        signature += `${uf}:${info.mtimeMs};`
      } catch {
        // UF ainda sem arquivo no espelho: fica fora até o ingest baixar.
      }
    }),
  )
  const sorted = Object.fromEntries(Object.entries(ufs).sort(([a], [b]) => a.localeCompare(b)))
  return {
    signature,
    body: JSON.stringify({
      ano: 2026,
      cargo: 'Deputado Federal',
      fonte: 'TSE, resultados oficiais (arquivos de UF do cargo Deputado Federal)',
      vagas: Object.values(sorted).reduce((sum, uf) => sum + uf.vagas, 0),
      ufs: sorted,
    }),
  }
}

/** Corpo JSON da bancada 2026, refeito no máximo a cada 10 s. */
export async function hemiciclo2026(mirrorDir) {
  if (cached && Date.now() - builtAt < REBUILD_MIN_MS) return cached.body
  building ??= build(mirrorDir)
    .then((result) => {
      cached = result
      builtAt = Date.now()
      return result
    })
    .finally(() => {
      building = null
    })
  return (await building).body
}
