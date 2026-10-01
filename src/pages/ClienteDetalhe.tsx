import {
  ArrowLeft,
  CalendarPlus,
  CircleDollarSign,
  Clock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Ticket,
  Trash2,
  User,
  Wallet,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClienteFormModal } from '../components/ClienteFormModal'
import { EventosTabela } from '../components/EventosTabela'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { Avatar, EmptyState, PageHeader, StatCard } from '../components/ui/Misc'
import { dataCurta, enderecoCompleto, moeda, numero } from '../lib/format'
import { porDataDesc, useEventosCompletos } from '../lib/hooks'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'

export function ClienteDetalhe() {
  const { id } = useParams()
  const navegar = useNavigate()
  const cliente = useDados((s) => s.clientes.find((c) => c.id === id))
  const excluirCliente = useDados((s) => s.excluirCliente)
  const todos = useEventosCompletos()
  const [editando, setEditando] = useState(false)

  const eventos = useMemo(() => todos.filter((e) => e.evento.clienteId === id).sort(porDataDesc), [todos, id])
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

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
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
                {cliente.tipo === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}
              </Badge>
            }
          />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 pb-5 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Dado rotulo={cliente.tipo === 'PJ' ? 'CNPJ' : 'CPF'}>{cliente.documento}</Dado>
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
              {enderecoCompleto(cliente)}
            </Dado>
            {cliente.observacoes && (
              <div className="col-span-full">
                <Dado rotulo="Observações">{cliente.observacoes}</Dado>
              </div>
            )}
            <div className="col-span-full text-xs text-muted">Cliente desde {dataCurta(cliente.criadoEm.slice(0, 10))}</div>
          </dl>
        </Card>

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
    </>
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
