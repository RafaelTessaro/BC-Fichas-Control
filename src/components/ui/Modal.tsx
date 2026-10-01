import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'

function useTravarRolagemEEsc(aberto: boolean, fechar: () => void) {
  const fecharRef = useRef(fechar)
  useEffect(() => {
    fecharRef.current = fechar
  })
  useEffect(() => {
    if (!aberto) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        fecharRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = anterior
      window.removeEventListener('keydown', onKey)
    }
  }, [aberto])
}

const overlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2 },
}

export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  rodape,
  largura = 'max-w-lg',
  icone,
}: {
  aberto: boolean
  aoFechar: () => void
  titulo?: ReactNode
  descricao?: ReactNode
  children?: ReactNode
  rodape?: ReactNode
  largura?: string
  icone?: ReactNode
}) {
  useTravarRolagemEEsc(aberto, aoFechar)
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div {...overlay} className="absolute inset-0 bg-[rgb(10_12_14/0.42)] backdrop-blur-[3px]" onClick={aoFechar} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className={cn(
              'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-surface shadow-float sm:rounded-3xl',
              largura,
            )}
          >
            {(titulo || descricao) && (
              <div className="flex items-start gap-3 px-6 pt-6 pb-2">
                {icone && (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                    {icone}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  {titulo && <h2 className="text-lg font-semibold tracking-[-0.015em] text-ink">{titulo}</h2>}
                  {descricao && <p className="mt-1 text-sm text-muted">{descricao}</p>}
                </div>
                <button
                  type="button"
                  onClick={aoFechar}
                  aria-label="Fechar"
                  className="-mt-1 -mr-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>
            )}
            {children ? (
              <div className="scroll-fino min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
            ) : (
              <div className="h-4" />
            )}
            {rodape && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-6 py-4">
                {rodape}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

export function Drawer({
  aberto,
  aoFechar,
  titulo,
  descricao,
  children,
  lado = 'right',
  largura = 'w-[420px]',
}: {
  aberto: boolean
  aoFechar: () => void
  titulo?: ReactNode
  descricao?: ReactNode
  children?: ReactNode
  lado?: 'left' | 'right'
  largura?: string
}) {
  useTravarRolagemEEsc(aberto, aoFechar)
  const x = lado === 'right' ? '100%' : '-100%'
  return createPortal(
    <AnimatePresence>
      {aberto && (
        <div className="fixed inset-0 z-50">
          <motion.div {...overlay} className="absolute inset-0 bg-[rgb(10_12_14/0.36)] backdrop-blur-[2px]" onClick={aoFechar} />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x }}
            animate={{ x: 0 }}
            exit={{ x }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className={cn(
              'absolute top-0 bottom-0 flex max-w-[92vw] flex-col border-line bg-surface shadow-float',
              lado === 'right' ? 'right-0 border-l' : 'left-0 border-r',
              largura,
            )}
          >
            {titulo && (
              <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">{titulo}</h2>
                  {descricao && <p className="mt-0.5 text-[13px] text-muted">{descricao}</p>}
                </div>
                <button
                  type="button"
                  onClick={aoFechar}
                  aria-label="Fechar"
                  className="-mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="scroll-fino min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
