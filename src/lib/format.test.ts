import { describe, expect, it } from 'vitest'
import { mascaraDocumento, mascaraTelefone, normalizar, periodo, textoParaReais } from './format'

describe('formatação', () => {
  it('interpreta valores colados no padrão brasileiro e internacional', () => {
    expect(textoParaReais('R$ 1.234,56')).toBe(1234.56)
    expect(textoParaReais('80')).toBe(80)
    expect(textoParaReais('80,5')).toBe(80.5)
    expect(textoParaReais('80.50')).toBe(80.5)
    expect(textoParaReais('1.500')).toBe(1500)
    expect(textoParaReais('abc')).toBeNull()
  })

  it('aplica máscaras de CPF, CNPJ e telefone', () => {
    expect(mascaraDocumento('12345678909', 'PF')).toBe('123.456.789-09')
    expect(mascaraDocumento('12403843000118', 'PJ')).toBe('12.403.843/0001-18')
    expect(mascaraTelefone('1930239050')).toBe('(19) 3023-9050')
    expect(mascaraTelefone('19987654321')).toBe('(19) 98765-4321')
  })

  it('busca sem acentos e sem diferenciar maiúsculas', () => {
    expect(normalizar('  Paróquia SÃO José ')).toBe('paroquia sao jose')
  })

  it('formata períodos de forma compacta', () => {
    expect(periodo('2026-08-01', '2026-08-01')).toBe('01/08/2026')
    expect(periodo('2026-08-01', '2026-08-03')).toBe('01 a 03/08/2026')
    expect(periodo('2026-07-30', '2026-08-02')).toBe('30/07 a 02/08/2026')
    expect(periodo(null, null)).toBe('Sem datas')
  })
})
