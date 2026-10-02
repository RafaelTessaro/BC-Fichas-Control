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
import { capacidade, osEmAberto, type Capacidade, type EstadoMaquina } from '#shared/maquinas.ts'
import { StatusBadge } from '../components/Badges'
import { GraficoFaturamento, Legenda } from '../components/charts/Charts'
import { useSituacoes } from '../components/Maquinas'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { PageHeader, StatCard } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { codigoEvento, dataExtensa, moeda, numero, periodo } from '../lib/format'
import { useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import { agruparPorPeriodo, filtrarPeriodo, somar, totaisVazios } from '../lib/relatorio'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { MigracaoNavegador } from '../components/MigracaoNavegador'
import { useHoje } from '../lib/hoje'

export function Painel() {
  const todos = useEventosCompletos()
  const clientes = useDados((s) => s.clientes)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const carregarExemplo = useDados((s) => s.carregarExemplo)
  const navegar = useNavigate()
  const hoje = useHoje()
  const cap = useMemo(() => capacidade(maquinas, config), [maquinas, config])

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
    // Máquinas de hoje ainda sem número escolhido, evento por evento (reserva a mais num evento
    // não cobre a falta em outro)
    const semNumeroHoje = ativos.reduce((s, x) => {
      const doDia = x.evento.dias.filter((dd) => dd.data === hoje).reduce((a, dd) => a + dd.maquinas, 0)
      return s + (doDia ? Math.max(0, doDia - x.evento.maquinasIds.length) : 0)
    }, 0)

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
      semNumeroHoje,
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

      {/* Aparece em qualquer computador que ainda tenha dados da versão anterior no navegador */}
      <MigracaoNavegador />

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
                  titulo="Ajuste as configurações"
                  texto="Quantas máquinas P e G você tem e os valores da diária e da bobina."
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
                  texto="Datas, máquinas enviadas e o cabeçalho e o rodapé das fichas."
                  to="/eventos/novo"
                />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {/* O servidor só carrega o exemplo com o sistema vazio (sem máquinas também) */}
                {maquinas.length === 0 && (
                  <Button
                    variante="soft"
                    icone={<Database className="h-4 w-4" />}
                    onClick={async () => {
                      try {
                        await carregarExemplo()
                        toast.sucesso('Dados de exemplo carregados', 'Você pode apagá-los em Configurações.')
                      } catch (e) {
                        avisarErro('Não foi possível carregar o exemplo', e)
                      }
                    }}
                  >
                    Explorar com dados de exemplo
                  </Button>
                )}
                <span className="text-xs text-muted">
                  Os dados ficam no servidor e aparecem em todos os computadores da rede.
                </span>
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
              ? `${numero(d.mes.eventos)} ${d.mes.eventos === 1 ? 'evento' : 'eventos'} no mês`
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
          formatar={(v) => `${Math.round(v)} / ${cap.total}`}
          icone={<Cpu className="h-4 w-4" />}
          detalhe={
            d.eventosHoje
              ? `Em ${d.eventosHoje} ${d.eventosHoje === 1 ? 'evento acontecendo' : 'eventos acontecendo'}`
              : 'Nenhum evento hoje'
          }
          delay={0.12}
        />
      </div>

      {(cap.cadastradas || !vazio) && <SituacaoMaquinas cap={cap} semNumero={d.semNumeroHoje} />}

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
          valor={(x) => `${numero(x.evento.bobinasConsignadas)} ${x.evento.bobinasConsignadas === 1 ? 'bobina' : 'bobinas'}`}
          vazio="Nenhuma conferência pendente."
        />
      </div>
    </>
  )
}

const COR_ESTADO: Record<Exclude<EstadoMaquina, 'DESATIVADA'>, string> = {
  LOCADA: 'bg-info',
  MANUTENCAO: 'bg-warning-dot',
  DISPONIVEL: 'bg-success',
}

