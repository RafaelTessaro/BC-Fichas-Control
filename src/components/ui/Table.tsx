import { motion } from 'motion/react'
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Tabela({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('scroll-fino overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-0 text-sm">{children}</table>
    </div>
  )
}

export function Th({ className, alinhar, ...props }: ThHTMLAttributes<HTMLTableCellElement> & { alinhar?: 'right' | 'center' }) {
  return (
    <th
      className={cn(
        'sticky top-0 border-b border-line bg-surface-2/70 px-4 py-2.5 text-left text-[12px] font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5',
        alinhar === 'right' && 'text-right',
        alinhar === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  )
}

export function Td({ className, alinhar, ...props }: TdHTMLAttributes<HTMLTableCellElement> & { alinhar?: 'right' | 'center' }) {
  return (
    <td
      className={cn(
        'border-b border-line px-4 py-3 align-middle text-ink-2 first:pl-5 last:pr-5 group-last/linha:border-b-0',
        alinhar === 'right' && 'tnum text-right',
        alinhar === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  )
}

/** Linha com entrada escalonada suave e destaque ao passar o mouse. */
export function Linha({
  indice = 0,
  aoClicar,
  className,
  children,
}: { indice?: number; aoClicar?: () => void; children: ReactNode } & Pick<HTMLAttributes<HTMLTableRowElement>, 'className'>) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice, 14) * 0.022, duration: 0.25, ease: 'easeOut' }}
      onClick={aoClicar}
      className={cn('group/linha transition-colors duration-100', aoClicar && 'cursor-pointer hover:bg-surface-2/70', className)}
    >
      {children}
    </motion.tr>
  )
}
