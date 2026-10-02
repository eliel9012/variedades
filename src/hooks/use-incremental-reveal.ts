import { useEffect, useRef, useState } from 'react'

/** Revela uma lista grande aos poucos conforme a pessoa desce a página, em vez
 * de montar todos os cards de uma vez (ex.: /pesquisas chegava a renderizar
 * ~300 cards simultâneos, somando Presidente nacional e Governador em todos
 * os estados, pesado em RAM em celular mais fraco). Usa um `sentinelRef`: um
 * div vazio colocado no fim da lista já visível, observado por
 * IntersectionObserver; quando ele entra na tela, libera mais `batchSize`
 * itens. `resetKey` reinicia a contagem pro `initial` sempre que o conjunto de
 * itens muda de verdade (troca de filtro), senão trocar de filtro deixaria o
 * contador alto de antes escondendo o início da nova lista. */
export function useIncrementalReveal(totalCount: number, resetKey: unknown, initial = 8, batchSize = 8) {
  const [visibleCount, setVisibleCount] = useState(initial)
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setVisibleCount(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, initial])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    if (visibleCount >= totalCount) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((current) => Math.min(totalCount, current + batchSize))
        }
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visibleCount, totalCount, batchSize])

  return { visibleCount: Math.min(visibleCount, totalCount), sentinelRef }
}
