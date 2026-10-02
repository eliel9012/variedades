// Carregador genérico de anúncio, desligado por padrão. Serve pra qualquer
// rede que funcione com uma tag <script src="..."> simples carregada uma vez
// no <head> (AdSense, Media.net, Ezoic e a maioria das alternativas seguem
// esse padrão), troca de rede é só trocar as env vars, sem mexer em código.
// Só carrega quando:
//   1) a rede está configurada no build (VITE_AD_SCRIPT_URL), e
//   2) a pessoa aceitou cookie não essencial no banner (ver cookie-consent.ts).
// Nunca carrega sozinho sem as duas condições.
import { hasAdConsent, onConsentChange } from './cookie-consent'

export type AdSlotName = 'header' | 'footer' | 'sidebar' | 'in-content'

// Cada posição (header/footer/sidebar/in-content) tem sua própria env var de
// ID de unidade de anúncio: redes de verdade (AdSense, Media.net, Ezoic etc)
// quase sempre exigem um ID por posição, não só um script global único.
// Posição sem env var preenchida = nunca mostra nada ali, mesmo com a rede
// configurada e consentimento dado (ver AdSlot).
const SLOT_ENV: Record<AdSlotName, string | undefined> = {
  header: import.meta.env.VITE_AD_SLOT_HEADER,
  footer: import.meta.env.VITE_AD_SLOT_FOOTER,
  sidebar: import.meta.env.VITE_AD_SLOT_SIDEBAR,
  'in-content': import.meta.env.VITE_AD_SLOT_INCONTENT,
}

export function adSlotId(slot: AdSlotName): string | undefined {
  return SLOT_ENV[slot] || undefined
}

let injected = false
let scriptLoaded = false
const scriptLoadListeners = new Set<() => void>()

export function adClientId(): string | undefined {
  return import.meta.env.VITE_AD_CLIENT_ID || undefined
}

function injectAdScript() {
  if (injected) return
  const scriptUrl = import.meta.env.VITE_AD_SCRIPT_URL
  if (!scriptUrl) return
  injected = true

  const script = document.createElement('script')
  script.async = true
  script.src = scriptUrl
  script.crossOrigin = 'anonymous'
  script.onload = () => {
    scriptLoaded = true
    scriptLoadListeners.forEach((listener) => listener())
  }
  document.head.appendChild(script)
}

export function initAds() {
  if (hasAdConsent()) injectAdScript()
  onConsentChange((consent) => {
    if (consent === 'accepted') injectAdScript()
  })
}

// AdSense (rede em uso): depois que o script global carrega, cada <ins
// class="adsbygoogle"> novo na página precisa de um
// `(adsbygoogle = window.adsbygoogle || []).push({})` extra pra ser
// escaneado/preenchido. Isso é feito uma vez por posição, no AdSlot.
declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

export function requestAdFill() {
  if (!scriptLoaded) return
  try {
    window.adsbygoogle = window.adsbygoogle || []
    window.adsbygoogle.push({})
  } catch {
    // Rede real pode falhar em preencher (sem inventário pro recorte, bloqueio
    // de adblock etc). Não é um erro nosso: o slot só continua vazio e
    // colapsado (ver ad-slot.css, `.ad-slot:empty`).
  }
}

/** Avisa quando o script global da rede termina de carregar (chama direto se
 * já carregou). Usado pelo AdSlot pra saber quando é seguro chamar
 * `requestAdFill()` pela posição dele. */
export function onAdScriptLoad(listener: () => void) {
  if (scriptLoaded) {
    listener()
    return () => undefined
  }
  scriptLoadListeners.add(listener)
  return () => {
    scriptLoadListeners.delete(listener)
  }
}
