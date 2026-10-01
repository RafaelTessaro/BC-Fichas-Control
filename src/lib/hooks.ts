import { useMemo } from 'react'
import { useDados } from '../store/dados'
import { calcularEvento, type ResumoEvento } from '#shared/calc.ts'
import type { Cliente, Evento } from '#shared/tipos.ts'

export interface EventoCompleto {
  evento: Evento
  resumo: ResumoEvento
  cliente: Cliente | undefined
}

/** Eventos com o cálculo financeiro e o cliente já resolvidos (memoizado). */
export function useEventosCompletos(): EventoCompleto[] {
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  return useMemo(() => {
    const mapa = new Map(clientes.map((c) => [c.id, c]))
    return eventos.map((evento) => ({ evento, resumo: calcularEvento(evento), cliente: mapa.get(evento.clienteId) }))
  }, [eventos, clientes])
}

/** Ordena do mais recente para o mais antigo pela primeira data de uso. */
export const porDataDesc = (a: EventoCompleto, b: EventoCompleto) =>
  (b.resumo.dataInicio ?? '').localeCompare(a.resumo.dataInicio ?? '') || b.evento.codigo - a.evento.codigo
