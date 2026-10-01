import { describe, expect, it } from 'vitest'
import { migrarCliente, normalizarCliente } from './dominio.ts'
import {
  cnpjAlfanumerico,
  cnpjValido,
  completarCnpj,
  completarCpf,
  cpfValido,
  mascaraCep,
  mascaraCnpj,
  mascaraCpf,
  mascaraDocumento,
  mascaraTelefone,
  normalizarCnpj,
  somenteDigitos,
} from './documentos.ts'

describe('CNPJ', () => {
  it('aceita CNPJs válidos, com ou sem máscara', () => {
    expect(cnpjValido('12.403.843/0001-18')).toBe(true)
    expect(cnpjValido('12403843000118')).toBe(true)
    expect(cnpjValido('33.000.167/0001-01')).toBe(true)
    expect(cnpjValido('11.444.777/0001-61')).toBe(true)
  })

  it('recusa dígito verificador errado, tamanho errado e sequências repetidas', () => {
    expect(cnpjValido('12.403.843/0001-19')).toBe(false)
    expect(cnpjValido('12.403.843/0001-28')).toBe(false)
    expect(cnpjValido('1240384300011')).toBe(false)
    expect(cnpjValido('124038430001180')).toBe(false)
    expect(cnpjValido('')).toBe(false)
    for (let d = 0; d <= 9; d++) expect(cnpjValido(String(d).repeat(14))).toBe(false)
  })

  it('completa os dígitos verificadores a partir dos 12 primeiros', () => {
    expect(completarCnpj('124038430001')).toBe('12403843000118')
    expect(completarCnpj('12.403.843/0001')).toBe('12403843000118')
    expect(cnpjValido(completarCnpj('987654320001'))).toBe(true)
    // Base curta é completada com zeros à esquerda
    expect(completarCnpj('1')).toHaveLength(14)
  })
})

