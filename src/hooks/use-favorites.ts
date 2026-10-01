import { useCallback, useEffect, useState } from 'react'

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

// Favoritos ficam só no aparelho (localStorage), por sqCandidate. Usado em
// todas as listas de candidato (presidente, estados, composição parlamentar).
export function useFavoriteCandidates() {
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set(readStoredFavorites()))

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]))
    } catch {
      // Armazenamento indisponível (modo privado etc.): favoritos seguem só em memória nesta sessão.
    }
  }, [favorites])

  const isFavorite = useCallback((sqCandidate: string) => favorites.has(sqCandidate), [favorites])

  const toggleFavorite = useCallback((sqCandidate: string) => {
    setFavorites((current) => {
      const next = new Set(current)
      if (next.has(sqCandidate)) next.delete(sqCandidate)
      else next.add(sqCandidate)
      return next
    })
  }, [])

  return { favorites, isFavorite, toggleFavorite }
}
