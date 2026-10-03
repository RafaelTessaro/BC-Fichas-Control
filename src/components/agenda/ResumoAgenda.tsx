import { TriangleAlert } from 'lucide-react'
import { fraseVariacao, textoVariacao, type ComparacaoResumo, type ResumoPeriodo, type Variacao } from '../../lib/agenda'
import { cn } from '../../lib/cn'
import { numero } from '../../lib/format'

/**
 * Totais do mês (ou do ano) mostrado: eventos, diárias cobradas e o pico de máquinas fora. Com
 * "Comparar", cada número traz o do mesmo período do ano anterior e a diferença (seta e número,
 * não só a cor); se o ano anterior não teve nenhum registro, diz isso em vez de mostrar zeros.
 */
export function ResumoAgenda({
  resumo,
  comparacao,
  rotuloAnterior,
  total,
  periodo,
}: {
  resumo: ResumoPeriodo
  /** `null` com a comparação desligada. */
  comparacao: ComparacaoResumo | null
  /** "out/2025" ou "2025". */
  rotuloAnterior: string
  /** Máquinas da empresa (o "de quantas" do pico). */
  total: number
  periodo: 'mes' | 'ano'
}) {
  const comparando = comparacao && !comparacao.semRegistros ? comparacao : null
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-surface-2/40 px-4 py-2.5 sm:flex-row sm:items-start sm:gap-6">
      <dl className="grid grid-cols-3 gap-x-4 gap-y-1 sm:flex sm:flex-wrap sm:gap-x-7">
        <Numero
          rotulo="Eventos"
          valor={numero(resumo.eventos)}
          v={comparando?.eventos}
          rotuloAnterior={rotuloAnterior}
          comCor
          dica={`Eventos com máquinas fora ${periodo === 'mes' ? 'no mês' : 'no ano'} (sem os cancelados)`}
        />
        <Numero
          rotulo="Diárias"
          valor={numero(resumo.diarias)}
          v={comparando?.diarias}
          rotuloAnterior={rotuloAnterior}
          comCor
          dica="Diárias cobradas: máquinas titulares mais as reservas usadas, só nos dias de uso"
        />
        <Numero
          rotulo="Pico"
          valor={`${numero(resumo.pico)}/${numero(total)}`}
          anterior={comparando ? `${numero(comparando.pico.anterior)}/${numero(total)}` : undefined}
          v={comparando?.pico}
          rotuloAnterior={rotuloAnterior}
          dica={`Maior número de máquinas fora da empresa (titulares + reservas) num mesmo dia ${periodo === 'mes' ? 'do mês' : 'do ano'}`}
        />
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] sm:ml-auto sm:min-h-6 sm:justify-end sm:text-right">
        {comparacao?.semRegistros && (
          <span className="text-muted">
            Sem registros em {rotuloAnterior}: <span className="text-ink-2">nada para comparar.</span>
          </span>
        )}
        {resumo.diasAcima > 0 && (
          <span className="inline-flex items-center gap-1 font-medium text-danger">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            {resumo.diasAcima} {resumo.diasAcima === 1 ? 'dia acima' : 'dias acima'} do total de máquinas
          </span>
        )}
      </div>
    </div>
  )
}

/** Cor da diferença: mais eventos/diárias é bom (verde), menos é ruim (vermelho); a seta diz o mesmo sem cor. */
const COR_DIRECAO = { mais: 'text-success', menos: 'text-danger', igual: 'text-muted' } as const

function Numero({
  rotulo,
  valor,
  anterior,
  v,
  rotuloAnterior,
  comCor,
  dica,
}: {
  rotulo: string
  valor: string
  /** Como escrever o número do ano anterior (padrão: o número). */
  anterior?: string
  v?: Variacao
  rotuloAnterior: string
  /** Pinta a diferença de verde/vermelho (o pico não é bom nem ruim: fica neutro). */
  comCor?: boolean
  dica: string
}) {
  return (
    <div className="min-w-0" title={dica}>
      <dt className="inline text-[13px] text-muted">{rotulo}</dt>{' '}
      <dd className="tnum inline text-[13px] font-semibold text-ink">{valor}</dd>
      {v && (
        <dd className="tnum mt-0.5 block text-[11.5px] leading-4 text-muted sm:whitespace-nowrap">
          <span className="sr-only">
            {rotuloAnterior}: {anterior ?? numero(v.anterior)}, {fraseVariacao(v, rotuloAnterior)}
          </span>
          <span aria-hidden>
            {rotuloAnterior}: <span className="text-ink-2">{anterior ?? numero(v.anterior)}</span>{' '}
            <span className={cn('font-semibold', comCor ? COR_DIRECAO[v.direcao] : 'text-ink-2')}>{textoVariacao(v)}</span>
          </span>
        </dd>
      )}
    </div>
  )
}
