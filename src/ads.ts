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

function injectAdScript() {
  if (injected) return
  const scriptUrl = import.meta.env.VITE_AD_SCRIPT_URL
  if (!scriptUrl) return
  injected = true

  const script = document.createElement('script')
  script.async = true
  script.src = scriptUrl
  const clientId = import.meta.env.VITE_AD_CLIENT_ID
  if (clientId) script.dataset.adClient = clientId
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

// CONTRATO GENÉRICO POR POSIÇÃO (documentado aqui porque vai precisar de um
// ajuste pequeno assim que a rede de verdade for escolhida, ver README >
// "Rede de anúncios"): redes da família AdSense (AdSense em si, e quase todo
// concorrente/clone, Media.net incluso) publicam um array global do tipo
// `window.adsbygoogle = window.adsbygoogle || []` e esperam um `.push({})`
// extra por elemento `<ins>` na página pra "escanear" e preencher aquela
// posição depois que o script carregou. Ezoic usa o mesmo desenho com nomes
// diferentes (`ezstandalone.showAds(id)`). Aqui isso fica genérico atrás de
// `requestAdFill()`; quando a rede for escolhida, troque só o nome do array
// global (e o formato do argumento, se precisar) dentro dessa função.
declare global {
  interface Window {
    __adQueue?: unknown[]
  }
}

export function requestAdFill() {
  if (!scriptLoaded) return
  try {
    window.__adQueue = window.__adQueue || []
    window.__adQueue.push({})
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
