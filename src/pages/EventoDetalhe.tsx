import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CalendarRange,
  Clock,
  Copy,
  CreditCard,
  Ellipsis,
  FileDown,
  Landmark,
  Mail,
  MapPin,
  MessageCircle,
  MessageSquarePlus,
  MessageSquareWarning,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  QrCode,
  Receipt,
  ReceiptText,
  Send,
  StickyNote,
  User,
  Trash2,
  Wallet,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AnexosEvento } from '../components/AnexosEvento'
import { ConferenciaBadge, PagamentoBadge } from '../components/Badges'
import { EnviarDocumentoModal, type CanalEnvio } from '../components/EnviarDocumentoModal'
import { useAcoesEvento } from '../components/EventosTabela'
import { IconeMaquinaFichas } from '../components/IconeMaquinaFichas'
import { MaquinaChip, useSituacoes } from '../components/Maquinas'
import { MaquinasEnviadas } from '../components/MaquinasEvento'
import { SeletorProgramacao } from '../components/Programacao'
import { ReclamacaoModal } from '../components/ReclamacaoModal'
import { TextoFicha } from '../components/TextoFicha'
import { GoogleSyncBadge } from '../components/GoogleSyncBadge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { Field, Input, NumberInput } from '../components/ui/Form'
import { Modal } from '../components/ui/Modal'
import { Avatar, EmptyState, Menu, PageHeader, Segmented } from '../components/ui/Misc'
import { calcularEvento, FORMAS_PAGAMENTO, STATUS_EVENTO } from '#shared/calc.ts'
import { diasOcupados, STATUS_PROGRAMACAO } from '#shared/maquinas.ts'
import { cn } from '../lib/cn'
import { codigoEvento, dataCurta, dataExtensa, enderecoCompleto, hojeISO, moeda, numero, periodo } from '../lib/format'
import { useHoje } from '../lib/hoje'
import type { Evento, EventoPatch, FormaPagamento, Maquina, Reclamacao, StatusEvento } from '#shared/tipos.ts'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { cidadeDoEvento, podeGerarRecibo } from '../lib/recibo'

const ICONES_PAGAMENTO: Record<Exclude<FormaPagamento, 'NAO_PAGO'>, ReactNode> = {
  PIX: <QrCode className="h-4 w-4" />,
  DINHEIRO: <Banknote className="h-4 w-4" />,
  DEBITO: <CreditCard className="h-4 w-4" />,
  CREDITO: <CreditCard className="h-4 w-4" />,
  BOLETO: <Landmark className="h-4 w-4" />,
}

/** Animação das faixas que aparecem embaixo do status (recibo, reclamação). */
const FAIXA = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
}

