import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarPlus, ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/Badges'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Drawer } from '../components/ui/Modal'
import { PageHeader } from '../components/ui/Misc'
import { STATUS_EVENTO } from '#shared/calc.ts'
import { capacidade, diasOcupados, ordenarMaquinas, periodoEvento } from '#shared/maquinas.ts'
import { cn } from '../lib/cn'
import { cap, codigoEvento, dataExtensa, numero } from '../lib/format'
import { useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import type { Maquina, StatusEvento } from '#shared/tipos.ts'
import { useDados } from '../store/dados'
import { useHoje } from '../lib/hoje'

const COR_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: 'bg-info',
  PENDENTE: 'bg-warning-dot',
  FINALIZADO: 'bg-success',
  CANCELADO: 'bg-neutral',
}

/** Bolinha vazada, nos dias em que as máquinas só ficam com o cliente. */
const ANEL_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: 'border-info',
  PENDENTE: 'border-warning-dot',
  FINALIZADO: 'border-success',
  CANCELADO: 'border-neutral',
}

interface ItemDia {
  item: EventoCompleto
  /** Máquinas fora da empresa no dia (com período corrido, a maior quantidade do evento). */
  maquinas: number
  /** Diárias do dia (0 nos dias em que as máquinas só ficam com o cliente). */
  diarias: number
  /** `false` nos dias em que as máquinas só ficam com o cliente, entre os dias de uso. */
  uso: boolean
}

/** Bolinha com a cor do status: cheia nos dias de uso, vazada nos dias só com o cliente. */
function PontoStatus({ status, uso, className }: { status: StatusEvento; uso: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full', uso ? COR_STATUS[status] : cn('border-[1.5px]', ANEL_STATUS[status]), className)}
    />
  )
}

