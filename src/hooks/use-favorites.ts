import { useCallback, useSyncExternalStore } from 'react'

const STORAGE_KEY = 'apura-brasil:favorite-candidates'

function readStoredFavorites(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

// Um só conjunto de favoritos para a página inteira: estrela marcada numa
// lista aparece marcada (e no topo) em todas as outras na hora, e também em
// outra aba do mesmo navegador (evento storage).
let favorites: Set<string> = new Set(readStoredFavorites())
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    favorites = new Set(readStoredFavorites())
    emit()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function getSnapshot() {
  return favorites
}

function toggle(sqCandidate: string) {
  const next = new Set(favorites)
  if (next.has(sqCandidate)) next.delete(sqCandidate)
  else next.add(sqCandidate)
  favorites = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
  } catch {
    // Armazenamento indisponível (modo privado etc.): favoritos seguem só em memória nesta sessão.
  }
  emit()
}

/** Favoritos primeiro, mantendo a ordem original dentro de cada grupo. */
export function favoritesFirst<T extends { sqCandidate: string }>(list: T[], favoriteSet: Set<string>): T[] {
  if (favoriteSet.size === 0) return list
  return [...list.filter((item) => favoriteSet.has(item.sqCandidate)), ...list.filter((item) => !favoriteSet.has(item.sqCandidate))]
}

// Favoritos ficam só no aparelho (localStorage), por sqCandidate. Usado em
// todas as listas de candidato com estrela.
export function useFavoriteCandidates() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const isFavorite = useCallback((sqCandidate: string) => current.has(sqCandidate), [current])
  return { favorites: current, isFavorite, toggleFavorite: toggle }
}