export function EventoDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const evento = useDados((s) => s.eventos.find((e) => e.id === id))
  const cliente = useDados((s) => s.clientes.find((c) => c.id === evento?.clienteId))
  const alterarEvento = useDados((s) => s.alterarEvento)
  const acoes = useAcoesEvento()
  const [modalPagamento, setModalPagamento] = useState(false)
  const [modalDevolucao, setModalDevolucao] = useState(false)
  const [gerando, setGerando] = useState(false)
  const [gerandoRecibo, setGerandoRecibo] = useState(false)
  // Janelas que guardam o último conteúdo enquanto fecham (sem trocar o título na animação de saída)
  const [envio, setEnvio] = useState<{ aberto: boolean; canal: CanalEnvio }>({ aberto: false, canal: 'whatsapp' })
  const [reclamacao, setReclamacao] = useState<{ aberto: boolean; editar?: Reclamacao }>({ aberto: false })
  // Logo depois de finalizar por aqui: sugere registrar o que o cliente reclamou das máquinas
  const [sugerirReclamacao, setSugerirReclamacao] = useState(false)
  const [salvandoProgramacao, setSalvandoProgramacao] = useState(false)

  if (!evento) {
    return (
      <EmptyState
        icone={<CalendarDays className="h-6 w-6" />}
        titulo="Evento não encontrado"
        descricao="Ele pode ter sido excluído."
        acao={<Button onClick={() => navegar('/eventos')}>Voltar para eventos</Button>}
      />
    )
  }

  const r = calcularEvento(evento)
  const completo = { evento, resumo: r, cliente }
  const cidade = cidadeDoEvento(evento, cliente)

  /** Alteração rápida no servidor; devolve `true` se deu certo (para fechar o modal). */
  const alterar = async (patch: EventoPatch, titulo: string, descricao: string) => {
    try {
      await alterarEvento(evento.id, patch)
      toast.sucesso(titulo, descricao)
      return true
    } catch (e) {
      avisarErro('Não foi possível salvar', e)
      return false
    }
  }

  const gerarPDF = async () => {
    setGerando(true)
    await acoes.pdf(completo)
    setGerando(false)
  }

  // Recibo: só para pagamento em PIX ou dinheiro; em destaque depois que o evento é finalizado
  const temRecibo = podeGerarRecibo(evento)
  const destaqueRecibo = temRecibo && evento.status === 'FINALIZADO'
  const gerarRecibo = async () => {
    setGerandoRecibo(true)
    await acoes.recibo(completo)
    setGerandoRecibo(false)
  }
  const pagoEm = `${FORMAS_PAGAMENTO[evento.formaPagamento].label}${evento.dataPagamento ? ` em ${dataCurta(evento.dataPagamento)}` : ''}`
  const enviar = (canal: CanalEnvio) => setEnvio({ aberto: true, canal })

  /** Finalizado por aqui, com máquinas: aparece a sugestão de registrar reclamação. */
  const aoFinalizar = () => {
    if (evento.maquinasIds.length) setSugerirReclamacao(true)
  }

  const mudarStatus = async (s: StatusEvento) => {
    const oferecerRecibo = s === 'FINALIZADO' && podeGerarRecibo({ ...evento, status: s })
    const ok = await alterar(
      { status: s },
      oferecerRecibo ? 'Evento finalizado' : 'Status atualizado',
      oferecerRecibo ? 'Use “Gerar recibo”, logo abaixo do status, para entregar o recibo ao cliente.' : STATUS_EVENTO[s].label,
    )
    if (ok && s === 'FINALIZADO') aoFinalizar()
    else if (ok) setSugerirReclamacao(false)
  }

  const mudarProgramacao = async (p: Evento['programacao']) => {
    setSalvandoProgramacao(true)
    await alterar({ programacao: p }, 'Programação atualizada', STATUS_PROGRAMACAO[p].label)
    setSalvandoProgramacao(false)
  }

  return (
    <>
      <PageHeader
        voltar={
          <Link
            to="/eventos"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Eventos
          </Link>
        }
        titulo={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {evento.nome}
            <span className="tnum rounded-lg bg-surface-3 px-2 py-0.5 text-sm font-medium text-muted">
              {codigoEvento(evento.codigo)}
            </span>
            <GoogleSyncBadge evento={evento} />
          </span>
        }
        descricao={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {cliente ? (
              <Link to={`/clientes/${cliente.id}`} className="font-medium text-ink-2 hover:text-brand-ink hover:underline">
                {cliente.nome}
              </Link>
            ) : (
              'Cliente removido'
            )}
            <span className="text-line-strong">•</span>
            <span className="tnum">{periodo(r.dataInicio, r.dataFim)}</span>
            {/* A cidade do evento (só os antigos têm uma) ou a do cadastro do cliente */}
            {cidade && (
              <>
                <span className="text-line-strong">•</span>
                {cidade}
              </>
            )}
          </span>
        }
        acoes={
          <>
            <Button icone={<Pencil className="h-4 w-4" />} onClick={() => acoes.editar(evento.id)}>
              Editar
            </Button>
            {/* No celular, o envio fica no menu "…" (os botões não cabem numa linha) */}
            <div className="flex max-sm:hidden">
              <Menu
                gatilho={(abrir) => (
                  <Button icone={<Send className="h-4 w-4" />} onClick={abrir}>
                    Enviar
                  </Button>
                )}
                itens={[
                  {
                    label: 'Enviar por WhatsApp',
                    icone: <MessageCircle className="h-4 w-4" />,
                    aoClicar: () => enviar('whatsapp'),
                  },
                  { label: 'Enviar por e-mail', icone: <Mail className="h-4 w-4" />, aoClicar: () => enviar('email') },
                ]}
              />
            </div>
            <Button variante="primary" icone={<FileDown className="h-4 w-4" />} onClick={gerarPDF} disabled={gerando}>
              {gerando ? 'Gerando…' : 'Gerar PDF'}
            </Button>
            <Menu
              gatilho={(abrir) => (
                <Button tamanho="icon" onClick={abrir} aria-label="Mais ações">
                  <Ellipsis className="h-4 w-4" />
                </Button>
              )}
              itens={[
                ...(temRecibo
                  ? [{ label: 'Gerar recibo', icone: <ReceiptText className="h-4 w-4" />, aoClicar: () => void gerarRecibo() }]
                  : []),
                {
                  label: 'Enviar por WhatsApp',
                  icone: <MessageCircle className="h-4 w-4" />,
                  aoClicar: () => enviar('whatsapp'),
                },
                { label: 'Enviar por e-mail', icone: <Mail className="h-4 w-4" />, aoClicar: () => enviar('email') },
                'sep',
                { label: 'Duplicar evento', icone: <Copy className="h-4 w-4" />, aoClicar: () => acoes.duplicar(evento.id) },
                'sep',
                {
                  label: 'Excluir evento',
                  icone: <Trash2 className="h-4 w-4" />,
                  perigo: true,
                  aoClicar: () => acoes.excluir(completo, () => navegar('/eventos', { replace: true })),
                },
              ]}
            />
          </>
        }
      />

      {/* Andamento: status do evento e da programação das máquinas (e as sugestões ao finalizar) */}
      <Card className="mb-6 overflow-hidden">
        <div className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-[13px] font-medium text-muted">Status</span>
              <Segmented
                tamanho="sm"
                valor={evento.status}
                aoMudar={(s) => void mudarStatus(s)}
                opcoes={(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => ({ valor: s, label: STATUS_EVENTO[s].label }))}
              />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label htmlFor="det-programacao" className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
                <IconeMaquinaFichas className="h-3.5 w-3.5" />
                Programação
              </label>
              <div className="flex items-center gap-2">
                <PontoProgramacao status={evento.programacao} />
                <SeletorProgramacao
                  id="det-programacao"
                  valor={evento.programacao}
                  aoMudar={(p) => void mudarProgramacao(p)}
                  disabled={salvandoProgramacao}
                  className="h-8! w-[184px] rounded-lg! text-[13px]!"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {r.conferencia !== 'CONFERIDO' && (
              <Button tamanho="sm" icone={<PackageCheck className="h-4 w-4" />} onClick={() => setModalDevolucao(true)}>
                Registrar devolução
              </Button>
            )}
            {!r.pago && evento.status !== 'CANCELADO' && (
              <Button tamanho="sm" variante="soft" icone={<Wallet className="h-4 w-4" />} onClick={() => setModalPagamento(true)}>
                Registrar pagamento
              </Button>
            )}
          </div>
        </div>
        <AnimatePresence initial={false}>
          {destaqueRecibo && (
            <motion.div key="recibo" {...FAIXA} className="overflow-hidden">
              <div className="flex flex-col gap-3 border-t border-line bg-brand-soft px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
                    <ReceiptText className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">Recibo para o cliente</p>
                    <p className="tnum text-[13px] text-ink-2">
                      Pago via {pagoEm} • <b className="font-semibold text-ink">{moeda(r.total)}</b>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-sm:w-full">
                  <Button
                    variante="primary"
                    icone={<ReceiptText className="h-4 w-4" />}
                    onClick={gerarRecibo}
                    disabled={gerandoRecibo}
                    className="max-sm:w-full"
                  >
                    {gerandoRecibo ? 'Gerando…' : 'Gerar recibo'}
                  </Button>
                  <Button
                    icone={<MessageCircle className="h-4 w-4" />}
                    onClick={() => enviar('whatsapp')}
                    title="Enviar o recibo pelo WhatsApp"
                    className="max-sm:flex-1"
                  >
                    WhatsApp
                  </Button>
                  <Button
                    icone={<Mail className="h-4 w-4" />}
                    onClick={() => enviar('email')}
                    title="Enviar o recibo por e-mail"
                    className="max-sm:flex-1"
                  >
                    E-mail
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
          {sugerirReclamacao && evento.status === 'FINALIZADO' && (
            <motion.div key="reclamacao" {...FAIXA} className="overflow-hidden">
              <div className="flex flex-col gap-3 border-t border-line bg-surface-2/70 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
                    <MessageSquareWarning className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">O cliente reclamou de alguma máquina?</p>
                    <p className="text-[13px] text-ink-2">Ex.: “estava travando”. Registre para ficar no histórico da máquina.</p>
                  </div>
                </div>
                <div className="flex gap-2 max-sm:w-full">
                  <Button
                    variante="soft"
                    icone={<MessageSquarePlus className="h-4 w-4" />}
                    onClick={() => {
                      setSugerirReclamacao(false)
                      setReclamacao({ aberto: true })
                    }}
                    className="max-sm:flex-1"
                  >
                    Registrar reclamação
                  </Button>
                  <Button variante="ghost" onClick={() => setSugerirReclamacao(false)}>
                    Não houve
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* Resumo financeiro */}
          <Card className="overflow-hidden">
            <CardHeader
              icone={<Receipt className="h-4 w-4" />}
              titulo="Resumo financeiro"
              descricao="Mesmo cálculo da planilha de controle interno."
            />
            <div className="px-5">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  <LinhaResumo rotulo="Quantidade de diárias utilizadas" valor={numero(r.totalDiarias)} />
                  <LinhaResumo rotulo="Valor unitário da diária" valor={moeda(evento.valorDiaria)} />
                  <LinhaResumo rotulo="Valor total das diárias" valor={moeda(r.valorDiarias)} forte />
                  <LinhaResumo
                    rotulo="Quantidade de bobinas utilizadas"
                    valor={r.bobinasUtilizadas === null ? 'A conferir' : numero(r.bobinasUtilizadas)}
                  />
                  <LinhaResumo rotulo="Valor unitário da bobina" valor={moeda(evento.valorBobina)} />
                  <LinhaResumo rotulo="Valor total das bobinas" valor={moeda(r.valorBobinas)} forte />
                  {r.desconto > 0 && <LinhaResumo rotulo="Desconto" valor={`− ${moeda(r.desconto)}`} />}
                </tbody>
              </table>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="m-5 flex items-center justify-between rounded-2xl bg-brand px-5 py-4 text-white"
            >
              <span className="text-sm font-semibold tracking-wide">VALOR TOTAL</span>
              <span className="tnum text-2xl font-semibold tracking-[-0.02em]">{moeda(r.total)}</span>
            </motion.div>
          </Card>

          {/* Fichas: texto para programar nas máquinas (o nome do evento sai no topo) */}
          <Card>
            <CardHeader
              icone={<ReceiptText className="h-4 w-4" />}
              titulo="Fichas"
              descricao="Texto para programar nas máquinas: o nome do evento sai no topo e o rodapé, no fim."
            />
            {/* Lado a lado quando há espaço */}
            <div className="@container px-5 pb-5">
              <div className="grid grid-cols-1 items-start gap-4 @lg:grid-cols-2">
                <TextoFicha rotulo="Nome do evento" dica="topo da ficha" texto={evento.nome} vazio="Sem nome." />
                <TextoFicha
                  rotulo="Rodapé"
                  dica="fim da ficha"
                  texto={evento.rodape}
                  vazio="Sem rodapé. Use “Editar” para preencher."
                />
              </div>
            </div>
          </Card>

          {/* Arquivos que o cliente mandou (prints, logo, cardápio…) */}
          <AnexosEvento eventoId={evento.id} id="arquivos" />

          {/* Dias */}
          <DiasDeUtilizacao evento={evento} totalDiarias={r.totalDiarias} />
        </div>

        <div className="flex flex-col gap-6">
          <MaquinasEnviadas evento={evento} />

          <ReclamacoesDoEvento
            evento={evento}
            aoRegistrar={() => setReclamacao({ aberto: true })}
            aoEditar={(rec) => setReclamacao({ aberto: true, editar: rec })}
          />

          {/* Cliente */}
          <Card>
            <CardHeader titulo="Cliente" />
            {cliente ? (
              <div className="px-5 pb-5">
                <Link to={`/clientes/${cliente.id}`} className="group flex items-center gap-3">
                  <Avatar nome={cliente.nome} className="h-10 w-10" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink group-hover:text-brand-ink">{cliente.nome}</p>
                    <p className="truncate text-xs text-muted">
                      {cliente.documento ||
                        { PJ: 'Pessoa jurídica', PF: 'Pessoa física', AVULSO: 'Cliente avulso' }[cliente.tipo]}
                    </p>
                  </div>
                </Link>
                <div className="mt-4 flex flex-col gap-2 text-sm">
                  {cliente.responsavel && <Info icone={<User className="h-4 w-4" />}>{cliente.responsavel}</Info>}
                  {cliente.telefone && <Info icone={<Phone className="h-4 w-4" />}>{cliente.telefone}</Info>}
                  {cliente.email && <Info icone={<Mail className="h-4 w-4" />}>{cliente.email}</Info>}
                  {enderecoCompleto(cliente) && <Info icone={<MapPin className="h-4 w-4" />}>{enderecoCompleto(cliente)}</Info>}
                </div>
              </div>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted">O cliente deste evento foi removido.</p>
            )}
          </Card>

          {/* Bobinas */}
          <Card>
            <CardHeader
              icone={<Package className="h-4 w-4" />}
              titulo="Bobinas"
              acoes={<ConferenciaBadge status={r.conferencia} />}
            />
            <div className="grid grid-cols-3 gap-2 px-5 pb-5">
              <Mini rotulo="Consignadas" valor={numero(evento.bobinasConsignadas)} />
              <Mini rotulo="Devolvidas" valor={evento.bobinasDevolvidas === null ? '—' : numero(evento.bobinasDevolvidas)} />
              <Mini rotulo="Utilizadas" valor={r.bobinasUtilizadas === null ? '—' : numero(r.bobinasUtilizadas)} destaque />
            </div>
          </Card>

          {/* Pagamento */}
          <Card>
            <CardHeader
              icone={<Wallet className="h-4 w-4" />}
              titulo="Pagamento"
              acoes={<PagamentoBadge forma={evento.formaPagamento} />}
            />
            <div className="px-5 pb-5 text-sm">
              {r.pago ? (
                <>
                  <p className="text-ink-2">
                    Pago via <b className="font-medium text-ink">{FORMAS_PAGAMENTO[evento.formaPagamento].label}</b>
                    {evento.dataPagamento && (
                      <>
                        {' '}
                        em <b className="tnum font-medium text-ink">{dataCurta(evento.dataPagamento)}</b>
                      </>
                    )}
                    .
                  </p>
                  {/* Finalizado, o recibo fica em destaque logo abaixo do status */}
                  {temRecibo && !destaqueRecibo && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        tamanho="sm"
                        variante="soft"
                        icone={<ReceiptText className="h-4 w-4" />}
                        onClick={gerarRecibo}
                        disabled={gerandoRecibo}
                      >
                        {gerandoRecibo ? 'Gerando…' : 'Gerar recibo'}
                      </Button>
                      <Button tamanho="sm" icone={<Send className="h-4 w-4" />} onClick={() => enviar('whatsapp')}>
                        Enviar
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-ink-2">
                    <Clock className="h-4 w-4 text-warning" />
                    Aguardando pagamento de <b className="tnum font-semibold text-ink">{moeda(r.total)}</b>
                  </p>
                  {evento.status !== 'CANCELADO' && r.total > 0 && (
                    <Button tamanho="sm" className="mt-3" icone={<Send className="h-4 w-4" />} onClick={() => enviar('whatsapp')}>
                      Enviar o total ao cliente
                    </Button>
                  )}
                </>
              )}
            </div>
          </Card>

          {evento.observacoes && (
            <Card>
              <CardHeader icone={<StickyNote className="h-4 w-4" />} titulo="Observações" />
              <p className="px-5 pb-5 text-sm break-words whitespace-pre-wrap text-ink-2">{evento.observacoes}</p>
            </Card>
          )}
        </div>
      </div>

      <PagamentoModal
        aberto={modalPagamento}
        aoFechar={() => setModalPagamento(false)}
        total={r.total}
        sugerirFinalizar={r.conferencia === 'CONFERIDO'}
        aoConfirmar={async (forma, data, finalizar) => {
          // Finalizado com PIX ou dinheiro: o recibo aparece em destaque logo abaixo do status
          const oferecerRecibo = finalizar && podeGerarRecibo({ formaPagamento: forma, status: 'FINALIZADO' })
          const ok = await alterar(
            { formaPagamento: forma, dataPagamento: data, ...(finalizar ? { status: 'FINALIZADO' as const } : {}) },
            oferecerRecibo ? 'Pagamento registrado e evento finalizado' : 'Pagamento registrado',
            oferecerRecibo
              ? `${FORMAS_PAGAMENTO[forma].label} • ${moeda(r.total)}. Use “Gerar recibo”, logo abaixo do status.`
              : `${FORMAS_PAGAMENTO[forma].label} • ${moeda(r.total)}`,
          )
          if (ok && finalizar) aoFinalizar()
          return ok
        }}
      />
      <DevolucaoModal
        aberto={modalDevolucao}
        aoFechar={() => setModalDevolucao(false)}
        consignadas={evento.bobinasConsignadas}
        valorBobina={evento.valorBobina}
        aoConfirmar={(devolvidas) =>
          alterar(
            { bobinasDevolvidas: devolvidas },
            'Devolução registrada',
            `${evento.bobinasConsignadas - devolvidas} bobinas utilizadas`,
          )
        }
      />
      <EnviarDocumentoModal
        aberto={envio.aberto}
        aoFechar={() => setEnvio((x) => ({ ...x, aberto: false }))}
        canal={envio.canal}
        evento={evento}
        cliente={cliente}
      />
      <ReclamacaoModal
        aberto={reclamacao.aberto}
        aoFechar={() => setReclamacao((x) => ({ ...x, aberto: false }))}
        reclamacao={reclamacao.editar}
        maquinasIds={evento.maquinasIds}
        eventoId={evento.id}
      />
    </>
  )
}

/** Bolinha com a cor do andamento da programação, ao lado da lista. */
function PontoProgramacao({ status }: { status: Evento['programacao'] }) {
  const cor = { warning: 'bg-warning-dot', info: 'bg-info', brand: 'bg-brand', success: 'bg-success', neutral: 'bg-neutral' }
  const tom = STATUS_PROGRAMACAO[status].tone
  return (
    <span
      aria-hidden
      title={STATUS_PROGRAMACAO[status].descricao}
      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', cor[tom as keyof typeof cor] ?? 'bg-neutral')}
    />
  )
}

/** Dias de uso; com período corrido, deixa claro de quando a quando as máquinas ficam com o cliente. */
function DiasDeUtilizacao({ evento, totalDiarias }: { evento: Evento; totalDiarias: number }) {
  const ocupados = useMemo(() => diasOcupados(evento), [evento])
  const usos = ocupados.filter((d) => d.uso).length
  // Só faz diferença quando há dias sem uso entre o primeiro e o último
  const corrido = evento.periodoCorrido && ocupados.length > usos
  const inicio = ocupados[0]?.data
  const fim = ocupados[ocupados.length - 1]?.data
  return (
    <Card>
      <CardHeader
        icone={<CalendarDays className="h-4 w-4" />}
        titulo="Dias de utilização"
        descricao={
          <span className="tnum">
            {evento.dias.length} {evento.dias.length === 1 ? 'data' : 'datas'} de uso • {numero(totalDiarias)}{' '}
            {totalDiarias === 1 ? 'diária' : 'diárias'}
          </span>
        }
      />
      {corrido && inicio && fim && (
        <div className="mx-5 mb-3 flex items-start gap-3 rounded-xl border border-info/20 bg-info-soft px-3.5 py-3">
          <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-info" />
          <p className="text-[13px] text-ink-2">
            <b className="font-semibold text-ink">Período corrido:</b> as máquinas ficam com o cliente de{' '}
            <b className="tnum font-semibold text-ink">{dataCurta(inicio)}</b> a{' '}
            <b className="tnum font-semibold text-ink">{dataCurta(fim)}</b> ({ocupados.length} dias), sem voltar entre um uso e
            outro. Na agenda, elas contam como ocupadas o período todo; as diárias, só nos dias de uso.
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 px-5 pb-5 sm:grid-cols-2">
        {evento.dias.map((d, i) => (
          <motion.div
            key={d.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5"
          >
            <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 leading-none">
              <span className="text-[10px] font-semibold text-muted uppercase">{dataExtensa(d.data, 'MMM')}</span>
              <span className="tnum mt-0.5 text-base font-semibold text-ink">{dataExtensa(d.data, 'dd')}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{dataExtensa(d.data, 'EEEE')}</p>
              <p className="tnum text-xs text-muted">{dataCurta(d.data)}</p>
            </div>
            <span className="tnum rounded-lg bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-ink">
              {d.maquinas} {d.maquinas === 1 ? 'máquina' : 'máquinas'}
            </span>
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

/**
 * Reclamações que o cliente fez sobre as máquinas deste evento. Aparece quando já há alguma, ou a
 * partir do primeiro dia do evento (antes disso não há o que reclamar).
 */
function ReclamacoesDoEvento({
  evento,
  aoRegistrar,
  aoEditar,
}: {
  evento: Evento
  aoRegistrar: () => void
  aoEditar: (r: Reclamacao) => void
}) {
  const todas = useDados((s) => s.reclamacoes)
  const maquinas = useDados((s) => s.maquinas)
  const excluirReclamacao = useDados((s) => s.excluirReclamacao)
  const situacoes = useSituacoes()
  const hoje = useHoje()
  const lista = useMemo(() => todas.filter((r) => r.eventoId === evento.id), [todas, evento.id])
  const porId = useMemo(() => new Map(maquinas.map((m) => [m.id, m])), [maquinas])
  const inicio = useMemo(() => evento.dias.map((d) => d.data).sort()[0] ?? '', [evento.dias])
  const comecou = !!inicio && inicio <= hoje && evento.status !== 'CANCELADO'
  if (!lista.length && (!comecou || !maquinas.length)) return null

  const apagar = async (r: Reclamacao, m: Maquina | undefined) => {
    const ok = await confirmar({
      titulo: 'Apagar esta reclamação?',
      descricao: `A reclamação${m ? ` da máquina ${m.identificacao}` : ''} sai do histórico. Esta ação não pode ser desfeita.`,
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

  return (
    <Card>
      <CardHeader
        icone={<MessageSquareWarning className="h-4 w-4" />}
        titulo="Reclamações"
        descricao={
          lista.length
            ? `${lista.length} ${lista.length === 1 ? 'registrada' : 'registradas'} neste evento`
            : 'Do cliente, sobre as máquinas'
        }
        acoes={
          <Button
            tamanho="sm"
            variante="soft"
            icone={<MessageSquarePlus className="h-4 w-4" />}
            onClick={aoRegistrar}
            title="Registrar uma reclamação do cliente sobre uma máquina"
          >
            Registrar
          </Button>
        }
      />
      {lista.length ? (
        <ul className="divide-y divide-line border-t border-line">
          <AnimatePresence initial={false}>
            {lista.map((r) => {
              const m = porId.get(r.maquinaId)
              return (
                <motion.li
                  key={r.id}
                  layout="position"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-3 px-5 py-3.5">
                    {m ? (
                      <Link to={`/manutencao/${m.id}`} title={`Abrir a ficha da máquina ${m.identificacao}`} className="shrink-0">
                        <MaquinaChip
                          maquina={m}
                          estado={situacoes.get(m.id)?.estado ?? 'DISPONIVEL'}
                          className="min-w-[52px] cursor-pointer justify-center"
                        />
                      </Link>
                    ) : (
                      <span className="flex h-8 min-w-[52px] shrink-0 items-center justify-center rounded-lg bg-surface-2 px-2 text-xs text-muted">
                        ?
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm break-words whitespace-pre-line text-ink">{r.descricao}</p>
                      <p className="tnum mt-0.5 text-xs text-muted">
                        {dataCurta(r.data)}
                        {!m && ' · máquina excluída'}
                      </p>
                    </div>
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
                        onClick={() => void apagar(r, m)}
                        aria-label="Apagar reclamação"
                        title="Apagar"
                        className="hover:bg-danger-soft hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted">
          Nenhuma reclamação. Se o cliente relatou algum problema numa máquina (ex.: “estava travando”), registre aqui: fica no
          histórico dela.
        </p>
      )}
    </Card>
  )
}

function LinhaResumo({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <tr>
      <td className="py-3 text-ink-2">{rotulo}</td>
      <td className={cn('tnum py-3 text-right whitespace-nowrap', forte ? 'font-semibold text-ink' : 'text-ink-2')}>{valor}</td>
    </tr>
  )
}

function Info({ icone, children }: { icone: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 text-ink-2">
      <span className="mt-0.5 shrink-0 text-muted">{icone}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  )
}

function Mini({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className={cn('rounded-xl px-3 py-2.5', destaque ? 'bg-brand-soft' : 'bg-surface-2')}>
      <p className={cn('text-[11px] font-medium', destaque ? 'text-brand-ink' : 'text-muted')}>{rotulo}</p>
      <p className={cn('tnum mt-0.5 text-lg font-semibold', destaque ? 'text-brand-ink' : 'text-ink')}>{valor}</p>
    </div>
  )
}

function PagamentoModal({
  aberto,
  aoFechar,
  total,
  sugerirFinalizar,
  aoConfirmar,
}: {
  aberto: boolean
  aoFechar: () => void
  total: number
  sugerirFinalizar: boolean
  aoConfirmar: (forma: FormaPagamento, data: string, finalizar: boolean) => Promise<boolean>
}) {
  const [enviando, setEnviando] = useState(false)
  const [forma, setForma] = useState<Exclude<FormaPagamento, 'NAO_PAGO'>>('PIX')
  const [data, setData] = useState(hojeISO())
  const [finalizar, setFinalizar] = useState(true)
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<Wallet className="h-5 w-5" />}
      titulo="Registrar pagamento"
      descricao={`Valor do evento: ${moeda(total)}`}
      largura="max-w-md"
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button
            variante="primary"
            disabled={enviando}
            onClick={async () => {
              setEnviando(true)
              const ok = await aoConfirmar(forma, data || hojeISO(), sugerirFinalizar && finalizar)
              setEnviando(false)
              if (ok) aoFechar()
            }}
          >
            {enviando ? 'Salvando…' : 'Confirmar pagamento'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(Object.keys(ICONES_PAGAMENTO) as Array<keyof typeof ICONES_PAGAMENTO>).map((fp) => (
            <button
              key={fp}
              type="button"
              onClick={() => setForma(fp)}
              aria-pressed={forma === fp}
              className={cn(
                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition-colors',
                forma === fp
                  ? 'border-brand/60 bg-brand-soft text-brand-ink'
                  : 'border-line-strong/80 text-ink-2 hover:bg-surface-2',
              )}
            >
              {ICONES_PAGAMENTO[fp]}
              {FORMAS_PAGAMENTO[fp].label}
            </button>
          ))}
        </div>
        <Field label="Data do pagamento" htmlFor="pg-data">
          <Input id="pg-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Field>
        {sugerirFinalizar && (
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line p-3 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={finalizar}
              onChange={(e) => setFinalizar(e.target.checked)}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            Marcar o evento como <b className="font-medium text-ink">Finalizado</b>
          </label>
        )}
      </div>
    </Modal>
  )
}

function DevolucaoModal({
  aberto,
  aoFechar,
  consignadas,
  valorBobina,
  aoConfirmar,
}: {
  aberto: boolean
  aoFechar: () => void
  consignadas: number
  valorBobina: number
  aoConfirmar: (devolvidas: number) => Promise<boolean>
}) {
  const [enviando, setEnviando] = useState(false)
  const [dev, setDev] = useState<number | null>(null)
  const usadas = dev === null ? null : consignadas - dev
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<PackageCheck className="h-5 w-5" />}
      titulo="Registrar devolução de bobinas"
      descricao={`${numero(consignadas)} bobinas foram consignadas para este evento.`}
      largura="max-w-md"
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button
            variante="primary"
            disabled={dev === null || enviando}
            onClick={async () => {
              if (dev === null) return
              setEnviando(true)
              const ok = await aoConfirmar(dev)
              setEnviando(false)
              if (ok) aoFechar()
            }}
          >
            {enviando ? 'Salvando…' : 'Confirmar devolução'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Bobinas devolvidas" htmlFor="dev-qtd">
          <NumberInput id="dev-qtd" valor={dev} permitirVazio max={consignadas} aoMudar={setDev} placeholder="0" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Mini rotulo="Utilizadas" valor={usadas === null ? '—' : numero(usadas)} destaque />
          <Mini rotulo="Valor das bobinas" valor={usadas === null ? '—' : moeda(usadas * valorBobina)} />
        </div>
      </div>
    </Modal>
  )
}
