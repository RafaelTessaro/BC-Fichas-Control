import { motion, type HTMLMotionProps } from 'motion/react'
import { forwardRef, type ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Variante = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft'
type Tamanho = 'sm' | 'md' | 'icon' | 'icon-sm'

const variantes: Record<Variante, string> = {
  primary: 'bg-brand text-white shadow-xs hover:bg-brand-hover disabled:hover:bg-brand [text-shadow:0_1px_0_rgb(0_0_0/0.06)]',
  secondary: 'bg-surface text-ink border border-line-strong/80 shadow-xs hover:bg-surface-2 hover:border-line-strong',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  soft: 'bg-brand-soft text-brand-ink hover:brightness-[0.97] dark:hover:brightness-125',
  // No escuro o vermelho é claro: texto escuro para ter contraste
  danger: 'bg-danger text-white shadow-xs hover:brightness-110 dark:text-bg',
}

const tamanhos: Record<Tamanho, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variante?: Variante
  tamanho?: Tamanho
  icone?: ReactNode
  children?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variante = 'secondary', tamanho = 'md', icone, className, children, type = 'button', ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={props.disabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center font-medium whitespace-nowrap select-none',
        'transition-[background-color,border-color,color,box-shadow,filter] duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantes[variante],
        tamanhos[tamanho],
        className,
      )}
      {...props}
    >
      {icone}
      {children}
    </motion.button>
  )
})
