import './share-whatsapp.css'

// Texto da mensagem por seção do site; o link vai para a página que a pessoa
// está vendo (sem query string, para não espalhar ?simular=...).
function shareText(pathname: string): string {
  const [first, second] = pathname.split('/').filter(Boolean)
  if (first === 'apuracao') {
    return second === 'presidente'
      ? 'Apuração de Presidente ao vivo, com os dados oficiais do TSE:'
      : 'Apuração de Governador e Senador ao vivo, com os dados oficiais do TSE:'
  }
  if (first === 'pesquisas') return 'Pesquisas eleitorais de 2026 reunidas num lugar só:'
  return 'Eleições 2026: apuração ao vivo com os dados oficiais do TSE:'
}

function whatsappHref(pathname: string): string {
  const url = `${window.location.origin}${pathname}`
  return `https://wa.me/?text=${encodeURIComponent(`${shareText(pathname)} ${url}`)}`
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.86 9.86 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 4.54 0 8.24 3.7 8.24 8.24 0 4.55-3.7 8.24-8.24 8.24Zm4.52-6.17c-.25-.12-1.47-.72-1.69-.8-.23-.09-.39-.13-.56.12-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.23.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.24 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z"
      />
    </svg>
  )
}

/** Compartilhar no WhatsApp: botão no topo no desktop e botão flutuante no
 * celular (o topo some ao rolar, e no celular é onde mais se compartilha). */
export function ShareWhatsApp({ pathname, variant }: { pathname: string; variant: 'topbar' | 'floating' }) {
  return (
    <a
      className={`share-whatsapp share-whatsapp--${variant}`}
      href={whatsappHref(pathname)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Compartilhar no WhatsApp (abre em nova aba)"
    >
      <WhatsAppIcon />
      {variant === 'topbar' && <span>Compartilhar</span>}
    </a>
  )
}
