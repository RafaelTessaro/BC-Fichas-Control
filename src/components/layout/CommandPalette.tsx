import { CalendarPlus, CornerDownLeft, Search, Ticket, UserPlus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { calcularEvento } from '../../lib/calc'
import { cn } from '../../lib/cn'
import { codigoEvento, normalizar, periodo } from '../../lib/format'
import { useDados } from '../../store/dados'
import { Avatar } from '../ui/Misc'
import { TODAS_PAGINAS } from './nav'

export const usePaleta = create<{ aberta: boolean; abrir: () => void; fechar: () => void }>((set) => ({
  aberta: false,
  abrir: () => set({ aberta: true }),
  fechar: () => set({ aberta: false }),
}))

interface Resultado {
  id: string
  grupo: string
  titulo: string
  detalhe?: string
  icone: ReactNode
  ir: () => void
}

/** Busca global (Ctrl/⌘ + K): páginas, ações, clientes e eventos. */
export function CommandPalette() {
  const { aberta, abrir, fechar } = usePaleta()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (usePaleta.getState().aberta) fechar()
        else abrir()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [abrir, fechar])

  return createPortal(<AnimatePresence>{aberta && <Paleta fechar={fechar} />}</AnimatePresence>, document.body)
}

function Paleta({ fechar }: { fechar: () => void }) {
  const [q, setQ] = useState('')
  const [ativo, setAtivo] = useState(0)
  const navegar = useNavigate()
  const clientes = useDados((s) => s.clientes)
  const eventos = useDados((s) => s.eventos)
  const lista = useRef<HTMLDivElement>(null)

  const resultados = useMemo<Resultado[]>(() => {
    const termo = normalizar(q)
    const ir = (to: string) => () => {
      fechar()
      navegar(to)
    }
    const casa = (s: string) => !termo || normalizar(s).includes(termo)
    const out: Resultado[] = []

    const acoes: Resultado[] = [
      {
        id: 'a-ev',
        grupo: 'Ações rápidas',
        titulo: 'Novo evento',
        icone: <CalendarPlus className="h-4 w-4" />,
        ir: ir('/eventos/novo'),
      },
      {
        id: 'a-cl',
        grupo: 'Ações rápidas',
        titulo: 'Novo cliente',
        icone: <UserPlus className="h-4 w-4" />,
        ir: ir('/clientes?novo=1'),
      },
    ]
    out.push(...acoes.filter((a) => casa(a.titulo)))
    out.push(
      ...TODAS_PAGINAS.filter((p) => casa(`${p.label} ${p.descricao}`)).map((p) => ({
        id: `p-${p.to}`,
        grupo: 'Páginas',
        titulo: p.label,
        detalhe: p.descricao,
        icone: <p.icone className="h-4 w-4" />,
        ir: ir(p.to),
      })),
    )
    if (termo) {
      const nomeCliente = new Map(clientes.map((c) => [c.id, c.nome]))
      out.push(
        ...clientes
          .filter((c) => casa(`${c.nome} ${c.documento} ${c.responsavel} ${c.cidade}`))
          .slice(0, 6)
          .map((c) => ({
            id: `c-${c.id}`,
            grupo: 'Clientes',
            titulo: c.nome,
            detalhe: [c.cidade, c.telefone].filter(Boolean).join(' • '),
            icone: <Avatar nome={c.nome} className="h-6 w-6 rounded-md text-[10px]" />,
            ir: ir(`/clientes/${c.id}`),
          })),
      )
      out.push(
        ...eventos
          .filter((e) => casa(`${e.nome} ${codigoEvento(e.codigo)} ${nomeCliente.get(e.clienteId) ?? ''} ${e.local}`))
          .sort((a, b) => b.codigo - a.codigo)
          .slice(0, 8)
          .map((e) => {
            const r = calcularEvento(e)
            return {
              id: `e-${e.id}`,
              grupo: 'Eventos',
              titulo: `${e.nome}`,
              detalhe: `${codigoEvento(e.codigo)} • ${nomeCliente.get(e.clienteId) ?? '—'} • ${periodo(r.dataInicio, r.dataFim)}`,
              icone: <Ticket className="h-4 w-4" />,
              ir: ir(`/eventos/${e.id}`),
            }
          }),
      )
    }
    return out
  }, [q, clientes, eventos, navegar, fechar])

  useEffect(() => {
    lista.current?.querySelector<HTMLElement>(`[data-idx="${ativo}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [ativo])

  let ultimoGrupo = ''

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center px-4 pt-[12vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[rgb(10_12_14/0.4)] backdrop-blur-[3px]"
        onClick={fechar}
      />
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 460, damping: 36 }}
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-float"
        role="dialog"
        aria-label="Busca global"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-[18px] w-[18px] text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setAtivo(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAtivo((a) => Math.min(a + 1, resultados.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setAtivo((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                resultados[ativo]?.ir()
              } else if (e.key === 'Escape') {
                fechar()
              }
            }}
            placeholder="Buscar clientes, eventos ou páginas…"
            className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <div ref={lista} className="scroll-fino max-h-[52vh] overflow-y-auto p-2">
          {resultados.length === 0 && <p className="px-3 py-10 text-center text-sm text-muted">Nenhum resultado para “{q}”.</p>}
          {resultados.map((r, i) => {
            const cabecalho = r.grupo !== ultimoGrupo
            ultimoGrupo = r.grupo
            return (
              <div key={r.id}>
                {cabecalho && (
                  <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{r.grupo}</p>
                )}
                <button
                  data-idx={i}
                  onMouseMove={() => setAtivo(i)}
                  onClick={r.ir}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                    i === ativo ? 'bg-surface-2' : '',
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-2">
                    {r.icone}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">{r.titulo}</span>
                    {r.detalhe && <span className="block truncate text-xs text-muted">{r.detalhe}</span>}
                  </span>
                  {i === ativo && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </div>
  )
}
