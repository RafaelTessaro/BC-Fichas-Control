import { describe, expect, it } from 'vitest'
import { calcularEvento, conferenciaBobinas, ocupacaoPorDia } from './calc.ts'
import type { Evento } from './tipos.ts'

const base = {
  dias: [{ id: 'd1', data: '2026-08-01', maquinas: 2, reservas: 0, reservasUsadas: 0 }],
  valorDiaria: 80,
  valorBobina: 6,
  bobinasConsignadas: 0,
  bobinasDevolvidas: 0 as number | null,
  desconto: 0,
  formaPagamento: 'NAO_PAGO' as const,
}

describe('calcularEvento — mesmas regras da planilha', () => {
  it('reproduz o exemplo da planilha (1 data, 2 máquinas, R$ 80/diária)', () => {
    const r = calcularEvento(base)
    expect(r.totalDiarias).toBe(2)
    expect(r.valorDiarias).toBe(160)
    expect(r.bobinasUtilizadas).toBe(0)
    expect(r.valorBobinas).toBe(0)
    expect(r.total).toBe(160)
    expect(r.conferencia).toBe('CONFERIDO')
    expect(r.pago).toBe(false)
  })

  it('soma as máquinas de todas as datas como diárias', () => {
    const r = calcularEvento({
      ...base,
      dias: [
        { id: 'a', data: '2026-08-03', maquinas: 3, reservas: 0, reservasUsadas: 0 },
        { id: 'b', data: '2026-08-01', maquinas: 2, reservas: 0, reservasUsadas: 0 },
        { id: 'c', data: '2026-08-02', maquinas: 4, reservas: 0, reservasUsadas: 0 },
      ],
    })
    expect(r.totalDiarias).toBe(9)
    expect(r.valorDiarias).toBe(720)
    expect(r.dataInicio).toBe('2026-08-01')
    expect(r.dataFim).toBe('2026-08-03')
  })

  it('cobra bobinas utilizadas = consignadas − devolvidas', () => {
    const r = calcularEvento({ ...base, bobinasConsignadas: 50, bobinasDevolvidas: 12 })
    expect(r.bobinasUtilizadas).toBe(38)
    expect(r.valorBobinas).toBe(228)
    expect(r.total).toBe(388)
  })

  it('não cobra bobinas enquanto a devolução não foi informada', () => {
    const r = calcularEvento({ ...base, bobinasConsignadas: 50, bobinasDevolvidas: null })
    expect(r.conferencia).toBe('PREENCHER')
    expect(r.bobinasUtilizadas).toBeNull()
    expect(r.valorBobinas).toBe(0)
    expect(r.total).toBe(160)
  })

  it('marca valor inválido quando devolvidas > consignadas ou negativas', () => {
    expect(conferenciaBobinas(10, 11)).toBe('INVALIDO')
    expect(conferenciaBobinas(10, -1)).toBe('INVALIDO')
    const r = calcularEvento({ ...base, bobinasConsignadas: 10, bobinasDevolvidas: 11 })
    expect(r.bobinasUtilizadas).toBeNull()
    expect(r.total).toBe(160)
  })

  it('aplica desconto sem deixar o total negativo', () => {
    expect(calcularEvento({ ...base, desconto: 10 }).total).toBe(150)
    expect(calcularEvento({ ...base, desconto: 999 }).total).toBe(0)
  })

  it('considera pago qualquer forma diferente de "Não pago"', () => {
    expect(calcularEvento({ ...base, formaPagamento: 'PIX' }).pago).toBe(true)
  })

  it('evita erros de ponto flutuante em centavos', () => {
    const r = calcularEvento({
      ...base,
      valorDiaria: 0.1,
      dias: [{ id: 'x', data: '2026-01-01', maquinas: 3, reservas: 0, reservasUsadas: 0 }],
    })
    expect(r.valorDiarias).toBe(0.3)
  })
})

describe('ocupacaoPorDia', () => {
  const ev = (id: string, status: Evento['status'], dias: Evento['dias']) => ({ id, status, dias }) as Evento

  it('soma máquinas por data e ignora cancelados e o próprio evento', () => {
    const mapa = ocupacaoPorDia(
      [
        ev('1', 'EM_ABERTO', [{ id: 'a', data: '2026-08-01', maquinas: 2, reservas: 0, reservasUsadas: 0 }]),
        ev('2', 'FINALIZADO', [{ id: 'b', data: '2026-08-01', maquinas: 3, reservas: 0, reservasUsadas: 0 }]),
        ev('3', 'CANCELADO', [{ id: 'c', data: '2026-08-01', maquinas: 9, reservas: 0, reservasUsadas: 0 }]),
      ],
      '2',
    )
    expect(mapa.get('2026-08-01')).toBe(2)
  })
})
