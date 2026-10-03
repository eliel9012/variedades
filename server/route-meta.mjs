// Prévia de link por rota (WhatsApp e redes leem só o HTML, sem JS): título,
// descrição e og:url do recorte de apuração aberto. Só usa dados estáticos
// (nomes de UF e a lista de municípios em public/data); nenhum número.
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const UF_NAMES = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo',
  GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba',
  PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
}
// Mesma preposição do card (src/components/ui/apuracao-cards.tsx).
export const UF_PREPOSITION = { AC: 'no', AP: 'no', AM: 'no', CE: 'no', DF: 'no', ES: 'no', MA: 'no', PA: 'no', PR: 'no', PI: 'no', RJ: 'no', RN: 'no', RS: 'no', TO: 'no', BA: 'na', PB: 'na' }
// Mesmos slugs de cargo da SPA (src/App.tsx, OFFICE_SLUG).
const OFFICE_BY_SLUG = {
  presidente: 'Presidente', governador: 'Governador', senador: 'Senador',
  deputadofederal: 'Deputado federal', deputadoestadual: 'Deputado estadual', deputadodistrital: 'Deputado distrital',
}
// Igual a formatCityName (src/municipios.ts).
const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'à'])
const capitalize = (word) => (word ? word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1) : word)
export function formatCityName(nm) {
  return nm.toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean).map((word, index) => {
    if (index > 0 && LOWERCASE_WORDS.has(word)) return word
    const apostrophe = /^(d|n)['’](.+)$/.exec(word)
    if (apostrophe) return `${index > 0 ? apostrophe[1] : apostrophe[1].toLocaleUpperCase('pt-BR')}'${capitalize(apostrophe[2])}`
    return word.split('-').map((part, partIndex) => (partIndex > 0 && LOWERCASE_WORDS.has(part) ? part : capitalize(part))).join('-')
  }).join(' ')
}

const cityLists = new Map()
async function cityName(dataDir, uf, slug) {
  if (!cityLists.has(uf)) {
    cityLists.set(uf, readFile(path.join(dataDir, 'municipios', `${uf.toLowerCase()}.json`), 'utf8')
      .then((text) => new Map(JSON.parse(text).map((item) => [item.slug, item.nm])))
      .catch(() => new Map()))
  }
  const nm = (await cityLists.get(uf)).get(slug)
  return nm ? formatCityName(nm) : null
}

/** Meta da rota, ou null para usar o HTML padrão. */
export async function routeMeta(dataDir, urlPath) {
  const parts = urlPath.split('/').filter(Boolean)
  const comparativo = parts[0] === 'comparativo'
  if (parts[0] !== 'apuracao' && !comparativo) return null
  // Comparativo 2022: mesmos recortes; sem cargo, a UF abre em Governador.
  const build = comparativo ? (office, place, placeIn) => metaComparativo(office ?? 'Governador', place, placeIn) : meta
  if (comparativo && (parts.length === 1 || (parts[1] === 'presidente' && parts.length === 2))) return metaComparativo('Presidente', 'Brasil', 'no Brasil')
  if (parts[1] === 'presidente' && parts.length === 2) return meta('Presidente', 'Brasil', 'no Brasil')
  const uf = (parts[1] || '').toUpperCase()
  if (!UF_NAMES[uf] || parts.length > 4) return null
  // Sem cargo na URL: título só com o lugar (a página mostra todos os cargos).
  let office = null
  let slug = null
  const last = parts[parts.length - 1]
  if (parts.length >= 3 && OFFICE_BY_SLUG[last]) office = OFFICE_BY_SLUG[last]
  else if (parts.length === 4) return null
  if (parts.length === 4 || (parts.length === 3 && !OFFICE_BY_SLUG[last])) slug = parts[2]
  if (office === 'Deputado distrital' && uf !== 'DF') return null
  if (office === 'Deputado estadual' && uf === 'DF') return null
  if (slug) {
    const name = await cityName(dataDir, uf, slug)
    if (!name) return null
    const place = `${name} (${uf})`
    return { ...build(office, place, `em ${place}`), image: `${uf.toLowerCase()}/${slug}`, imageAlt: `Apura Brasil, ${comparativo ? 'comparativo 2022' : 'apuração'} em ${place}` }
  }
  const placeIn = `${UF_PREPOSITION[uf] ?? 'em'} ${UF_NAMES[uf]}`
  return { ...build(office, UF_NAMES[uf], placeIn), image: uf.toLowerCase(), imageAlt: `Apura Brasil, ${comparativo ? 'comparativo 2022' : 'apuração'} ${placeIn}` }
}

function metaComparativo(office, place, placeIn) {
  const label = office === 'Deputado distrital' ? 'Deputado Distrital' : office
  return {
    title: `Comparativo 2022 · ${label} · ${place} · Apura Brasil`,
    description: `Resultado de ${label} ${placeIn} em 2022 ao lado da apuração de 2026, com os dados oficiais do TSE.`,
  }
}

function meta(office, place, placeIn) {
  if (!office) {
    return {
      title: `Apuração ${placeIn} · Eleições 2026 · Apura Brasil`,
      description: `Acompanhe ao vivo a apuração de Presidente, Governador, Senador e Deputados ${placeIn} com os dados oficiais do TSE.`,
    }
  }
  const label = office === 'Deputado distrital' ? 'Deputado Distrital' : office
  return {
    title: `Apuração ${label} · ${place} · Eleições 2026 · Apura Brasil`,
    description: `Acompanhe ao vivo a apuração de ${label} ${placeIn} com os dados oficiais do TSE.`,
  }
}

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Sobe quando o desenho das imagens por lugar mudar (o Cloudflare guarda 30 dias).
export const OG_PLACES_VERSION = 1

/** Aplica a meta no HTML já ajustado para o domínio. withImage: a imagem do
 * lugar existe em disco (senão fica a imagem padrão do domínio). */
export function applyRouteMeta(html, host, urlPath, info, withImage) {
  const title = escapeHtml(info.title)
  const description = escapeHtml(info.description)
  const pagePath = urlPath.split('/').map((part) => encodeURIComponent(part)).join('/')
  const out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*/g, `$1${title}`)
    .replace(/(<meta (?:name="description"|property="og:description"|name="twitter:description") content=")[^"]*/g, `$1${description}`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1https://${host}${pagePath}`)
    .replace(/(<link rel="canonical" href=")[^"]*/, `$1https://eleicoes.meulab.fun${pagePath}`)
  if (!withImage || !info.image) return out
  return out
    .replace(/(<meta (?:property="og:image"|name="twitter:image") content=")[^"]*/g, `$1https://${host}/og/${info.image}.jpg?v=${OG_PLACES_VERSION}`)
    .replace(/<meta property="og:image:type" content="image\/png"/, '<meta property="og:image:type" content="image/jpeg"')
    .replace(/(<meta property="og:image:alt" content=")[^"]*/, `$1${escapeHtml(info.imageAlt)}`)
}
