import type { Evento, FormaPagamento, StatusEvento } from './tipos.ts'

/**
 * Regras de cálculo herdadas da planilha "Controle Interno de Locação":
 *
 *   TOTAL DE DIÁRIAS     = soma da quantidade de máquinas de cada data utilizada
 *   VALOR DAS DIÁRIAS    = valor da diária × total de diárias
 *   BOBINAS UTILIZADAS   = bobinas consignadas − bobinas devolvidas
 *                          (vazio enquanto as devolvidas não forem informadas
 *                           ou se o valor for inválido)
 *   VALOR DAS BOBINAS    = valor de cada bobina × bobinas utilizadas
 *   TOTAL FINAL          = valor das diárias + valor das bobinas
 *
 * O sistema acrescenta apenas um campo opcional de desconto (padrão 0),
 * subtraído do total final.
 */

export type StatusConferencia = 'PREENCHER' | 'INVALIDO' | 'CONFERIDO'

export interface ResumoEvento {
  totalDiarias: number
  valorDiarias: number
  conferencia: StatusConferencia
  bobinasUtilizadas: number | null
  valorBobinas: number
  subtotal: number
  desconto: number
  total: number
  pago: boolean
  dataInicio: string | null
  dataFim: string | null
}

type EntradaCalculo = Pick<
  Evento,
  'dias' | 'valorDiaria' | 'valorBobina' | 'bobinasConsignadas' | 'bobinasDevolvidas' | 'desconto' | 'formaPagamento'
>

const arred = (n: number) => Math.round(n * 100) / 100

export function conferenciaBobinas(consignadas: number, devolvidas: number | null): StatusConferencia {
  if (devolvidas === null || Number.isNaN(devolvidas)) return 'PREENCHER'
  if (devolvidas < 0 || devolvidas > consignadas) return 'INVALIDO'
  return 'CONFERIDO'
}

export function calcularEvento(e: EntradaCalculo): ResumoEvento {
  const totalDiarias = e.dias.reduce((s, d) => s + (Number(d.maquinas) || 0), 0)
  const valorDiarias = arred((e.valorDiaria || 0) * totalDiarias)

  const consignadas = e.bobinasConsignadas || 0
  const conferencia = conferenciaBobinas(consignadas, e.bobinasDevolvidas)
  const bobinasUtilizadas = conferencia === 'CONFERIDO' ? consignadas - (e.bobinasDevolvidas as number) : null
  const valorBobinas = bobinasUtilizadas === null ? 0 : arred((e.valorBobina || 0) * bobinasUtilizadas)

  const subtotal = arred(valorDiarias + valorBobinas)
  const desconto = Math.max(0, e.desconto || 0)
  const total = Math.max(0, arred(subtotal - desconto))

  const datas = e.dias
    .map((d) => d.data)
    .filter(Boolean)
    .sort()

  return {
    totalDiarias,
    valorDiarias,
    conferencia,
    bobinasUtilizadas,
    valorBobinas,
    subtotal,
    desconto,
    total,
    pago: e.formaPagamento !== 'NAO_PAGO',
    dataInicio: datas[0] ?? null,
    dataFim: datas[datas.length - 1] ?? null,
  }
}

export const STATUS_EVENTO: Record<StatusEvento, { label: string; tone: Tone }> = {
  EM_ABERTO: { label: 'Em aberto', tone: 'info' },
  PENDENTE: { label: 'Pendente', tone: 'warning' },
  FINALIZADO: { label: 'Finalizado', tone: 'success' },
  CANCELADO: { label: 'Cancelado', tone: 'neutral' },
}

export const FORMAS_PAGAMENTO: Record<FormaPagamento, { label: string }> = {
  NAO_PAGO: { label: 'Não pago' },
  DINHEIRO: { label: 'Dinheiro' },
  BOLETO: { label: 'Boleto' },
  CREDITO: { label: 'Crédito' },
  DEBITO: { label: 'Débito' },
  PIX: { label: 'PIX' },
}

export const CONFERENCIA: Record<StatusConferencia, { label: string; tone: Tone }> = {
  PREENCHER: { label: 'Aguardando devolução', tone: 'warning' },
  INVALIDO: { label: 'Valor inválido', tone: 'danger' },
  CONFERIDO: { label: 'Conferido', tone: 'success' },
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

/** Soma de máquinas reservadas por data, considerando eventos não cancelados. */
export function ocupacaoPorDia(eventos: Evento[], ignorarId?: string): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const ev of eventos) {
    if (ev.status === 'CANCELADO' || ev.id === ignorarId) continue
    for (const d of ev.dias) {
      if (!d.data) continue
      mapa.set(d.data, (mapa.get(d.data) ?? 0) + (Number(d.maquinas) || 0))
    }
  }
  return mapa
}
