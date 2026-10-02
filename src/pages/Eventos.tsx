import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subMonths } from 'date-fns'
import { Download, Plus, Ticket } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EventosTabela } from '../components/EventosTabela'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Select } from '../components/ui/Form'
import { EmptyState, PageHeader, SearchInput, Segmented } from '../components/ui/Misc'
import { FORMAS_PAGAMENTO, STATUS_EVENTO } from '#shared/calc.ts'
import { exportarCSV } from '../lib/csv'
import { codigoEvento, dataCurta, hojeISO, moeda, normalizar, numero } from '../lib/format'
import { porDataDesc, useEventosCompletos } from '../lib/hooks'
import { useDados } from '../store/dados'
import type { StatusEvento } from '#shared/tipos.ts'

type FiltroStatus = 'todos' | StatusEvento
type FiltroPeriodo = 'todos' | 'proximos' | 'mes' | 'mes-passado' | 'ano'
type FiltroPagamento = 'todos' | 'pagos' | 'nao-pagos'

function intervalo(p: FiltroPeriodo): [string, string] | null {
  const hoje = new Date()
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (p) {
    case 'proximos':
      return [hojeISO(), '9999-12-31']
    case 'mes':
      return [f(startOfMonth(hoje)), f(endOfMonth(hoje))]
    case 'mes-passado':
      return [f(startOfMonth(subMonths(hoje, 1))), f(endOfMonth(subMonths(hoje, 1)))]
    case 'ano':
      return [f(startOfYear(hoje)), f(endOfYear(hoje))]
    default:
      return null
  }
}

