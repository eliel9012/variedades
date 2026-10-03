// Pré-aquece no Cloudflare as imagens de preview por lugar (og-places/), nos
// dois domínios. Com o Tiered Cache ligado, o tier superior guarda a cópia e
// todo POP abre rápido. Ritmo baixo (~20/s) contra o próprio servidor; nenhum
// pedido ao TSE. Rodado depois do purge do deploy (o purge por host limpa /og).
// Antes das imagens, aquece também o resultado de 2022 de Brasil e de UF
// (/data/2022/{cargo}/t{n}/*.json, ~300 arquivos); os de município (36 mil)
// ficam sob demanda.
//
//   node scripts/warm-og.mjs [--rate 20]
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OG_PLACES_VERSION } from '../server/route-meta.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = process.env.OG_DIR || path.join(ROOT, 'og-places')
const HISTORY_DIR = process.env.HISTORY_2022_DIR || path.join(ROOT, 'work', 'tse2022', 'out')
const HOSTS = ['eleicoes.meulab.fun', 'eleicoesphvox.com.br']
const args = process.argv.slice(2)
const rate = args.includes('--rate') ? Number(args[args.indexOf('--rate') + 1]) : 20

const urls = []
try {
  for (const cargo of await readdir(HISTORY_DIR, { withFileTypes: true })) {
    if (!cargo.isDirectory()) continue
    for (const turno of await readdir(path.join(HISTORY_DIR, cargo.name))) {
      for (const name of await readdir(path.join(HISTORY_DIR, cargo.name, turno))) {
        if (name.endsWith('.json')) urls.push(`/data/2022/${cargo.name}/${turno}/${name}`)
      }
    }
  }
} catch {
  // Sem dados de 2022 nesta máquina: aquece só as imagens.
}
// og-places/{uf}.jpg, {uf}/{cidade}.jpg e 2022/... (prévias do comparativo).
for (const name of await readdir(DIR, { recursive: true })) {
  if (name.endsWith('.jpg')) urls.push(`/og/${name.split(path.sep).join('/')}?v=${OG_PLACES_VERSION}`)
}

const counts = {}
const started = Date.now()
let index = 0
for (const host of HOSTS) {
  for (const url of urls) {
    const status = await fetch(`https://${host}${url}`, { headers: { 'accept-encoding': 'br, gzip' } })
      .then(async (res) => {
        await res.arrayBuffer()
        return `${res.status} ${res.headers.get('cf-cache-status') ?? '-'}`
      })
      .catch(() => 'erro')
    counts[status] = (counts[status] ?? 0) + 1
    index += 1
    const wait = (index * 1000) / rate - (Date.now() - started)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }
}
console.log(`warm-og: ${index} pedidos em ${Math.round((Date.now() - started) / 1000)} s`, counts)
