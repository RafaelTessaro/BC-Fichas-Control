import { describe, expect, it } from 'vitest'
import { calcularEvento } from './calc'
import type { EventoCompleto } from './hooks'
import { agruparPorPeriodo, filtrarPeriodo, periodoAnterior } from './relatorio'
import type { Evento } from './types'

function ev(id: string, datas: string[], extra: Partial<Evento> = {}): EventoCompleto {
  const evento = {
    id,
    codigo: 1,
    clienteId: 'c1',
    nome: id,
    dias: datas.map((data, i) => ({ id: `${id}-${i}`, data, maquinas: 1 })),
    valorDiaria: 100,
    valorBobina: 5,
    bobinasConsignadas: 10,
    bobinasDevolvidas: 4,
    desconto: 0,
    formaPagamento: 'PIX',
    status: 'FINALIZADO',
    ...extra,
  } as Evento
  return { evento, resumo: calcularEvento(evento), cliente: undefined }
}

describe('relatórios', () => {
  const itens = [
    ev('a', ['2026-07-30', '2026-08-02']),
    ev('b', ['2026-08-15']),
    ev('c', ['2026-08-20'], { status: 'CANCELADO' }),
    ev('d', ['2026-09-01'], { formaPagamento: 'NAO_PAGO' }),
  ]

  it('atribui o evento ao mês da primeira data e ignora cancelados', () => {
    const f = filtrarPeriodo(itens, '2026-08-01', '2026-08-31')
    expect(f.map((x) => x.evento.id)).toEqual(['b'])
  })

  it('agrupa por mês somando diárias, bobinas e recebido/a receber', () => {
    const f = filtrarPeriodo(itens, '2026-07-01', '2026-09-30')
    const { baldes, granularidade } = agruparPorPeriodo(f, '2026-07-01', '2026-09-30')
    expect(granularidade).toBe('mes')
    expect(baldes.map((b) => b.total)).toEqual([230, 130, 130])
    expect(baldes[2].aReceber).toBe(130)
    expect(baldes[0].diarias).toBe(2)
  })

  it('usa semanas em períodos curtos', () => {
    expect(agruparPorPeriodo([], '2026-08-01', '2026-08-31').granularidade).toBe('semana')
  })

  it('compara com o período anterior equivalente', () => {
    expect(periodoAnterior('2026-08-01', '2026-08-31')).toEqual(['2026-07-01', '2026-07-31'])
    expect(periodoAnterior('2026-07-01', '2026-09-30')).toEqual(['2026-04-01', '2026-06-30'])
    expect(periodoAnterior('2026-08-10', '2026-08-19')).toEqual(['2026-07-31', '2026-08-09'])
  })
})
