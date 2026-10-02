// Ficha da máquina: situação, onde está, dados, ordens de serviço e histórico.

import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  CircleCheck,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Cpu,
  History,
  MapPin,
  Pencil,
  ShieldCheck,
  Ticket,
  Trash2,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  codigoOS,
  ESTADO_MAQUINA,
  localDaLocacao,
  osEmAberto,
  periodoEvento,
  STATUS_MAQUINA_LISTA,
  STATUS_OS,
  TIPO_MAQUINA,
  TIPO_OS,
  type SituacaoMaquina,
} from '#shared/maquinas.ts'
import type { Evento, Maquina, OrdemServico, StatusMaquina } from '#shared/tipos.ts'
import { SituacaoBadge, StatusOSBadge, TipoMaquinaBadge, useSituacoes } from '../components/Maquinas'
import { MaquinaFormModal } from '../components/MaquinaFormModal'
import { BotaoImprimirOS, OrdemServicoModal } from '../components/OrdemServicoModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { EmptyState, PageHeader, Segmented, StatCard } from '../components/ui/Misc'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { codigoEvento, dataCurta, moeda, numero, periodo } from '../lib/format'
import {
  avisoLocacoes,
  diasEntre,
  historicoMaquina,
  locacoesDeHojeEmDiante,
  nomeAlemDoLocal,
  ordenarOrdens,
  perguntaSituacao,
  resumoMaquina,
  type ItemHistorico,
  type Locacao,
} from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { useHoje } from '../lib/hoje'
import { hojeLocalIso } from '#shared/dominio.ts'

type ModalOS = { ordem?: OrdemServico; concluir?: boolean }
type Aba = 'manutencoes' | 'historico'
type FiltroHistorico = 'tudo' | 'os' | 'locacao'

/** Quantas O.S. aparecem antes de "Mostrar mais". */
const POR_PAGINA = 8

