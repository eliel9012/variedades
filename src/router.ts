import { useSyncExternalStore } from 'react'
import { states } from './data'

// Router minimalista, sem dependência nova: qualquer componente pode ler a
// rota atual com `useRoute()` (sem precisar de Context/prop-drilling, já que
// é um dado global do navegador) e navegar com `navigate()`. `pushState` não
// dispara `popstate` sozinho, então `navigate` notifica os ouvintes na mão;
// o botão voltar/avançar do navegador aciona o `popstate` real.
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify)
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (typeof window === 'undefined') return
  if (window.location.pathname === path) return
  if (options.replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  notify()
}

export function useRoute(): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange)
      return () => listeners.delete(onStoreChange)
    },
    () => window.location.pathname,
    () => '/',
  )
}

/** UFs são sempre comparadas sem diferenciar maiúscula/minúscula e
 * canonicalizadas em maiúsculas; a URL usa minúsculas por ficar mais limpa
 * (`/pesquisas/presidente/sp`, não `/SP`). */
export function ufSegment(uf: string) {
  return uf.toLowerCase()
}

// Só as 27 UFs reais (lista de src/data.ts, sem o 'Brasil'): qualquer outro
// par de letras na URL (ex.: `/apuracao/xx`) não é tratado como estado.
const VALID_UFS = new Set(states.filter((item) => item !== 'Brasil'))

export function parseUfSegment(segment: string | undefined): string | null {
  if (!segment) return null
  const uf = segment.toUpperCase()
  return VALID_UFS.has(uf) ? uf : null
}
