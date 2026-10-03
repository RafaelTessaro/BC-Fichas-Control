import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ANO_MAX, ANO_MIN, MESES, chaveMes, nomeMes } from '../../lib/agenda'
import { cn } from '../../lib/cn'

const LARGURA = 296
/** Quantos anos o painel mostra de uma vez na visão do ano. */
const ANOS_POR_PAGINA = 12

const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

/**
 * Título clicável da agenda ("Outubro de 2025 ▾" ou "2025 ▾"): abre um painel com a grade de
 * 12 meses (na visão do ano, de 12 anos) e quantos eventos cada um teve; um clique já abre o
 * mês, sem botão de confirmar. Fecha com Esc ou clicando fora.
 */
export function SeletorPeriodo({
  visao,
  mes,
  mesAtual,
  porMes,
  porAno,
  aoEscolherMes,
  aoEscolherAno,
}: {
  visao: 'mes' | 'ano'
  /** Mês mostrado (`yyyy-MM`). */
  mes: string
  /** Mês de hoje (`yyyy-MM`). */
  mesAtual: string
  porMes: Map<string, number>
  porAno: Map<string, number>
  aoEscolherMes: (mes: string) => void
  aoEscolherAno: (ano: number) => void
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const aberto = pos !== null
  const ano = Number(mes.slice(0, 4))
  // Ano (ou primeiro ano da página) que o painel está mostrando; volta ao selecionado ao abrir
  const [anoVisto, setAnoVisto] = useState(ano)
  const gatilho = useRef<HTMLButtonElement>(null)
  const painel = useRef<HTMLDivElement>(null)
  const idPainel = useId()

  const inicioPagina = (a: number) => Math.min(ANO_MAX - ANOS_POR_PAGINA + 1, Math.max(ANO_MIN, a - 6))

  const abrir = () => {
    if (aberto) return setPos(null)
    const r = gatilho.current?.getBoundingClientRect()
    if (!r) return
    setAnoVisto(visao === 'ano' ? inicioPagina(ano) : ano)
    // Alinhado ao título, sem sair da tela no celular
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - LARGURA - 8)) })
  }

  const fechar = (devolverFoco = true) => {
    setPos(null)
    if (devolverFoco) gatilho.current?.focus()
  }

  // Ao abrir, o foco vai para o mês (ou ano) selecionado
  useEffect(() => {
    if (!aberto) return
    const id = requestAnimationFrame(() => {
      const alvo =
        painel.current?.querySelector<HTMLButtonElement>('[data-selecionado="true"]') ??
        painel.current?.querySelector<HTMLButtonElement>('[data-celula]')
      alvo?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node
      if (!gatilho.current?.contains(alvo) && !painel.current?.contains(alvo)) setPos(null)
    }
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      fechar()
    }
    const sumir = () => setPos(null)
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', sumir)
    return () => {
      document.removeEventListener('mousedown', fora)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('resize', sumir)
    }
  }, [aberto])

  // Setas andam pela grade (3 colunas), Home/End vão para a primeira/última casa
  const navegarGrade = (e: KeyboardEvent<HTMLDivElement>) => {
    const celulas = [...(painel.current?.querySelectorAll<HTMLButtonElement>('[data-celula]') ?? [])]
    const i = celulas.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[e.key]
    let j = i
    if (passo !== undefined) j = Math.max(0, Math.min(celulas.length - 1, i + passo))
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = celulas.length - 1
    else return
    e.preventDefault()
    celulas[j]?.focus()
  }

  const titulo = visao === 'ano' ? String(ano) : nomeMes(mes)
  const paginaAnos = Array.from({ length: ANOS_POR_PAGINA }, (_, i) => anoVisto + i)
  const podeVoltar = anoVisto > ANO_MIN
  const podeAvancar = visao === 'ano' ? anoVisto + ANOS_POR_PAGINA - 1 < ANO_MAX : anoVisto < ANO_MAX
  const passoPagina = visao === 'ano' ? ANOS_POR_PAGINA : 1
  const anoAtual = Number(mesAtual.slice(0, 4))

  return (
    <>
      <button
        ref={gatilho}
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-controls={aberto ? idPainel : undefined}
        title={visao === 'ano' ? 'Escolher o ano' : 'Escolher o mês'}
        className={cn(
          'group inline-flex h-9 min-w-0 cursor-pointer items-center gap-1 rounded-lg px-1.5 text-base font-semibold tracking-[-0.015em] text-ink transition-colors hover:bg-surface-2 sm:px-2 sm:text-lg',
          visao === 'mes' && 'sm:min-w-[11.75rem] sm:justify-between',
          aberto && 'bg-surface-2',
        )}
      >
        <span className="tnum truncate">{titulo}</span>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted transition-transform group-hover:text-ink-2', aberto && 'rotate-180')}
        />
      </button>
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={painel}
              id={idPainel}
              role="dialog"
              aria-label={visao === 'ano' ? 'Escolher o ano' : 'Escolher o mês'}
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
              transition={{ duration: 0.14 }}
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: LARGURA }}
              className="z-[70] origin-top-left rounded-2xl border border-line bg-surface p-3 shadow-float"
              // Sair do painel com Tab fecha (sem roubar o foco de volta)
              onBlur={(e) => {
                const destino = e.relatedTarget as Node | null
                if (destino && !painel.current?.contains(destino) && !gatilho.current?.contains(destino)) fechar(false)
              }}
              // O painel fica no fim da página: Tab depois da última casa (ou Shift+Tab antes da
              // primeira) fecha e devolve o foco ao título, em vez de se perder no fim da página
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return
                const focaveis = [...(painel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
                const i = focaveis.indexOf(document.activeElement as HTMLButtonElement)
                if ((e.shiftKey && i === 0) || (!e.shiftKey && i === focaveis.length - 1)) {
                  e.preventDefault()
                  fechar()
                }
              }}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setAnoVisto((a) => a - passoPagina)}
                  disabled={!podeVoltar}
                  aria-label={visao === 'ano' ? 'Anos anteriores' : 'Ano anterior'}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="tnum text-sm font-semibold text-ink" aria-live="polite">
                  {visao === 'ano' ? `${paginaAnos[0]} – ${paginaAnos[paginaAnos.length - 1]}` : anoVisto}
                </span>
                <button
                  type="button"
                  onClick={() => setAnoVisto((a) => a + passoPagina)}
                  disabled={!podeAvancar}
                  aria-label={visao === 'ano' ? 'Próximos anos' : 'Próximo ano'}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1" onKeyDown={navegarGrade}>
                {visao === 'ano'
                  ? paginaAnos.map((a) => (
                      <Celula
                        key={a}
                        rotulo={String(a)}
                        quantidade={porAno.get(String(a)) ?? 0}
                        descricao={`${a}`}
                        selecionado={a === ano}
                        atual={a === anoAtual}
                        aoClicar={() => {
                          fechar()
                          aoEscolherAno(a)
                        }}
                      />
                    ))
                  : MESES.map((nome, i) => {
                      const chave = chaveMes(anoVisto, i + 1)
                      return (
                        <Celula
                          key={chave}
                          rotulo={`${nome.charAt(0).toUpperCase()}${nome.slice(1, 3)}`}
                          quantidade={porMes.get(chave) ?? 0}
                          descricao={nomeMes(chave)}
                          selecionado={chave === mes}
                          atual={chave === mesAtual}
                          aoClicar={() => {
                            fechar()
                            aoEscolherMes(chave)
                          }}
                        />
                      )
                    })}
              </div>
              <p className="mt-2 px-1 text-[11.5px] text-muted">
                {visao === 'ano' ? 'Eventos em cada ano.' : 'Eventos em cada mês.'}{' '}
                <span className="max-sm:hidden">Use as setas para andar pela grade.</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}

