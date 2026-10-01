export type FavoriteButtonProps = {
  active: boolean
  onToggle: () => void
  label: string
}

export function FavoriteButton({ active, onToggle, label }: FavoriteButtonProps) {
  return (
    <button
      type="button"
      className={`favorite-button${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={active ? `Remover ${label} dos favoritos` : `Favoritar ${label}`}
      title={active ? 'Remover dos favoritos' : 'Favoritar'}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <span aria-hidden="true">{active ? '★' : '☆'}</span>
    </button>
  )
}

export default FavoriteButton
