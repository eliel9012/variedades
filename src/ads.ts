// Carregador genérico de anúncio, desligado por padrão. Serve pra qualquer
// rede que funcione com uma tag <script src="..."> simples apontada a um
// elemento com id fixo (AdSense, Media.net e a maioria das alternativas
// seguem esse padrão), troca de rede é só trocar as env vars, sem mexer
// em código. Só carrega quando:
//   1) a rede está configurada no build (VITE_AD_SCRIPT_URL), e
//   2) a pessoa aceitou cookie não essencial no banner (ver cookie-consent.ts).
// Nunca carrega sozinho sem as duas condições.
import { hasAdConsent, onConsentChange } from './cookie-consent'

let injected = false

function injectAdScript() {
  if (injected) return
  const scriptUrl = import.meta.env.VITE_AD_SCRIPT_URL as string | undefined
  if (!scriptUrl) return
  injected = true

  const script = document.createElement('script')
  script.async = true
  script.src = scriptUrl
  const clientId = import.meta.env.VITE_AD_CLIENT_ID as string | undefined
  if (clientId) script.dataset.adClient = clientId
  script.crossOrigin = 'anonymous'
  document.head.appendChild(script)
}

export function initAds() {
  if (hasAdConsent()) injectAdScript()
  onConsentChange((consent) => {
    if (consent === 'accepted') injectAdScript()
  })
}
