import { useEffect } from 'react'
import { requestAdFill, useAdReadiness } from '../../ads'

const SLOT_ID = import.meta.env.VITE_AD_SLOT_MULTIPLEX

/** Anúncio "multiplex" do AdSense: grade de recomendação, pensado pro fim de
 * uma seção/página, depois que a pessoa já consumiu o conteúdo principal
 * (`data-ad-format="autorelaxed"`, sem layout-key, ele mesmo decide quantas
 * colunas cabem). Renderiza `null` até ter consentimento + script carregado +
 * o slot configurado, igual aos outros componentes de anúncio. */
export default function MultiplexAdCard() {
  const { clientId, ready } = useAdReadiness()
  const showUnit = ready && Boolean(SLOT_ID)

  useEffect(() => {
    if (showUnit) requestAdFill()
  }, [showUnit])

  if (!showUnit) return null

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-format="autorelaxed"
      data-ad-client={clientId}
      data-ad-slot={SLOT_ID}
    />
  )
}
