import { CalendarPlus, PauseCircle, Phone } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ordenarMaquinas, periodoEvento, quantidadePorExtenso, reservasParadas } from '#shared/maquinas.ts'
import type { Cliente, Evento, Maquina } from '#shared/tipos.ts'
import { StatusBadge } from '../Badges'
import { SeloReserva } from '../Maquinas'
import { Button } from '../ui/Button'
import { Drawer } from '../ui/Modal'
import { corBarra, foraNoDia, reservasNoDia, soComClienteNoDia, type Ocorrencia } from '../../lib/agenda'
import { cn } from '../../lib/cn'
import { codigoEvento, dataCurta, dataExtensa } from '../../lib/format'
import type { EventoCompleto } from '../../lib/hooks'

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * Painel lateral de um dia da agenda: máquinas fora (titulares + reservas), os eventos com as
 * máquinas enviadas (as reservas marcadas) e as reservas paradas com clientes, para saber onde
 * buscar uma máquina a mais se faltar.
 */
export function PainelDia({
  data,
  itens,
  eventos,
  clientes,
  porId,
  total,
  capacidadeDoDia,
  manutencao,
  avisarVazio,
  aoFechar,
  aoNovoEvento,
}: {
  /** Dia aberto (`yyyy-MM-dd`), ou `null` com o painel fechado. */
  data: string | null
  itens: Array<Ocorrencia<EventoCompleto>>
  /** Todos os eventos (para achar as reservas paradas no dia). */
  eventos: Evento[]
  clientes: Map<string, Cliente>
  porId: Map<string, Maquina>
  /** Máquinas da empresa. */
  total: number
  /** Máquinas que podem sair no dia (de hoje em diante, sem as que estão em manutenção). */
  capacidadeDoDia: number
  /** Máquinas em manutenção a descontar neste dia (0 nos dias que já passaram). */
  manutencao: number
  avisarVazio: boolean
  aoFechar: () => void
  aoNovoEvento: (data: string) => void
}) {
  const fora = foraNoDia(itens)
  const comCliente = soComClienteNoDia(itens)
  const reservas = reservasNoDia(itens)
  const livres = Math.max(0, capacidadeDoDia - fora)
  const pct = fora / Math.max(1, capacidadeDoDia)
  const paradas = useMemo(() => (data ? reservasParadas(eventos, data) : []), [eventos, data])

  return (
    <Drawer
      aberto={!!data}
      aoFechar={aoFechar}
      titulo={data ? dataExtensa(data, "EEEE, d 'de' MMMM 'de' yyyy") : ''}
      descricao={
        data
          ? `${fora} de ${total} máquinas fora${reservas ? ` (${plural(reservas, 'reserva', 'reservas')})` : ''} • ${livres} ${
              livres === 1 ? 'livre' : 'livres'
            }${manutencao ? ` (${manutencao} em manutenção)` : ''}`
          : ''
      }
    >
      {data && (
        <div className="flex flex-col gap-3 p-5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
            role="img"
            aria-label={`${fora} de ${capacidadeDoDia} máquinas fora`}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, pct * 100)}%` }}
              className="flex h-full overflow-hidden rounded-full"
            >
              {/* Dias de uso em traço cheio; só com o cliente, mais claro (mas contando igual) */}
              <span
                className={cn('h-full', corBarra(pct))}
                style={{ width: `${((fora - comCliente) / Math.max(1, fora)) * 100}%` }}
              />
              <span className={cn('h-full flex-1 opacity-45', corBarra(pct))} />
            </motion.div>
          </div>

          {itens.length === 0 && <p className="py-8 text-center text-sm text-muted">Nenhum evento neste dia.</p>}
          {itens.map((o, i) => (
            <CartaoEvento key={o.item.evento.id} o={o} i={i} porId={porId} avisarVazio={avisarVazio} />
          ))}

          {paradas.length > 0 && (
            <motion.section
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: itens.length * 0.04 + 0.04 }}
              aria-labelledby="reservas-paradas"
              className="mt-1 rounded-xl border border-dashed border-line-strong bg-surface-2/50 p-3.5"
            >
              <h3 id="reservas-paradas" className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                <PauseCircle className="h-4 w-4 shrink-0 text-ink-2" />
                Reservas paradas neste dia
                <span className="tnum rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
                  {paradas.reduce((s, p) => s + p.paradas, 0)}
                </span>
              </h3>
              <p className="mt-1 text-xs text-muted">Se precisar de uma máquina a mais, estas estão com clientes, sem uso.</p>
              <ul className="mt-2.5 flex flex-col divide-y divide-line">
                {paradas.map((p) => {
                  const cliente = clientes.get(p.evento.clienteId)
                  return (
                    <li key={p.evento.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <Link
                          to={`/eventos/${p.evento.id}`}
                          className="truncate text-sm font-medium text-ink hover:text-brand-ink hover:underline"
                        >
                          {p.evento.nome}
                        </Link>
                        <span className="tnum shrink-0 text-xs text-muted">{plural(p.paradas, 'parada', 'paradas')}</span>
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span className="truncate">{cliente?.nome ?? '—'}</span>
                        {cliente?.telefone && (
                          <a
                            href={`tel:${cliente.telefone.replace(/[^\d+]/g, '')}`}
                            className="tnum inline-flex items-center gap-1 font-medium whitespace-nowrap text-ink-2 hover:text-brand-ink"
                          >
                            <Phone className="h-3 w-3" />
                            {cliente.telefone}
                          </a>
                        )}
                      </p>
                      <ReservasMarcadas ids={p.maquinasIds} paradas={p.paradas} porId={porId} avisarVazio={avisarVazio} />
                    </li>
                  )
                })}
              </ul>
            </motion.section>
          )}

          <Button
            variante="soft"
            className="mt-2"
            icone={<CalendarPlus className="h-4 w-4" />}
            onClick={() => aoNovoEvento(data)}
          >
            Novo evento em {dataCurta(data).slice(0, 5)}
          </Button>
        </div>
      )}
    </Drawer>
  )
}

function CartaoEvento({
  o,
  i,
  porId,
  avisarVazio,
}: {
  o: Ocorrencia<EventoCompleto>
  i: number
  porId: Map<string, Maquina>
  avisarVazio: boolean
}) {
  const { item, maquinas, reservas, reservasUsadas, uso } = o
  const p = uso ? null : periodoEvento(item.evento)
  // A cidade do evento (antigos) ou a do cadastro do cliente
  const cidade = item.evento.cidade || item.cliente?.cidade
  const cancelado = item.evento.status === 'CANCELADO'
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
      <Link
        to={`/eventos/${item.evento.id}`}
        className={cn(
          'block rounded-xl border p-3.5 transition-colors hover:border-line-strong hover:bg-surface-2/60',
          uso ? 'border-line' : 'border-dashed border-line-strong',
        )}
      >
        {/* Sem espaço (celular), o selo desce para baixo do nome em vez de cortá-lo */}
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
          <div className="min-w-[9rem] flex-1">
            <p className={cn('truncate font-medium text-ink', cancelado && 'line-through opacity-70')}>{item.evento.nome}</p>
            <p className="truncate text-xs text-muted">
              {codigoEvento(item.evento.codigo)} • {item.cliente?.nome ?? '—'}
            </p>
          </div>
          <span
            className={cn(
              'tnum shrink-0 rounded-lg px-2 py-1 text-right text-xs font-semibold',
              uso ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-ink-2',
            )}
          >
            {quantidadePorExtenso(maquinas, reservas)}
          </span>
        </div>
        {reservasUsadas > 0 && (
          <p className="mt-1.5 text-xs font-medium text-ink-2">
            {reservasUsadas === 1
              ? '1 reserva usada neste dia (cobrada como diária).'
              : `${reservasUsadas} reservas usadas neste dia (cobradas como diárias).`}
          </p>
        )}
        {p && (
          <p className="tnum mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-ink-2">
            <b className="font-semibold text-ink">Com o cliente, sem uso neste dia.</b> As máquinas ficam com ele de{' '}
            {dataCurta(p.inicio).slice(0, 5)} a {dataCurta(p.fim).slice(0, 5)}, entre os dias de uso.
          </p>
        )}
        <MaquinasDoEvento
          ids={item.evento.maquinasIds}
          reservasIds={item.evento.reservasIds ?? []}
          porId={porId}
          avisarVazio={avisarVazio && !cancelado}
        />
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <StatusBadge status={item.evento.status} />
          {cidade && <span className="truncate text-xs text-muted">{cidade}</span>}
        </div>
      </Link>
    </motion.div>
  )
}

/**
 * Etiqueta com o número da máquina; a reserva tem o mesmo visual do resto do sistema (contorno
 * tracejado âmbar e o selinho "R").
 */
function EtiquetaMaquina({ m, reserva }: { m: Maquina; reserva: boolean }) {
  return (
    <span
      title={reserva ? `${m.identificacao} · reserva neste evento` : undefined}
      className={cn(
        'tnum inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] leading-4 font-semibold',
        reserva ? 'border border-dashed border-warning-dot bg-surface text-ink-2' : 'bg-surface-2 text-ink-2 ring-1 ring-line',
      )}
    >
      {m.identificacao}
      {reserva && (
        <>
          <SeloReserva pequeno />
          <span className="sr-only">(reserva)</span>
        </>
      )}
    </span>
  )
}

/** Números das máquinas enviadas ao evento (ex.: P-01, G-03), titulares primeiro e as reservas marcadas. */
function MaquinasDoEvento({
  ids,
  reservasIds,
  porId,
  avisarVazio,
}: {
  ids: string[]
  reservasIds: string[]
  porId: Map<string, Maquina>
  avisarVazio: boolean
}) {
  const reservas = new Set(reservasIds)
  const lista = ordenarMaquinas(ids.map((id) => porId.get(id)).filter((m): m is Maquina => !!m)).sort(
    (a, b) => Number(reservas.has(a.id)) - Number(reservas.has(b.id)),
  )
  if (!lista.length) {
    return avisarVazio ? <p className="mt-2 text-xs text-muted">Números das máquinas ainda não escolhidos.</p> : null
  }
  const max = 12
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      <span className="sr-only">Máquinas enviadas:</span>
      {lista.slice(0, max).map((m) => (
        <EtiquetaMaquina key={m.id} m={m} reserva={reservas.has(m.id)} />
      ))}
      {lista.length > max && <span className="px-1 text-[11px] leading-5 text-muted">+{lista.length - max}</span>}
    </div>
  )
}

/**
 * As máquinas marcadas como reserva no evento; avisa quando falta marcar (só com máquinas
 * cadastradas: sem elas não há o que marcar). O uso é anotado sem dizer qual máquina: com mais
 * reservas marcadas do que paradas, diz "uma de" em vez de afirmar que todas estão sem uso.
 */
function ReservasMarcadas({
  ids,
  paradas,
  porId,
  avisarVazio,
}: {
  ids: string[]
  paradas: number
  porId: Map<string, Maquina>
  avisarVazio: boolean
}) {
  const lista = ordenarMaquinas(ids.map((id) => porId.get(id)).filter((m): m is Maquina => !!m))
  const faltam = avisarVazio ? Math.max(0, paradas - lista.length) : 0
  if (!lista.length && !faltam) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span className="sr-only">Máquinas reserva:</span>
      {lista.length > paradas && <span className="text-xs text-muted">{paradas === 1 ? 'Uma de' : `${paradas} de`}</span>}
      {lista.map((m) => (
        <EtiquetaMaquina key={m.id} m={m} reserva />
      ))}
      {faltam > 0 && (
        <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-[11px] leading-4 font-medium text-warning">
          {lista.length
            ? `+${faltam} não ${faltam === 1 ? 'marcada' : 'marcadas'}`
            : faltam === 1
              ? 'Reserva não marcada'
              : `${faltam} reservas não marcadas`}
        </span>
      )}
    </div>
  )
}
