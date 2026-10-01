import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns'
import {
  ArrowRight,
  CalendarClock,
  CalendarPlus,
  CircleCheck,
  CircleDollarSign,
  Clock,
  Cpu,
  Database,
  PackageCheck,
  Settings,
  Ticket,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StatusBadge } from '../components/Badges'
import { GraficoFaturamento, Legenda } from '../components/charts/Charts'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { PageHeader, StatCard } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { codigoEvento, dataExtensa, hojeISO, moeda, numero, periodo } from '../lib/format'
import { useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import { agruparPorPeriodo, filtrarPeriodo, somar, totaisVazios } from '../lib/relatorio'
import { useDados } from '../store/dados'
import { toast } from '../store/ui'

export function Painel() {
  const todos = useEventosCompletos()
  const clientes = useDados((s) => s.clientes)
  const frota = useDados((s) => s.config.frotaMaquinas)
  const carregarExemplo = useDados((s) => s.carregarExemplo)
  const navegar = useNavigate()
  const hoje = hojeISO()

  const d = useMemo(() => {
    const f = (x: Date) => format(x, 'yyyy-MM-dd')
    const agora = new Date()
    const mesDe = f(startOfMonth(agora))
    const mesAte = f(endOfMonth(agora))
    const antDe = f(startOfMonth(subMonths(agora, 1)))
    const antAte = f(endOfMonth(subMonths(agora, 1)))
    const doMes = filtrarPeriodo(todos, mesDe, mesAte)
    const mes = doMes.reduce(somar, totaisVazios())
    const anterior = filtrarPeriodo(todos, antDe, antAte).reduce(somar, totaisVazios())

    const seisDe = f(startOfMonth(subMonths(agora, 5)))
    const { baldes } = agruparPorPeriodo(filtrarPeriodo(todos, seisDe, mesAte), seisDe, mesAte)

    const ativos = todos.filter((x) => x.evento.status !== 'CANCELADO')
    const aReceber = ativos.filter((x) => !x.resumo.pago).reduce((s, x) => s + x.resumo.total, 0)
    const maquinasHoje = ativos.reduce(
      (s, x) => s + x.evento.dias.filter((dd) => dd.data === hoje).reduce((a, dd) => a + dd.maquinas, 0),
      0,
    )

    const proximos = ativos
      .filter((x) => (x.resumo.dataFim ?? '') >= hoje)
      .sort((a, b) => (a.resumo.dataInicio ?? '').localeCompare(b.resumo.dataInicio ?? ''))
      .slice(0, 6)

    const encerrados = ativos.filter((x) => (x.resumo.dataFim ?? '9999') < hoje)
    const semPagamento = encerrados
      .filter((x) => !x.resumo.pago)
      .sort((a, b) => (a.resumo.dataFim ?? '').localeCompare(b.resumo.dataFim ?? ''))
    const semConferencia = encerrados.filter((x) => x.resumo.conferencia !== 'CONFERIDO')

    return {
      mes,
      anterior,
      baldes,
      aReceber,
      maquinasHoje,
      proximos,
      semPagamento,
      semConferencia,
      eventosHoje: ativos.filter((x) => x.evento.dias.some((dd) => dd.data === hoje)).length,
    }
  }, [todos, hoje])

  const variacao = d.anterior.total > 0 ? (d.mes.total - d.anterior.total) / d.anterior.total : null
  const vazio = todos.length === 0 && clientes.length === 0

  return (
    <>
      <PageHeader
        titulo="Painel"
        descricao={dataExtensa(hoje, "EEEE, d 'de' MMMM 'de' yyyy")}
        acoes={
          <>
            <Button icone={<UserPlus className="h-4 w-4" />} onClick={() => navegar('/clientes?novo=1')}>
              Novo cliente
            </Button>
            <Button variante="primary" icone={<CalendarPlus className="h-4 w-4" />} onClick={() => navegar('/eventos/novo')}>
              Novo evento
            </Button>
          </>
        }
      />

      {vazio && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="relative mb-6 overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-brand-soft blur-3xl" />
            <div className="relative">
              <h2 className="text-xl font-semibold tracking-[-0.02em] text-ink">Bem-vindo ao BC Fichas Control</h2>
              <p className="mt-1 max-w-xl text-sm text-muted">
                Controle de locação de máquinas de fichas: clientes, eventos, diárias, bobinas e faturamento em um só lugar.
                Comece em três passos:
              </p>
              <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Passo
                  n={1}
                  icone={<Settings className="h-4 w-4" />}
                  titulo="Ajuste os valores padrão"
                  texto="Valor da diária, da bobina e tamanho da frota."
                  to="/configuracoes"
                />
                <Passo
                  n={2}
                  icone={<Users className="h-4 w-4" />}
                  titulo="Cadastre seus clientes"
                  texto="Dados de contato e documento."
                  to="/clientes?novo=1"
                />
                <Passo
                  n={3}
                  icone={<Ticket className="h-4 w-4" />}
                  titulo="Lance o primeiro evento"
                  texto="Dias de uso, máquinas e bobinas."
                  to="/eventos/novo"
                />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  variante="soft"
                  icone={<Database className="h-4 w-4" />}
                  onClick={() => {
                    carregarExemplo()
                    toast.sucesso('Dados de exemplo carregados', 'Você pode apagá-los em Configurações.')
                  }}
                >
                  Explorar com dados de exemplo
                </Button>
                <span className="text-xs text-muted">Os dados ficam salvos neste navegador.</span>
              </div>
            </div>
          </Card>
        </motion.div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          rotulo="Faturamento do mês"
          valor={d.mes.total}
          formatar={moeda}
          destaque
          icone={<CircleDollarSign className="h-4 w-4" />}
          detalhe={
            variacao === null
              ? `${numero(d.mes.eventos)} eventos no mês`
              : `${variacao >= 0 ? '+' : ''}${(variacao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. mês anterior`
          }
        />
        <StatCard
          rotulo="A receber"
          valor={d.aReceber}
          formatar={moeda}
          icone={<Wallet className="h-4 w-4" />}
          detalhe="Todos os eventos não pagos"
          delay={0.04}
        />
        <StatCard
          rotulo="Diárias no mês"
          valor={d.mes.diarias}
          formatar={(v) => numero(Math.round(v))}
          icone={<Ticket className="h-4 w-4" />}
          detalhe={`${numero(d.mes.eventos)} ${d.mes.eventos === 1 ? 'evento' : 'eventos'}`}
          delay={0.08}
        />
        <StatCard
          rotulo="Máquinas hoje"
          valor={d.maquinasHoje}
          formatar={(v) => `${Math.round(v)} / ${frota}`}
          icone={<Cpu className="h-4 w-4" />}
          detalhe={
            d.eventosHoje
              ? `${d.eventosHoje} ${d.eventosHoje === 1 ? 'evento acontecendo' : 'eventos acontecendo'}`
              : 'Nenhum evento hoje'
          }
          delay={0.12}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            titulo="Faturamento — últimos 6 meses"
            acoes={
              <Link
                to="/relatorios"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
              >
                Relatórios <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="px-3 pb-4">
            <div className="mb-2 px-2">
              <Legenda />
            </div>
            <GraficoFaturamento
              altura={250}
              dados={d.baldes.map((b) => ({
                rotulo: b.rotulo,
                rotuloLongo: b.rotuloLongo,
                diarias: b.valorDiarias,
                bobinas: b.valorBobinas,
              }))}
            />
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHeader
            icone={<CalendarClock className="h-4 w-4" />}
            titulo="Próximos eventos"
            acoes={
              <Link
                to="/agenda"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
              >
                Agenda <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          <div className="flex flex-1 flex-col gap-1 px-3 pb-3">
            {d.proximos.length === 0 && (
              <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted">Nenhum evento agendado.</p>
            )}
            {d.proximos.map((x, i) => (
              <ItemEvento key={x.evento.id} x={x} i={i} hoje={hoje} />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListaAtencao
          icone={<Clock className="h-4 w-4" />}
          titulo="Pagamentos pendentes"
          descricao="Eventos encerrados ainda não pagos."
          itens={d.semPagamento}
          valor={(x) => moeda(x.resumo.total)}
          vazio="Todos os eventos encerrados estão pagos."
        />
        <ListaAtencao
          icone={<PackageCheck className="h-4 w-4" />}
          titulo="Bobinas a conferir"
          descricao="Eventos encerrados sem devolução registrada."
          itens={d.semConferencia}
          valor={(x) => `${numero(x.evento.bobinasConsignadas)} consig.`}
          vazio="Nenhuma conferência pendente."
        />
      </div>
    </>
  )
}

function Passo({ n, icone, titulo, texto, to }: { n: number; icone: ReactNode; titulo: string; texto: string; to: string }) {
  return (
    <Link
      to={to}
      className="group flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">{icone}</span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted">Passo {n}</span>
        <span className="block text-sm font-semibold text-ink">{titulo}</span>
        <span className="mt-0.5 block text-xs text-muted">{texto}</span>
      </span>
      <ArrowRight className="mt-1 ml-auto h-4 w-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
    </Link>
  )
}

function ItemEvento({ x, i, hoje }: { x: EventoCompleto; i: number; hoje: string }) {
  const ini = x.resumo.dataInicio!
  const acontecendo = ini <= hoje
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + i * 0.04 }}>
      <Link
        to={`/eventos/${x.evento.id}`}
        className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2"
      >
        <div
          className={cn(
            'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-xl leading-none',
            acontecendo ? 'bg-brand text-white' : 'bg-surface-2 text-ink',
          )}
        >
          <span className={cn('text-[10px] font-semibold uppercase', acontecendo ? 'text-white/85' : 'text-muted')}>
            {dataExtensa(ini, 'MMM').replace('.', '')}
          </span>
          <span className="tnum mt-0.5 text-base font-semibold">{dataExtensa(ini, 'dd')}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{x.evento.nome}</p>
          <p className="truncate text-xs text-muted">
            {x.cliente?.nome ?? '—'} • {acontecendo ? 'Acontecendo agora' : periodo(x.resumo.dataInicio, x.resumo.dataFim)}
          </p>
        </div>
        <span className="tnum shrink-0 text-xs font-medium text-ink-2">{numero(x.resumo.totalDiarias)} diárias</span>
      </Link>
    </motion.div>
  )
}

function ListaAtencao({
  icone,
  titulo,
  descricao,
  itens,
  valor,
  vazio,
}: {
  icone: ReactNode
  titulo: string
  descricao: string
  itens: EventoCompleto[]
  valor: (x: EventoCompleto) => string
  vazio: string
}) {
  return (
    <Card>
      <CardHeader
        icone={icone}
        titulo={
          <span className="flex items-center gap-2">
            {titulo}
            {itens.length > 0 && (
              <span className="tnum rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning">
                {itens.length}
              </span>
            )}
          </span>
        }
        descricao={descricao}
      />
      <div className="px-3 pb-3">
        {itens.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <CircleCheck className="h-4 w-4 text-success" />
            {vazio}
          </p>
        ) : (
          <div className="scroll-fino flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {itens.map((x) => (
              <Link
                key={x.evento.id}
                to={`/eventos/${x.evento.id}`}
                className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2"
              >
                <span className="tnum w-12 shrink-0 text-xs font-medium text-muted">{codigoEvento(x.evento.codigo)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{x.evento.nome}</p>
                  <p className="truncate text-xs text-muted">
                    {x.cliente?.nome ?? '—'} • {periodo(x.resumo.dataInicio, x.resumo.dataFim)}
                  </p>
                </div>
                <StatusBadge status={x.evento.status} />
                <span className="tnum w-24 shrink-0 text-right text-sm font-medium text-ink max-sm:hidden">{valor(x)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}
