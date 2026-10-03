// Ficha da máquina: situação, onde está, manutenções, reclamações de clientes e histórico.

import {
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  History,
  MapPin,
  MessageSquarePlus,
  MessageSquareWarning,
  Pencil,
  ShieldCheck,
  Ticket,
  Trash2,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { hojeLocalIso } from '#shared/dominio.ts'
import {
  codigoOS,
  ESTADO_MAQUINA,
  localDaLocacao,
  osEmAberto,
  periodoEvento,
  reservasUsadasDia,
  STATUS_MAQUINA_LISTA,
  STATUS_OS,
  TIPO_MAQUINA,
  TIPO_OS,
  type SituacaoMaquina,
} from '#shared/maquinas.ts'
import type { Evento, OrdemServico, OrdemServicoInput, Reclamacao, StatusMaquina } from '#shared/tipos.ts'
import { IconeMaquinaFichas } from '../components/IconeMaquinaFichas'
import { SeloReserva, SituacaoBadge, StatusOSBadge, TipoMaquinaBadge, useSituacoes } from '../components/Maquinas'
import { MaquinaFormModal } from '../components/MaquinaFormModal'
import { OrdemServicoModal } from '../components/OrdemServicoModal'
import { ReclamacaoModal } from '../components/ReclamacaoModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { EmptyState, PageHeader, Segmented, StatCard } from '../components/ui/Misc'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { codigoEvento, dataCurta, numero, periodo } from '../lib/format'
import { useHoje } from '../lib/hoje'
import {
  avisoLocacoes,
  DICA_RESERVA,
  diasEntre,
  historicoMaquina,
  locacoesDeHojeEmDiante,
  ordenarOrdens,
  perguntaSituacao,
  problemaDaReclamacao,
  resumoMaquina,
  usoDaReserva,
  type ItemHistorico,
  type Locacao,
} from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'

/** Estado do formulário de manutenção: nova (talvez já preenchida), edição ou conclusão. */
type ModalOS = { ordem?: OrdemServico; concluir?: boolean; inicial?: Partial<OrdemServicoInput> }
/** Formulário de reclamação: nova (`{}`) ou edição. */
type ModalReclamacao = { reclamacao?: Reclamacao }
type Aba = 'manutencoes' | 'historico'
type FiltroHistorico = 'tudo' | ItemHistorico['tipo']

/** Quantas manutenções aparecem antes de "Mostrar mais". */
const POR_PAGINA = 8
/** Quantas reclamações aparecem antes de "Mostrar todas". */
const RECLAMACOES_VISIVEIS = 4

export function MaquinaDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const maquina = useDados((s) => s.maquinas.find((m) => m.id === id))
  const todasOrdens = useDados((s) => s.ordens)
  const todasReclamacoes = useDados((s) => s.reclamacoes)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const salvarMaquina = useDados((s) => s.salvarMaquina)
  const excluirMaquina = useDados((s) => s.excluirMaquina)
  const excluirOrdem = useDados((s) => s.excluirOrdem)
  const excluirReclamacao = useDados((s) => s.excluirReclamacao)
  const situacao = useSituacoes().get(id ?? '')

  const [editando, setEditando] = useState(false)
  const [modalOS, setModalOS] = useState<ModalOS | null>(null)
  const [modalReclamacao, setModalReclamacao] = useState<ModalReclamacao | null>(null)
  const [mudando, setMudando] = useState(false)
  const [aba, setAba] = useState<Aba>('manutencoes')
  const [filtro, setFiltro] = useState<FiltroHistorico>('tudo')
  const [limite, setLimite] = useState(POR_PAGINA)

  const hoje = useHoje()
  const ordens = useMemo(() => ordenarOrdens(todasOrdens.filter((o) => o.maquinaId === id)), [todasOrdens, id])
  // A lista da loja já vem da mais recente para a mais antiga
  const reclamacoes = useMemo(() => todasReclamacoes.filter((r) => r.maquinaId === id), [todasReclamacoes, id])
  const resumo = useMemo(
    () => resumoMaquina(id ?? '', todasOrdens, eventos, todasReclamacoes, hoje),
    [id, todasOrdens, eventos, todasReclamacoes, hoje],
  )
  const historico = useMemo(
    () => historicoMaquina(id ?? '', todasOrdens, eventos, todasReclamacoes, hoje),
    [id, todasOrdens, eventos, todasReclamacoes, hoje],
  )
  const locacoes = useMemo(() => locacoesDeHojeEmDiante(id ?? '', eventos, hoje), [id, eventos, hoje])
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes])
  const eventoPorId = useMemo(() => new Map(eventos.map((e) => [e.id, e])), [eventos])

  if (!maquina || !situacao) {
    return (
      <EmptyState
        icone={<IconeMaquinaFichas className="h-6 w-6" />}
        titulo="Máquina não encontrada"
        descricao="Ela pode ter sido excluída."
        acao={<Button onClick={() => navegar('/manutencao')}>Voltar para a manutenção</Button>}
      />
    )
  }

  const ident = maquina.identificacao
  const desativada = maquina.status === 'DESATIVADA'
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
          ? `Ela ainda tem ${resumo.emAberto === 1 ? 'uma manutenção em aberto' : `${resumo.emAberto} manutenções em aberto`}.`
          : 'Pronta para ser locada.',
        MANUTENCAO: resumo.emAberto
          ? 'Fica fora dos eventos até ser liberada.'
          : 'Registre a manutenção para acompanhar o serviço.',
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
    if (desativada) {
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
    if (ordens.length || reclamacoes.length || eventosComEla) {
      const partes = [
        ordens.length && `${ordens.length} ${ordens.length === 1 ? 'manutenção' : 'manutenções'}`,
        reclamacoes.length && `${reclamacoes.length} ${reclamacoes.length === 1 ? 'reclamação' : 'reclamações'}`,
        eventosComEla && `${eventosComEla} ${eventosComEla === 1 ? 'evento' : 'eventos'}`,
      ].filter(Boolean) as string[]
      const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}` : partes[0]
      return oferecerDesativar(`Ela já tem ${lista} registrados.`)
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
      titulo: `Excluir a manutenção ${codigoOS(o.numero)}?`,
      descricao:
        'Ela sai do histórico da máquina. Se o serviço só não vai mais ser feito, prefira marcar a manutenção como “Cancelada”. Esta ação não pode ser desfeita.',
      confirmar: 'Excluir manutenção',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirOrdem(o.id)
      toast.sucesso(`Manutenção ${codigoOS(o.numero)} excluída`)
    } catch (e) {
      avisarErro('Não foi possível excluir a manutenção', e)
    }
  }

  const apagarReclamacao = async (r: Reclamacao) => {
    const ok = await confirmar({
      titulo: 'Apagar esta reclamação?',
      descricao: `“${r.descricao}” sai do histórico da máquina ${ident}. Esta ação não pode ser desfeita.`,
      confirmar: 'Apagar reclamação',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirReclamacao(r.id)
      toast.sucesso('Reclamação apagada')
    } catch (e) {
      avisarErro('Não foi possível apagar a reclamação', e)
    }
  }

  /** Abre uma manutenção corretiva já com o relato do cliente como problema. */
  const manutencaoDaReclamacao = (r: Reclamacao) =>
    setModalOS({
      inicial: { tipo: 'CORRETIVA', problema: problemaDaReclamacao(r, r.eventoId ? eventoPorId.get(r.eventoId) : undefined) },
    })

  const filtrado = historico.filter((h) => filtro === 'tudo' || h.tipo === filtro)
  const semManutencao = desativada ? 'Reative a máquina para registrar uma manutenção' : undefined

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
            {situacao.estado === 'LOCADA' && situacao.reserva && (
              <Badge tom="warning" ponto={false} className="gap-1 pl-1.5 tracking-normal">
                <SeloReserva pequeno />
                Reserva
              </Badge>
            )}
          </span>
        }
        descricao={`${TIPO_MAQUINA[maquina.tipo].label} (${TIPO_MAQUINA[maquina.tipo].descricao.toLowerCase()}) · cadastrada em ${dataCurta(hojeLocalIso(new Date(maquina.criadoEm)))}`}
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
            <Button icone={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setModalReclamacao({})}>
              Registrar reclamação
            </Button>
            <Button
              variante="primary"
              icone={<ClipboardPlus className="h-4 w-4" />}
              onClick={() => setModalOS({})}
              disabled={desativada}
              title={semManutencao}
            >
              Nova manutenção
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
          detalhe={
            resumo.emAberto
              ? `${resumo.emAberto} em aberto`
              : resumo.ultimaManutencao
                ? `Última em ${dataCurta(resumo.ultimaManutencao)}`
                : 'Nenhuma concluída ainda'
          }
        />
        <StatCard
          rotulo="Reclamações"
          valor={resumo.reclamacoes}
          formatar={(v) => numero(Math.round(v))}
          icone={<MessageSquareWarning className="h-4 w-4" />}
          detalhe={resumo.ultimaReclamacao ? `Última em ${dataCurta(resumo.ultimaReclamacao)}` : 'Nenhuma registrada'}
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
          detalhe={
            resumo.diasReserva ? (
              <span
                title={`Dias em que ela ficou com o cliente como reserva: não contam diária, a não ser que ele use.${
                  !resumo.diasReservaUsada
                    ? ''
                    : resumo.diasReserva === 1
                      ? ' Ela foi usada nesse dia.'
                      : ` Ela foi usada em ${numero(resumo.diasReservaUsada)} deles.`
                }`}
              >
                + {numero(resumo.diasReserva)} {resumo.diasReserva === 1 ? 'dia' : 'dias'} como reserva
              </span>
            ) : (
              'Dias em eventos'
            )
          }
          delay={0.12}
        />
      </div>

      {/* No celular: onde está → manutenções → reclamações; no computador, os dois cartões menores à esquerda */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3 lg:grid-rows-[auto_1fr]">
        <Card className="lg:col-start-1 lg:row-start-1">
          <CardHeader icone={<MapPin className="h-4 w-4" />} titulo="Onde está" descricao="Situação de hoje" />
          <div className="flex flex-col gap-4 px-5 pb-5">
            <OndeEsta
              situacao={situacao}
              hoje={hoje}
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
          <Reclamacoes
            reclamacoes={reclamacoes}
            eventoPorId={eventoPorId}
            nomeCliente={nomeCliente}
            podeAbrirManutencao={!desativada}
            aoRegistrar={() => setModalReclamacao({})}
            aoEditar={(r) => setModalReclamacao({ reclamacao: r })}
            aoApagar={(r) => void apagarReclamacao(r)}
            aoAbrirManutencao={manutencaoDaReclamacao}
          />
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
                  { valor: 'reclamacao', label: 'Reclamações' },
                  { valor: 'locacao', label: 'Locações' },
                ]}
              />
            )}
          </div>

          {aba === 'manutencoes' ? (
            ordens.length ? (
              <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
                {ordens.slice(0, limite).map((o, i) => (
                  <CartaoManutencao
                    key={o.id}
                    ordem={o}
                    indice={i}
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
                titulo="Nenhuma manutenção registrada"
                descricao="Registre limpezas, higienizações, revisões e consertos para acompanhar a saúde desta máquina."
                acao={
                  !desativada && (
                    <Button variante="primary" icone={<ClipboardPlus className="h-4 w-4" />} onClick={() => setModalOS({})}>
                      Registrar a primeira manutenção
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
                {
                  tudo: 'Sem histórico ainda',
                  os: 'Nenhuma manutenção ainda',
                  reclamacao: 'Nenhuma reclamação',
                  locacao: 'Nenhuma locação ainda',
                }[filtro]
              }
              descricao={
                {
                  tudo: 'Os eventos para os quais ela for enviada aparecem aqui, junto com as manutenções e as reclamações.',
                  os: 'As manutenções desta máquina aparecem aqui.',
                  reclamacao: 'As reclamações dos clientes sobre esta máquina aparecem aqui.',
                  locacao: 'Os eventos para os quais ela for enviada aparecem aqui.',
                }[filtro]
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
        inicial={modalOS?.inicial}
      />
      <ReclamacaoModal
        aberto={!!modalReclamacao}
        aoFechar={() => setModalReclamacao(null)}
        reclamacao={modalReclamacao?.reclamacao}
        maquinaId={maquina.id}
      />
    </>
  )
}

/** Situação de hoje em destaque: locada (com o evento), disponível, em manutenção ou desativada. */
function OndeEsta({
  situacao,
  hoje,
  ordemAberta,
  nomeCliente,
  aoAbrirOS,
}: {
  situacao: SituacaoMaquina
  hoje: string
  ordemAberta: OrdemServico | undefined
  nomeCliente: Map<string, string>
  aoAbrirOS: () => void
}) {
  const { estado, evento, reserva } = situacao
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
        {estado === 'LOCADA' ? (reserva ? 'Locada agora · como reserva' : 'Locada agora') : ESTADO_MAQUINA[estado].label}
      </p>
      {estado === 'LOCADA' && evento ? (
        <>
          <DadosEvento evento={evento} nomeCliente={nomeCliente} />
          {reserva && (
            <p className="mt-2.5 flex items-start gap-1.5 border-t border-current/15 pt-2.5 text-[13px] text-ink-2">
              <SeloReserva className="mt-px" />
              {DICA_RESERVA[usoDaReserva(evento, hoje)]}
            </p>
          )}
        </>
      ) : estado === 'DISPONIVEL' ? (
        <p className="mt-1 text-sm text-ink-2">Livre hoje: não está em nenhum evento.</p>
      ) : estado === 'DESATIVADA' ? (
        <p className="mt-1 text-sm text-ink-2">Fora de uso e fora da lista para eventos. O histórico continua guardado.</p>
      ) : (
        <>
          {ordemAberta ? (
            <p className="mt-1 text-sm text-ink-2">
              Manutenção {codigoOS(ordemAberta.numero)} · {STATUS_OS[ordemAberta.status].label.toLowerCase()} desde{' '}
              {dataCurta(ordemAberta.abertura)}
              {(ordemAberta.servicos[0] || ordemAberta.problema) && (
                <span className="block truncate text-[13px] text-muted">
                  {ordemAberta.servicos.join(', ') || ordemAberta.problema}
                </span>
              )}
            </p>
          ) : (
            <div className="mt-1 text-sm text-ink-2">
              <p>Nenhuma manutenção em aberto registrando o serviço.</p>
              <Button
                variante="secondary"
                tamanho="sm"
                className="mt-2"
                icone={<ClipboardPlus className="h-3.5 w-3.5" />}
                onClick={aoAbrirOS}
              >
                Registrar manutenção
              </Button>
            </div>
          )}
          {evento && (
            <p className="mt-2 border-t border-current/15 pt-2 text-[13px] font-medium">
              Atenção: está marcada hoje{reserva ? ' como reserva' : ''} em{' '}
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

/** Nome do evento, período, cliente e o link para abri-lo. */
function DadosEvento({ evento, nomeCliente }: { evento: Evento; nomeCliente: Map<string, string> }) {
  const p = periodoEvento(evento)
  return (
    <div className="mt-1">
      <p className="text-base leading-snug font-semibold break-words text-ink">{localDaLocacao(evento)}</p>
      <p className="mt-1 text-[13px] text-ink-2">
        {p && <span className="tnum">{periodo(p.inicio, p.fim)}</span>}
        {nomeCliente.get(evento.clienteId) && ` · ${nomeCliente.get(evento.clienteId)}`}
      </p>
      {evento.periodoCorrido && <p className="text-xs text-ink-2">Fica com o cliente o período todo.</p>}
      <Link
        to={`/eventos/${evento.id}`}
        className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium underline-offset-2 hover:underline"
      >
        Abrir o evento {codigoEvento(evento.codigo)}
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
              className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2"
            >
              <CalendarClock className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{localDaLocacao(l.evento)}</span>
                <span className="tnum block text-xs text-muted">
                  {periodo(l.inicio, l.fim)}
                  {l.reserva && ' · como reserva'}
                </span>
              </span>
              {l.reserva && <SeloReserva className="shrink-0" />}
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

/** Cartão "Reclamações de clientes": o que os clientes relataram sobre a máquina. */
function Reclamacoes({
  reclamacoes,
  eventoPorId,
  nomeCliente,
  podeAbrirManutencao,
  aoRegistrar,
  aoEditar,
  aoApagar,
  aoAbrirManutencao,
}: {
  reclamacoes: Reclamacao[]
  eventoPorId: Map<string, Evento>
  nomeCliente: Map<string, string>
  podeAbrirManutencao: boolean
  aoRegistrar: () => void
  aoEditar: (r: Reclamacao) => void
  aoApagar: (r: Reclamacao) => void
  aoAbrirManutencao: (r: Reclamacao) => void
}) {
  const [todas, setTodas] = useState(false)
  const visiveis = todas ? reclamacoes : reclamacoes.slice(0, RECLAMACOES_VISIVEIS)
  return (
    <>
      <CardHeader
        icone={<MessageSquareWarning className="h-4 w-4" />}
        titulo="Reclamações de clientes"
        descricao={
          reclamacoes.length
            ? `${reclamacoes.length} ${reclamacoes.length === 1 ? 'registrada' : 'registradas'}`
            : 'O que os clientes relataram'
        }
        acoes={
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={aoRegistrar}
            aria-label="Registrar reclamação"
            title="Registrar reclamação"
            className="-mt-1 -mr-1.5"
          >
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        }
      />
      {reclamacoes.length ? (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {visiveis.map((r, i) => {
              const evento = r.eventoId ? eventoPorId.get(r.eventoId) : undefined
              const cliente = evento && nomeCliente.get(evento.clienteId)
              return (
                <motion.li
                  key={r.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 6) * 0.03, duration: 0.22 }}
                  className="px-5 py-3.5"
                >
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-sm break-words whitespace-pre-line text-ink">{r.descricao}</p>
                    <div className="-mt-1 -mr-2 flex shrink-0 items-center">
                      <Button
                        variante="ghost"
                        tamanho="icon-sm"
                        onClick={() => aoEditar(r)}
                        aria-label="Editar reclamação"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variante="ghost"
                        tamanho="icon-sm"
                        onClick={() => aoApagar(r)}
                        aria-label="Apagar reclamação"
                        title="Apagar"
                        className="hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    <span className="tnum">{dataCurta(r.data)}</span>
                    {evento ? (
                      <>
                        {' · '}
                        <Link
                          to={`/eventos/${evento.id}`}
                          className="font-medium text-ink-2 underline decoration-current/30 underline-offset-2 hover:text-brand-ink hover:decoration-current"
                        >
                          <span className="tnum">{codigoEvento(evento.codigo)}</span> {evento.nome}
                        </Link>
                      </>
                    ) : r.eventoId ? (
                      ' · Evento excluído'
                    ) : (
                      ' · Sem evento'
                    )}
                    {cliente && ` · ${cliente}`}
                  </p>
                  {podeAbrirManutencao && (
                    <Button
                      variante="soft"
                      tamanho="sm"
                      icone={<Wrench className="h-3.5 w-3.5" />}
                      onClick={() => aoAbrirManutencao(r)}
                      className="mt-2.5 h-7 px-2.5 text-xs"
                      title="Registrar uma manutenção corretiva com este relato"
                    >
                      Abrir manutenção
                    </Button>
                  )}
                </motion.li>
              )
            })}
          </ul>
          {reclamacoes.length > RECLAMACOES_VISIVEIS && (
            <div className="border-t border-line px-5 py-2.5">
              <button
                type="button"
                onClick={() => setTodas((t) => !t)}
                className="cursor-pointer text-[13px] font-medium text-brand-ink hover:underline"
              >
                {todas ? 'Mostrar menos' : `Mostrar todas (${reclamacoes.length})`}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="mx-5 mb-5 rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2">
          Nenhuma reclamação registrada. Quando a máquina voltar de um evento e o cliente tiver relatado algum problema (ex.:
          “estava travando”), registre aqui.
        </p>
      )}
    </>
  )
}

/** Uma manutenção com todos os detalhes e as ações. */
function CartaoManutencao({
  ordem,
  indice,
  aoEditar,
  aoConcluir,
  aoExcluir,
}: {
  ordem: OrdemServico
  indice: number
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
            <span className="tnum text-[15px] font-semibold text-ink">Manutenção {codigoOS(ordem.numero)}</span>
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
            aria-label={`Editar a manutenção ${codigoOS(ordem.numero)}`}
            title="Editar"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variante="ghost"
            tamanho="icon-sm"
            onClick={aoExcluir}
            aria-label={`Excluir a manutenção ${codigoOS(ordem.numero)}`}
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

      {(ordem.problema || ordem.responsavel) && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
          {ordem.problema && <Dado rotulo="Problema relatado">{ordem.problema}</Dado>}
          {ordem.responsavel && <Dado rotulo="Responsável">{ordem.responsavel}</Dado>}
        </dl>
      )}
      <RegistroAntigo ordem={ordem} />
    </motion.article>
  )
}

/** Serviço realizado e peças de manutenções antigas (campos que saíram da tela), em letra miúda. */
function RegistroAntigo({ ordem, className }: { ordem: OrdemServico; className?: string }) {
  if (!ordem.solucao && !ordem.pecas) return null
  return (
    <p className={cn('mt-2 text-xs break-words text-muted', className)}>
      {ordem.solucao && (
        <>
          <span className="font-medium">Feito:</span> {ordem.solucao}
        </>
      )}
      {ordem.solucao && ordem.pecas && ' · '}
      {ordem.pecas && (
        <>
          <span className="font-medium">Peças:</span> {ordem.pecas}
        </>
      )}
    </p>
  )
}

/** Linha do tempo com manutenções, reclamações e locações, separada por ano. */
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
              {item.tipo === 'os' ? (
                <ItemManutencao item={item} />
              ) : item.tipo === 'reclamacao' ? (
                <ItemReclamacao item={item} nomeCliente={nomeCliente} />
              ) : (
                <ItemLocacao item={item} hoje={hoje} nomeCliente={nomeCliente} />
              )}
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

function ItemManutencao({ item }: { item: Extract<ItemHistorico, { tipo: 'os' }> }) {
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
            Manutenção {TIPO_OS[o.tipo].label.toLowerCase()} · {codigoOS(o.numero)}
          </p>
          <StatusOSBadge status={o.status} />
        </div>
        <p className="tnum text-xs text-muted">
          {dataCurta(o.abertura)}
          {o.conclusao && o.conclusao !== o.abertura && ` a ${dataCurta(o.conclusao)}`}
          {o.responsavel && ` · ${o.responsavel}`}
        </p>
        {o.servicos.length > 0 && <p className="mt-1 text-[13px] text-ink-2">{o.servicos.join(', ')}</p>}
        {o.problema && (
          <p className="mt-1 text-[13px] break-words text-ink-2">
            <span className="text-muted">Problema: </span>
            {o.problema}
          </p>
        )}
        <RegistroAntigo ordem={o} className="mt-1" />
      </div>
    </>
  )
}

function ItemReclamacao({
  item,
  nomeCliente,
}: {
  item: Extract<ItemHistorico, { tipo: 'reclamacao' }>
  nomeCliente: Map<string, string>
}) {
  const { reclamacao: r, evento } = item
  const cliente = evento && nomeCliente.get(evento.clienteId)
  return (
    <>
      <Marcador icone={<MessageSquareWarning className="h-4 w-4" />} classe="bg-warning-soft text-warning" />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium text-ink">
          Reclamação do cliente
          {evento && (
            <>
              {' · '}
              <Link to={`/eventos/${evento.id}`} className="break-words hover:text-brand-ink hover:underline">
                {evento.nome}
              </Link>
            </>
          )}
        </p>
        <p className="tnum text-xs text-muted">
          {dataCurta(r.data)}
          {evento && ` · ${codigoEvento(evento.codigo)}`}
          {cliente && ` · ${cliente}`}
        </p>
        <p className="mt-1 text-[13px] break-words whitespace-pre-line text-ink-2">“{r.descricao}”</p>
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
  // Como reserva: em quantos dias ela com certeza foi usada (cobrada); com mais de uma reserva e só
  // parte usada, não dá para saber qual
  const usoReserva =
    !item.reserva || item.quando === 'futura'
      ? null
      : item.diasUsada
        ? `reserva usada${e.dias.length > 1 ? ` em ${item.diasUsada} ${item.diasUsada === 1 ? 'dia' : 'dias'}` : ''}`
        : e.dias.some((d) => reservasUsadasDia(d) > 0)
          ? 'o cliente usou parte das reservas'
          : item.quando === 'agora'
            ? 'reserva sem uso até agora'
            : 'reserva sem uso'
  return (
    <>
      <span
        className="relative shrink-0"
        title={item.reserva ? 'Foi como reserva: fica com o cliente e só é cobrada se ele usar' : undefined}
      >
        <Marcador icone={<Ticket className="h-4 w-4" />} classe="bg-info-soft text-info" />
        {item.reserva && <SeloReserva pequeno className="absolute -right-1 bottom-0 ring-2 ring-surface" />}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/eventos/${e.id}`} className="text-sm font-medium break-words text-ink hover:text-brand-ink hover:underline">
            {item.reserva ? 'Reserva' : 'Locada'} · {localDaLocacao(e)}
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
          {e.periodoCorrido && ' · período todo com o cliente'}
          {usoReserva && ` · ${usoReserva}`}
        </p>
      </div>
    </>
  )
}

function Dado({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-line text-ink-2">{children || <span className="text-muted">—</span>}</dd>
    </div>
  )
}
