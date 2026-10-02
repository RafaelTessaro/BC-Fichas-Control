import { describe, expect, it } from 'vitest'
import { inteiroPorExtenso, valorPorExtenso } from './extenso.ts'

describe('valor por extenso', () => {
  it('números inteiros', () => {
    const casos: Array<[number, string]> = [
      [0, 'zero'],
      [1, 'um'],
      [10, 'dez'],
      [14, 'quatorze'],
      [21, 'vinte e um'],
      [100, 'cem'],
      [101, 'cento e um'],
      [110, 'cento e dez'],
      [480, 'quatrocentos e oitenta'],
      [999, 'novecentos e noventa e nove'],
      [1000, 'mil'],
      [1001, 'mil e um'],
      [1100, 'mil e cem'],
      [1200, 'mil e duzentos'],
      [1234, 'mil duzentos e trinta e quatro'],
      [2020, 'dois mil e vinte'],
      [21000, 'vinte e um mil'],
      [100000, 'cem mil'],
      [101500, 'cento e um mil e quinhentos'],
      [1000000, 'um milhão'],
      [1000001, 'um milhão e um'],
      [1500000, 'um milhão e quinhentos mil'],
      [2345678, 'dois milhões trezentos e quarenta e cinco mil seiscentos e setenta e oito'],
    ]
    for (const [n, texto] of casos) expect(inteiroPorExtenso(n), String(n)).toBe(texto)
  })

  it('reais e centavos', () => {
    expect(valorPorExtenso(480)).toBe('quatrocentos e oitenta reais')
    expect(valorPorExtenso(1)).toBe('um real')
    expect(valorPorExtenso(0.01)).toBe('um centavo')
    expect(valorPorExtenso(0.5)).toBe('cinquenta centavos')
    expect(valorPorExtenso(1234.56)).toBe('mil duzentos e trinta e quatro reais e cinquenta e seis centavos')
    expect(valorPorExtenso(1.1)).toBe('um real e dez centavos')
    expect(valorPorExtenso(1000000)).toBe('um milhão de reais')
    expect(valorPorExtenso(2000000.5)).toBe('dois milhões de reais e cinquenta centavos')
    expect(valorPorExtenso(1500000)).toBe('um milhão e quinhentos mil reais')
    expect(valorPorExtenso(0)).toBe('zero real')
    // Arredondamento de ponto flutuante (0,1 + 0,2)
    expect(valorPorExtenso(80.1 + 0.2)).toBe('oitenta reais e trinta centavos')
  })
})
