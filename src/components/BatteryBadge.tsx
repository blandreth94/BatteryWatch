interface Props {
  id: string
  size?: 'sm' | 'md' | 'lg'
}

export default function BatteryBadge({ id, size = 'md' }: Props) {
  const fontSize = size === 'sm' ? '0.75rem' : size === 'lg' ? '1.2rem' : '0.9rem'
  return (
    <span
      className="badge badge-primary"
      style={{ fontSize, letterSpacing: '0.04em' }}
    >
      {id}
    </span>
  )
}