export function MaquinaDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const maquina = useDados((s) => s.maquinas.find((m) => m.id === id))
  const todasOrdens = useDados((s) => s.ordens)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const salvarMaquina = useDados((s) => s.salvarMaquina)
  const excluirMaquina = useDados((s) => s.excluirMaquina)
  const excluirOrdem = useDados((s) => s.excluirOrdem)
  const situacao = useSituacoes().get(id ?? '')

  const [editando, setEditando] = useState(false)
  const [modalOS, setModalOS] = useState<ModalOS | null>(null)
  const [mudando, setMudando] = useState(false)
  const [aba, setAba] = useState<Aba>('manutencoes')
  const [filtro, setFiltro] = useState<FiltroHistorico>('tudo')
  const [limite, setLimite] = useState(POR_PAGINA)

  const hoje = useHoje()
  const ordens = useMemo(() => ordenarOrdens(todasOrdens.filter((o) => o.maquinaId === id)), [todasOrdens, id])
  const resumo = useMemo(() => resumoMaquina(id ?? '', todasOrdens, eventos, hoje), [id, todasOrdens, eventos, hoje])
  const historico = useMemo(() => historicoMaquina(id ?? '', todasOrdens, eventos, hoje), [id, todasOrdens, eventos, hoje])
  const locacoes = useMemo(() => locacoesDeHojeEmDiante(id ?? '', eventos, hoje), [id, eventos, hoje])
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes])

  if (!maquina || !situacao) {
    return (
      <EmptyState
        icone={<Cpu className="h-6 w-6" />}
        titulo="Máquina não encontrada"
        descricao="Ela pode ter sido excluída."
        acao={<Button onClick={() => navegar('/manutencao')}>Voltar para a manutenção</Button>}
      />
    )
  }

  const ident = maquina.identificacao
  // Locações de hoje em diante, sem a que está acontecendo agora (já aparece em destaque)
  const proximas = locacoes.filter((l) => l.evento.id !== situacao.evento?.id)

  /** Troca a situação cadastrada (com confirmação ao desativar ou com eventos marcados). */
  const mudarSituacao = async (nova: StatusMaquina, jaConfirmado = false) => {
    if (nova === maquina.status || mudando) return
    if (!jaConfirmado) {
      const pergunta = perguntaSituacao(maquina, nova, locacoes)
      if (pergunta && !(await confirmar(pergunta))) return
    }
    setMudando(true)
    try {
      const { id: idMaquina, versao, criadoEm: _c, atualizadoEm: _a, ...dados } = maquina
      await salvarMaquina({ ...dados, status: nova }, { id: idMaquina, versao })
      const textos: Record<StatusMaquina, string> = {
        DISPONIVEL: resumo.emAberto
          ? `Ela ainda tem ${resumo.emAberto === 1 ? 'uma O.S. em aberto' : `${resumo.emAberto} O.S. em aberto`}.`
          : 'Pronta para ser locada.',
        MANUTENCAO: resumo.emAberto ? 'Fica fora dos eventos até ser liberada.' : 'Abra uma O.S. para registrar o serviço.',
        DESATIVADA: 'O histórico continua guardado.',
      }
      toast.sucesso(`${ident}: ${ESTADO_MAQUINA[nova].label.toLowerCase()}`, textos[nova])
    } catch (e) {
      avisarErro('Não foi possível mudar a situação', e)
    } finally {
      setMudando(false)
    }
  }

  /** Oferece desativar no lugar de excluir (máquina com histórico). `motivo`: o que ela já tem registrado. */
  const oferecerDesativar = async (motivo: string) => {
    const regra = 'Para não perder esse histórico, ela não pode ser excluída'
    if (maquina.status === 'DESATIVADA') {
      return void toast.info('Esta máquina não pode ser excluída', `${motivo} ${regra}; ela já está desativada.`)
    }
    const ok = await confirmar({
      titulo: `A máquina ${ident} tem histórico`,
      descricao: [
        `${motivo} ${regra}, mas pode ser desativada: sai da lista de máquinas em uso e dá para reativar depois.`,
        avisoLocacoes(locacoes),
      ]
        .filter(Boolean)
        .join(' '),
      confirmar: 'Desativar máquina',
    })
    if (ok) await mudarSituacao('DESATIVADA', true)
  }

  const excluir = async () => {
    const eventosComEla = eventos.filter((e) => e.maquinasIds.includes(maquina.id)).length
    if (ordens.length || eventosComEla) {
      const partes = [
        ordens.length && `${ordens.length} ${ordens.length === 1 ? 'ordem de serviço' : 'ordens de serviço'}`,
        eventosComEla && `${eventosComEla} ${eventosComEla === 1 ? 'evento' : 'eventos'}`,
      ].filter(Boolean)
      return oferecerDesativar(`Ela já tem ${partes.join(' e ')} registrados.`)
    }
    const ok = await confirmar({
      titulo: `Excluir a máquina ${ident}?`,
      descricao: 'Ela nunca foi enviada para eventos nem passou por manutenção. Esta ação não pode ser desfeita.',
      confirmar: 'Excluir máquina',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirMaquina(maquina.id)
      toast.sucesso('Máquina excluída', ident)
      navegar('/manutencao', { replace: true })
    } catch (e) {
      // Outro computador registrou histórico para ela enquanto isso
      if (e instanceof ErroApi && e.status === 409)
        await oferecerDesativar(e.message.replace(/ Desative-a.*$/, '').replace(/^Esta máquina/, 'Ela'))
      else avisarErro('Não foi possível excluir', e)
    }
  }

  const excluirOS = async (o: OrdemServico) => {
    const ok = await confirmar({
      titulo: `Excluir a ${codigoOS(o.numero)}?`,
      descricao:
        'Ela sai do histórico da máquina. Se a O.S. só não foi feita, prefira marcá-la como “Cancelada”. Esta ação não pode ser desfeita.',
      confirmar: 'Excluir O.S.',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirOrdem(o.id)
      toast.sucesso(`${codigoOS(o.numero)} excluída`)
    } catch (e) {
      avisarErro('Não foi possível excluir a O.S.', e)
    }
  }

  const filtrado = historico.filter((h) => filtro === 'tudo' || h.tipo === filtro)

  return (
    <>
      <PageHeader
        voltar={
          <Link
            to="/manutencao"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Manutenção
          </Link>
        }
        titulo={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{ident}</span>
            <TipoMaquinaBadge tipo={maquina.tipo} className="h-6 min-w-6 text-xs tracking-normal" />
            <SituacaoBadge estado={situacao.estado} className="tracking-normal" />
          </span>
        }
        descricao={[`${TIPO_MAQUINA[maquina.tipo].label} (${TIPO_MAQUINA[maquina.tipo].descricao.toLowerCase()})`, maquina.modelo]
          .filter(Boolean)
          .join(' · ')}
        acoes={
          <>
            <Button
              variante="ghost"
              tamanho="icon"
              onClick={excluir}
              aria-label="Excluir máquina"
              title="Excluir máquina"
              className="hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button icone={<Pencil className="h-4 w-4" />} onClick={() => setEditando(true)}>
              Editar
            </Button>
            <Button
              variante="primary"
              icone={<ClipboardPlus className="h-4 w-4" />}
              onClick={() => setModalOS({})}
              disabled={maquina.status === 'DESATIVADA'}
              title={maquina.status === 'DESATIVADA' ? 'Reative a máquina para abrir uma O.S.' : undefined}
            >
              Nova O.S.
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          rotulo="Manutenções feitas"
          valor={resumo.concluidas}
          formatar={(v) => numero(Math.round(v))}
          icone={<ShieldCheck className="h-4 w-4" />}
          destaque
          detalhe={resumo.ultimaManutencao ? `Última em ${dataCurta(resumo.ultimaManutencao)}` : 'Nenhuma concluída ainda'}
        />
        <StatCard
          rotulo="Gasto com manutenção"
          valor={resumo.gasto}
          formatar={moeda}
          icone={<CircleDollarSign className="h-4 w-4" />}
          detalhe={resumo.emAberto ? `${resumo.emAberto} O.S. em aberto` : 'Peças e mão de obra'}
          delay={0.04}
        />
        <StatCard
          rotulo="Eventos"
          valor={resumo.eventos}
          formatar={(v) => numero(Math.round(v))}
          icone={<Ticket className="h-4 w-4" />}
          detalhe={
            resumo.agendados ? `${resumo.agendados} ${resumo.agendados === 1 ? 'agendado' : 'agendados'}` : 'Locações registradas'
          }
          delay={0.08}
        />
        <StatCard
          rotulo="Diárias"
          valor={resumo.diarias}
          formatar={(v) => numero(Math.round(v))}
          icone={<CalendarClock className="h-4 w-4" />}
          detalhe="Dias em eventos"
          delay={0.12}
        />
      </div>

      {/* No celular: onde está → manutenções → dados; no computador, os dois cartões menores à esquerda */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <Card className="lg:col-start-1 lg:row-start-1">
          <CardHeader icone={<MapPin className="h-4 w-4" />} titulo="Onde está" descricao="Situação de hoje" />
          <div className="flex flex-col gap-4 px-5 pb-5">
            <OndeEsta
              situacao={situacao}
              ordemAberta={ordens.find(osEmAberto)}
              nomeCliente={nomeCliente}
              aoAbrirOS={() => setModalOS({})}
            />
            {proximas.length > 0 && <ProximasLocacoes locacoes={proximas} />}
            <div>
              <p id="rotulo-situacao" className="mb-1.5 text-[13px] font-medium text-ink-2">
                Alterar situação
              </p>
              <TrocaSituacao valor={maquina.status} aoMudar={(s) => void mudarSituacao(s)} desabilitado={mudando} />
              {situacao.estado === 'LOCADA' && (
                <p className="mt-2 text-xs text-muted">“Locada” é automático: vem dos eventos com esta máquina.</p>
              )}
            </div>
          </div>
        </Card>

        <Card className="max-lg:order-2 lg:col-start-1 lg:row-start-2">
          <CardHeader
            icone={<Cpu className="h-4 w-4" />}
            titulo="Dados da máquina"
            acoes={
              <Button variante="ghost" tamanho="sm" icone={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditando(true)}>
                Editar
              </Button>
            }
          />
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 pb-5 text-sm">
            <Dado rotulo="Identificação">{ident}</Dado>
            <Dado rotulo="Tipo">{TIPO_MAQUINA[maquina.tipo].label}</Dado>
            <Dado rotulo="Modelo">{maquina.modelo}</Dado>
            <Dado rotulo="Nº de série">{maquina.numeroSerie}</Dado>
            <Dado rotulo="Aquisição">{maquina.dataAquisicao && dataCurta(maquina.dataAquisicao)}</Dado>
            <Dado rotulo="Cadastrada em">{dataCurta(hojeLocalIso(new Date(maquina.criadoEm)))}</Dado>
            {maquina.observacoes && (
              <div className="col-span-2">
                <Dado rotulo="Observações">
                  <span className="whitespace-pre-line">{maquina.observacoes}</span>
                </Dado>
              </div>
            )}
          </dl>
        </Card>

        <Card className="overflow-hidden max-lg:order-1 lg:col-span-2 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-4">
            <Segmented
              valor={aba}
              aoMudar={setAba}
              opcoes={[
                {
                  valor: 'manutencoes',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <ClipboardList className="h-3.5 w-3.5" />
                      Manutenções
                    </span>
                  ),
                  contagem: ordens.length,
                },
                {
                  valor: 'historico',
                  label: (
                    <span className="flex items-center gap-1.5">
                      <History className="h-3.5 w-3.5" />
                      Histórico
                    </span>
                  ),
                },
              ]}
            />
            {aba === 'historico' && (
              <Segmented
                tamanho="sm"
                valor={filtro}
                aoMudar={setFiltro}
                opcoes={[
                  { valor: 'tudo', label: 'Tudo' },
                  { valor: 'os', label: 'Manutenções' },
                  { valor: 'locacao', label: 'Locações' },
                ]}
              />
            )}
          </div>

          {aba === 'manutencoes' ? (
            ordens.length ? (
              <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
                {ordens.slice(0, limite).map((o, i) => (
                  <CartaoOS
                    key={o.id}
                    ordem={o}
                    indice={i}
                    maquina={maquina}
                    aoEditar={() => setModalOS({ ordem: o })}
                    aoConcluir={() => setModalOS({ ordem: o, concluir: true })}
                    aoExcluir={() => void excluirOS(o)}
                  />
                ))}
                {ordens.length > limite && (
                  <Button className="self-center" onClick={() => setLimite((l) => l + POR_PAGINA)}>
                    Mostrar mais ({ordens.length - limite})
                  </Button>
                )}
              </div>
            ) : (
              <EmptyState
                className="border-t border-line"
                icone={<Wrench className="h-6 w-6" />}
                titulo="Nenhuma ordem de serviço"
                descricao="Registre limpezas, higienizações, revisões e consertos para acompanhar a saúde desta máquina."
                acao={
                  maquina.status !== 'DESATIVADA' && (
                    <Button variante="primary" icone={<ClipboardPlus className="h-4 w-4" />} onClick={() => setModalOS({})}>
                      Abrir a primeira O.S.
                    </Button>
                  )
                }
              />
            )
          ) : filtrado.length ? (
            <LinhaDoTempo itens={filtrado} hoje={hoje} nomeCliente={nomeCliente} />
          ) : (
            <EmptyState
              className="border-t border-line"
              icone={<History className="h-6 w-6" />}
              titulo={
                filtro === 'locacao'
                  ? 'Nenhuma locação ainda'
                  : filtro === 'os'
                    ? 'Nenhuma manutenção ainda'
                    : 'Sem histórico ainda'
              }
              descricao={
                filtro === 'os'
                  ? 'As ordens de serviço desta máquina aparecem aqui.'
                  : 'Os eventos para os quais ela for enviada aparecem aqui, junto com as manutenções.'
              }
            />
          )}
        </Card>
      </div>

      <MaquinaFormModal aberto={editando} maquina={maquina} aoFechar={() => setEditando(false)} />
      <OrdemServicoModal
        aberto={!!modalOS}
        aoFechar={() => setModalOS(null)}
        ordem={modalOS?.ordem}
        maquinaId={maquina.id}
        fixarMaquina
        concluir={modalOS?.concluir}
      />
    </>
  )
}

/** Situação de hoje em destaque: locada (com o local do evento), disponível, em manutenção ou desativada. */
function OndeEsta({
  situacao,
  ordemAberta,
  nomeCliente,
  aoAbrirOS,
}: {
  situacao: SituacaoMaquina
  ordemAberta: OrdemServico | undefined
  nomeCliente: Map<string, string>
  aoAbrirOS: () => void
}) {
  const { estado, evento } = situacao
  const caixa = {
    DISPONIVEL: 'bg-success-soft text-success',
    LOCADA: 'bg-info-soft text-info',
    MANUTENCAO: 'bg-warning-soft text-warning',
    DESATIVADA: 'bg-neutral-soft text-neutral',
  }[estado]

  return (
    <motion.div
      key={estado}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('rounded-xl px-4 py-3.5', caixa)}
    >
      <p className="text-xs font-semibold tracking-[0.04em] uppercase">
        {estado === 'LOCADA' ? 'Locada agora' : ESTADO_MAQUINA[estado].label}
      </p>
      {estado === 'LOCADA' && evento ? (
        <DadosEvento evento={evento} nomeCliente={nomeCliente} />
      ) : estado === 'DISPONIVEL' ? (
        <p className="mt-1 text-sm text-ink-2">Livre hoje: não está em nenhum evento.</p>
      ) : estado === 'DESATIVADA' ? (
        <p className="mt-1 text-sm text-ink-2">Fora de uso e fora da lista para eventos. O histórico continua guardado.</p>
      ) : (
        <>
          {ordemAberta ? (
            <p className="mt-1 text-sm text-ink-2">
              {codigoOS(ordemAberta.numero)} · {STATUS_OS[ordemAberta.status].label.toLowerCase()} desde{' '}
              {dataCurta(ordemAberta.abertura)}
              {(ordemAberta.servicos[0] || ordemAberta.problema) && (
                <span className="block truncate text-[13px] text-muted">
                  {ordemAberta.servicos.join(', ') || ordemAberta.problema}
                </span>
              )}
            </p>
          ) : (
            <div className="mt-1 text-sm text-ink-2">
              <p>Nenhuma O.S. aberta para registrar o serviço.</p>
              <Button
                variante="secondary"
                tamanho="sm"
                className="mt-2"
                icone={<ClipboardPlus className="h-3.5 w-3.5" />}
                onClick={aoAbrirOS}
              >
                Abrir O.S.
              </Button>
            </div>
          )}
          {evento && (
            <p className="mt-2 border-t border-current/15 pt-2 text-[13px] font-medium">
              Atenção: está marcada hoje em{' '}
              <Link to={`/eventos/${evento.id}`} className="underline underline-offset-2">
                {localDaLocacao(evento)}
              </Link>
              .
            </p>
          )}
        </>
      )}
    </motion.div>
  )
}

/** Local (cabeçalho das fichas), evento, cliente e período. */
function DadosEvento({ evento, nomeCliente }: { evento: Evento; nomeCliente: Map<string, string> }) {
  const p = periodoEvento(evento)
  const linhas = evento.cabecalho
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return (
    <div className="mt-1">
      <p className="text-base leading-snug font-semibold break-words text-ink">{localDaLocacao(evento)}</p>
      {linhas.length > 1 && <p className="text-[13px] break-words text-ink-2">{linhas.slice(1, 3).join(' · ')}</p>}
      <p className="mt-1.5 text-[13px] text-ink-2">
        {p && <span className="tnum">{periodo(p.inicio, p.fim)}</span>}
        {nomeCliente.get(evento.clienteId) && ` · ${nomeCliente.get(evento.clienteId)}`}
      </p>
      <Link
        to={`/eventos/${evento.id}`}
        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium underline-offset-2 hover:underline"
      >
        {evento.nome} {codigoEvento(evento.codigo)}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}

function ProximasLocacoes({ locacoes }: { locacoes: Locacao[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium text-ink-2">
        {locacoes.length === 1 ? 'Próxima locação' : 'Próximas locações'}
      </p>
      <ul className="flex flex-col gap-1">
        {locacoes.slice(0, 3).map((l) => (
          <li key={l.evento.id}>
            <Link
              to={`/eventos/${l.evento.id}`}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 -mx-2 transition-colors hover:bg-surface-2"
            >
              <CalendarClock className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{localDaLocacao(l.evento)}</span>
                <span className="tnum block text-xs text-muted">{periodo(l.inicio, l.fim)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {locacoes.length > 3 && <p className="mt-1 text-xs text-muted">e mais {locacoes.length - 3}</p>}
    </div>
  )
}

const OPCOES_SITUACAO: Record<StatusMaquina, { icone: ReactNode; ativo: string }> = {
  DISPONIVEL: { icone: <CircleCheck className="h-4 w-4" />, ativo: 'border-success/40 bg-success-soft text-success' },
  MANUTENCAO: { icone: <Wrench className="h-4 w-4" />, ativo: 'border-warning/40 bg-warning-soft text-warning' },
  DESATIVADA: { icone: <Ban className="h-4 w-4" />, ativo: 'border-line-strong bg-neutral-soft text-neutral' },
}

/** Troca rápida da situação cadastrada. */
function TrocaSituacao({
  valor,
  aoMudar,
  desabilitado,
}: {
  valor: StatusMaquina
  aoMudar: (s: StatusMaquina) => void
  desabilitado: boolean
}) {
  return (
    <div role="radiogroup" aria-labelledby="rotulo-situacao" className="grid grid-cols-3 gap-2">
      {STATUS_MAQUINA_LISTA.map((s) => {
        const ativo = s === valor
        return (
          <button
            type="button"
            key={s}
            role="radio"
            aria-checked={ativo}
            disabled={desabilitado}
            onClick={() => aoMudar(s)}
            className={cn(
              'flex min-h-[58px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border px-1.5 py-2 text-center text-xs leading-tight font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait',
              ativo ? OPCOES_SITUACAO[s].ativo : 'border-line-strong/80 bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink',
            )}
          >
            {OPCOES_SITUACAO[s].icone}
            {ESTADO_MAQUINA[s].label}
          </button>
        )
      })}
    </div>
  )
}

/** Uma ordem de serviço com todos os detalhes e as ações. */
function CartaoOS({
  ordem,
  indice,
  maquina,
  aoEditar,
  aoConcluir,
  aoExcluir,
}: {
  ordem: OrdemServico
  indice: number
  maquina: Maquina
  aoEditar: () => void
  aoConcluir: () => void
  aoExcluir: () => void
}) {
  const aberta = osEmAberto(ordem)
  const duracao = ordem.conclusao ? diasEntre(ordem.abertura, ordem.conclusao) : null
  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice, 8) * 0.03, duration: 0.25, ease: 'easeOut' }}
      className={cn(
        'rounded-xl border p-4',
        aberta ? 'border-warning/30 bg-warning-soft/40' : 'border-line bg-surface',
        ordem.status === 'CANCELADA' && 'opacity-75',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum text-[15px] font-semibold text-ink">{codigoOS(ordem.numero)}</span>
            <Badge tom={ordem.tipo === 'CORRETIVA' ? 'danger' : 'brand'} ponto={false}>
              {TIPO_OS[ordem.tipo].label}
            </Badge>
            <StatusOSBadge status={ordem.status} />
          </div>
          <p className="tnum mt-1 text-xs text-muted">
            Aberta em {dataCurta(ordem.abertura)}
            {ordem.conclusao &&
              ` · concluída em ${dataCurta(ordem.conclusao)}${duracao ? ` (${duracao} ${duracao === 1 ? 'dia' : 'dias'})` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          {aberta && (
            <Button
              variante="soft"
              tamanho="sm"
              icone={<ClipboardCheck className="h-4 w-4" />}
              onClick={aoConcluir}
              className="mr-1"
            >
              Concluir
            </Button>
          )}
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={aoEditar}
            aria-label={`Editar ${codigoOS(ordem.numero)}`}
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <BotaoImprimirOS ordem={ordem} maquina={maquina} />
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={aoExcluir}
            aria-label={`Excluir ${codigoOS(ordem.numero)}`}
            title="Excluir"
            className="hover:bg-danger-soft hover:text-danger"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {ordem.servicos.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Serviços">
          {ordem.servicos.map((s) => (
            <li
              key={s}
              className="inline-flex h-6 items-center rounded-full border border-line bg-surface px-2.5 text-xs font-medium text-ink-2"
            >
              {s}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {ordem.problema && <Dado rotulo="Problema relatado">{ordem.problema}</Dado>}
        {ordem.solucao && <Dado rotulo="Serviço realizado">{ordem.solucao}</Dado>}
        {ordem.pecas && <Dado rotulo="Peças trocadas">{ordem.pecas}</Dado>}
        {ordem.responsavel && <Dado rotulo="Responsável">{ordem.responsavel}</Dado>}
        {ordem.custo > 0 && <Dado rotulo="Custo">{moeda(ordem.custo)}</Dado>}
      </dl>
    </motion.article>
  )
}

/** Linha do tempo com O.S. e locações, separada por ano. */
function LinhaDoTempo({ itens, hoje, nomeCliente }: { itens: ItemHistorico[]; hoje: string; nomeCliente: Map<string, string> }) {
  return (
    <ol className="border-t border-line px-5 pt-4 pb-5">
      {itens.map((item, i) => {
        const ano = item.data.slice(0, 4)
        const novoAno = i === 0 || itens[i - 1].data.slice(0, 4) !== ano
        const ultimo = i === itens.length - 1
        return (
          <li key={`${item.tipo}-${item.id}`}>
            {novoAno && <p className="tnum mb-3 ml-11 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{ano}</p>}
            <motion.div
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.025, duration: 0.25 }}
              className="relative flex gap-3 pb-5"
            >
              {!ultimo && <span aria-hidden className="absolute top-9 bottom-1 left-[15px] w-px bg-line" />}
              {item.tipo === 'os' ? <ItemOS item={item} /> : <ItemLocacao item={item} hoje={hoje} nomeCliente={nomeCliente} />}
            </motion.div>
          </li>
        )
      })}
    </ol>
  )
}

function Marcador({ icone, classe }: { icone: ReactNode; classe: string }) {
  return (
    <span className={cn('relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-4 ring-surface', classe)}>
      {icone}
    </span>
  )
}

function ItemOS({ item }: { item: Extract<ItemHistorico, { tipo: 'os' }> }) {
  const o = item.ordem
  const corretiva = o.tipo === 'CORRETIVA'
  return (
    <>
      <Marcador
        icone={corretiva ? <Wrench className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
        classe={corretiva ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-ink'}
      />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm font-medium text-ink">
            {codigoOS(o.numero)} · {TIPO_OS[o.tipo].label}
          </p>
          <StatusOSBadge status={o.status} />
        </div>
        <p className="tnum text-xs text-muted">
          {dataCurta(o.abertura)}
          {o.conclusao && o.conclusao !== o.abertura && ` a ${dataCurta(o.conclusao)}`}
          {o.custo > 0 && ` · ${moeda(o.custo)}`}
          {o.responsavel && ` · ${o.responsavel}`}
        </p>
        {o.servicos.length > 0 && <p className="mt-1 text-[13px] text-ink-2">{o.servicos.join(', ')}</p>}
        {o.problema && (
          <p className="mt-1 text-[13px] break-words text-ink-2">
            <span className="text-muted">Problema: </span>
            {o.problema}
          </p>
        )}
        {o.solucao && (
          <p className="mt-0.5 text-[13px] break-words text-ink-2">
            <span className="text-muted">Feito: </span>
            {o.solucao}
          </p>
        )}
      </div>
    </>
  )
}

function ItemLocacao({
  item,
  hoje,
  nomeCliente,
}: {
  item: Extract<ItemHistorico, { tipo: 'locacao' }>
  hoje: string
  nomeCliente: Map<string, string>
}) {
  const e = item.evento
  const cliente = nomeCliente.get(e.clienteId)
  const rotulo = { passada: null, agora: 'Acontecendo agora', futura: 'Agendada' }[item.quando]
  return (
    <>
      <Marcador icone={<Ticket className="h-4 w-4" />} classe="bg-info-soft text-info" />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/eventos/${e.id}`} className="text-sm font-medium break-words text-ink hover:text-brand-ink hover:underline">
            Locada · {localDaLocacao(e)}
          </Link>
          {rotulo && (
            <Badge tom={item.quando === 'agora' ? 'info' : 'neutral'}>
              {item.quando === 'futura' ? `${rotulo} · em ${diasEntre(hoje, item.data)} d` : rotulo}
            </Badge>
          )}
        </div>
        <p className="tnum text-xs text-muted">
          {periodo(item.data, item.fim)} · {codigoEvento(e.codigo)}
          {cliente && ` · ${cliente}`}
        </p>
        {nomeAlemDoLocal(e) && <p className="mt-1 text-[13px] text-ink-2">{e.nome}</p>}
      </div>
    </>
  )
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-ink-2">{children || <span className="text-muted">—</span>}</dd>
    </div>
  )
}
