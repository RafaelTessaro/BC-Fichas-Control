import { describe, expect, it } from 'vitest'
import { calcularEvento } from '#shared/calc.ts'
import type { DiaEvento, Evento, StatusEvento } from '#shared/tipos.ts'
import {
  acaoDaTecla,
  compararResumos,
  contagemEventos,
  diaCurto,
  dicaDia,
  diasDoMes,
  faixaOcupacao,
  fimDoMes,
  foraNoDia,
  intervalosFaixas,
  lerDia,
  lerMes,
  mesCurto,
  nomeMes,
  ocorrenciasPorDia,
  reservasNoDia,
  resumoDosMeses,
  resumoPeriodo,
  semanasDoMes,
  soComClienteNoDia,
  somarMeses,
  textoVariacao,
  fraseVariacao,
  variacao,
  type EventoAgenda,
} from './agenda'

// Outubro de 2026 começa numa quinta-feira; os sábados são 3, 10, 17, 24 e 31.

let seq = 0
const dia = (data: string, maquinas: number, reservas = 0, reservasUsadas = 0): DiaEvento => ({
  id: `d${++seq}`,
  data,
  maquinas,
  reservas,
  reservasUsadas,
})

const evento = (
  id: string,
  dias: DiaEvento[],
  extra: Partial<Pick<Evento, 'nome' | 'status' | 'periodoCorrido'>> = {},
): { evento: EventoAgenda } => ({
  evento: {
    id,
    nome: extra.nome ?? id,
    status: (extra.status ?? 'EM_ABERTO') as StatusEvento,
    dias,
    periodoCorrido: !!extra.periodoCorrido,
  },
})

const frota = (n: number) => () => n

describe('ocorrências de cada dia', () => {
  it('mostra titulares e reservas, e cobra as diárias das titulares mais as reservas usadas', () => {
    const festa = evento('festa', [dia('2026-10-02', 4, 1), dia('2026-10-03', 4, 1, 1), dia('2026-10-04', 4, 1)], {
      nome: 'Festa da Primavera',
    })
    const porDia = ocorrenciasPorDia([festa])
    const sabado = porDia.get('2026-10-03')![0]
    expect(sabado).toMatchObject({ maquinas: 4, reservas: 1, reservasUsadas: 1, uso: true, diarias: 5 })
    expect(porDia.get('2026-10-02')![0].diarias).toBe(4)
    // A soma das diárias dos dias é o total de diárias do evento
    const soma = [...porDia.values()].flat().reduce((s, o) => s + o.diarias, 0)
    expect(soma).toBe(
      calcularEvento({
        ...festa.evento,
        valorDiaria: 0,
        valorBobina: 0,
        bobinasConsignadas: 0,
        bobinasDevolvidas: null,
        desconto: 0,
        formaPagamento: 'NAO_PAGO',
      }).totalDiarias,
    )
    expect(foraNoDia(porDia.get('2026-10-03'))).toBe(5)
    expect(reservasNoDia(porDia.get('2026-10-03'))).toBe(1)
  })

  it('no período corrido, os dias do meio contam as máquinas (e a reserva) sem diária', () => {
    const feira = evento('feira', [dia('2026-10-10', 3, 1), dia('2026-10-11', 3, 1), dia('2026-10-17', 3, 1)], {
      periodoCorrido: true,
    })
    const porDia = ocorrenciasPorDia([feira])
    const quarta = porDia.get('2026-10-14')!
    expect(quarta[0]).toMatchObject({ maquinas: 3, reservas: 1, uso: false, diarias: 0 })
    expect(foraNoDia(quarta)).toBe(4)
    expect(soComClienteNoDia(quarta)).toBe(4)
    expect(soComClienteNoDia(porDia.get('2026-10-10'))).toBe(0)
  })

  it('cancelados aparecem no dia (por último), mas não contam máquinas', () => {
    const porDia = ocorrenciasPorDia([
      evento('cancelado', [dia('2026-10-03', 5)], { status: 'CANCELADO', nome: 'A' }),
      evento('ok', [dia('2026-10-03', 2, 1)], { nome: 'B' }),
    ])
    const lista = porDia.get('2026-10-03')!
    expect(lista.map((o) => o.item.evento.id)).toEqual(['ok', 'cancelado'])
    expect(foraNoDia(lista)).toBe(3)
    expect(foraNoDia(undefined)).toBe(0)
  })
})