export function Eventos() {
  const todos = useEventosCompletos()
  const maquinas = useDados((s) => s.maquinas)
  // Identificação das máquinas (P-01, G-03…) para a busca e a exportação
  const identificacoes = useMemo(() => new Map(maquinas.map((m) => [m.id, m.identificacao])), [maquinas])
  const nomesMaquinas = useCallback(
    (ids: string[]) =>
      ids
        .map((id) => identificacoes.get(id))
        .filter(Boolean)
        .join(', '),
    [identificacoes],
  )
  const navegar = useNavigate()
  const [status, setStatus] = useState<FiltroStatus>('todos')
  const [busca, setBusca] = useState('')
  const [periodoSel, setPeriodo] = useState<FiltroPeriodo>('todos')
  const [pagamento, setPagamento] = useState<FiltroPagamento>('todos')

  // Filtros exceto status (para as contagens das abas)
  const base = useMemo(() => {
    const q = normalizar(busca)
    const iv = intervalo(periodoSel)
    return todos
      .filter(
        ({ evento: e, cliente }) =>
          !q ||
          normalizar(
            `${e.nome} ${codigoEvento(e.codigo)} ${cliente?.nome ?? ''} ${e.cabecalho} ${e.cidade} ${nomesMaquinas(e.maquinasIds)}`,
          ).includes(q),
      )
      .filter(({ resumo: r }) => !iv || ((r.dataFim ?? '') >= iv[0] && (r.dataInicio ?? '') <= iv[1]))
      .filter(({ resumo: r }) => pagamento === 'todos' || (pagamento === 'pagos' ? r.pago : !r.pago))
  }, [todos, busca, periodoSel, pagamento, nomesMaquinas])

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: base.length }
    for (const { evento } of base) c[evento.status] = (c[evento.status] ?? 0) + 1
    return c
  }, [base])

  const lista = useMemo(() => {
    const l = base.filter(({ evento }) => status === 'todos' || evento.status === status)
    if (periodoSel === 'proximos') return [...l].sort((a, b) => -porDataDesc(a, b))
    return [...l].sort(porDataDesc)
  }, [base, status, periodoSel])

  const totais = useMemo(
    () =>
      lista.reduce(
        (s, { evento, resumo }) => {
          if (evento.status === 'CANCELADO') return s
          s.total += resumo.total
          s.diarias += resumo.totalDiarias
          if (!resumo.pago) s.aReceber += resumo.total
          return s
        },
        { total: 0, diarias: 0, aReceber: 0 },
      ),
    [lista],
  )

  const exportar = () =>
    exportarCSV(
      'eventos.csv',
      [
        'Código',
        'Evento',
        'Cliente',
        'Cidade',
        'Início',
        'Fim',
        'Diárias',
        'Valor diárias',
        'Bobinas utilizadas',
        'Valor bobinas',
        'Desconto',
        'Total',
        'Pagamento',
        'Status',
        'Máquinas enviadas',
      ],
      lista.map(({ evento: e, resumo: r, cliente }) => [
        codigoEvento(e.codigo),
        e.nome,
        cliente?.nome ?? '',
        e.cidade,
        dataCurta(r.dataInicio),
        dataCurta(r.dataFim),
        r.totalDiarias,
        r.valorDiarias,
        r.bobinasUtilizadas ?? '',
        r.valorBobinas,
        r.desconto,
        r.total,
        FORMAS_PAGAMENTO[e.formaPagamento].label,
        STATUS_EVENTO[e.status].label,
        nomesMaquinas(e.maquinasIds),
      ]),
    )

  const algumFiltro = busca || periodoSel !== 'todos' || pagamento !== 'todos'

  return (
    <>
      <PageHeader
        titulo="Eventos"
        descricao="Locações de máquinas com diárias, bobinas e pagamento."
        acoes={
          <>
            <Button
              icone={<Download className="h-4 w-4" />}
              onClick={exportar}
              disabled={!lista.length}
              title="Baixa uma planilha (CSV) que abre no Excel"
            >
              Exportar planilha
            </Button>
            <Button variante="primary" icone={<Plus className="h-4 w-4" />} onClick={() => navegar('/eventos/novo')}>
              Novo evento
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Segmented
          valor={status}
          aoMudar={setStatus}
          opcoes={[
            { valor: 'todos', label: 'Todos', contagem: contagem.todos ?? 0 },
            ...(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => ({
              valor: s,
              label: STATUS_EVENTO[s].label,
              contagem: contagem[s] ?? 0,
            })),
          ]}
        />
        {lista.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
            <span className="text-muted">
              Diárias <b className="tnum font-semibold text-ink">{numero(totais.diarias)}</b>
            </span>
            <span className="text-muted">
              A receber <b className="tnum font-semibold text-ink">{moeda(totais.aReceber)}</b>
            </span>
            <span className="text-muted">
              Total <b className="tnum font-semibold text-ink">{moeda(totais.total)}</b>
            </span>
          </div>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <SearchInput valor={busca} aoMudar={setBusca} placeholder="Buscar evento, cliente, máquina…" className="lg:w-80" />
          <div className="grid grid-cols-2 gap-3 lg:flex lg:[&>*]:w-56">
            <Select value={periodoSel} onChange={(e) => setPeriodo(e.target.value as FiltroPeriodo)} aria-label="Período">
              <option value="todos">Todo o período</option>
              <option value="proximos">Próximos (a partir de hoje)</option>
              <option value="mes">Este mês</option>
              <option value="mes-passado">Mês passado</option>
              <option value="ano">Este ano</option>
            </Select>
            <Select value={pagamento} onChange={(e) => setPagamento(e.target.value as FiltroPagamento)} aria-label="Pagamento">
              <option value="todos">Qualquer pagamento</option>
              <option value="pagos">Pagos</option>
              <option value="nao-pagos">Não pagos</option>
            </Select>
          </div>
        </div>
        {lista.length === 0 ? (
          <EmptyState
            icone={<Ticket className="h-6 w-6" />}
            titulo={todos.length ? 'Nenhum evento encontrado' : 'Nenhum evento cadastrado'}
            descricao={
              todos.length
                ? algumFiltro || status !== 'todos'
                  ? 'Ajuste a busca ou os filtros para ver outros eventos.'
                  : ''
                : 'Cadastre um evento com os dias de uso e a quantidade de máquinas para calcular automaticamente o valor.'
            }
            acao={
              !todos.length && (
                <Button variante="primary" icone={<Plus className="h-4 w-4" />} onClick={() => navegar('/eventos/novo')}>
                  Cadastrar evento
                </Button>
              )
            }
          />
        ) : (
          <EventosTabela itens={lista} />
        )}
      </Card>
    </>
  )
}
