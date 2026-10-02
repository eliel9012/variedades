// Analytics opcional via Umami (self-hosted, open source, sem cookie).
// Só carrega o script se as duas env vars estiverem definidas no build
// (VITE_UMAMI_SCRIPT_URL e VITE_UMAMI_WEBSITE_ID); sem elas, não injeta
// nada, nunca um <script src=""> quebrado. Ver README > "Analytics
// (Umami)" pra como subir o Umami e preencher essas variáveis.
export function initAnalytics() {
  const scriptUrl = import.meta.env.VITE_UMAMI_SCRIPT_URL as string | undefined
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined
  if (!scriptUrl || !websiteId) return

  const script = document.createElement('script')
  script.defer = true
  script.src = scriptUrl
  script.dataset.websiteId = websiteId
  document.head.appendChild(script)
}
