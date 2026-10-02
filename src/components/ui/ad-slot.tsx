import './ad-slot.css'

export type AdSlotProps = { slot: 'header' | 'footer' }

/** Container reservado de anúncio. Fica com altura zero (ver ad-slot.css,
 * `:empty`) até ter conteúdo real dentro, então nunca aparece uma caixa
 * vazia atrapalhando leitura enquanto não tem anunciante configurado. Cada
 * rede de anúncio (AdSense, Media.net etc) tem seu próprio jeito de marcar o
 * elemento alvo (ex. `<ins class="adsbygoogle">`); quando a rede for
 * escolhida, o elemento dela entra dentro de `.ad-slot--header`/`--footer`. */
export default function AdSlot({ slot }: AdSlotProps) {
  return <div className={`ad-slot ad-slot--${slot}`} aria-label={`Espaço de anúncio (${slot})`} />
}
