import { describe, expect, it } from 'vitest'
import { ErroApi } from '../../lib/api'
import { avisoEspera, erroAoEntrar, formatarEspera } from './auxiliares'

describe('espera do bloqueio por tentativas', () => {
  it('formatarEspera escreve a unidade (14:57 se leria como horário)', () => {
    expect(formatarEspera(897)).toBe('14 min 57 s')
    expect(formatarEspera(900)).toBe('15 min')
    expect(formatarEspera(65)).toBe('1 min 5 s')
    expect(formatarEspera(120)).toBe('2 min')
    expect(formatarEspera(40)).toBe('40 s')
  })

  it('aviso da conta e aviso do computador', () => {
    expect(avisoEspera(897)).toBe('Muitas tentativas. Aguarde 14 min 57 s para tentar de novo.')
    expect(avisoEspera(900, true)).toBe(
      'Muitas tentativas erradas neste computador. Aguarde 15 min ou entre por outro computador.',
    )
  })

  it('erroAoEntrar lê a espera e o motivo do 429', () => {
    const conta = new ErroApi(429, 'Muitas tentativas. Tente de novo em 1 minuto.', { esperarSegundos: 30 })
    expect(erroAoEntrar(conta)).toEqual({ mensagem: conta.message, esperarSegundos: 30, porComputador: false })
    const computador = new ErroApi(429, 'x', { esperarSegundos: 899.2, motivo: 'computador' })
    expect(erroAoEntrar(computador)).toMatchObject({ esperarSegundos: 900, porComputador: true })
    expect(erroAoEntrar(new ErroApi(429, 'x'))).toMatchObject({ esperarSegundos: 60, porComputador: false })
    expect(erroAoEntrar(new ErroApi(401, 'Usuário ou senha incorretos.'))).toEqual({
      mensagem: 'Usuário ou senha incorretos.',
      esperarSegundos: 0,
      porComputador: false,
    })
  })
})