/** Faixa compacta com a situação das máquinas agora: locadas, em manutenção, disponíveis e O.S. em aberto. */
function SituacaoMaquinas({ cap, semNumero }: { cap: Capacidade; semNumero: number }) {
  const maquinas = useDados((s) => s.maquinas)
  const ordens = useDados((s) => s.ordens)
  const situacoes = useSituacoes()
  const os = useMemo(() => ordens.filter(osEmAberto).length, [ordens])
  const partes = useMemo(() => {
    const c = { LOCADA: 0, MANUTENCAO: 0, DISPONIVEL: 0 }
    for (const m of maquinas) {
      const e = situacoes.get(m.id)?.estado
      if (e && e !== 'DESATIVADA') c[e]++
    }
    return [
      { estado: 'LOCADA' as const, qtd: c.LOCADA, rotulo: c.LOCADA === 1 ? 'locada' : 'locadas' },
      { estado: 'MANUTENCAO' as const, qtd: c.MANUTENCAO, rotulo: 'em manutenção' },
      { estado: 'DISPONIVEL' as const, qtd: c.DISPONIVEL, rotulo: c.DISPONIVEL === 1 ? 'disponível' : 'disponíveis' },
    ]
  }, [maquinas, situacoes])
  const soma = partes.reduce((s, p) => s + p.qtd, 0)

  const link = (to: string, texto: string) => (
    <Link
      to={to}
      className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium whitespace-nowrap text-brand-ink hover:underline"
    >
      {texto} <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.4 }}>
      <Card className="mb-6 flex flex-col gap-4 p-4 sm:px-5 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex min-w-0 items-center gap-3 lg:w-56 lg:shrink-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
            <Cpu className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Situação das máquinas</h3>
            <p className="text-[13px] text-muted">
              {cap.cadastradas ? `Agora · ${numero(cap.P)} P e ${numero(cap.G)} G` : 'Ainda não informadas'}
            </p>
          </div>
        </div>

        {cap.cadastradas ? (
          <>
            <div className="min-w-0 flex-1">
              <div
                className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-surface-3"
                role="img"
                aria-label={partes.map((p) => `${p.qtd} ${p.rotulo}`).join(', ')}
              >
                {partes.map(
                  (p) =>
                    p.qtd > 0 && (
                      <motion.div
                        key={p.estado}
                        initial={{ width: 0 }}
                        animate={{ width: `${(p.qtd / Math.max(1, soma)) * 100}%` }}
                        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                        className={cn('h-full first:rounded-l-full last:rounded-r-full', COR_ESTADO[p.estado])}
                      />
                    ),
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                {partes.map((p) => (
                  <li key={p.estado} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span className={cn('h-2 w-2 rounded-full', COR_ESTADO[p.estado])} />
                    <b className="tnum font-semibold text-ink">{numero(p.qtd)}</b> {p.rotulo}
                  </li>
                ))}
              </ul>
              {semNumero > 0 && (
                <p className="mt-1 text-xs text-warning">
                  {semNumero === 1
                    ? '1 máquina reservada para hoje ainda está sem número escolhido no evento.'
                    : `${semNumero} máquinas reservadas para hoje ainda estão sem número escolhido no evento.`}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 lg:shrink-0 lg:justify-end">
              {os > 0 ? (
                <Badge tom="warning">{os === 1 ? '1 O.S. em aberto' : `${os} O.S. em aberto`}</Badge>
              ) : (
                <Badge tom="success">Nenhuma O.S. em aberto</Badge>
              )}
              {link('/manutencao', 'Manutenção')}
            </div>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-[13px] text-ink-2">
              Informe quantas máquinas P e G a empresa tem para acompanhar aqui quantas estão locadas, em manutenção e
              disponíveis.
            </p>
            {link('/configuracoes', 'Informar máquinas')}
          </>
        )}
      </Card>
    </motion.div>
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
        <span className="tnum shrink-0 text-xs font-medium text-ink-2">
          {numero(x.resumo.totalDiarias)} {x.resumo.totalDiarias === 1 ? 'diária' : 'diárias'}
        </span>
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
