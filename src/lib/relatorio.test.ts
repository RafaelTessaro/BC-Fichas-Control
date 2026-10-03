import { describe, expect, it } from 'vitest'
import { calcularEvento } from '#shared/calc.ts'
import type { EventoCompleto } from './hooks'
import { agruparPorPeriodo, filtrarPeriodo, periodoAnterior, somar, totaisVazios } from './relatorio'
import type { Evento } from '#shared/tipos.ts'

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

  it('soma as diárias de reserva usada (já incluídas nas diárias); a reserva parada não conta', () => {
    const comReserva = ev('r', ['2026-08-10', '2026-08-11'], {
      dias: [
        { id: 'r0', data: '2026-08-10', maquinas: 3, reservas: 1, reservasUsadas: 1 },
        { id: 'r1', data: '2026-08-11', maquinas: 3, reservas: 1, reservasUsadas: 0 },
      ],
    })
    const t = [comReserva, itens[1]].reduce(somar, totaisVazios())
    expect(t.diarias).toBe(8) // 3 + 1 usada + 3 do primeiro, mais 1 do outro evento
    expect(t.diariasReserva).toBe(1)
    expect(t.valorDiarias).toBe(800)
    const { baldes } = agruparPorPeriodo(filtrarPeriodo([comReserva], '2026-08-01', '2026-08-31'), '2026-08-01', '2026-08-31')
    expect(baldes.reduce((s, b) => s + b.diariasReserva, 0)).toBe(1)
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
