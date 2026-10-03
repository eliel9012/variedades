import { useEffect, useState } from 'react'

// Lista estática gerada por scripts/build-municipios.mjs (servida em
// /data/municipios/{uf}.json): código TSE de 5 dígitos, IBGE, nome em
// maiúsculas como o TSE publica, slug único por UF e se é capital.
export type Municipio = { cd: string; ibge: string; nm: string; slug: string; capital: boolean }

const listCache = new Map<string, Promise<Municipio[]>>()

export function loadMunicipios(uf: string): Promise<Municipio[]> {
  const key = uf.toLowerCase()
  const cached = listCache.get(key)
  if (cached) return cached
  const promise = fetch(`/data/municipios/${key}.json`)
    .then((response) => (response.ok ? (response.json() as Promise<Municipio[]>) : Promise.reject(new Error(`municipios ${response.status}`))))
    .then((data) => (Array.isArray(data) ? data : Promise.reject(new Error('municipios inválido'))))
    .catch((error) => {
      listCache.delete(key)
      throw error
    })
  listCache.set(key, promise)
  return promise
}

/** Lista de municípios da UF (null = carregando ou sem UF). */
export function useMunicipios(uf: string | null): { list: Municipio[] | null; error: boolean } {
  const [loaded, setLoaded] = useState<{ uf: string; list: Municipio[] | null; error: boolean } | null>(null)
  useEffect(() => {
    if (!uf) return
    let alive = true
    loadMunicipios(uf)
      .then((list) => alive && setLoaded({ uf, list, error: false }))
      .catch(() => alive && setLoaded({ uf, list: null, error: true }))
    return () => {
      alive = false
    }
  }, [uf])
  if (!uf || !loaded || loaded.uf !== uf) return { list: null, error: false }
  return { list: loaded.list, error: loaded.error }
}

/** Sem acento, minúsculas, só letras/números separados por espaço:
 * "são" e "SAO" viram "sao"; "D'OESTE" vira "d oeste". */
export function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const LOWERCASE_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'a', 'o', 'à'])

function capitalize(word: string) {
  return word ? word.charAt(0).toLocaleUpperCase('pt-BR') + word.slice(1) : word
}

/** "SÃO JOSÉ DOS CAMPOS" -> "São José dos Campos"; "SANTA BÁRBARA D'OESTE"
 * -> "Santa Bárbara d'Oeste"; "EMBU-GUAÇU" -> "Embu-Guaçu". */
export function formatCityName(nm: string) {
  return nm
    .toLocaleLowerCase('pt-BR')
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      if (index > 0 && LOWERCASE_WORDS.has(word)) return word
      const apostrophe = /^(d|n)['’](.+)$/.exec(word)
      if (apostrophe) return `${index > 0 ? apostrophe[1] : apostrophe[1].toLocaleUpperCase('pt-BR')}'${capitalize(apostrophe[2])}`
      return word.split('-').map((part, partIndex) => (partIndex > 0 && LOWERCASE_WORDS.has(part) ? part : capitalize(part))).join('-')
    })
    .join(' ')
}

/** Ordena por relevância: nome igual, começa com, alguma palavra começa com,
 * contém. Empate: capital primeiro, depois ordem alfabética da lista. */
export function searchMunicipios(list: Municipio[], query: string, limit = 8): Municipio[] {
  const q = normalizeSearch(query)
  if (!q) return []
  const scored: Array<{ item: Municipio; score: number; index: number }> = []
  list.forEach((item, index) => {
    const name = normalizeSearch(item.nm)
    let score = -1
    if (name === q) score = 0
    else if (name.startsWith(q)) score = 1
    else if (name.split(' ').some((word) => word.startsWith(q)) || name.includes(` ${q}`)) score = 2
    else if (name.includes(q)) score = 3
    if (score >= 0) scored.push({ item, score, index })
  })
  scored.sort((a, b) => a.score - b.score || Number(b.item.capital) - Number(a.item.capital) || a.index - b.index)
  return scored.slice(0, limit).map((entry) => entry.item)
}