describe('resumo do período', () => {
  const itens = [
    evento('a', [dia('2026-10-03', 4, 1, 1), dia('2026-10-04', 4, 1)]),
    evento('b', [dia('2026-10-03', 6, 2)]),
    evento('c', [dia('2026-10-31', 2), dia('2026-11-01', 2)]),
    evento('x', [dia('2026-10-20', 9)], { status: 'CANCELADO' }),
  ]
  const porDia = ocorrenciasPorDia(itens)

  it('conta eventos, diárias cobradas, pico com reservas e dias acima da frota', () => {
    const r = resumoPeriodo(porDia, '2026-10-01', '2026-10-31', frota(12))
    expect(r.eventos).toBe(3)
    // a: 5 + 4; b: 6; c: 2 (só o dia 31 é de outubro)
    expect(r.diarias).toBe(17)
    // Dia 3: 4+1 e 6+2
    expect(r.pico).toBe(13)
    expect(r.diasAcima).toBe(1)
    // O cancelado conta como registro (o mês teve movimento), não como evento
    expect(r.registros).toBe(4)
  })

  it('a capacidade pode variar por dia (máquinas em manutenção de hoje em diante)', () => {
    const r = resumoPeriodo(porDia, '2026-10-01', '2026-10-31', (d) => (d >= '2026-10-04' ? 4 : 20))
    expect(r.diasAcima).toBe(1)
  })

  it('separa os meses do ano; o evento que vira o mês conta nos dois', () => {
    const meses = resumoDosMeses(porDia, 2026, frota(20))
    expect(meses).toHaveLength(12)
    expect(meses[9].eventos).toBe(3)
    expect(meses[10]).toMatchObject({ eventos: 1, diarias: 2, registros: 1 })
    expect(meses[0]).toMatchObject({ eventos: 0, diarias: 0, pico: 0, registros: 0 })
  })

  it('compara com o ano anterior pelos totais; "sem registros" é diferente de zero', () => {
    const atual = resumoPeriodo(porDia, '2026-10-01', '2026-10-31', frota(12))
    const vazio = resumoPeriodo(porDia, '2025-10-01', '2025-10-31', frota(12))
    expect(compararResumos(atual, vazio).semRegistros).toBe(true)
    // Ano anterior só com um cancelado: teve registro, mas zero eventos
    const soCancelado = ocorrenciasPorDia([evento('y', [dia('2025-10-11', 3)], { status: 'CANCELADO' })])
    const anterior = resumoPeriodo(soCancelado, '2025-10-01', '2025-10-31', frota(12))
    const c = compararResumos(atual, anterior)
    expect(c.semRegistros).toBe(false)
    expect(c.eventos).toEqual({ atual: 3, anterior: 0, diferenca: 3, direcao: 'mais' })
  })

  it('escreve a diferença com seta e número (não só cor)', () => {
    expect(textoVariacao(variacao(5, 3))).toBe('▲ 2')
    expect(textoVariacao(variacao(1, 4))).toBe('▼ 3')
    expect(textoVariacao(variacao(2, 2))).toBe('= igual')
    expect(textoVariacao(variacao(2500, 1000))).toBe('▲ 1.500')
    expect(fraseVariacao(variacao(5, 3), 'out/2025')).toBe('2 a mais que em out/2025')
    expect(fraseVariacao(variacao(1, 4), 'out/2025')).toBe('3 a menos que em out/2025')
    expect(fraseVariacao(variacao(2, 2), 'out/2025')).toBe('igual a out/2025')
  })

  it('conta eventos por mês e por ano para o seletor', () => {
    const { porMes, porAno } = contagemEventos(porDia)
    expect(porMes.get('2026-10')).toBe(3)
    expect(porMes.get('2026-11')).toBe(1)
    expect(porMes.get('2026-09')).toBeUndefined()
    expect(porAno.get('2026')).toBe(3)
  })
})

describe('faixas do mapa de calor', () => {
  it('usa faixas fixas relativas à frota', () => {
    const f = (n: number) => faixaOcupacao(n, 20)
    expect([0, 1, 5, 6, 10, 11, 16, 17, 20, 21].map(f)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5])
    // 80% de 5 é exatamente 4: fica na faixa de até 80% (sem erro de arredondamento)
    expect(faixaOcupacao(4, 5)).toBe(3)
    // Sem frota, qualquer máquina fora já passa do total
    expect(faixaOcupacao(1, 0)).toBe(5)
  })

  it('diz quantas máquinas cabem em cada faixa, para a legenda', () => {
    expect(intervalosFaixas(17)).toEqual([
      { faixa: 0, de: 0, ate: 0 },
      { faixa: 1, de: 1, ate: 4 },
      { faixa: 2, de: 5, ate: 8 },
      { faixa: 3, de: 9, ate: 13 },
      { faixa: 4, de: 14, ate: 17 },
      { faixa: 5, de: 18, ate: null },
    ])
    // Frota pequena: algumas faixas não têm nenhum número inteiro
    expect(intervalosFaixas(2).map((x) => (x ? [x.de, x.ate] : null))).toEqual([[0, 0], null, [1, 1], null, [2, 2], [3, null]])
  })

  it('monta a dica do dia com titulares+reservas e o nome do evento', () => {
    const porDia = ocorrenciasPorDia([
      evento('x', [dia('2026-10-10', 4, 1)], { nome: 'Festa X' }),
      evento('y', [dia('2026-10-10', 2)], { nome: 'Baile Y' }),
      evento('z', [dia('2026-10-10', 7)], { nome: 'Cancelado', status: 'CANCELADO' }),
    ])
    expect(dicaDia('2026-10-10', porDia.get('2026-10-10'))).toBe('sáb 10/10: 4+1 · Festa X; 2 · Baile Y')
    expect(dicaDia('2026-10-12', porDia.get('2026-10-12'))).toBe('seg 12/10: nenhuma máquina fora')
    const corrido = ocorrenciasPorDia([
      evento('f', [dia('2026-10-10', 3, 1), dia('2026-10-17', 3, 1)], { nome: 'Feira', periodoCorrido: true }),
    ])
    expect(dicaDia('2026-10-13', corrido.get('2026-10-13'))).toBe('ter 13/10: 3+1 · Feira (sem uso)')
  })
})