describe('CNPJ alfanumérico (IN RFB 2.229/2024)', () => {
  // Exemplo divulgado pela Receita Federal; DV conferido pelo módulo 11 com o valor (ASCII − 48) de cada caractere
  it('aceita o exemplo oficial, com ou sem máscara e em minúsculas', () => {
    expect(cnpjValido('12.ABC.345/01DE-35')).toBe(true)
    expect(cnpjValido('12ABC34501DE35')).toBe(true)
    expect(cnpjValido('12.abc.345/01de-35')).toBe(true)
  })

  it('calcula os verificadores com o valor ASCII − 48 de cada caractere', () => {
    expect(completarCnpj('12ABC34501DE')).toBe('12ABC34501DE35')
    expect(completarCnpj('12.abc.345/01de')).toBe('12ABC34501DE35')
    expect(cnpjValido(completarCnpj('ZZ1A2B3C0001'))).toBe(true)
  })

  it('recusa verificador errado, letras nos verificadores e caracteres repetidos', () => {
    expect(cnpjValido('12.ABC.345/01DE-36')).toBe(false)
    expect(cnpjValido('12.ABC.345/01DE-3A')).toBe(false)
    expect(cnpjValido('12ABC34501DE3')).toBe(false)
    expect(cnpjValido('A'.repeat(14))).toBe(false)
  })

  it('normaliza mantendo letras maiúsculas e identifica o formato', () => {
    expect(normalizarCnpj('12.abc.345/01de-35')).toBe('12ABC34501DE35')
    expect(normalizarCnpj(undefined as unknown as string)).toBe('')
    expect(cnpjAlfanumerico('12.ABC.345/01DE-35')).toBe(true)
    expect(cnpjAlfanumerico('12.403.843/0001-18')).toBe(false)
  })

  it('máscara aceita letras nas 12 primeiras posições e só números nos verificadores', () => {
    expect(mascaraCnpj('12a')).toBe('12.A')
    expect(mascaraCnpj('12abc345')).toBe('12.ABC.345')
    expect(mascaraCnpj('12abc34501de')).toBe('12.ABC.345/01DE')
    expect(mascaraCnpj('12abc34501dex')).toBe('12.ABC.345/01DE')
    expect(mascaraCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35')
    expect(mascaraCnpj('12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35')
    expect(mascaraDocumento('12abc34501de35', 'PJ')).toBe('12.ABC.345/01DE-35')
  })

  it('o cadastro de empresa aceita e guarda o CNPJ com letras maiúsculas', () => {
    const ok = normalizarCliente({ tipo: 'PJ', nome: 'Nova Empresa', documento: '12abc34501de35' })
    expect(ok.erros).toEqual([])
    expect(ok.valor.documento).toBe('12.ABC.345/01DE-35')
    const ruim = normalizarCliente({ tipo: 'PJ', nome: 'Nova Empresa', documento: '12.ABC.345/01DE-36' })
    expect(ruim.erros).toEqual(['CNPJ inválido. Confira o número digitado.'])
    // CPF continua só com números
    expect(normalizarCliente({ tipo: 'PF', nome: 'Ana', documento: '529.982.247-25' }).valor.documento).toBe('529.982.247-25')
  })

  it('CNPJ colado com rótulo ou texto em volta continua valendo, sem embaralhar as letras do rótulo', () => {
    for (const colado of [
      'CNPJ: 12.403.843/0001-18',
      'CNPJ 12403843000118',
      'CNPJ12403843000118',
      'cnpj/mf nº 12.403.843/0001-18',
      'nº 12.403.843/0001-18',
      'N° 12.403.843/0001-18',
      'No. 12.403.843/0001-18',
      '12.403.843/0001-18 (matriz)',
      'Inscrição 12.403.843/0001-18',
    ]) {
      expect(normalizarCnpj(colado), colado).toBe('12403843000118')
      expect(mascaraCnpj(colado), colado).toBe('12.403.843/0001-18')
      const r = normalizarCliente({ tipo: 'PJ', nome: 'Padaria', documento: colado })
      expect(r.erros, colado).toEqual([])
      expect(r.valor.documento, colado).toBe('12.403.843/0001-18')
    }
    // O alfanumérico também pode vir com rótulo
    expect(mascaraCnpj('CNPJ: 12.ABC.345/01DE-35')).toBe('12.ABC.345/01DE-35')
    expect(mascaraCnpj('nº 12.abc.345/01de-35')).toBe('12.ABC.345/01DE-35')
    expect(mascaraCnpj('12.ABC.345/01DE-35 (filial)')).toBe('12.ABC.345/01DE-35')
    expect(cnpjValido('CNPJ: 12.ABC.345/01DE-35')).toBe(true)
    // Digitação parcial continua igual
    expect(mascaraCnpj('12.403')).toBe('12.403')
    expect(mascaraCnpj('n')).toBe('N')
  })

  it('cliente antigo com texto no lugar do CNPJ não vira um CNPJ com letras embaralhado', () => {
    const base = { id: 'c1', tipo: 'PJ', nome: 'Antiga' }
    expect(migrarCliente({ ...base, documento: 'isento' }).documento).toBe('')
    expect(migrarCliente({ ...base, documento: 'não informado' }).documento).toBe('')
    // Número incompleto fica como estava (só os algarismos)
    expect(migrarCliente({ ...base, documento: '12.403.843' }).documento).toBe('12.403.843')
    expect(migrarCliente({ ...base, documento: 'CNPJ 12403843000118' }).documento).toBe('12.403.843/0001-18')
    expect(migrarCliente({ ...base, documento: '12abc34501de35' }).documento).toBe('12.ABC.345/01DE-35')
  })
})

describe('CPF', () => {
  it('aceita CPFs válidos, com ou sem máscara', () => {
    expect(cpfValido('529.982.247-25')).toBe(true)
    expect(cpfValido('52998224725')).toBe(true)
    expect(cpfValido('111.444.777-35')).toBe(true)
  })

  it('recusa dígito verificador errado, tamanho errado e sequências repetidas', () => {
    expect(cpfValido('529.982.247-24')).toBe(false)
    expect(cpfValido('5299822472')).toBe(false)
    expect(cpfValido('529982247250')).toBe(false)
    expect(cpfValido('')).toBe(false)
    for (let d = 0; d <= 9; d++) expect(cpfValido(String(d).repeat(11))).toBe(false)
  })

  it('completa os dígitos verificadores a partir dos 9 primeiros', () => {
    expect(completarCpf('529982247')).toBe('52998224725')
    expect(completarCpf('111.444.777')).toBe('11144477735')
    for (const base of ['123456789', '000000001', '987654321']) expect(cpfValido(completarCpf(base))).toBe(true)
  })
})

describe('máscaras', () => {
  it('CNPJ é formatado conforme digita', () => {
    expect(mascaraCnpj('12')).toBe('12')
    expect(mascaraCnpj('124')).toBe('12.4')
    expect(mascaraCnpj('124038')).toBe('12.403.8')
    expect(mascaraCnpj('124038430')).toBe('12.403.843/0')
    expect(mascaraCnpj('1240384300011')).toBe('12.403.843/0001-1')
    expect(mascaraCnpj('12403843000118')).toBe('12.403.843/0001-18')
    expect(mascaraCnpj('12403843000118999')).toBe('12.403.843/0001-18')
    expect(mascaraCnpj('12.403.843/0001-18')).toBe('12.403.843/0001-18')
  })

  it('CPF é formatado conforme digita', () => {
    expect(mascaraCpf('529')).toBe('529')
    expect(mascaraCpf('5299')).toBe('529.9')
    expect(mascaraCpf('5299822')).toBe('529.982.2')
    expect(mascaraCpf('52998224725')).toBe('529.982.247-25')
    expect(mascaraCpf('5299822472599')).toBe('529.982.247-25')
  })

  it('documento conforme o tipo', () => {
    expect(mascaraDocumento('12403843000118', 'PJ')).toBe('12.403.843/0001-18')
    expect(mascaraDocumento('52998224725', 'PF')).toBe('529.982.247-25')
    // Trocar de PJ para PF corta o excesso
    expect(mascaraDocumento('12.403.843/0001-18', 'PF')).toBe('124.038.430-00')
  })

  it('CEP e telefone', () => {
    expect(mascaraCep('13500120')).toBe('13500-120')
    expect(mascaraCep('13500')).toBe('13500')
    expect(mascaraCep('135001209')).toBe('13500-120')
    expect(mascaraTelefone('')).toBe('')
    expect(mascaraTelefone('19')).toBe('(19')
    expect(mascaraTelefone('1981182225')).toBe('(19) 8118-2225')
    expect(mascaraTelefone('19981182225')).toBe('(19) 98118-2225')
  })

  it('somenteDigitos tolera vazio', () => {
    expect(somenteDigitos('12.403.843/0001-18')).toBe('12403843000118')
    expect(somenteDigitos(undefined as unknown as string)).toBe('')
  })
})
