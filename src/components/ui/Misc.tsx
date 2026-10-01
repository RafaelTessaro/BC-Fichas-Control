import { Search, X } from 'lucide-react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../lib/cn'
import { iniciais } from '../../lib/format'

export function PageHeader({
  titulo,
  descricao,
  acoes,
  voltar,
}: {
  titulo: ReactNode
  descricao?: ReactNode
  acoes?: ReactNode
  voltar?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {voltar}
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] text-ink">{titulo}</h1>
        {descricao && <p className="mt-1 text-[14px] text-muted">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  )
}

export function EmptyState({
  icone,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone: ReactNode
  titulo: string
  descricao?: string
  acao?: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="relative mb-4">
        <div className="absolute inset-0 scale-150 rounded-full bg-brand-soft blur-xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-surface text-brand shadow-xs">
          {icone}
        </div>
      </div>
      <h3 className="text-[15px] font-semibold text-ink">{titulo}</h3>
      {descricao && <p className="mt-1 max-w-sm text-sm text-muted">{descricao}</p>}
      {acao && <div className="mt-5">{acao}</div>}
    </motion.div>
  )
}

/** Controle segmentado com indicador animado (usado em filtros e abas). */
export function Segmented<T extends string>({
  opcoes,
  valor,
  aoMudar,
  className,
  tamanho = 'md',
}: {
  opcoes: Array<{ valor: T; label: ReactNode; contagem?: number }>
  valor: T
  aoMudar: (v: T) => void
  className?: string
  tamanho?: 'sm' | 'md'
}) {
  const grupo = useId()
  return (
    <div
      role="tablist"
      className={cn(
        'scroll-fino inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-surface-3/70 p-1',
        className,
      )}
    >
      {opcoes.map((o) => {
        const ativo = o.valor === valor
        return (
          <button
            type="button"
            key={o.valor}
            role="tab"
            aria-selected={ativo}
            onClick={() => aoMudar(o.valor)}
            className={cn(
              'relative flex cursor-pointer items-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150',
              tamanho === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              ativo ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {ativo && (
              <motion.span
                layoutId={`seg-${grupo}`}
                className="absolute inset-0 rounded-lg bg-surface shadow-xs ring-1 ring-line"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="relative">{o.label}</span>
            {o.contagem !== undefined && (
              <span
                className={cn(
                  'tnum relative rounded-md px-1.5 text-[11px] leading-5',
                  ativo ? 'bg-brand-soft text-brand-ink' : 'bg-surface-3 text-muted',
                )}
              >
                {o.contagem}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function SearchInput({
  valor,
  aoMudar,
  placeholder = 'Buscar…',
  className,
}: {
  valor: string
  aoMudar: (v: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-line-strong/80 bg-surface pr-9 pl-9 text-sm text-ink shadow-xs transition-[border-color,box-shadow] placeholder:text-muted/80 hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-[var(--ring)] focus:outline-none"
      />
      <AnimatePresence>
        {valor && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => aoMudar('')}
            aria-label="Limpar busca"
            className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}

const coresAvatar = [
  'bg-[#e7f6ee] text-[#077a3c] dark:bg-[#14b05c26] dark:text-[#4fd18a]',
  'bg-[#e9f1fc] text-[#2468c8] dark:bg-[#6aa5f024] dark:text-[#8dbaf3]',
  'bg-[#fdf0e7] text-[#b5521c] dark:bg-[#eb683424] dark:text-[#f29a72]',
  'bg-[#f3eefc] text-[#5b45b5] dark:bg-[#9085e924] dark:text-[#aea6f0]',
  'bg-[#fcecf2] text-[#b8336a] dark:bg-[#e87ba424] dark:text-[#ef9fbe]',
]

export function Avatar({ nome, className }: { nome: string; className?: string }) {
  const idx = [...nome].reduce((s, c) => s + c.charCodeAt(0), 0) % coresAvatar.length
  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold',
        coresAvatar[idx],
        className,
      )}
    >
      {iniciais(nome)}
    </div>
  )
}

/** Número que "conta" suavemente até o valor ao mudar. */
export function AnimatedNumber({ valor, formatar }: { valor: number; formatar: (v: number) => string }) {
  const mv = useMotionValue(valor)
  const texto = useTransform(mv, (v) => formatar(v))
  const primeiro = useRef(true)
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false
      mv.set(0)
    }
    const ctrl = animate(mv, valor, { duration: 0.7, ease: [0.22, 1, 0.36, 1] })
    return () => ctrl.stop()
  }, [valor, mv])
  return <motion.span>{texto}</motion.span>
}

/** Menu suspenso (renderizado em portal para não ser cortado por tabelas com rolagem). */
export function Menu({
  gatilho,
  itens,
  alinhar = 'right',
}: {
  gatilho: (abrir: () => void, aberto: boolean) => ReactNode
  itens: Array<{ label: string; icone?: ReactNode; aoClicar: () => void; perigo?: boolean } | 'sep'>
  alinhar?: 'left' | 'right'
}) {
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; paraCima: boolean } | null>(null)
  const ancora = useRef<HTMLDivElement>(null)
  const painel = useRef<HTMLDivElement>(null)
  const aberto = pos !== null

  const abrir = () => {
    if (aberto) return setPos(null)
    const r = ancora.current?.getBoundingClientRect()
    if (!r) return
    const altura = itens.length * 38 + 12
    const paraCima = r.bottom + altura + 12 > window.innerHeight && r.top > altura
    setPos({
      top: paraCima ? r.top - 6 : r.bottom + 6,
      paraCima,
      ...(alinhar === 'right' ? { right: window.innerWidth - r.right } : { left: r.left }),
    })
  }

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!ancora.current?.contains(alvo) && !painel.current?.contains(alvo)) setPos(null)
    }
    const fechar = () => setPos(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', fechar)
    document.addEventListener('scroll', fechar, true)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('resize', fechar)
      document.removeEventListener('scroll', fechar, true)
    }
  }, [aberto])

  return (
    <div ref={ancora} className="relative inline-flex">
      {gatilho(abrir, aberto)}
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={painel}
              initial={{ opacity: 0, y: pos.paraCima ? 4 : -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14 }}
              style={{
                position: 'fixed',
                top: pos.top,
                left: pos.left,
                right: pos.right,
                translate: pos.paraCima ? '0 -100%' : undefined,
              }}
              className={cn(
                'z-[70] min-w-[190px] rounded-xl border border-line bg-surface p-1 shadow-float',
                pos.paraCima ? 'origin-bottom' : 'origin-top',
              )}
            >
              {itens.map((it, i) =>
                it === 'sep' ? (
                  <div key={i} className="my-1 h-px bg-line" />
                ) : (
                  <button
                    type="button"
                    key={it.label}
                    onClick={(e) => {
                      e.stopPropagation()
                      setPos(null)
                      it.aoClicar()
                    }}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors',
                      it.perigo ? 'text-danger hover:bg-danger-soft' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                    )}
                  >
                    {it.icone}
                    {it.label}
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

/** Cartão de indicador (KPI). */
export function StatCard({
  rotulo,
  valor,
  formatar,
  icone,
  detalhe,
  destaque,
  delay = 0,
}: {
  rotulo: string
  valor: number
  formatar: (v: number) => string
  icone: ReactNode
  detalhe?: ReactNode
  destaque?: boolean
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'relative overflow-hidden rounded-2xl border p-5 shadow-xs',
        destaque ? 'border-transparent bg-brand text-white' : 'border-line bg-surface',
      )}
    >
      {destaque && <div className="pointer-events-none absolute -top-16 -right-10 h-44 w-44 rounded-full bg-white/10 blur-2xl" />}
      <div className="relative flex items-center justify-between">
        <p className={cn('text-[13px] font-medium', destaque ? 'text-white/85' : 'text-muted')}>{rotulo}</p>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            destaque ? 'bg-white/15 text-white' : 'bg-surface-2 text-ink-2',
          )}
        >
          {icone}
        </div>
      </div>
      <p
        className={cn(
          'relative mt-3 text-[26px] leading-none font-semibold tracking-[-0.025em]',
          destaque ? 'text-white' : 'text-ink',
        )}
      >
        <AnimatedNumber valor={valor} formatar={formatar} />
      </p>
      {detalhe && <div className={cn('relative mt-2 text-[12.5px]', destaque ? 'text-white/80' : 'text-muted')}>{detalhe}</div>}
    </motion.div>
  )
}