describe('mês e dia na URL', () => {
  it('aceita só meses válidos de 2000 a 2100', () => {
    expect(lerMes('2025-10', '2026-10')).toBe('2025-10')
    for (const invalido of ['2025-13', '2025-00', '2025-1', 'outubro', '', null, undefined, '1999-12', '2101-01', '2025-10-01']) {
      expect(lerMes(invalido, '2026-10')).toBe('2026-10')
    }
  })

  it('aceita só dias que existem no calendário', () => {
    expect(lerDia('2025-10-11')).toBe('2025-10-11')
    expect(lerDia('2024-02-29')).toBe('2024-02-29')
    expect(lerDia('2025-02-29')).toBeNull()
    expect(lerDia('2025-10-32')).toBeNull()
    expect(lerDia('11/10/2025')).toBeNull()
    expect(lerDia(null)).toBeNull()
  })

  it('anda de mês em mês virando o ano', () => {
    expect(somarMeses('2026-01', -1)).toBe('2025-12')
    expect(somarMeses('2025-12', 1)).toBe('2026-01')
    expect(somarMeses('2026-10', -12)).toBe('2025-10')
    expect(somarMeses('2026-10', 15)).toBe('2028-01')
  })

  it('escreve o nome do mês e os limites', () => {
    expect(nomeMes('2025-10')).toBe('Outubro de 2025')
    expect(nomeMes('2026-03')).toBe('Março de 2026')
    expect(mesCurto('2025-10')).toBe('out/2025')
    expect(fimDoMes('2024-02')).toBe('2024-02-29')
    expect(fimDoMes('2026-12')).toBe('2026-12-31')
    expect(diasDoMes('2026-02')).toHaveLength(28)
    expect(diaCurto('2026-10-03')).toBe('sáb 03/10')
  })

  it('monta semanas inteiras de domingo a sábado', () => {
    const outubro = semanasDoMes('2026-10')
    expect(outubro[0]).toBe('2026-09-27')
    expect(outubro[outubro.length - 1]).toBe('2026-10-31')
    expect(outubro).toHaveLength(35)
    // Fevereiro de 2026 começa num domingo e termina num sábado: quatro semanas exatas
    expect(semanasDoMes('2026-02')).toHaveLength(28)
  })
})

describe('teclas de atalho', () => {
  const corpo = { tagName: 'BODY' }
  it('← → mudam o mês e T volta para hoje', () => {
    expect(acaoDaTecla({ key: 'ArrowLeft', alvo: corpo })).toBe('anterior')
    expect(acaoDaTecla({ key: 'ArrowRight', alvo: { tagName: 'BUTTON' } })).toBe('proximo')
    expect(acaoDaTecla({ key: 't', alvo: corpo })).toBe('hoje')
    expect(acaoDaTecla({ key: 'T', alvo: corpo })).toBe('hoje')
    expect(acaoDaTecla({ key: 'x', alvo: corpo })).toBeNull()
  })

  it('não atrapalham a digitação, os atalhos do navegador nem as janelas abertas', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
      expect(acaoDaTecla({ key: 'ArrowLeft', alvo: { tagName } })).toBeNull()
    }
    expect(acaoDaTecla({ key: 't', alvo: { tagName: 'DIV', isContentEditable: true } })).toBeNull()
    expect(acaoDaTecla({ key: 'ArrowLeft', altKey: true, alvo: corpo })).toBeNull()
    expect(acaoDaTecla({ key: 'ArrowLeft', ctrlKey: true, alvo: corpo })).toBeNull()
    expect(acaoDaTecla({ key: 't', metaKey: true, alvo: corpo })).toBeNull()
    expect(acaoDaTecla({ key: 't', isComposing: true, alvo: corpo })).toBeNull()
    expect(acaoDaTecla({ key: 'ArrowRight', alvo: corpo }, true)).toBeNull()
  })
})
