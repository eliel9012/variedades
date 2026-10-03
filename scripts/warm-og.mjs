// Pré-aquece no Cloudflare as imagens de preview por lugar (og-places/), nos
// dois domínios. Com o Tiered Cache ligado, o tier superior guarda a cópia e
// todo POP abre rápido. Ritmo baixo (~20/s) contra o próprio servidor; nenhum
// pedido ao TSE. Rodado depois do purge do deploy (o purge por host limpa /og).
//
//   node scripts/warm-og.mjs [--rate 20]
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { OG_PLACES_VERSION } from '../server/route-meta.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = process.env.OG_DIR || path.join(ROOT, 'og-places')
const HOSTS = ['eleicoes.meulab.fun', 'eleicoesphvox.com.br']
const args = process.argv.slice(2)
const rate = args.includes('--rate') ? Number(args[args.indexOf('--rate') + 1]) : 20

const files = []
for (const item of await readdir(DIR, { withFileTypes: true })) {
  if (item.isFile()) files.push(item.name)
  else for (const name of await readdir(path.join(DIR, item.name))) files.push(`${item.name}/${name}`)
}

const counts = {}
const started = Date.now()
let index = 0
for (const host of HOSTS) {
  for (const file of files) {
    const status = await fetch(`https://${host}/og/${file}?v=${OG_PLACES_VERSION}`)
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
