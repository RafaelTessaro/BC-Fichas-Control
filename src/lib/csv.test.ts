import { describe, expect, it } from 'vitest'
import { celulaCsv } from './csv'

describe('celulaCsv', () => {
  it('neutraliza textos que o Excel interpretaria como fórmula', () => {
    expect(celulaCsv('=1+1')).toBe("'=1+1")
    expect(celulaCsv('@SOMA(A1)')).toBe("'@SOMA(A1)")
    expect(celulaCsv('-2+3')).toBe("'-2+3")
    expect(celulaCsv('+55 19 9999')).toBe("'+55 19 9999")
  })

  it('mantém números (inclusive negativos) como números com vírgula', () => {
    expect(celulaCsv(-5)).toBe('-5')
    expect(celulaCsv(80.5)).toBe('80,5')
  })

  it('escapa separador, aspas e quebras de linha', () => {
    expect(celulaCsv('a;b')).toBe('"a;b"')
    expect(celulaCsv('diz "oi"')).toBe('"diz ""oi"""')
    expect(celulaCsv('linha1\nlinha2')).toBe('"linha1\nlinha2"')
  })
})
