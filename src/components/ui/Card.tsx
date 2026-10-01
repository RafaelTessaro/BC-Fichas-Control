import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-xs', className)} {...props} />
}

export function CardHeader({
  titulo,
  descricao,
  acoes,
  icone,
  className,
}: {
  titulo: ReactNode
  descricao?: ReactNode
  acoes?: ReactNode
  icone?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icone && (
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            {icone}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
          {descricao && <p className="mt-0.5 text-[13px] text-muted">{descricao}</p>}
        </div>
      </div>
      {acoes && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
    </div>
  )
}
