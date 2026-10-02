import { useEffect } from 'react'
import { requestAdFill, useAdReadiness } from '../../ads'

const SLOT_ID = import.meta.env.VITE_AD_SLOT_INFEED
const LAYOUT_KEY = import.meta.env.VITE_AD_LAYOUT_KEY_INFEED

/** Anúncio nativo "in-feed" do AdSense: pensado pra ser repetido várias vezes
 * dentro de uma lista de cards (é literalmente como o próprio AdSense
 * documenta o uso desse formato), diferente do AdSlot genérico (header/
 * footer/sidebar/in-content), que é um espaço fixo único por posição. Por
 * isso usa `data-ad-format="fluid"` + `data-ad-layout-key` em vez de
 * `data-ad-format="auto"`: o estilo (fonte/cor/espaçamento) foi configurado
 * no painel do AdSense pra imitar `.pesquisas-tracker__card`. Renderiza
 * `null` até ter consentimento + script carregado + as duas env vars desse
 * slot configuradas, igual ao AdSlot. */
export default function InFeedAdCard() {
  const { clientId, ready } = useAdReadiness()
  const showUnit = ready && Boolean(SLOT_ID) && Boolean(LAYOUT_KEY)

  useEffect(() => {
    if (showUnit) requestAdFill()
  }, [showUnit])

  if (!showUnit) return null

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-format="fluid"
      data-ad-layout-key={LAYOUT_KEY}
      data-ad-client={clientId}
      data-ad-slot={SLOT_ID}
    />
  )
}
