import { TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { quantidadeCurta } from '#shared/maquinas.ts'
import {
  FAIXAS,
  MESES,
  chaveMes,
  diaCurto,
  diaDaSemana,
  diasDoMes,
  dicaDia,
  faixaOcupacao,
  foraNoDia,
  intervalosFaixas,
  mesCurto,
  variacao,
  textoVariacao,
  type Faixa,
  type Ocorrencia,
  type PorDia,
  type ResumoPeriodo,
} from '../../lib/agenda'
import { cn } from '../../lib/cn'
import type { EventoCompleto } from '../../lib/hooks'
import { numero } from '../../lib/format'

/**
 * Cores das faixas: um só tom (o verde da marca), do mais claro ao mais escuro no tema claro e
 * do mais apagado ao mais aceso no escuro (passos conferidos: a primeira faixa tem contraste de
 * pelo menos 2:1 com o fundo e cada faixa se distingue da vizinha). Acima da frota, o vermelho de
 * perigo, com um canto marcado para não depender só da cor.
 */
const COR_FAIXA: Record<Faixa, string> = {
  0: 'bg-surface-3/70 text-muted',
  1: 'bg-[color-mix(in_oklab,var(--brand)_66%,var(--surface))] text-ink dark:bg-[color-mix(in_oklab,var(--brand)_42%,var(--surface))]',
  2: 'bg-brand text-ink dark:bg-[color-mix(in_oklab,var(--brand)_68%,var(--surface))]',
  3: 'bg-brand-ink text-white dark:bg-brand dark:text-bg',
  4: 'bg-[color-mix(in_oklab,var(--brand-ink)_62%,var(--ink))] text-white dark:bg-brand-ink dark:text-bg',
  5: 'bg-danger text-white dark:text-bg',
}

const SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

const plural = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

interface Dica {
  data: string
  x: number
  y: number
}

/**
 * Visão do ano: 12 mini-calendários, cada dia pintado pela quantidade de máquinas fora da
 * empresa (titulares + reservas dos eventos não cancelados) em faixas fixas da frota. Passar o
 * mouse (ou o foco) mostra os eventos do dia; o clique abre o dia na visão do mês.
 */
export function VisaoAno({
  ano,
  porDia,
  frota,
  hoje,
  resumos,
  anteriores,
  aoAbrirDia,
  aoAbrirMes,
}: {
  ano: number
  porDia: PorDia<EventoCompleto>
  frota: number
  hoje: string
  /** Resumo de cada mês do ano (janeiro primeiro). */
  resumos: ResumoPeriodo[]
  /** Os do ano anterior, com a comparação ligada. */
  anteriores: ResumoPeriodo[] | null
  aoAbrirDia: (data: string) => void
  aoAbrirMes: (mes: string) => void
}) {
  const [dica, setDica] = useState<Dica | null>(null)

  const mostrarDica = (data: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    setDica({ data, x: r.left + r.width / 2, y: r.top })
  }
  const esconderDica = (data: string) => setDica((d) => (d?.data === data ? null : d))
  // A dica fica presa à posição do dia: rolar a página a esconde
  const comDica = dica !== null
  useEffect(() => {
    if (!comDica) return
    const sumir = () => setDica(null)
    document.addEventListener('scroll', sumir, true)
    window.addEventListener('resize', sumir)
    return () => {
      document.removeEventListener('scroll', sumir, true)
      window.removeEventListener('resize', sumir)
    }
  }, [comDica])

  return (
    <div className="p-4 sm:p-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MESES.map((nome, i) => {
          const mes = chaveMes(ano, i + 1)
          const r = resumos[i]
          const ant = anteriores?.[i]
          const inicio = diaDaSemana(`${mes}-01`)
          return (
            <section key={mes} aria-label={`${nome} de ${ano}`} className="min-w-0">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  onClick={() => aoAbrirMes(mes)}
                  className="-ml-1 cursor-pointer rounded-md px-1 text-[14px] font-semibold text-ink capitalize transition-colors hover:text-brand-ink"
                  title={`Abrir ${nome} de ${ano}`}
                >
                  {nome}
                </button>
                <span className="tnum truncate text-[12px] text-muted">
                  {r.eventos
                    ? `${plural(r.eventos, 'evento', 'eventos')} · ${plural(r.diarias, 'diária', 'diárias')}`
                    : 'Sem eventos'}
                </span>
              </div>
              {ant && <ComparacaoMes atual={r} anterior={ant} rotulo={mesCurto(chaveMes(ano - 1, i + 1))} />}
              <div className="grid grid-cols-7 gap-[3px]">
                {SEMANA.map((s, j) => (
                  <abbr
                    key={j}
                    title={SEMANA_LONGA[j]}
                    className="pb-0.5 text-center text-[10px] font-medium text-muted no-underline"
                  >
                    {s}
                  </abbr>
                ))}
                {Array.from({ length: inicio }, (_, j) => (
                  <span key={`v${j}`} aria-hidden />
                ))}
                {diasDoMes(mes).map((data) => {
                  const lista = porDia.get(data)
                  const fora = foraNoDia(lista)
                  const faixa = faixaOcupacao(fora, frota)
                  const ehHoje = data === hoje
                  return (
                    <button
                      type="button"
                      key={data}
                      onClick={() => aoAbrirDia(data)}
                      onPointerEnter={(e) => mostrarDica(data, e.currentTarget)}
                      onPointerLeave={() => esconderDica(data)}
                      onFocus={(e) => mostrarDica(data, e.currentTarget)}
                      onBlur={() => esconderDica(data)}
                      aria-label={`${dicaDia(data, lista)}${fora ? ` (${fora} de ${frota} máquinas fora)` : ''}${ehHoje ? ', hoje' : ''}`}
                      className={cn(
                        'tnum relative flex aspect-[5/4] cursor-pointer items-center justify-center rounded-[5px] text-[11px] font-medium transition-[filter,box-shadow] duration-100 hover:brightness-110 sm:aspect-square dark:hover:brightness-125',
                        COR_FAIXA[faixa],
                        ehHoje && 'z-[1] ring-2 ring-ink ring-offset-1 ring-offset-surface',
                      )}
                    >
                      {Number(data.slice(8))}
                      {faixa === 5 && <CantoAlerta />}
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>

      <Legenda frota={frota} />

      {createPortal(
        <AnimatePresence>
          {dica && <DicaDia key="dica" dica={dica} lista={porDia.get(dica.data)} frota={frota} />}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

/** Canto marcado nos dias acima da frota: o alerta não depende só do vermelho. */
function CantoAlerta() {
  return (
    <span
      aria-hidden
      className="absolute top-0 right-0 h-0 w-0 rounded-tr-[5px] border-t-[7px] border-l-[7px] border-t-white border-l-transparent dark:border-t-bg"
    />
  )
}

/** Diferença do mês para o mesmo mês do ano anterior (ou "sem registros"). */
function ComparacaoMes({ atual, anterior, rotulo }: { atual: ResumoPeriodo; anterior: ResumoPeriodo; rotulo: string }) {
  if (!anterior.registros) {
    return <p className="-mt-1 mb-2 text-[11.5px] text-muted">Sem registros em {rotulo}</p>
  }
  const ev = variacao(atual.eventos, anterior.eventos)
  const di = variacao(atual.diarias, anterior.diarias)
  const cor = (d: 'mais' | 'menos' | 'igual') => (d === 'mais' ? 'text-success' : d === 'menos' ? 'text-danger' : 'text-muted')
  return (
    <p
      className="tnum -mt-1 mb-2 truncate text-[11.5px] text-muted"
      title={`${rotulo}: ${plural(anterior.eventos, 'evento', 'eventos')} e ${plural(anterior.diarias, 'diária', 'diárias')}`}
    >
      vs. {rotulo}: eventos <b className={cn('font-semibold', cor(ev.direcao))}>{textoVariacao(ev)}</b> · diárias{' '}
      <b className={cn('font-semibold', cor(di.direcao))}>{textoVariacao(di)}</b>
    </p>
  )
}

/** Dica flutuante do dia: o número de máquinas na frente, o nome do evento depois. */
function DicaDia({ dica, lista, frota }: { dica: Dica; lista: Array<Ocorrencia<EventoCompleto>> | undefined; frota: number }) {
  const ativos = (lista ?? []).filter((o) => o.item.evento.status !== 'CANCELADO')
  const fora = foraNoDia(lista)
  // Fica dentro da tela mesmo nos dias da borda
  const x = Math.max(136, Math.min(dica.x, window.innerWidth - 136))
  const acima = dica.y > 140
  return (
    <motion.div
      role="tooltip"
      initial={{ opacity: 0, y: acima ? 4 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ duration: 0.12 }}
      style={{ position: 'fixed', left: x, top: acima ? dica.y - 8 : dica.y + 40, translate: acima ? '-50% -100%' : '-50% 0' }}
      className="pointer-events-none z-[80] w-max max-w-[260px] rounded-xl border border-line bg-surface px-3 py-2 text-[12px] shadow-float"
    >
      <p className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink-2">{diaCurto(dica.data)}</span>
        <span className="tnum text-muted">
          {fora ? (
            <>
              <b className="font-semibold text-ink">{fora}</b> de {frota} fora
            </>
          ) : (
            'nenhuma máquina fora'
          )}
        </span>
      </p>
      {ativos.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1 border-t border-line pt-1.5">
          {ativos.slice(0, 6).map((o) => (
            <li key={o.item.evento.id} className="flex min-w-0 items-baseline gap-2">
              <b className="tnum w-9 shrink-0 font-semibold text-ink">{quantidadeCurta(o.maquinas, o.reservas)}</b>
              <span className="truncate text-ink-2">
                {o.item.evento.nome}
                {!o.uso && <span className="text-muted"> (sem uso)</span>}
              </span>
            </li>
          ))}
          {ativos.length > 6 && <li className="text-muted">+{ativos.length - 6} mais</li>}
        </ul>
      )}
      {fora > frota && (
        <p className="mt-1.5 flex items-center gap-1 font-medium text-danger">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" /> Acima da frota
        </p>
      )}
    </motion.div>
  )
}

/** Legenda das faixas, com quantas máquinas cabem em cada uma para esta frota. */
function Legenda({ frota }: { frota: number }) {
  const intervalos = intervalosFaixas(frota)
  const faixaTexto = (i: number) => {
    const x = intervalos[i]
    if (!x) return 'nenhum número'
    if (x.ate === null) return `${x.de} ou mais`
    return x.de === x.ate ? String(x.de) : `${x.de} a ${x.ate}`
  }
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-line pt-4 text-xs text-muted sm:flex-row sm:items-start sm:gap-5">
      <p className="shrink-0 pt-0.5">
        Máquinas fora por dia (titulares + reservas), frota de <b className="tnum font-semibold text-ink">{numero(frota)}</b>:
      </p>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {FAIXAS.map((f, i) => (
          <li key={f.faixa} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap', !intervalos[i] && 'opacity-50')}>
            <span className={cn('relative h-3.5 w-3.5 rounded-[4px]', COR_FAIXA[f.faixa])}>
              {f.faixa === 5 && (
                <span className="absolute top-0 right-0 h-0 w-0 rounded-tr-[4px] border-t-[5px] border-l-[5px] border-t-white border-l-transparent dark:border-t-bg" />
              )}
            </span>
            <span className={cn(f.faixa === 5 && 'font-medium text-danger')}>{f.rotulo}</span>
            {f.faixa > 0 && <span className="tnum text-muted/80">({faixaTexto(i)})</span>}
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-3.5 w-3.5 rounded-[4px] bg-surface-3/70 ring-2 ring-ink ring-offset-1 ring-offset-surface" />
          Hoje
        </li>
      </ul>
    </div>
  )
}
