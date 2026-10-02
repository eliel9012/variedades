import { useEffect, useRef, useState } from 'react'
import { getStoredConsent, setConsent, type ConsentValue } from '../../cookie-consent'
import './cookie-banner.css'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisible(getStoredConsent() === null)
  }, [])

  // Enquanto o banner está aberto, reserva no fim da página o espaço que ele
  // ocupa (altura medida ao vivo), pra nunca cobrir conteúdo de forma
  // permanente: dá pra rolar até o fim e ver tudo acima dele.
  useEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    const body = document.body
    const apply = () => body.style.setProperty('--cookie-banner-space', `${Math.ceil(el.getBoundingClientRect().height) + 16}px`)
    apply()
    body.classList.add('has-cookie-banner')
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null
    observer?.observe(el)
    return () => {
      observer?.disconnect()
      body.classList.remove('has-cookie-banner')
      body.style.removeProperty('--cookie-banner-space')
    }
  }, [visible])

  function choose(value: ConsentValue) {
    setConsent(value)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div ref={ref} className="cookie-banner" role="dialog" aria-label="Preferências de cookies" aria-live="polite">
      <p className="cookie-banner__text cookie-banner__text--full">
        Este site usa <strong>Umami</strong> pra contar visitas de forma anônima e agregada, sem cookie e sem dado
        pessoal, isso roda sempre, não depende da sua escolha abaixo. Se/quando tiver anúncio aqui, ele usa cookie
        próprio do anunciante pra isso funcionar, e só é carregado se você aceitar.
      </p>
      <p className="cookie-banner__text cookie-banner__text--short">
        Cookie só pra anúncio, se você aceitar.
      </p>
      <div className="cookie-banner__actions">
        <button type="button" className="cookie-banner__btn cookie-banner__btn--secondary" onClick={() => choose('rejected')}>
          Só o essencial
        </button>
        <button type="button" className="cookie-banner__btn cookie-banner__btn--primary" onClick={() => choose('accepted')}>
          <span className="cookie-banner__label--full">Aceitar cookies de anúncio</span>
          <span className="cookie-banner__label--short">Aceitar</span>
        </button>
      </div>
    </div>
  )
}
