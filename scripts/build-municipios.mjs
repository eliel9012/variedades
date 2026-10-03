#!/usr/bin/env node
// Gera os arquivos estáticos de municípios (rodar 1x; o resultado vai pro git):
// - public/data/municipios/index.json: UF > quantidade de municípios
// - public/data/municipios/{uf}.json: [{ cd (TSE), ibge, nm, slug, capital }]
// - public/data/malhas/{uf}.json: { viewBox, paths: { cdTSE: "M..." } }, já
//   projetado em SVG para o front não precisar de biblioteca de mapa.
// Fontes: config de municípios do TSE (mun-e006257-cm.json) e malhas do IBGE
// (qualidade mínima). TSE e IBGE se ligam pelo código IBGE (cdi).
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_MUN = path.join(ROOT, 'public', 'data', 'municipios')
const OUT_MESH = path.join(ROOT, 'public', 'data', 'malhas')
const TSE_MUN = 'https://resultados.tse.jus.br/oficial/ele2026/6257/config/mun-e006257-cm.json'
const IBGE_MESH = (uf) => `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf.toUpperCase()}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`
const WIDTH = 1000 // largura do viewBox; altura sai da proporção da UF

export const slugify = (name) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function getJson(url) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
      return await response.json()
    } catch (error) {
      if (attempt >= 3) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
}

/** Projeção equirretangular com correção de latitude média (UF é pequena o bastante). */
function buildPaths(features) {
  const rings = (geometry) => (geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat())
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const feature of features) {
    for (const ring of rings(feature.geometry)) {
      for (const [x, y] of ring) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x)
        minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      }
    }
  }
  const kx = Math.cos((((minY + maxY) / 2) * Math.PI) / 180)
  const scale = WIDTH / ((maxX - minX) * kx)
  const height = Math.ceil((maxY - minY) * scale)
  const round = (value) => Math.round(value * 10) / 10
  const paths = {}
  for (const feature of features) {
    let d = ''
    for (const ring of rings(feature.geometry)) {
      let last = ''
      ring.forEach(([x, y], index) => {
        const point = `${round((x - minX) * kx * scale)} ${round((maxY - y) * scale)}`
        if (point === last) return // vértices que colapsam no arredondamento
        d += `${index === 0 ? 'M' : 'L'}${point}`
        last = point
      })
      d += 'Z'
    }
    paths[feature.properties.codarea] = d
  }
  return { viewBox: `0 0 ${WIDTH} ${height}`, paths }
}

async function main() {
  await mkdir(OUT_MUN, { recursive: true })
  await mkdir(OUT_MESH, { recursive: true })
  const config = await getJson(TSE_MUN)
  const index = {}
  const problems = []
  for (const abr of config.abr) {
    const uf = abr.cd.toLowerCase()
    if (uf === 'zz') continue // exterior: sem malha e sem governador/senador
    const cities = abr.mu
      .map((mu) => ({ cd: mu.cd, ibge: mu.cdi, nm: mu.nm, slug: slugify(mu.nm), capital: mu.c === 's' }))
      .sort((a, b) => a.nm.localeCompare(b.nm, 'pt-BR'))
    const slugs = new Set()
    for (const city of cities) {
      if (slugs.has(city.slug)) problems.push(`${uf}: slug repetido ${city.slug}`)
      slugs.add(city.slug)
    }
    const geo = await getJson(IBGE_MESH(uf))
    const mesh = buildPaths(geo.features)
    // Reindexa pelo código TSE (o front só conhece cd TSE).
    const byIbge = new Map(cities.map((city) => [city.ibge, city.cd]))
    const paths = {}
    for (const [ibge, d] of Object.entries(mesh.paths)) {
      const cd = byIbge.get(ibge)
      if (cd) paths[cd] = d
      else problems.push(`${uf}: polígono IBGE ${ibge} sem município no TSE`)
    }
    for (const city of cities) if (!paths[city.cd]) problems.push(`${uf}: ${city.nm} (${city.cd}/${city.ibge}) sem polígono`)
    await writeFile(path.join(OUT_MUN, `${uf}.json`), JSON.stringify(cities))
    await writeFile(path.join(OUT_MESH, `${uf}.json`), JSON.stringify({ viewBox: mesh.viewBox, paths }))
    index[uf] = cities.length
    console.log(`${uf}: ${cities.length} municípios, ${Object.keys(paths).length} polígonos`)
  }
  await writeFile(path.join(OUT_MUN, 'index.json'), JSON.stringify(index))
  const total = Object.values(index).reduce((sum, value) => sum + value, 0)
  console.log(`total: ${total} municípios`)
  if (problems.length) {
    console.log(`${problems.length} diferença(s):`)
    for (const problem of problems) console.log(`  ${problem}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
