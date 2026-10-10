import { Ellipsis } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'

export interface AcaoMenu {
  label: string
  icone?: ReactNode
  aoClicar: () => void
  perigo?: boolean
  /** Ação proibida: aparece desabilitada, com o motivo ao passar o mouse e logo abaixo do nome. */
  motivo?: string
}

/**
 * Menu "…" de ações de uma linha. Como o `Menu` de ui/Misc, mas com itens desabilitados que dizem
 * o motivo (ex.: "Você não pode excluir a própria conta").
 */
export function MenuAcoes({ itens, rotulo = 'Ações' }: { itens: Array<AcaoMenu | 'sep'>; rotulo?: string }) {
  const [pos, setPos] = useState<{ top: number; right: number; paraCima: boolean; maxAltura: number } | null>(null)
  const ancora = useRef<HTMLDivElement>(null)
  const painel = useRef<HTMLDivElement>(null)
  const aberto = pos !== null

  const abrir = () => {
    if (aberto) return setPos(null)
    const r = ancora.current?.getBoundingClientRect()
    if (!r) return
    // Itens com motivo têm duas linhas
    const altura = itens.reduce((s, it) => s + (it === 'sep' ? 9 : it.motivo ? 54 : 38), 10)
    const abaixo = window.innerHeight - r.bottom - 12
    const acima = r.top - 12
    const paraCima = altura > abaixo && acima > abaixo
    setPos({
      top: paraCima ? r.top - 6 : r.bottom + 6,
      right: window.innerWidth - r.right,
      paraCima,
      maxAltura: Math.max(120, (paraCima ? acima : abaixo) - 6),
    })
  }

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!ancora.current?.contains(alvo) && !painel.current?.contains(alvo)) setPos(null)
    }
    const fechar = () => setPos(null)
    const rolou = (e: Event) => {
      if (!(e.target instanceof Node && painel.current?.contains(e.target))) setPos(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', fechar)
    document.addEventListener('scroll', rolou, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('resize', fechar)
      document.removeEventListener('scroll', rolou, true)
    }
  }, [aberto])

  return (
    <div ref={ancora} className="relative inline-flex">
      <Button
        variante="ghost"
        tamanho="icon-sm"
        onClick={abrir}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        className={cn(aberto && 'bg-surface-2 text-ink')}
      >
        <Ellipsis className="h-4 w-4" />
      </Button>
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={painel}
              role="menu"
              initial={{ opacity: 0, y: pos.paraCima ? 4 : -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14 }}
              style={{
                position: 'fixed',
                top: pos.top,
                right: pos.right,
                maxHeight: pos.maxAltura,
                translate: pos.paraCima ? '0 -100%' : undefined,
              }}
              className={cn(
                'z-[70] w-[min(300px,calc(100vw-24px))] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-float',
                pos.paraCima ? 'origin-bottom' : 'origin-top',
              )}
            >
              {itens.map((it, i) =>
                it === 'sep' ? (
                  <div key={i} className="my-1 h-px bg-line" />
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    key={it.label}
                    disabled={!!it.motivo}
                    aria-disabled={!!it.motivo}
                    title={it.motivo}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (it.motivo) return
                      setPos(null)
                      it.aoClicar()
                    }}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                      it.motivo
                        ? 'cursor-not-allowed text-muted'
                        : it.perigo
                          ? 'cursor-pointer text-danger hover:bg-danger-soft'
                          : 'cursor-pointer text-ink-2 hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    <span className={cn('mt-px flex shrink-0', it.motivo && 'opacity-60')}>{it.icone}</span>
                    <span className="min-w-0">
                      <span className="block">{it.label}</span>
                      {it.motivo && <span className="mt-0.5 block text-[11.5px] leading-snug font-normal">{it.motivo}</span>}
                    </span>
                  </button>
                ),
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
