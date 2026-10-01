import {
  addDays,
  differenceInCalendarDays,
  eachMonthOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cap } from './format'
import type { EventoCompleto } from './hooks'
import type { FormaPagamento } from '#shared/tipos.ts'

export interface Totais {
  eventos: number
  diarias: number
  valorDiarias: number
  bobinasConsignadas: number
  bobinasUtilizadas: number
  valorBobinas: number
  descontos: number
  total: number
  recebido: number
  aReceber: number
}

export const totaisVazios = (): Totais => ({
  eventos: 0,
  diarias: 0,
  valorDiarias: 0,
  bobinasConsignadas: 0,
  bobinasUtilizadas: 0,
  valorBobinas: 0,
  descontos: 0,
  total: 0,
  recebido: 0,
  aReceber: 0,
})

export function somar(t: Totais, { resumo, evento }: EventoCompleto) {
  t.eventos++
  t.diarias += resumo.totalDiarias
  t.valorDiarias += resumo.valorDiarias
  t.bobinasConsignadas += evento.bobinasConsignadas
  t.bobinasUtilizadas += resumo.bobinasUtilizadas ?? 0
  t.valorBobinas += resumo.valorBobinas
  t.descontos += resumo.desconto
  t.total += resumo.total
  if (resumo.pago) t.recebido += resumo.total
  else t.aReceber += resumo.total
  return t
}

/**
 * Eventos considerados no faturamento: não cancelados, com a primeira data
 * de uso dentro do intervalo [de, ate] (formato ISO).
 */
export function filtrarPeriodo(itens: EventoCompleto[], de: string, ate: string, clienteId?: string) {
  return itens.filter(
    ({ evento, resumo }) =>
      evento.status !== 'CANCELADO' &&
      !!resumo.dataInicio &&
      resumo.dataInicio >= de &&
      resumo.dataInicio <= ate &&
      (!clienteId || evento.clienteId === clienteId),
  )
}

export interface Balde extends Totais {
  chave: string
  rotulo: string
  rotuloLongo: string
}

/** Agrupa por semana (períodos curtos) ou por mês. */
export function agruparPorPeriodo(
  itens: EventoCompleto[],
  de: string,
  ate: string,
): { baldes: Balde[]; granularidade: 'semana' | 'mes' } {
  const ini = parseISO(de)
  const fim = parseISO(ate)
  const semanal = differenceInCalendarDays(fim, ini) <= 45
  const baldes: Balde[] = semanal
    ? eachWeekOfInterval({ start: ini, end: fim }).map((s) => ({
        ...totaisVazios(),
        chave: format(s, 'yyyy-MM-dd'),
        rotulo: format(s < ini ? ini : s, 'dd/MM'),
        rotuloLongo: `Semana de ${format(s < ini ? ini : s, 'dd/MM')} a ${format(endOfWeek(s) > fim ? fim : endOfWeek(s), 'dd/MM')}`,
      }))
    : eachMonthOfInterval({ start: ini, end: fim }).map((m) => ({
        ...totaisVazios(),
        chave: format(m, 'yyyy-MM'),
        rotulo: format(m, 'MMM/yy', { locale: ptBR }).replace('.', ''),
        rotuloLongo: cap(format(m, "MMMM 'de' yyyy", { locale: ptBR })),
      }))
  const indice = new Map(baldes.map((b, i) => [b.chave, i]))
  for (const it of itens) {
    const d = parseISO(it.resumo.dataInicio!)
    const chave = semanal ? format(startOfWeek(d), 'yyyy-MM-dd') : format(d, 'yyyy-MM')
    const i = indice.get(chave)
    if (i !== undefined) somar(baldes[i], it)
  }
  return { baldes, granularidade: semanal ? 'semana' : 'mes' }
}

export function porFormaPagamento(itens: EventoCompleto[]) {
  const m = new Map<FormaPagamento, { valor: number; qtd: number }>()
  for (const { evento, resumo } of itens) {
    const s = m.get(evento.formaPagamento) ?? { valor: 0, qtd: 0 }
    s.valor += resumo.total
    s.qtd++
    m.set(evento.formaPagamento, s)
  }
  return m
}

export function porCliente(itens: EventoCompleto[]) {
  const m = new Map<string, { nome: string; valor: number; qtd: number }>()
  for (const { evento, resumo, cliente } of itens) {
    const s = m.get(evento.clienteId) ?? { nome: cliente?.nome ?? 'Cliente removido', valor: 0, qtd: 0 }
    s.valor += resumo.total
    s.qtd++
    m.set(evento.clienteId, s)
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor)
}

/** Intervalo imediatamente anterior, de mesmo tamanho, para comparação. */
export function periodoAnterior(de: string, ate: string): [string, string] {
  const ini = parseISO(de)
  const dias = differenceInCalendarDays(parseISO(ate), ini) + 1
  // Se o período for exatamente meses cheios, compara com os mesmos meses anteriores
  if (format(ini, 'dd') === '01' && format(endOfMonth(parseISO(ate)), 'yyyy-MM-dd') === ate) {
    const meses = eachMonthOfInterval({ start: ini, end: parseISO(ate) }).length
    const inicioAnt = startOfMonth(addDays(ini, -1))
    const iniAnt = new Date(inicioAnt.getFullYear(), inicioAnt.getMonth() - (meses - 1), 1)
    return [format(iniAnt, 'yyyy-MM-dd'), format(addDays(ini, -1), 'yyyy-MM-dd')]
  }
  return [format(addDays(ini, -dias), 'yyyy-MM-dd'), format(addDays(ini, -1), 'yyyy-MM-dd')]
}
