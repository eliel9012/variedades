// Consentimento só pro que de fato usa cookie/identificador pessoal (hoje:
// anúncio, quando configurado). Umami não usa cookie nem guarda dado
// pessoal (ver README > Analytics), então roda sempre, sem depender disso,
// não é "cookie não essencial", é analytics anônimo agregado.
const STORAGE_KEY = 'apura-brasil-consent'
export type ConsentValue = 'accepted' | 'rejected'

type Listener = (value: ConsentValue) => void
const listeners = new Set<Listener>()

export function getStoredConsent(): ConsentValue | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'accepted' || value === 'rejected' ? value : null
  } catch {
    return null
  }
}

export function hasAdConsent(): boolean {
  return getStoredConsent() === 'accepted'
}

export function setConsent(value: ConsentValue) {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Sem acesso a localStorage (modo privado etc): a escolha só vale pra
    // sessão atual, o banner volta a aparecer na próxima visita.
  }
  listeners.forEach((listener) => listener(value))
}

export function onConsentChange(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
