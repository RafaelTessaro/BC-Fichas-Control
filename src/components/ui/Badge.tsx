import type { ReactNode } from 'react'
import type { Tone } from '../../lib/calc'
import { cn } from '../../lib/cn'

const tons: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'bg-neutral-soft text-neutral', dot: 'bg-neutral' },
  info: { box: 'bg-info-soft text-info', dot: 'bg-info' },
  success: { box: 'bg-success-soft text-success', dot: 'bg-success' },
  warning: { box: 'bg-warning-soft text-warning', dot: 'bg-warning-dot' },
  danger: { box: 'bg-danger-soft text-danger', dot: 'bg-danger' },
  brand: { box: 'bg-brand-soft text-brand-ink', dot: 'bg-brand' },
}

export function Badge({
  tom = 'neutral',
  children,
  ponto = true,
  className,
}: {
  tom?: Tone
  children: ReactNode
  ponto?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap',
        tons[tom].box,
        className,
      )}
    >
      {ponto && <span className={cn('h-1.5 w-1.5 rounded-full', tons[tom].dot)} />}
      {children}
    </span>
  )
}
