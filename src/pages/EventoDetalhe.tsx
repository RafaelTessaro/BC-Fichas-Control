import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Clock,
  Copy,
  CreditCard,
  Ellipsis,
  FileDown,
  Landmark,
  Mail,
  MapPin,
  Package,
  PackageCheck,
  Pencil,
  Phone,
  QrCode,
  Receipt,
  StickyNote,
  User,
  Trash2,
  Wallet,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConferenciaBadge, PagamentoBadge } from '../components/Badges'
import { useAcoesEvento } from '../components/EventosTabela'
import { GoogleSyncBadge } from '../components/GoogleSyncBadge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Field, Input, NumberInput } from '../components/ui/Form'
import { Modal } from '../components/ui/Modal'
import { Avatar, EmptyState, Menu, PageHeader, Segmented } from '../components/ui/Misc'
import { calcularEvento, FORMAS_PAGAMENTO, STATUS_EVENTO } from '#shared/calc.ts'
import { cn } from '../lib/cn'
import { codigoEvento, dataCurta, dataExtensa, enderecoCompleto, hojeISO, moeda, numero, periodo } from '../lib/format'
import type { EventoPatch, FormaPagamento, StatusEvento } from '#shared/tipos.ts'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'

const ICONES_PAGAMENTO: Record<Exclude<FormaPagamento, 'NAO_PAGO'>, ReactNode> = {
  PIX: <QrCode className="h-4 w-4" />,
  DINHEIRO: <Banknote className="h-4 w-4" />,
  DEBITO: <CreditCard className="h-4 w-4" />,
  CREDITO: <CreditCard className="h-4 w-4" />,
  BOLETO: <Landmark className="h-4 w-4" />,
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
            {evento.cidade && (
              <>
                <span className="text-line-strong">•</span>
                {evento.cidade}
              </>
            )}
          </span>
        }
        acoes={
          <>
            <Button icone={<Pencil className="h-4 w-4" />} onClick={() => acoes.editar(evento.id)}>
              Editar
            </Button>
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

      {/* Andamento */}
      <Card className="mb-6 flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium text-muted">Status</span>
          <Segmented
            tamanho="sm"
            valor={evento.status}
            aoMudar={(s: StatusEvento) => void alterar({ status: s }, 'Status atualizado', STATUS_EVENTO[s].label)}
            opcoes={(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => ({ valor: s, label: STATUS_EVENTO[s].label }))}
          />
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

          {/* Dias */}
          <Card>
            <CardHeader
              icone={<CalendarDays className="h-4 w-4" />}
              titulo="Dias de utilização"
              descricao={`${evento.dias.length} ${evento.dias.length === 1 ? 'data' : 'datas'} • ${numero(r.totalDiarias)} diárias`}
            />
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
        </div>

        <div className="flex flex-col gap-6">
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
                      {cliente.documento || (cliente.tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física')}
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
              ) : (
                <p className="flex items-center gap-2 text-ink-2">
                  <Clock className="h-4 w-4 text-warning" />
                  Aguardando pagamento de <b className="tnum font-semibold text-ink">{moeda(r.total)}</b>
                </p>
              )}
            </div>
          </Card>

          {(evento.observacoes || evento.rodape) && (
            <Card>
              <CardHeader icone={<StickyNote className="h-4 w-4" />} titulo="Observações" />
              <div className="flex flex-col gap-3 px-5 pb-5 text-sm">
                {evento.observacoes && <p className="whitespace-pre-wrap text-ink-2">{evento.observacoes}</p>}
                {evento.rodape && (
                  <p className="text-xs text-muted">
                    Rodapé do PDF: <span className="font-medium text-ink-2">{evento.rodape}</span>
                  </p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      <PagamentoModal
        aberto={modalPagamento}
        aoFechar={() => setModalPagamento(false)}
        total={r.total}
        sugerirFinalizar={r.conferencia === 'CONFERIDO'}
        aoConfirmar={(forma, data, finalizar) =>
          alterar(
            { formaPagamento: forma, dataPagamento: data, ...(finalizar ? { status: 'FINALIZADO' as const } : {}) },
            'Pagamento registrado',
            `${FORMAS_PAGAMENTO[forma].label} • ${moeda(r.total)}`,
          )
        }
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
    </>
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
