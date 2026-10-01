import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { normalizar } from '../../lib/format'

export interface OpcaoCombo {
  valor: string
  label: string
  detalhe?: string
  icone?: ReactNode
}

/** Seleção com busca e navegação por teclado (↑ ↓ Enter Esc). */
export function Combobox({
  opcoes,
  valor,
  aoMudar,
  placeholder = 'Selecione…',
  vazio = 'Nada encontrado',
  acaoCriar,
  id,
  invalido,
}: {
  opcoes: OpcaoCombo[]
  valor: string
  aoMudar: (v: string) => void
  placeholder?: string
  vazio?: string
  acaoCriar?: { label: string; aoClicar: (texto: string) => void }
  id?: string
  invalido?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const raiz = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)

  const selecionada = opcoes.find((o) => o.valor === valor)
  const filtradas = useMemo(() => {
    const q = normalizar(busca)
    if (!q) return opcoes
    return opcoes.filter((o) => normalizar(`${o.label} ${o.detalhe ?? ''}`).includes(q))
  }, [opcoes, busca])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  const abrir = () => {
    setBusca('')
    setAtivo(
      Math.max(
        0,
        opcoes.findIndex((o) => o.valor === valor),
      ),
    )
    setAberto(true)
    requestAnimationFrame(() => input.current?.focus())
  }

  const escolher = (o: OpcaoCombo) => {
    aoMudar(o.valor)
    setAberto(false)
  }

  return (
    <div ref={raiz} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => (aberto ? setAberto(false) : abrir())}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className={cn(
          'flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl border bg-surface px-3.5 text-left text-sm shadow-xs transition-[border-color,box-shadow]',
          aberto ? 'border-brand ring-4 ring-[var(--ring)]' : 'border-line-strong/80 hover:border-line-strong',
          invalido && !aberto && 'border-danger',
        )}
      >
        {selecionada?.icone}
        <span className={cn('min-w-0 flex-1 truncate', selecionada ? 'text-ink' : 'text-muted/80')}>
          {selecionada?.label ?? placeholder}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" />
      </button>

      <AnimatePresence>
        {aberto && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute top-full right-0 left-0 z-40 mt-1.5 origin-top overflow-hidden rounded-xl border border-line bg-surface shadow-float"
          >
            <div className="border-b border-line p-2">
              <input
                ref={input}
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setAtivo(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setAtivo((a) => Math.min(a + 1, filtradas.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setAtivo((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (filtradas[ativo]) escolher(filtradas[ativo])
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setAberto(false)
                  }
                }}
                placeholder="Digite para buscar…"
                className="h-9 w-full rounded-lg bg-surface-2 px-3 text-sm text-ink outline-none placeholder:text-muted"
              />
            </div>
            <div ref={lista} role="listbox" className="scroll-fino max-h-64 overflow-y-auto p-1">
              {filtradas.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">{vazio}</p>}
              {filtradas.map((o, i) => (
                <button
                  key={o.valor}
                  type="button"
                  role="option"
                  data-idx={i}
                  aria-selected={o.valor === valor}
                  onMouseEnter={() => setAtivo(i)}
                  onClick={() => escolher(o)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    i === ativo ? 'bg-surface-2 text-ink' : 'text-ink-2',
                  )}
                >
                  {o.icone}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{o.label}</span>
                    {o.detalhe && <span className="block truncate text-xs text-muted">{o.detalhe}</span>}
                  </span>
                  {o.valor === valor && <Check className="h-4 w-4 shrink-0 text-brand" />}
                </button>
              ))}
            </div>
            {acaoCriar && (
              <button
                type="button"
                onClick={() => {
                  setAberto(false)
                  acaoCriar.aoClicar(busca)
                }}
                className="flex w-full cursor-pointer items-center gap-2 border-t border-line px-3.5 py-2.5 text-left text-sm font-medium text-brand-ink transition-colors hover:bg-brand-soft"
              >
                <Plus className="h-4 w-4" />
                {acaoCriar.label}
                {busca && <span className="truncate text-muted">“{busca}”</span>}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
