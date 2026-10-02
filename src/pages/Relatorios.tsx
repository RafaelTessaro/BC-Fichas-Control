import { endOfMonth, endOfYear, format, startOfMonth, startOfYear, subMonths } from 'date-fns'
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartColumn,
  CircleDollarSign,
  Clock,
  Download,
  Package,
  Receipt,
  Ticket,
  Wallet,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { BarrasHorizontais, GraficoFaturamento, Legenda } from '../components/charts/Charts'
import { Card, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Field, Input, Select } from '../components/ui/Form'
import { EmptyState, PageHeader, Segmented, StatCard } from '../components/ui/Misc'
import { Tabela, Td, Th } from '../components/ui/Table'
import { FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { cn } from '../lib/cn'
import { exportarCSV } from '../lib/csv'
import { dataCurta, moeda, numero } from '../lib/format'
import { useEventosCompletos } from '../lib/hooks'
import {
  agruparPorPeriodo,
  filtrarPeriodo,
  periodoAnterior,
  porCliente,
  porFormaPagamento,
  somar,
  totaisVazios,
} from '../lib/relatorio'
import type { FormaPagamento } from '#shared/tipos.ts'
import { useDados } from '../store/dados'

type Preset = 'mes' | '3m' | '6m' | '12m' | 'ano' | 'custom'

function intervaloPreset(p: Preset): [string, string] {
  const hoje = new Date()
  const f = (d: Date) => format(d, 'yyyy-MM-dd')
  switch (p) {
    case 'mes':
      return [f(startOfMonth(hoje)), f(endOfMonth(hoje))]
    case '3m':
      return [f(startOfMonth(subMonths(hoje, 2))), f(endOfMonth(hoje))]
    case '6m':
      return [f(startOfMonth(subMonths(hoje, 5))), f(endOfMonth(hoje))]
    case 'ano':
      return [f(startOfYear(hoje)), f(endOfYear(hoje))]
    default:
      return [f(startOfMonth(subMonths(hoje, 11))), f(endOfMonth(hoje))]
  }
}

export function Relatorios() {
  const todos = useEventosCompletos()
  const clientes = useDados((s) => s.clientes)
  const [preset, setPreset] = useState<Preset>('12m')
  const [custom, setCustom] = useState<[string, string]>(() => intervaloPreset('3m'))
  const [clienteId, setClienteId] = useState('')
  const [visao, setVisao] = useState<'grafico' | 'tabela'>('grafico')

  const [de, ate] = preset === 'custom' ? custom : intervaloPreset(preset)
  const intervaloValido = de && ate && de <= ate

  const dados = useMemo(() => {
    if (!intervaloValido) return null
    const itens = filtrarPeriodo(todos, de, ate, clienteId || undefined)
    const totais = itens.reduce(somar, totaisVazios())
    const [aDe, aAte] = periodoAnterior(de, ate)
    const anterior = filtrarPeriodo(todos, aDe, aAte, clienteId || undefined).reduce(somar, totaisVazios())
    const { baldes, granularidade } = agruparPorPeriodo(itens, de, ate)
    const formas = porFormaPagamento(itens)
    const ranking = porCliente(itens)
    return { itens, totais, anterior, baldes, granularidade, formas, ranking }
  }, [todos, de, ate, clienteId, intervaloValido])

  const exportar = () => {
    if (!dados) return
    exportarCSV(
      `faturamento_${de}_a_${ate}.csv`,
      [
        'Período',
        'Eventos',
        'Diárias',
        'Valor diárias',
        'Bobinas utilizadas',
        'Valor bobinas',
        'Descontos',
        'Total',
        'Recebido',
        'A receber',
      ],
      [
        ...dados.baldes.map((b) => [
          b.rotuloLongo,
          b.eventos,
          b.diarias,
          b.valorDiarias,
          b.bobinasUtilizadas,
          b.valorBobinas,
          b.descontos,
          b.total,
          b.recebido,
          b.aReceber,
        ]),
        [
          'TOTAL',
          dados.totais.eventos,
          dados.totais.diarias,
          dados.totais.valorDiarias,
          dados.totais.bobinasUtilizadas,
          dados.totais.valorBobinas,
          dados.totais.descontos,
          dados.totais.total,
          dados.totais.recebido,
          dados.totais.aReceber,
        ],
      ],
    )
  }

  const t = dados?.totais ?? totaisVazios()
  const variacao = dados && dados.anterior.total > 0 ? (t.total - dados.anterior.total) / dados.anterior.total : null
  const ticket = t.eventos ? t.total / t.eventos : 0
  const semPagamento = dados?.itens.filter((x) => !x.resumo.pago).length ?? 0

  return (
    <>
      <PageHeader
        titulo="Relatórios"
        descricao="Faturamento e indicadores por período. Eventos cancelados não entram nos valores."
        acoes={
          <Button
            icone={<Download className="h-4 w-4" />}
            onClick={exportar}
            disabled={!dados?.itens.length}
            title="Baixa uma planilha (CSV) que abre no Excel"
          >
            Exportar planilha
          </Button>
        }
      />

      {/* Filtros — uma linha acima de todos os gráficos */}
      <Card className="mb-6 flex flex-col gap-3 p-4 xl:flex-row xl:items-end">
        <Field label="Período">
          <Segmented
            valor={preset}
            aoMudar={setPreset}
            opcoes={[
              { valor: 'mes', label: 'Este mês' },
              { valor: '3m', label: '3 meses' },
              { valor: '6m', label: '6 meses' },
              { valor: '12m', label: '12 meses' },
              { valor: 'ano', label: 'Este ano' },
              { valor: 'custom', label: 'Personalizado' },
            ]}
          />
        </Field>
        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="De" htmlFor="rel-de">
              <Input id="rel-de" type="date" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            </Field>
            <Field label="Até" htmlFor="rel-ate">
              <Input
                id="rel-ate"
                type="date"
                value={custom[1]}
                min={custom[0]}
                onChange={(e) => setCustom([custom[0], e.target.value])}
              />
            </Field>
          </div>
        )}
        <Field label="Cliente" htmlFor="rel-cli" className="xl:ml-auto xl:w-64">
          <Select id="rel-cli" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Todos os clientes</option>
            {[...clientes]
              .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </Select>
        </Field>
      </Card>

      {!intervaloValido ? (
        <Card>
          <EmptyState
            icone={<ChartColumn className="h-6 w-6" />}
            titulo="Período inválido"
            descricao="A data inicial deve ser igual ou anterior à data final."
          />
        </Card>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-muted">
            {dataCurta(de)} a {dataCurta(ate)} • {numero(t.eventos)} {t.eventos === 1 ? 'evento' : 'eventos'}
          </p>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              rotulo="Faturamento"
              valor={t.total}
              formatar={moeda}
              destaque
              icone={<CircleDollarSign className="h-4 w-4" />}
              detalhe={
                variacao === null ? (
                  'Sem dados no período anterior'
                ) : (
                  <span className="inline-flex items-center gap-1">
                    {variacao >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {variacao >= 0 ? '+' : ''}
                    {(variacao * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs. período anterior
                  </span>
                )
              }
            />
            <StatCard
              rotulo="Recebido"
              valor={t.recebido}
              formatar={moeda}
              icone={<Wallet className="h-4 w-4" />}
              detalhe={t.total ? `${Math.round((t.recebido / t.total) * 100)}% do faturamento` : '—'}
              delay={0.04}
            />
            <StatCard
              rotulo="A receber"
              valor={t.aReceber}
              formatar={moeda}
              icone={<Clock className="h-4 w-4" />}
              detalhe={`${numero(semPagamento)} ${semPagamento === 1 ? 'evento sem pagamento' : 'eventos sem pagamento'}`}
              delay={0.08}
            />
            <StatCard
              rotulo="Ticket médio"
              valor={ticket}
              formatar={moeda}
              icone={<Receipt className="h-4 w-4" />}
              detalhe="Por evento"
              delay={0.12}
            />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader
                titulo={dados?.granularidade === 'semana' ? 'Faturamento por semana' : 'Faturamento por mês'}
                descricao="Diárias e bobinas, pela data de início do evento."
                acoes={
                  <Segmented
                    tamanho="sm"
                    valor={visao}
                    aoMudar={setVisao}
                    opcoes={[
                      { valor: 'grafico', label: 'Gráfico' },
                      { valor: 'tabela', label: 'Tabela' },
                    ]}
                  />
                }
              />
              {visao === 'grafico' ? (
                <div className="px-3 pb-4">
                  <div className="mb-2 px-2">
                    <Legenda />
                  </div>
                  <GraficoFaturamento
                    dados={(dados?.baldes ?? []).map((b) => ({
                      rotulo: b.rotulo,
                      rotuloLongo: b.rotuloLongo,
                      diarias: b.valorDiarias,
                      bobinas: b.valorBobinas,
                    }))}
                  />
                </div>
              ) : (
                <div className="border-t border-line">
                  <Tabela className="max-h-[330px]">
                    <thead>
                      <tr>
                        <Th>Período</Th>
                        <Th alinhar="right">Eventos</Th>
                        <Th alinhar="right">Diárias</Th>
                        <Th alinhar="right">Bobinas</Th>
                        <Th alinhar="right">Total</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados?.baldes.map((b) => (
                        <tr key={b.chave}>
                          <Td className="whitespace-nowrap text-ink">{b.rotuloLongo}</Td>
                          <Td alinhar="right">{b.eventos}</Td>
                          <Td alinhar="right">{moeda(b.valorDiarias)}</Td>
                          <Td alinhar="right">{moeda(b.valorBobinas)}</Td>
                          <Td alinhar="right" className="font-medium text-ink">
                            {moeda(b.total)}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabela>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader titulo="Recebido por forma de pagamento" descricao="Eventos já pagos no período." />
              <div className="px-5 pb-5">
                <BarrasHorizontais
                  vazio="Nenhum pagamento recebido no período."
                  itens={[...(dados?.formas.entries() ?? [])]
                    .filter(([forma]) => forma !== 'NAO_PAGO')
                    .map(([forma, s]) => ({
                      rotulo: FORMAS_PAGAMENTO[forma as FormaPagamento].label,
                      valor: s.valor,
                      detalhe: `${s.qtd} ${s.qtd === 1 ? 'evento' : 'eventos'}`,
                    }))
                    .sort((a, b) => b.valor - a.valor)}
                />
              </div>
            </Card>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader titulo="Ranking de clientes" descricao="Os que mais faturaram no período." />
              <div className="px-5 pb-5">
                <BarrasHorizontais
                  itens={(dados?.ranking ?? []).slice(0, 8).map((c) => ({
                    rotulo: c.nome,
                    valor: c.valor,
                    detalhe: `${c.qtd} ${c.qtd === 1 ? 'evento' : 'eventos'}`,
                  }))}
                />
              </div>
            </Card>

            <Card>
              <CardHeader titulo="Operação" descricao="Volume de máquinas e bobinas." />
              <div className="grid grid-cols-2 gap-2 px-5 pb-5">
                <Indicador icone={<Ticket className="h-4 w-4" />} rotulo="Eventos" valor={numero(t.eventos)} />
                <Indicador icone={<ChartColumn className="h-4 w-4" />} rotulo="Diárias" valor={numero(t.diarias)} />
                <Indicador
                  icone={<Package className="h-4 w-4" />}
                  rotulo="Bobinas consignadas"
                  valor={numero(t.bobinasConsignadas)}
                />
                <Indicador
                  icone={<Package className="h-4 w-4" />}
                  rotulo="Bobinas utilizadas"
                  valor={numero(t.bobinasUtilizadas)}
                />
                <Indicador rotulo="Valor em diárias" valor={moeda(t.valorDiarias)} />
                <Indicador rotulo="Valor em bobinas" valor={moeda(t.valorBobinas)} />
                {t.descontos > 0 && <Indicador rotulo="Descontos concedidos" valor={moeda(t.descontos)} className="col-span-2" />}
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              titulo="Detalhamento do faturamento"
              descricao={dados?.granularidade === 'semana' ? 'Por semana' : 'Por mês'}
              acoes={
                <Button
                  tamanho="sm"
                  icone={<Download className="h-3.5 w-3.5" />}
                  onClick={exportar}
                  disabled={!dados?.itens.length}
                  title="Baixa uma planilha (CSV) que abre no Excel"
                >
                  Planilha
                </Button>
              }
            />
            <div className="border-t border-line">
              <Tabela>
                <thead>
                  <tr>
                    <Th>Período</Th>
                    <Th alinhar="right">Eventos</Th>
                    <Th alinhar="right">Diárias</Th>
                    <Th alinhar="right" className="max-md:hidden">
                      Valor diárias
                    </Th>
                    <Th alinhar="right" className="max-md:hidden">
                      Bobinas
                    </Th>
                    <Th alinhar="right" className="max-md:hidden">
                      Valor bobinas
                    </Th>
                    <Th alinhar="right">Total</Th>
                    <Th alinhar="right" className="max-sm:hidden">
                      Recebido
                    </Th>
                    <Th alinhar="right" className="max-sm:hidden">
                      A receber
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {dados?.baldes.map((b) => (
                    <tr key={b.chave} className={cn(b.eventos === 0 && 'opacity-60')}>
                      <Td className="whitespace-nowrap text-ink">{b.rotuloLongo}</Td>
                      <Td alinhar="right">{b.eventos}</Td>
                      <Td alinhar="right">{numero(b.diarias)}</Td>
                      <Td alinhar="right" className="max-md:hidden">
                        {moeda(b.valorDiarias)}
                      </Td>
                      <Td alinhar="right" className="max-md:hidden">
                        {numero(b.bobinasUtilizadas)}
                      </Td>
                      <Td alinhar="right" className="max-md:hidden">
                        {moeda(b.valorBobinas)}
                      </Td>
                      <Td alinhar="right" className="font-medium text-ink">
                        {moeda(b.total)}
                      </Td>
                      <Td alinhar="right" className="max-sm:hidden">
                        {moeda(b.recebido)}
                      </Td>
                      <Td alinhar="right" className="max-sm:hidden">
                        {moeda(b.aReceber)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-2/70 font-semibold text-ink">
                    <Td className="border-t border-line-strong text-ink">Total</Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink">
                      {t.eventos}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink">
                      {numero(t.diarias)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink max-md:hidden">
                      {moeda(t.valorDiarias)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink max-md:hidden">
                      {numero(t.bobinasUtilizadas)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink max-md:hidden">
                      {moeda(t.valorBobinas)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink">
                      {moeda(t.total)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink max-sm:hidden">
                      {moeda(t.recebido)}
                    </Td>
                    <Td alinhar="right" className="border-t border-line-strong text-ink max-sm:hidden">
                      {moeda(t.aReceber)}
                    </Td>
                  </tr>
                </tfoot>
              </Tabela>
            </div>
          </Card>
        </>
      )}
    </>
  )
}

function Indicador({
  rotulo,
  valor,
  icone,
  className,
}: {
  rotulo: string
  valor: string
  icone?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl bg-surface-2 px-3.5 py-3', className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icone}
        {rotulo}
      </p>
      <p className="tnum mt-1 text-base font-semibold text-ink">{valor}</p>
    </div>
  )
}