export function Agenda() {
  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const [direcao, setDirecao] = useState(0)
  const [diaAberto, setDiaAberto] = useState<string | null>(null)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const eventos = useEventosCompletos()
  const navegar = useNavigate()
  // Capacidade: máquinas P e G cadastradas (não desativadas) ou, sem cadastro, o número das configurações
  const capac = useMemo(() => capacidade(maquinas, config), [maquinas, config])
  const total = capac.total
  // De hoje em diante, as máquinas em manutenção não estão livres
  const hojeIso = useHoje()
  const capacidadeDoDia = (iso: string) => (iso >= hojeIso ? total - capac.manutencao : total)
  const porId = useMemo(() => new Map(maquinas.map((m) => [m.id, m])), [maquinas])

  // Dias ocupados de cada evento: com período corrido, também os dias em que as máquinas só ficam
  // com o cliente (contam na ocupação e nos alertas, mas não nas diárias)
  const porDia = useMemo(() => {
    const m = new Map<string, ItemDia[]>()
    for (const item of eventos) {
      const diarias = new Map<string, number>()
      for (const d of item.evento.dias) diarias.set(d.data, (diarias.get(d.data) ?? 0) + (Number(d.maquinas) || 0))
      for (const d of diasOcupados(item.evento)) {
        const l = m.get(d.data) ?? []
        l.push({ item, maquinas: d.maquinas, diarias: diarias.get(d.data) ?? 0, uso: d.uso })
        m.set(d.data, l)
      }
    }
    // Em cada dia, os eventos com uso antes dos que só estão com as máquinas
    for (const l of m.values()) l.sort((a, b) => Number(b.uso) - Number(a.uso))
    return m
  }, [eventos])

  const dias = useMemo(() => eachDayOfInterval({ start: startOfWeek(mes), end: endOfWeek(endOfMonth(mes)) }), [mes])

  const resumoMes = useMemo(() => {
    let diarias = 0
    let pico = 0
    let diasExcedidos = 0
    const evs = new Set<string>()
    for (const d of dias) {
      if (!isSameMonth(d, mes)) continue
      const iso = format(d, 'yyyy-MM-dd')
      const l = (porDia.get(iso) ?? []).filter((x) => x.item.evento.status !== 'CANCELADO')
      const usadas = l.reduce((s, x) => s + x.maquinas, 0)
      l.forEach((x) => evs.add(x.item.evento.id))
      diarias += l.reduce((s, x) => s + x.diarias, 0)
      pico = Math.max(pico, usadas)
      if (usadas > (iso >= hojeIso ? total - capac.manutencao : total)) diasExcedidos++
    }
    return { diarias, pico, diasExcedidos, eventos: evs.size }
  }, [dias, mes, porDia, total, capac.manutencao, hojeIso])

  const mudarMes = (delta: number) => {
    setDirecao(delta)
    setMes((m) => (delta > 0 ? addMonths(m, 1) : subMonths(m, 1)))
  }

  const itensDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : []
  const ativosDiaAberto = itensDiaAberto.filter((x) => x.item.evento.status !== 'CANCELADO')
  const usadasDiaAberto = ativosDiaAberto.reduce((s, x) => s + x.maquinas, 0)
  const comClienteDiaAberto = ativosDiaAberto.reduce((s, x) => s + (x.uso ? 0 : x.maquinas), 0)
  const capDiaAberto = diaAberto ? capacidadeDoDia(diaAberto) : total
  const livresDiaAberto = Math.max(0, capDiaAberto - usadasDiaAberto)

  return (
    <>
      <PageHeader
        titulo="Agenda"
        descricao={
          capac.cadastradas ? (
            <>
              Ocupação diária das {numero(total)} máquinas ({numero(capac.P)} P e {numero(capac.G)} G).
              {capac.manutencao > 0 &&
                (capac.manutencao === 1 ? ' 1 está em manutenção agora.' : ` ${capac.manutencao} estão em manutenção agora.`)}
            </>
          ) : (
            <>
              Ocupação diária considerando {numero(total)} máquinas.{' '}
              <Link to="/configuracoes" className="font-medium text-brand-ink hover:underline">
                Informe quantas máquinas P e G a empresa tem
              </Link>
            </>
          )
        }
        acoes={
          <Button variante="primary" icone={<CalendarPlus className="h-4 w-4" />} onClick={() => navegar('/eventos/novo')}>
            Novo evento
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <Button tamanho="icon-sm" onClick={() => mudarMes(-1)} aria-label="Mês anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button tamanho="icon-sm" onClick={() => mudarMes(1)} aria-label="Próximo mês">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <h2 className="ml-2 min-w-44 text-lg font-semibold tracking-[-0.015em] text-ink">
              {cap(format(mes, "MMMM 'de' yyyy", { locale: ptBR }))}
            </h2>
            <Button
              tamanho="sm"
              variante="ghost"
              onClick={() => {
                const hoje = startOfMonth(new Date())
                setDirecao(hoje > mes ? 1 : -1)
                setMes(hoje)
              }}
            >
              Hoje
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted sm:ml-auto">
            <span>
              Eventos <b className="tnum font-semibold text-ink">{resumoMes.eventos}</b>
            </span>
            <span>
              Diárias <b className="tnum font-semibold text-ink">{resumoMes.diarias}</b>
            </span>
            <span title="Maior número de máquinas fora da empresa num mesmo dia do mês">
              Pico{' '}
              <b className="tnum font-semibold text-ink">
                {resumoMes.pico}/{total}
              </b>
            </span>
            {resumoMes.diasExcedidos > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5" />
                {resumoMes.diasExcedidos} {resumoMes.diasExcedidos === 1 ? 'dia acima' : 'dias acima'} do total de máquinas
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
            <div key={d} className="px-2 py-2 text-center text-[12px] font-medium text-muted sm:px-3 sm:text-left">
              {d}
            </div>
          ))}
        </div>

        <div className="relative overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={direcao}>
            <motion.div
              key={mes.toISOString()}
              custom={direcao}
              initial={{ opacity: 0, x: direcao * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direcao * -40 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-7"
            >
              {dias.map((d) => {
                const iso = format(d, 'yyyy-MM-dd')
                const itens = porDia.get(iso) ?? []
                const ativos = itens.filter((x) => x.item.evento.status !== 'CANCELADO')
                const usadas = ativos.reduce((s, x) => s + x.maquinas, 0)
                // Parte das máquinas que só está com o cliente (traço mais claro na barra)
                const comCliente = ativos.reduce((s, x) => s + (x.uso ? 0 : x.maquinas), 0)
                const capDia = capacidadeDoDia(iso)
                const pct = capDia > 0 ? usadas / capDia : usadas > 0 ? 2 : 0
                const doMes = isSameMonth(d, mes)
                const hoje = isToday(d)
                return (
                  <button
                    type="button"
                    key={iso}
                    onClick={() => setDiaAberto(iso)}
                    className={cn(
                      'group relative flex min-h-[78px] cursor-pointer flex-col gap-1 border-r border-b border-line p-1.5 text-left transition-colors sm:min-h-[118px] sm:p-2 [&:nth-child(7n)]:border-r-0',
                      doMes ? 'bg-surface hover:bg-surface-2/70' : 'bg-surface-2/40 hover:bg-surface-2/80',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={cn(
                          'tnum flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-medium',
                          hoje ? 'bg-brand text-white' : doMes ? 'text-ink' : 'text-muted/70',
                        )}
                      >
                        {format(d, 'd')}
                      </span>
                      {usadas > 0 && (
                        <span
                          className={cn(
                            'tnum hidden text-[11px] font-medium sm:block',
                            pct > 1 ? 'text-danger' : pct >= 0.8 ? 'text-warning' : 'text-muted',
                          )}
                          title={`${usadas} de ${total} máquinas fora${comCliente ? ` (${comCliente} só com o cliente)` : ''}`}
                        >
                          {usadas}/{total}
                        </span>
                      )}
                    </div>

                    <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                      {itens.slice(0, 2).map(({ item, maquinas: qtd, uso }) => (
                        <span
                          key={item.evento.id}
                          title={
                            uso
                              ? undefined
                              : `${item.evento.nome}: as máquinas ficam com o cliente entre os dias de uso (sem uso neste dia)`
                          }
                          className={cn(
                            'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] leading-tight',
                            uso
                              ? 'bg-surface-2 py-[3px] text-ink-2 ring-1 ring-line/60'
                              : 'border border-dashed border-line-strong py-[2px] text-muted',
                            item.evento.status === 'CANCELADO' && 'line-through opacity-60',
                          )}
                        >
                          <PontoStatus status={item.evento.status} uso={uso} className="h-1.5 w-1.5" />
                          <span className="truncate">{item.evento.nome}</span>
                          <span
                            className="tnum ml-auto shrink-0 text-muted"
                            title={`${qtd} ${qtd === 1 ? 'máquina' : 'máquinas'}${uso ? '' : ' com o cliente'}`}
                          >
                            {qtd}
                          </span>
                        </span>
                      ))}
                      {itens.length > 2 && (
                        <span className="px-1 text-[11px] font-medium text-muted">+{itens.length - 2} mais</span>
                      )}
                    </div>

                    {/* Versão compacta (celular): pontos por evento */}
                    {itens.length > 0 && (
                      <div className="flex flex-wrap gap-1 sm:hidden">
                        {itens.slice(0, 4).map(({ item, uso }) => (
                          <PontoStatus key={item.evento.id} status={item.evento.status} uso={uso} className="h-1.5 w-1.5" />
                        ))}
                      </div>
                    )}

                    {usadas > 0 && (
                      <div className="mt-auto h-1 w-full overflow-hidden rounded-full bg-surface-3">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, pct * 100)}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          className="flex h-full overflow-hidden rounded-full"
                        >
                          {/* Dias de uso em traço cheio; só com o cliente, mais claro (mas contando igual) */}
                          <span
                            className={cn('h-full', corBarra(pct))}
                            style={{ width: `${((usadas - comCliente) / usadas) * 100}%` }}
                          />
                          <span className={cn('h-full flex-1 opacity-45', corBarra(pct))} />
                        </motion.div>
                      </div>
                    )}
                  </button>
                )
              })}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs text-muted">
          {(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', COR_STATUS[s])} />
              {STATUS_EVENTO[s].label}
            </span>
          ))}
          <span
            className="inline-flex items-center gap-1.5 whitespace-nowrap"
            title="Período corrido: as máquinas ficam com o cliente entre um dia de uso e outro. Contam como ocupadas, sem diária."
          >
            <span className="inline-flex h-3.5 w-5 items-center justify-center rounded-[4px] border border-dashed border-line-strong">
              <span className="h-1.5 w-1.5 rounded-full border-[1.5px] border-muted" />
            </span>
            Com o cliente, sem uso
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="flex h-1 w-5 overflow-hidden rounded-full">
                <span className="h-full w-3 bg-brand" />
                <span className="h-full flex-1 bg-brand opacity-45" />
              </span>{' '}
              Ocupação das máquinas
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1 w-5 rounded-full bg-warning-dot" /> 80% ou mais
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1 w-5 rounded-full bg-danger" /> Acima do total
            </span>
          </span>
        </div>
      </Card>

      <Drawer
        aberto={!!diaAberto}
        aoFechar={() => setDiaAberto(null)}
        titulo={diaAberto ? dataExtensa(diaAberto, "EEEE, d 'de' MMMM") : ''}
        descricao={
          diaAberto
            ? `${usadasDiaAberto} de ${total} máquinas reservadas • ${livresDiaAberto} ${livresDiaAberto === 1 ? 'livre' : 'livres'}${
                diaAberto >= hojeIso && capac.manutencao ? ` (${capac.manutencao} em manutenção)` : ''
              }`
            : ''
        }
      >
        {diaAberto && (
          <div className="flex flex-col gap-3 p-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (usadasDiaAberto / Math.max(1, capDiaAberto)) * 100)}%` }}
                className="flex h-full overflow-hidden rounded-full"
              >
                <span
                  className={cn('h-full', corBarra(usadasDiaAberto / Math.max(1, capDiaAberto)))}
                  style={{ width: `${((usadasDiaAberto - comClienteDiaAberto) / Math.max(1, usadasDiaAberto)) * 100}%` }}
                />
                <span className={cn('h-full flex-1 opacity-45', corBarra(usadasDiaAberto / Math.max(1, capDiaAberto)))} />
              </motion.div>
            </div>
            {itensDiaAberto.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhum evento neste dia.</p>}
            {itensDiaAberto.map(({ item, maquinas: qtd, uso }, i) => {
              const p = uso ? null : periodoEvento(item.evento)
              // A cidade do evento (antigos) ou a do cadastro do cliente
              const cidade = item.evento.cidade || item.cliente?.cidade
              return (
                <motion.div
                  key={item.evento.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    to={`/eventos/${item.evento.id}`}
                    className={cn(
                      'block rounded-xl border p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/60',
                      uso ? 'border-line' : 'border-dashed border-line-strong',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{item.evento.nome}</p>
                        <p className="truncate text-xs text-muted">
                          {codigoEvento(item.evento.codigo)} • {item.cliente?.nome ?? '—'}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'tnum shrink-0 rounded-lg px-2 py-1 text-xs font-semibold',
                          uso ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-ink-2',
                        )}
                      >
                        {qtd} {qtd === 1 ? 'máquina' : 'máquinas'}
                      </span>
                    </div>
                    {p && (
                      <p className="tnum mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
                        <b className="font-semibold text-ink">Com o cliente, sem uso neste dia.</b> As máquinas ficam com ele de{' '}
                        {format(parseISO(p.inicio), 'dd/MM')} a {format(parseISO(p.fim), 'dd/MM')}, entre os dias de uso.
                      </p>
                    )}
                    <MaquinasDoEvento
                      ids={item.evento.maquinasIds}
                      porId={porId}
                      avisarVazio={capac.cadastradas && item.evento.status !== 'CANCELADO'}
                    />
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <StatusBadge status={item.evento.status} />
                      {cidade && <span className="truncate text-xs text-muted">{cidade}</span>}
                    </div>
                  </Link>
                </motion.div>
              )
            })}
            <Button
              variante="soft"
              className="mt-2"
              icone={<CalendarPlus className="h-4 w-4" />}
              onClick={() => navegar(`/eventos/novo?data=${diaAberto}`)}
            >
              Novo evento em {format(parseISO(diaAberto), 'dd/MM')}
            </Button>
          </div>
        )}
      </Drawer>
    </>
  )
}

/** Cor da barra de ocupação do dia: verde, amarela a partir de 80% e vermelha acima do total. */
const corBarra = (pct: number) => (pct > 1 ? 'bg-danger' : pct >= 0.8 ? 'bg-warning-dot' : 'bg-brand')

/** Números das máquinas enviadas ao evento (ex.: P-01, G-03), para saber onde cada uma está. */
function MaquinasDoEvento({ ids, porId, avisarVazio }: { ids: string[]; porId: Map<string, Maquina>; avisarVazio: boolean }) {
  const lista = ordenarMaquinas(ids.map((id) => porId.get(id)).filter((m): m is Maquina => !!m))
  if (!lista.length) {
    return avisarVazio ? <p className="mt-2 text-xs text-muted">Números das máquinas ainda não escolhidos.</p> : null
  }
  const max = 12
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <span className="sr-only">Máquinas enviadas:</span>
      {lista.slice(0, max).map((m) => (
        <span
          key={m.id}
          className="tnum rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] leading-4 font-semibold text-ink-2 ring-1 ring-line"
        >
          {m.identificacao}
        </span>
      ))}
      {lista.length > max && <span className="px-1 text-[11px] leading-5 text-muted">+{lista.length - max}</span>}
    </div>
  )
}
