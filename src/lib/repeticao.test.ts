import { describe, expect, it } from 'vitest'
import {
  dataComDiaDaSemana,
  dataDaRegra,
  descreverRegra,
  diaDaSemana,
  diasDaCopia,
  faltasDaCopia,
  gradeDoMes,
  regrasDaData,
  repetirTodoMes,
  rotuloCopia,
  somarMeses,
  somarOcupacao,
} from './repeticao'

// Outubro de 2026 começa numa quinta-feira; os sábados são 3, 10, 17, 24 e 31.

describe('calendário', () => {
  it('sabe o dia da semana sem depender do fuso', () => {
    expect(diaDaSemana('2026-10-03')).toBe(6)
    expect(diaDaSemana('2026-10-04')).toBe(0)
    expect(dataComDiaDaSemana('2026-10-09')).toBe('sex 09/10')
  })

  it('monta as casas do mês em semanas completas, de domingo a sábado', () => {
    const outubro = gradeDoMes(2026, 10)
    expect(outubro).toHaveLength(35)
    expect(outubro.slice(0, 5)).toEqual([null, null, null, null, '2026-10-01'])
    expect(outubro[34]).toBe('2026-10-31')
    // Fevereiro de 2026 começa num domingo e tem 28 dias: quatro semanas exatas
    const fevereiro = gradeDoMes(2026, 2)
    expect(fevereiro).toHaveLength(28)
    expect(fevereiro.every(Boolean)).toBe(true)
  })

  it('anda de mês em mês virando o ano', () => {
    expect(somarMeses(2026, 11, 3)).toEqual({ ano: 2027, mes: 2 })
    expect(somarMeses(2026, 1, -1)).toEqual({ ano: 2025, mes: 12 })
    expect(somarMeses(2026, 12, 0)).toEqual({ ano: 2026, mes: 12 })
  })
})

describe('repetir todo mês', () => {
  it('descreve a ocorrência do dia da semana no mês', () => {
    expect(regrasDaData('2026-10-10').map(descreverRegra)).toEqual(['2º sábado'])
    expect(regrasDaData('2026-10-09').map(descreverRegra)).toEqual(['2ª sexta-feira'])
    expect(regrasDaData('2026-10-24').map(descreverRegra)).toEqual(['4º sábado'])
    // O 5º sábado só pode ser "o último" (nem todo mês tem cinco)
    expect(regrasDaData('2026-10-31').map(descreverRegra)).toEqual(['último sábado'])
    // 28/11/2026 é o 4º e também o último sábado do mês: as duas leituras valem
    expect(regrasDaData('2026-11-28').map(descreverRegra)).toEqual(['4º sábado', 'último sábado'])
    expect(regrasDaData('2026-10-28').map(descreverRegra)).toEqual(['4ª quarta-feira', 'última quarta-feira'])
  })

  it('acha a data da regra em qualquer mês', () => {
    expect(dataDaRegra(2026, 11, { diaSemana: 6, ordem: 2 })).toBe('2026-11-14')
    expect(dataDaRegra(2026, 12, { diaSemana: 6, ordem: -1 })).toBe('2026-12-26')
    expect(dataDaRegra(2026, 10, { diaSemana: 4, ordem: 1 })).toBe('2026-10-01')
    expect(dataDaRegra(2026, 10, { diaSemana: 6, ordem: -1 })).toBe('2026-10-31')
  })

  it('escolhe uma data por mês depois do evento', () => {
    expect(repetirTodoMes({ diaSemana: 6, ordem: 2 }, '2026-10-10', 3)).toEqual(['2026-11-14', '2026-12-12', '2027-01-09'])
    expect(repetirTodoMes({ diaSemana: 6, ordem: -1 }, '2026-10-31', 2)).toEqual(['2026-11-28', '2026-12-26'])
  })

  it('a partir de hoje, aproveita o mês corrente se a data ainda não passou', () => {
    expect(repetirTodoMes({ diaSemana: 6, ordem: 2 }, '2026-10-03', 2)).toEqual(['2026-10-10', '2026-11-14'])
    expect(repetirTodoMes({ diaSemana: 6, ordem: 2 }, '2026-10-12', 2)).toEqual(['2026-11-14', '2026-12-12'])
  })

  it('aceita de 1 a 12 meses', () => {
    expect(repetirTodoMes({ diaSemana: 0, ordem: 1 }, '2026-10-04', 12)).toHaveLength(12)
    expect(repetirTodoMes({ diaSemana: 0, ordem: 1 }, '2026-10-04', 1)).toEqual(['2026-11-01'])
  })
})

describe('cópias', () => {
  const dias = [
    { data: '2026-10-10', maquinas: 4, reservas: 1 },
    { data: '2026-10-09', maquinas: 3, reservas: 1 },
    { data: '2026-10-11', maquinas: 2, reservas: 0 },
  ]

  it('repete o desenho dos dias a partir da nova data de início', () => {
    const copia = diasDaCopia(dias, '2026-11-13')
    expect(copia.map((d) => [d.data, d.maquinas])).toEqual([
      ['2026-11-14', 4],
      ['2026-11-13', 3],
      ['2026-11-15', 2],
    ])
    expect(rotuloCopia(copia.map((d) => d.data))).toBe('sex 13/11 a dom 15/11')
    expect(rotuloCopia(['2026-12-12'])).toBe('sáb 12/12')
    expect(diasDaCopia([], '2026-11-13')).toEqual([])
  })

  it('avisa os dias em que faltariam máquinas (titulares e reservas)', () => {
    const ocupacao = new Map([
      ['2026-11-14', 6],
      ['2026-11-15', 8],
    ])
    const copia = { dias: diasDaCopia(dias, '2026-11-13') }
    // 6 + 5 = 11 no sábado; 8 + 2 = 10 no domingo (cabe certinho)
    expect(faltasDaCopia(copia, ocupacao, 10)).toEqual([{ data: '2026-11-14', faltam: 1 }])
    expect(faltasDaCopia(copia, ocupacao, 12)).toEqual([])
    // Capacidade por data (ex.: 1 máquina em manutenção de hoje em diante): o domingo também falta
    expect(faltasDaCopia(copia, ocupacao, (data) => (data >= '2026-11-15' ? 9 : 10))).toEqual([
      { data: '2026-11-14', faltam: 1 },
      { data: '2026-11-15', faltam: 1 },
    ])
    // Com a cópia já somada à ocupação
    const comCopia = somarOcupacao(ocupacao, [copia])
    expect(comCopia.get('2026-11-13')).toBe(4)
    expect(comCopia.get('2026-11-14')).toBe(11)
    expect(faltasDaCopia(copia, comCopia, 10, true)).toEqual([{ data: '2026-11-14', faltam: 1 }])
  })

  it('com período corrido, confere também os dias entre os usos', () => {
    const copia = {
      periodoCorrido: true,
      dias: diasDaCopia(
        [
          { data: '2026-10-03', maquinas: 3, reservas: 1 },
          { data: '2026-10-10', maquinas: 3, reservas: 1 },
        ],
        '2026-11-07',
      ),
    }
    const faltas = faltasDaCopia(copia, new Map([['2026-11-10', 7]]), 10)
    expect(faltas).toEqual([{ data: '2026-11-10', faltam: 1 }])
  })
})
