import {
  ArrowLeft,
  CalendarClock,
  CalendarPlus,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  Repeat,
  Ticket,
  Trash2,
  TriangleAlert,
  User,
  Wallet,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { StatusBadge } from '../components/Badges'
import { ClienteFormModal } from '../components/ClienteFormModal'
import { EventosTabela } from '../components/EventosTabela'
import { IconeMaquinaFichas } from '../components/IconeMaquinaFichas'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { Modal } from '../components/ui/Modal'
import { Avatar, EmptyState, PageHeader, StatCard } from '../components/ui/Misc'
import { STATUS_EVENTO } from '#shared/calc.ts'
import { cnpjValido } from '#shared/documentos.ts'
import { quantidadeCurta, quantidadePorExtenso, reservasDia } from '#shared/maquinas.ts'
import type { Cliente, ClienteInput } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import {
  avisoSituacao,
  camposDoCnpj,
  consultarCnpj,
  erroDeConsulta,
  ROTULO_TIPO_CLIENTE,
  rotuloSituacao,
  tomSituacao,
  type DadosCnpj,
} from '../lib/consultas'
import { codigoEvento, dataCurta, dataExtensa, enderecoCompleto, moeda, numero, periodo } from '../lib/format'
import { useHoje } from '../lib/hoje'
import { porDataDesc, useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import { DIAS_DA_SEMANA, diaDaSemana } from '../lib/repeticao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { hojeLocalIso } from '#shared/dominio.ts'

export function ClienteDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const cliente = useDados((s) => s.clientes.find((c) => c.id === id))
  const excluirCliente = useDados((s) => s.excluirCliente)
  const todos = useEventosCompletos()
  const [editando, setEditando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [atualizacao, setAtualizacao] = useState<DadosCnpj | null>(null)

  const eventos = useMemo(() => todos.filter((e) => e.evento.clienteId === id).sort(porDataDesc), [todos, id])
  const hoje = useHoje()
  // Aluguéis marcados de hoje em diante (o cliente que já passa as datas do ano inteiro)
  const proximos = useMemo(
    () =>
      eventos
        .filter(({ evento: e, resumo: r }) => e.status !== 'CANCELADO' && (r.dataFim ?? '') >= hoje)
        .sort((a, b) => -porDataDesc(a, b)),
    [eventos, hoje],
  )
  const t = useMemo(
    () =>
      eventos.reduce(
        (s, { evento, resumo }) => {
          if (evento.status === 'CANCELADO') return s
          s.faturado += resumo.total
          if (resumo.pago) s.recebido += resumo.total
          else s.aReceber += resumo.total
          s.diarias += resumo.totalDiarias
          return s
        },
        { faturado: 0, recebido: 0, aReceber: 0, diarias: 0 },
      ),
    [eventos],
  )

  if (!cliente) {
    return (
      <EmptyState
        icone={<User className="h-6 w-6" />}
        titulo="Cliente não encontrado"
        acao={<Button onClick={() => navegar('/clientes')}>Voltar para clientes</Button>}
      />
    )
  }

  const excluir = async () => {
    const ok = await confirmar({
      titulo: `Excluir ${cliente.nome}?`,
      descricao: 'Esta ação não pode ser desfeita.',
      confirmar: 'Excluir cliente',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirCliente(cliente.id)
      toast.sucesso('Cliente excluído')
      navegar('/clientes', { replace: true })
    } catch (e) {
      avisarErro('Não foi possível excluir', e)
    }
  }

  const podeConsultar = cliente.tipo === 'PJ' && cnpjValido(cliente.documento)

  const consultarReceita = async () => {
    setConsultando(true)
    try {
      setAtualizacao(await consultarCnpj(cliente.documento))
    } catch (e) {
      toast.erro('Não foi possível consultar a Receita', erroDeConsulta(e, 'CNPJ').mensagem)
    } finally {
      setConsultando(false)
    }
  }

  return (
    <>
      <PageHeader
        voltar={
          <Link
            to="/clientes"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Clientes
          </Link>
        }
        titulo={
          <span className="flex items-center gap-3">
            <Avatar nome={cliente.nome} className="h-11 w-11 text-sm" />
            <span className="min-w-0">
              <span className="block truncate">{cliente.nome}</span>
            </span>
          </span>
        }
        acoes={
          <>
            <Button
              variante="ghost"
              tamanho="icon"
              onClick={excluir}
              aria-label="Excluir cliente"
              className="hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            {podeConsultar && (
              <Button
                icone={<RefreshCw className={cn('h-4 w-4', consultando && 'animate-spin')} />}
                onClick={consultarReceita}
                disabled={consultando}
              >
                {consultando ? 'Consultando…' : 'Atualizar dados da Receita'}
              </Button>
            )}
            <Button icone={<Pencil className="h-4 w-4" />} onClick={() => setEditando(true)}>
              Editar
            </Button>
            <Button
              variante="primary"
              icone={<CalendarPlus className="h-4 w-4" />}
              onClick={() => navegar(`/eventos/novo?cliente=${cliente.id}`)}
            >
              Novo evento
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          rotulo="Total faturado"
          valor={t.faturado}
          formatar={moeda}
          icone={<CircleDollarSign className="h-4 w-4" />}
          destaque
        />
        <StatCard rotulo="Recebido" valor={t.recebido} formatar={moeda} icone={<Wallet className="h-4 w-4" />} delay={0.04} />
        <StatCard rotulo="A receber" valor={t.aReceber} formatar={moeda} icone={<Clock className="h-4 w-4" />} delay={0.08} />
        <StatCard
          rotulo="Eventos"
          valor={eventos.length}
          formatar={(v) => numero(Math.round(v))}
          icone={<Ticket className="h-4 w-4" />}
          detalhe={`${numero(t.diarias)} diárias no total`}
          delay={0.12}
        />
      </div>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader
            titulo="Dados cadastrais"
            acoes={
              <Badge tom="neutral" ponto={false}>
                {ROTULO_TIPO_CLIENTE[cliente.tipo]}
              </Badge>
            }
          />
          {cliente.tipo === 'PJ' && <AvisoSituacao situacao={cliente.situacaoCadastral} className="mx-5 mb-4" />}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 pb-5 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {cliente.tipo !== 'AVULSO' && <Dado rotulo={cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF'}>{cliente.documento}</Dado>}
            {cliente.tipo === 'PJ' && <Dado rotulo="Razão social">{cliente.razaoSocial}</Dado>}
            {cliente.tipo === 'PJ' && (
              <Dado rotulo="Situação na Receita">
                {cliente.situacaoCadastral && (
                  <Badge tom={tomSituacao(cliente.situacaoCadastral)}>{rotuloSituacao(cliente.situacaoCadastral)}</Badge>
                )}
              </Dado>
            )}
            <Dado rotulo="Responsável" icone={<User className="h-4 w-4" />}>
              {cliente.responsavel}
            </Dado>
            <Dado rotulo="Telefone" icone={<Phone className="h-4 w-4" />}>
              {cliente.telefone}
            </Dado>
            <Dado rotulo="E-mail" icone={<Mail className="h-4 w-4" />}>
              {cliente.email}
            </Dado>
            <Dado rotulo="Endereço" icone={<MapPin className="h-4 w-4" />}>
              {[enderecoCompleto(cliente), cliente.cep && `CEP ${cliente.cep}`].filter(Boolean).join(' — ')}
            </Dado>
            {cliente.observacoes && (
              <div className="col-span-full">
                <Dado rotulo="Observações">{cliente.observacoes}</Dado>
              </div>
            )}
            <div className="col-span-full flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>Cliente desde {dataCurta(hojeLocalIso(new Date(cliente.criadoEm)))}</span>
              {cliente.tipo === 'PJ' && cliente.consultadoEm && (
                <span>Dados consultados na Receita em {dataCurta(cliente.consultadoEm)}</span>
              )}
            </div>
          </dl>
        </Card>

        {eventos.length > 0 && <ProximasDatas itens={proximos} />}

        <Card className="overflow-hidden">
          <CardHeader
            titulo="Histórico de eventos"
            descricao={`${eventos.length} ${eventos.length === 1 ? 'evento' : 'eventos'}`}
          />
          {eventos.length ? (
            <div className="border-t border-line">
              <EventosTabela itens={eventos} ocultarCliente />
            </div>
          ) : (
            <EmptyState
              icone={<Ticket className="h-6 w-6" />}
              titulo="Nenhum evento ainda"
              descricao="Os eventos deste cliente aparecerão aqui."
              acao={
                <Button
                  variante="primary"
                  icone={<CalendarPlus className="h-4 w-4" />}
                  onClick={() => navegar(`/eventos/novo?cliente=${cliente.id}`)}
                >
                  Criar evento
                </Button>
              }
            />
          )}
        </Card>
      </div>

      <ClienteFormModal aberto={editando} cliente={cliente} aoFechar={() => setEditando(false)} />
      <Modal
        aberto={!!atualizacao}
        aoFechar={() => setAtualizacao(null)}
        largura="max-w-xl"
        icone={<RefreshCw className="h-5 w-5" />}
        titulo="Atualizar dados da Receita"
        descricao={atualizacao ? `${atualizacao.razaoSocial} · consulta via ${atualizacao.fonte}` : undefined}
      >
        {atualizacao && <ConferenciaReceita cliente={cliente} dados={atualizacao} aoFechar={() => setAtualizacao(null)} />}
      </Modal>
    </>
  )
}

/** Eventos do cliente de hoje em diante: data, nome, status e máquinas ("4+1"). */
function ProximasDatas({ itens }: { itens: EventoCompleto[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icone={<CalendarClock className="h-4 w-4" />}
        titulo="Próximas datas"
        descricao={
          itens.length
            ? `${itens.length} ${itens.length === 1 ? 'aluguel marcado' : 'aluguéis marcados'} de hoje em diante`
            : 'Nenhum aluguel marcado de hoje em diante'
        }
      />
      {itens.length ? (
        <ul className="scroll-fino max-h-[420px] divide-y divide-line overflow-y-auto border-t border-line">
          {itens.map(({ evento: e, resumo: r }) => {
            // Máquinas do dia de mais máquinas: titulares + reservas
            const titulares = Math.max(0, ...e.dias.map((d) => Number(d.maquinas) || 0))
            const reservas = Math.max(0, ...e.dias.map(reservasDia))
            const inicio = r.dataInicio ?? ''
            return (
              <li key={e.id}>
                <Link
                  to={`/eventos/${e.id}`}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/70"
                >
                  {inicio && (
                    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-surface-2 leading-none">
                      <span className="text-[10px] font-semibold text-muted uppercase">{dataExtensa(inicio, 'MMM')}</span>
                      <span className="tnum mt-0.5 text-base font-semibold text-ink">{dataExtensa(inicio, 'dd')}</span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
                      <span className="truncate">{e.nome}</span>
                      {e.grupoId && (
                        <span title="Faz parte de uma série de datas" className="shrink-0 text-muted">
                          <Repeat className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </p>
                    <p className="tnum truncate text-xs text-muted">
                      {inicio && `${DIAS_DA_SEMANA[diaDaSemana(inicio)].curto} `}
                      {periodo(r.dataInicio, r.dataFim)}
                      {/* No celular o status vem no lugar do código (o selo ao lado não cabe) */}
                      <span className="max-sm:hidden"> · {codigoEvento(e.codigo)}</span>
                      <span className="sm:hidden"> · {STATUS_EVENTO[e.status].label}</span>
                    </p>
                  </div>
                  <span
                    title={quantidadePorExtenso(titulares, reservas)}
                    aria-label={quantidadePorExtenso(titulares, reservas)}
                    className="tnum inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-soft px-2 py-1 text-xs font-semibold text-brand-ink"
                  >
                    <IconeMaquinaFichas className="h-3.5 w-3.5" />
                    {quantidadeCurta(titulares, reservas)}
                  </span>
                  <span className="max-sm:hidden">
                    <StatusBadge status={e.status} />
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-[13px] text-muted">
          Para o cliente que já passa as datas do ano, cadastre o primeiro evento e use “Repetir em outras datas”, no menu “…” do
          evento, para marcar as outras de uma vez.
        </p>
      )}
    </Card>
  )
}

function AvisoSituacao({ situacao, className }: { situacao: string; className?: string }) {
  const aviso = avisoSituacao(situacao)
  if (!aviso) return null
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium',
        tomSituacao(situacao) === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      {aviso}
    </div>
  )
}

/** Campos que a consulta pode atualizar, na ordem em que aparecem para conferência. */
const CAMPOS_RECEITA: Array<{ campo: keyof ClienteInput; rotulo: string }> = [
  { campo: 'razaoSocial', rotulo: 'Razão social' },
  { campo: 'nome', rotulo: 'Nome de exibição' },
  { campo: 'telefone', rotulo: 'Telefone' },
  { campo: 'email', rotulo: 'E-mail' },
  { campo: 'cep', rotulo: 'CEP' },
  { campo: 'logradouro', rotulo: 'Endereço' },
  { campo: 'numero', rotulo: 'Número' },
  { campo: 'complemento', rotulo: 'Complemento' },
  { campo: 'bairro', rotulo: 'Bairro' },
  { campo: 'cidade', rotulo: 'Cidade' },
  { campo: 'uf', rotulo: 'UF' },
]

/** Mostra o que mudou na Receita e salva, após confirmação, os campos escolhidos. */
function ConferenciaReceita({ cliente, dados, aoFechar }: { cliente: Cliente; dados: DadosCnpj; aoFechar: () => void }) {
  const salvarCliente = useDados((s) => s.salvarCliente)
  const [salvando, setSalvando] = useState(false)
  const [novos] = useState(() => camposDoCnpj(dados, new Date().toISOString()))
  // Só o que veio com valor: campo vazio na Receita não apaga o que já está no cadastro
  const mudancas = CAMPOS_RECEITA.filter(({ campo }) => novos[campo] && novos[campo] !== cliente[campo])
  // O nome de exibição costuma ser escolhido à mão: só vem marcado se estiver vazio
  const [marcados, setMarcados] = useState(
    () => new Set(mudancas.filter(({ campo }) => campo !== 'nome' || !cliente.nome).map(({ campo }) => campo)),
  )
  const situacaoMudou = !!cliente.situacaoCadastral && dados.situacaoCadastral !== cliente.situacaoCadastral

  const alternar = (campo: keyof ClienteInput) =>
    setMarcados((m) => {
      const n = new Set(m)
      if (n.has(campo)) n.delete(campo)
      else n.add(campo)
      return n
    })

  const salvar = async () => {
    setSalvando(true)
    try {
      const { id, versao, criadoEm: _c, atualizadoEm: _a, ...atual } = cliente
      const dadosNovos: ClienteInput = {
        ...atual,
        situacaoCadastral: dados.situacaoCadastral,
        consultadoEm: novos.consultadoEm ?? new Date().toISOString(),
      }
      for (const campo of marcados) {
        if (mudancas.some((m) => m.campo === campo)) (dadosNovos as unknown as Record<string, unknown>)[campo] = novos[campo]
      }
      await salvarCliente(dadosNovos, { id, versao })
      toast.sucesso(
        'Dados atualizados com a Receita',
        marcados.size ? `${marcados.size} ${marcados.size === 1 ? 'campo alterado' : 'campos alterados'}.` : undefined,
      )
      aoFechar()
    } catch (e) {
      avisarErro('Não foi possível salvar', e)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        Situação cadastral:
        <Badge tom={tomSituacao(dados.situacaoCadastral)}>{rotuloSituacao(dados.situacaoCadastral) || '—'}</Badge>
        {situacaoMudou && <span className="text-xs text-muted">antes: {rotuloSituacao(cliente.situacaoCadastral)}</span>}
      </div>
      <AvisoSituacao situacao={dados.situacaoCadastral} />

      {mudancas.length ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <p className="border-b border-line bg-surface-2/60 px-3.5 py-2 text-xs text-muted">
            Marque o que deve ser trocado pelos dados da Receita:
          </p>
          <ul className="divide-y divide-line">
            {mudancas.map(({ campo, rotulo }) => (
              <li key={campo}>
                <label className="flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-2/60">
                  <input
                    type="checkbox"
                    checked={marcados.has(campo)}
                    onChange={() => alternar(campo)}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brand)]"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block text-xs text-muted">{rotulo}</span>
                    {cliente[campo] && (
                      <span className="block break-words text-muted line-through">{String(cliente[campo])}</span>
                    )}
                    <span className="block font-medium break-words text-ink">{String(novos[campo])}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl bg-success-soft px-3.5 py-2.5 text-[13px] font-medium text-success">
          O cadastro já está igual ao da Receita Federal.
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button onClick={aoFechar}>Cancelar</Button>
        <Button variante="primary" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : mudancas.length ? 'Salvar dados atualizados' : 'Registrar a consulta'}
        </Button>
      </div>
    </div>
  )
}

function Dado({ rotulo, icone, children }: { rotulo: string; icone?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="mt-0.5 flex items-start gap-2 break-words text-ink-2">
        {icone && <span className="mt-0.5 shrink-0 text-muted">{icone}</span>}
        <span className="min-w-0">{children || <span className="text-muted">—</span>}</span>
      </dd>
    </div>
  )
}
