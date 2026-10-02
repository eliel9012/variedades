import { useSyncExternalStore } from 'react'

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

const UF_RE = /^[a-z]{2}$/i

export function parseUfSegment(segment: string | undefined): string | null {
  if (!segment || !UF_RE.test(segment)) return null
  return segment.toUpperCase()
}
