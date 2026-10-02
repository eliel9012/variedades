// Loader/cache simples para os arquivos public/data/polls-*.json usados pelo
// modulo de cenarios (server/scenario.mjs). So leitura + JSON.parse, cache em
// memoria de processo (sem file watching: o processo precisa ser reiniciado
// se os JSONs forem regerados por npm run sync:polls).

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', 'public', 'data')

const FILES = {
  presidenteNacional: 'polls-presidente-nacional.json',
  presidenteEstados: 'polls-presidente-estados.json',
  governadorEstados: 'polls-governador-estados.json',
  senado: 'polls-senado.json',
  partyIdeology: 'party-ideology.json',
  presidenteHistorico: 'polls-presidente-historico.json',
}

const cache = new Map()

async function loadFile(key) {
  if (cache.has(key)) return cache.get(key)
  const filePath = path.join(DATA_DIR, FILES[key])
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  cache.set(key, parsed)
  return parsed
}

export function loadPresidenteNacional() {
  return loadFile('presidenteNacional')
}

export function loadPresidenteEstados() {
  return loadFile('presidenteEstados')
}

export function loadGovernadorEstados() {
  return loadFile('governadorEstados')
}

export function loadSenado() {
  return loadFile('senado')
}

/** Classificação ideológica (esquerda/centro/direita) por partido, fonte
 * acadêmica única (ver campo `source` do próprio arquivo). Usado só para
 * anexar contexto grounded ao JSON de /api/scenario, nunca para gerar
 * classificação própria. */
export function loadPartyIdeology() {
  return loadFile('partyIdeology')
}

/** Histórico presidencial 2018/2022 (resultado oficial TSE) + 2026 (pesquisa)
 * por estado, compilado manualmente a partir de data/sources/*.xlsx (ver
 * scripts/convert-presidente-historico-xlsx.py). Cobre SÓ a corrida de
 * Presidente (PT x PL), nunca Governador/Senado. */
export function loadPresidenteHistorico() {
  return loadFile('presidenteHistorico')
}

/** So para testes: limpa o cache em memoria. */
export function clearCache() {
  cache.clear()
}
