import { useEffect } from 'react'
import { adSlotId, requestAdFill, useAdReadiness, type AdSlotName } from '../../ads'
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
 * são verdadeiras: a pessoa aceitou cookie de anúncio, o script global do
 * AdSense terminou de carregar (ver `useAdReadiness` em src/ads.ts), e essa
 * posição tem um ID de unidade configurado (`VITE_AD_SLOT_HEADER` /
 * `_FOOTER` / `_SIDEBAR` / `_INCONTENT`). */
export default function AdSlot({ slot }: AdSlotProps) {
  const slotId = adSlotId(slot)
  const { clientId, ready } = useAdReadiness()
  const showUnit = ready && Boolean(slotId)

  // Dispara o "escaneia e preenche" da rede uma vez por posição, assim que
  // consentimento + script + ID de unidade ficam todos prontos ao mesmo tempo.
  useEffect(() => {
    if (showUnit) requestAdFill()
  }, [showUnit])

  return (
    <div className={`ad-slot ad-slot--${slot}`} aria-label={`Espaço de anúncio (${slot})`}>
      {showUnit && (
        <ins
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-client={clientId}
          data-ad-slot={slotId}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      )}
    </div>
  )
}
