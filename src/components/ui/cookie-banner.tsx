import { useEffect, useState } from 'react'
import { getStoredConsent, setConsent, type ConsentValue } from '../../cookie-consent'
import './cookie-banner.css'

export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(getStoredConsent() === null)
  }, [])

  function choose(value: ConsentValue) {
    setConsent(value)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="cookie-banner" role="dialog" aria-label="Preferências de cookies" aria-live="polite">
      <p>
        Este site usa <strong>Umami</strong> pra contar visitas de forma anônima e agregada, sem cookie e sem dado
        pessoal, isso roda sempre, não depende da sua escolha abaixo. Se/quando tiver anúncio aqui, ele usa cookie
        próprio do anunciante pra isso funcionar, e só é carregado se você aceitar.
      </p>
      <div className="cookie-banner__actions">
        <button type="button" className="cookie-banner__btn cookie-banner__btn--secondary" onClick={() => choose('rejected')}>
          Só o essencial
        </button>
        <button type="button" className="cookie-banner__btn cookie-banner__btn--primary" onClick={() => choose('accepted')}>
          Aceitar cookies de anúncio
        </button>
      </div>
    </div>
  )
}
