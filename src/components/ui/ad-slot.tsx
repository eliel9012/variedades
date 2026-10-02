import { useEffect, useState } from 'react'
import { hasAdConsent, onConsentChange } from '../../cookie-consent'
import { adSlotId, onAdScriptLoad, requestAdFill, type AdSlotName } from '../../ads'
import './ad-slot.css'

export type AdSlotProps = { slot: AdSlotName }

/** Container reservado de anúncio. Fica com altura zero (ver ad-slot.css,
 * `:empty`) até ter conteúdo real dentro, então nunca aparece uma caixa vazia
 * atrapalhando leitura enquanto não tem anunciante configurado pra essa
 * posição específica. `sidebar`/`in-content` também somem por CSS fora da
 * faixa de largura onde fazem sentido (ver ad-slot.css), nunca os dois ao
 * mesmo tempo.
 *
 * Só renderiza a unidade de anúncio (o `<ins>` abaixo) quando as três coisas
 * são verdadeiras: a pessoa aceitou cookie de anúncio, o script global da
 * rede terminou de carregar (ver src/ads.ts, `onAdScriptLoad`), e essa
 * posição tem um ID de unidade configurado (`VITE_AD_SLOT_HEADER` /
 * `_FOOTER` / `_SIDEBAR` / `_INCONTENT`). O `<ins data-ad-slot-id="...">` é
 * um nome genérico de espaço reservado: quando a rede de verdade for
 * escolhida, troque a tag/atributo aqui pelo formato exato dela (ex. AdSense
 * usa `<ins class="adsbygoogle" data-ad-client="..." data-ad-slot="...">`). */
export default function AdSlot({ slot }: AdSlotProps) {
  const slotId = adSlotId(slot)
  const [consentReady, setConsentReady] = useState(() => hasAdConsent())
  const [scriptReady, setScriptReady] = useState(false)

  useEffect(() => {
    return onConsentChange((consent) => setConsentReady(consent === 'accepted'))
  }, [])
  useEffect(() => {
    return onAdScriptLoad(() => setScriptReady(true))
  }, [])

  const showUnit = consentReady && scriptReady && Boolean(slotId)

  // Dispara o "escaneia e preenche" da rede uma vez por posição, assim que
  // consentimento + script + ID de unidade ficam todos prontos ao mesmo tempo.
  useEffect(() => {
    if (showUnit) requestAdFill()
  }, [showUnit])

  return (
    <div className={`ad-slot ad-slot--${slot}`} aria-label={`Espaço de anúncio (${slot})`}>
      {showUnit && <ins className="ad-slot__unit" data-ad-slot-id={slotId} />}
    </div>
  )
}
