// Gera as imagens de preview (OG) por lugar: uma por município e uma por UF,
// a mesma para os dois domínios (sem endereço no rodapé). Roda offline, uma
// vez; é retomável (pula o que já existe). Só nomes, nenhum número eleitoral.
//
//   PLAYWRIGHT_MODULE=/caminho/node_modules/playwright/index.mjs \
//     nice -n 19 node scripts/og-places.mjs [--only sc] [--force]
//
// Saída: og-places/{uf}.jpg e og-places/{uf}/{slug}.jpg; com --year 2022,
// og-places/2022/{br,uf}.jpg e og-places/2022/{uf}/{slug}.jpg (comparativo).
// (OG_DIR muda a pasta). O servidor serve em /og/... (ver server/web.mjs).
import { mkdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { formatCityName, UF_NAMES, UF_PREPOSITION } from '../server/route-meta.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.env.OG_DIR || path.join(ROOT, 'og-places')
const args = process.argv.slice(2)
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].toUpperCase() : null
const force = args.includes('--force')
// --year 2022: prévias do comparativo, em og-places/2022/ (mais br.jpg).
const year = args.includes('--year') ? args[args.indexOf('--year') + 1] : null
const prefix = year ? `${year}/` : ''

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
const exists = (file) => stat(file).then(() => true, () => false)

const jobs = []
if (year && !only) jobs.push({ uf: 'BR', file: `${prefix}br.jpg`, place: 'Brasil', prep: 'no' })
for (const uf of Object.keys(UF_NAMES).filter((item) => !only || item === only)) {
  const cities = JSON.parse(await readFile(path.join(ROOT, 'public', 'data', 'municipios', `${uf.toLowerCase()}.json`), 'utf8'))
  jobs.push({ uf, file: `${prefix}${uf.toLowerCase()}.jpg`, place: UF_NAMES[uf], prep: UF_PREPOSITION[uf] ?? 'em' })
  for (const city of cities) jobs.push({ uf, file: `${prefix}${uf.toLowerCase()}/${city.slug}.jpg`, place: `${formatCityName(city.nm)} (${uf})`, prep: 'em' })
}

let done = 0
let skipped = 0
const started = Date.now()
await page.goto(pathToFileURL(path.join(ROOT, 'scripts', 'og-image.html')).href)
await page.evaluate(() => document.fonts.ready)
{
  for (const job of jobs) {
    const file = path.join(OUT, job.file)
    if (!force && (await exists(file))) {
      skipped += 1
      continue
    }
    await mkdir(path.dirname(file), { recursive: true })
    await page.evaluate(([place, prep, ano]) => window.setPlace(place, prep, ano), [job.place, job.prep, year])
    await page.screenshot({ path: file, type: 'jpeg', quality: 84 })
    done += 1
    if (done % 500 === 0) console.log(`${done} geradas, ${skipped} já existiam, ${Math.round((Date.now() - started) / 1000)} s`)
  }
}
await browser.close()
console.log(`fim: ${done} geradas, ${skipped} já existiam, ${Math.round((Date.now() - started) / 1000)} s`)
