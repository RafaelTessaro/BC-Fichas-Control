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
import { STATUS_EVENTO } from '../lib/calc'
import { cn } from '../lib/cn'
import { cap, codigoEvento, dataExtensa } from '../lib/format'
import { useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import type { StatusEvento } from '../lib/types'
import { useDados } from '../store/dados'

const COR_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: 'bg-info',
  PENDENTE: 'bg-warning-dot',
  FINALIZADO: 'bg-success',
  CANCELADO: 'bg-neutral',
}

interface ItemDia {
  item: EventoCompleto
  maquinas: number
}

export function Agenda() {
  const [mes, setMes] = useState(() => startOfMonth(new Date()))
  const [direcao, setDirecao] = useState(0)
  const [diaAberto, setDiaAberto] = useState<string | null>(null)
  const frota = useDados((s) => s.config.frotaMaquinas)
  const eventos = useEventosCompletos()
  const navegar = useNavigate()

  const porDia = useMemo(() => {
    const m = new Map<string, ItemDia[]>()
    for (const item of eventos) {
      for (const d of item.evento.dias) {
        const l = m.get(d.data) ?? []
        l.push({ item, maquinas: d.maquinas })
        m.set(d.data, l)
      }
    }
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
      const l = (porDia.get(format(d, 'yyyy-MM-dd')) ?? []).filter((x) => x.item.evento.status !== 'CANCELADO')
      const usadas = l.reduce((s, x) => s + x.maquinas, 0)
      l.forEach((x) => evs.add(x.item.evento.id))
      diarias += usadas
      pico = Math.max(pico, usadas)
      if (usadas > frota) diasExcedidos++
    }
    return { diarias, pico, diasExcedidos, eventos: evs.size }
  }, [dias, mes, porDia, frota])

  const mudarMes = (delta: number) => {
    setDirecao(delta)
    setMes((m) => (delta > 0 ? addMonths(m, 1) : subMonths(m, 1)))
  }

  const itensDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : []
  const usadasDiaAberto = itensDiaAberto.filter((x) => x.item.evento.status !== 'CANCELADO').reduce((s, x) => s + x.maquinas, 0)

  return (
    <>
      <PageHeader
        titulo="Agenda"
        descricao={`Ocupação diária da frota de ${frota} máquinas.`}
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
            <span>
              Pico{' '}
              <b className="tnum font-semibold text-ink">
                {resumoMes.pico}/{frota}
              </b>
            </span>
            {resumoMes.diasExcedidos > 0 && (
              <span className="inline-flex items-center gap-1 font-medium text-danger">
                <TriangleAlert className="h-3.5 w-3.5" />
                {resumoMes.diasExcedidos} {resumoMes.diasExcedidos === 1 ? 'dia acima' : 'dias acima'} da frota
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
                const pct = frota > 0 ? usadas / frota : 0
                const doMes = isSameMonth(d, mes)
                const hoje = isToday(d)
                return (
                  <button
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
                          title={`${usadas} de ${frota} máquinas reservadas`}
                        >
                          {usadas}/{frota}
                        </span>
                      )}
                    </div>

                    <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                      {itens.slice(0, 2).map(({ item, maquinas }) => (
                        <span
                          key={item.evento.id}
                          className={cn(
                            'flex min-w-0 items-center gap-1.5 rounded-md bg-surface-2 px-1.5 py-[3px] text-[11.5px] leading-tight text-ink-2 ring-1 ring-line/60',
                            item.evento.status === 'CANCELADO' && 'line-through opacity-60',
                          )}
                        >
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', COR_STATUS[item.evento.status])} />
                          <span className="truncate">{item.evento.nome}</span>
                          <span className="tnum ml-auto shrink-0 text-muted">{maquinas}</span>
                        </span>
                      ))}
                      {itens.length > 2 && (
                        <span className="px-1 text-[11px] font-medium text-muted">+{itens.length - 2} mais</span>
                      )}
                    </div>

                    {/* Versão compacta (celular): pontos por evento */}
                    {itens.length > 0 && (
                      <div className="flex flex-wrap gap-1 sm:hidden">
                        {itens.slice(0, 4).map(({ item }) => (
                          <span key={item.evento.id} className={cn('h-1.5 w-1.5 rounded-full', COR_STATUS[item.evento.status])} />
                        ))}
                      </div>
                    )}

                    {usadas > 0 && (
                      <div className="mt-auto h-1 w-full overflow-hidden rounded-full bg-surface-3">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, pct * 100)}%` }}
                          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                          className={cn(
                            'h-full rounded-full',
                            pct > 1 ? 'bg-danger' : pct >= 0.8 ? 'bg-warning-dot' : 'bg-brand',
                          )}
                        />
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
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1 w-5 rounded-full bg-brand" /> Ocupação da frota
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1 w-5 rounded-full bg-warning-dot" /> ≥ 80%
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1 w-5 rounded-full bg-danger" /> Acima da frota
            </span>
          </span>
        </div>
      </Card>

      <Drawer
        aberto={!!diaAberto}
        aoFechar={() => setDiaAberto(null)}
        titulo={diaAberto ? dataExtensa(diaAberto, "EEEE, d 'de' MMMM") : ''}
        descricao={
          diaAberto ? `${usadasDiaAberto} de ${frota} máquinas reservadas • ${Math.max(0, frota - usadasDiaAberto)} livres` : ''
        }
      >
        {diaAberto && (
          <div className="flex flex-col gap-3 p-5">
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (usadasDiaAberto / Math.max(1, frota)) * 100)}%` }}
                className={cn(
                  'h-full rounded-full',
                  usadasDiaAberto > frota ? 'bg-danger' : usadasDiaAberto / frota >= 0.8 ? 'bg-warning-dot' : 'bg-brand',
                )}
              />
            </div>
            {itensDiaAberto.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhum evento neste dia.</p>}
            {itensDiaAberto.map(({ item, maquinas }, i) => (
              <motion.div
                key={item.evento.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Link
                  to={`/eventos/${item.evento.id}`}
                  className="block rounded-xl border border-line p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{item.evento.nome}</p>
                      <p className="truncate text-xs text-muted">
                        {codigoEvento(item.evento.codigo)} • {item.cliente?.nome ?? '—'}
                      </p>
                    </div>
                    <span className="tnum shrink-0 rounded-lg bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-ink">
                      {maquinas} máq.
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <StatusBadge status={item.evento.status} />
                    {item.evento.local && <span className="truncate text-xs text-muted">{item.evento.local}</span>}
                  </div>
                </Link>
              </motion.div>
            ))}
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