/** Uma casa da grade: o mês (ou ano) e quantos eventos teve; um traço quando nenhum. */
function Celula({
  rotulo,
  quantidade,
  descricao,
  selecionado,
  atual,
  aoClicar,
}: {
  rotulo: string
  quantidade: number
  descricao: string
  selecionado: boolean
  atual: boolean
  aoClicar: () => void
}) {
  return (
    <button
      type="button"
      data-celula
      data-selecionado={selecionado}
      onClick={aoClicar}
      aria-current={selecionado ? 'true' : undefined}
      aria-label={`${descricao}: ${quantidade ? plural(quantidade, 'evento', 'eventos') : 'nenhum evento'}${atual ? ' (atual)' : ''}`}
      className={cn(
        'relative flex h-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl text-sm font-medium transition-colors',
        selecionado
          ? 'bg-brand text-white shadow-xs'
          : atual
            ? 'bg-brand-soft text-brand-ink ring-1 ring-brand/40 ring-inset hover:brightness-[0.97] dark:hover:brightness-125'
            : 'text-ink hover:bg-surface-2',
      )}
    >
      <span className="tnum">{rotulo}</span>
      <span
        aria-hidden
        className={cn(
          'tnum text-[11px] font-normal',
          selecionado ? 'text-white/85' : quantidade ? 'text-ink-2' : 'text-muted/70',
        )}
      >
        {quantidade ? plural(quantidade, 'evento', 'eventos') : '—'}
      </span>
    </button>
  )
}
