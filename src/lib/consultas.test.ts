import { describe, expect, it } from 'vitest'
import { CLIENTE_VAZIO, normalizarCliente } from '#shared/dominio.ts'
import type { Cliente, ClienteInput } from '#shared/tipos.ts'
import { ErroApi } from './api'
import {
  acharDuplicado,
  camposDoCnpj,
  camposMantidos,
  duplicadoDoErro,
  erroDeConsulta,
  mesclarCep,
  mesclarConsulta,
  trocarTipoCliente,
  valoresDaConsultaAnterior,
  type DadosCnpj,
} from './consultas'

const AGORA = '2026-10-01T12:00:00.000Z'

const empresaA: DadosCnpj = {
  cnpj: '12.403.843/0001-18',
  razaoSocial: 'PADARIA X LTDA',
  nomeFantasia: 'Padaria X',
  nomeSugerido: 'Padaria X',
  situacaoCadastral: 'ATIVA',
  dataAbertura: '2010-08-05',
  atividadePrincipal: 'Padaria',
  telefone: '(19) 3524-0000',
  email: 'contato@padariax.com.br',
  cep: '13500-120',
  logradouro: 'Rua 1',
  numero: '100',
  complemento: '',
  bairro: 'Centro',
  cidade: 'Rio Claro',
  uf: 'SP',
  fonte: 'BrasilAPI',
}

const empresaB: DadosCnpj = {
  ...empresaA,
  cnpj: '11.444.777/0001-61',
  razaoSocial: 'MERCADO Y LTDA',
  nomeFantasia: 'Mercado Y',
  nomeSugerido: 'Mercado Y',
  situacaoCadastral: 'BAIXADA',
  telefone: '',
  email: '',
  cep: '01001-000',
  logradouro: 'Praça da Sé',
  numero: '1',
  bairro: 'Sé',
  cidade: 'São Paulo',
}

const form = (p: Partial<ClienteInput> = {}): ClienteInput => ({ ...CLIENTE_VAZIO, ...p })

describe('mesclarConsulta', () => {
  it('consulta automática preenche só o que está vazio e preserva o que foi digitado', () => {
    const atual = form({ documento: empresaA.cnpj, nome: 'Padaria Ideal', telefone: '(19) 99999-0000' })
    const { form: novo, aplicados } = mesclarConsulta(atual, camposDoCnpj(empresaA, AGORA), {}, false)
    expect(novo.nome).toBe('Padaria Ideal')
    expect(novo.telefone).toBe('(19) 99999-0000')
    expect(novo.razaoSocial).toBe('PADARIA X LTDA')
    expect(novo.logradouro).toBe('Rua 1')
    expect(novo.situacaoCadastral).toBe('ATIVA')
    expect(aplicados).not.toHaveProperty('nome')
    expect(camposMantidos(novo, camposDoCnpj(empresaA, AGORA))).toEqual(['nome', 'telefone'])
    // Valor digitado igual ao da Receita não conta como mantido
    const igual = mesclarConsulta({ ...atual, nome: 'Padaria X' }, camposDoCnpj(empresaA, AGORA), {}, false)
    expect(camposMantidos(igual.form, camposDoCnpj(empresaA, AGORA))).toEqual(['telefone'])
  })

  it('"Consultar" (sobrescrever) troca tudo que veio preenchido', () => {
    const atual = form({ nome: 'Padaria Ideal', telefone: '(19) 99999-0000' })
    const { form: novo } = mesclarConsulta(atual, camposDoCnpj(empresaA, AGORA), {}, true)
    expect(novo.nome).toBe('Padaria X')
    expect(novo.telefone).toBe('(19) 3524-0000')
    expect(camposMantidos(novo, camposDoCnpj(empresaA, AGORA))).toEqual([])
  })

  it('no cadastro novo, trocar o CNPJ substitui o que veio da consulta anterior', () => {
    const r1 = mesclarConsulta(form(), camposDoCnpj(empresaA, AGORA), {}, false)
    const r2 = mesclarConsulta(r1.form, camposDoCnpj(empresaB, AGORA), r1.aplicados, false)
    expect(r2.form.razaoSocial).toBe('MERCADO Y LTDA')
    expect(r2.form.logradouro).toBe('Praça da Sé')
    // Vazio na consulta nova limpa o que tinha vindo da anterior
    expect(r2.form.telefone).toBe('')
  })

  it('na edição de cliente já consultado, trocar o CNPJ não mistura dados das duas empresas', () => {
    const salvo: Cliente = {
      ...form(camposDoCnpj(empresaA, '2026-01-01T00:00:00.000Z')),
      tipo: 'PJ',
      documento: empresaA.cnpj,
      nome: 'Padaria do João',
      id: 'c1',
      versao: 3,
      criadoEm: '2026-01-01T00:00:00.000Z',
      atualizadoEm: '2026-01-01T00:00:00.000Z',
    }
    const { id: _i, versao: _v, criadoEm: _c, atualizadoEm: _a, ...atual } = salvo
    const { form: novo } = mesclarConsulta(
      { ...atual, documento: empresaB.cnpj },
      camposDoCnpj(empresaB, AGORA),
      valoresDaConsultaAnterior(salvo),
      false,
    )
    expect(novo.razaoSocial).toBe('MERCADO Y LTDA')
    expect(novo).toMatchObject({ cep: '01001-000', logradouro: 'Praça da Sé', numero: '1', bairro: 'Sé', cidade: 'São Paulo' })
    expect(novo.situacaoCadastral).toBe('BAIXADA')
    // Nome de exibição e contato escolhidos à mão ficam
    expect(novo.nome).toBe('Padaria do João')
    expect(novo.telefone).toBe('(19) 3524-0000')
  })

  it('cliente que nunca foi consultado (ou não é empresa) não tem valores "da consulta"', () => {
    const base = { ...form({ razaoSocial: 'X' }), id: 'c', versao: 1, criadoEm: '', atualizadoEm: '' }
    expect(valoresDaConsultaAnterior(undefined)).toEqual({})
    expect(valoresDaConsultaAnterior({ ...base, tipo: 'PJ', consultadoEm: '' })).toEqual({})
    expect(valoresDaConsultaAnterior({ ...base, tipo: 'PF', consultadoEm: AGORA })).toEqual({})
    expect(valoresDaConsultaAnterior({ ...base, tipo: 'PJ', consultadoEm: AGORA })).toMatchObject({ razaoSocial: 'X' })
  })
})

describe('mesclarCep', () => {
  const comEndereco = { logradouro: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' }

  it('CEP geral de outra cidade limpa rua e bairro do endereço anterior', () => {
    const r = mesclarCep(comEndereco, { logradouro: '', bairro: '', cidade: 'Espírito Santo do Pinhal', uf: 'SP' })
    expect(r).toEqual({ logradouro: '', bairro: '', cidade: 'Espírito Santo do Pinhal', uf: 'SP' })
  })

  it('CEP geral da mesma cidade mantém o que foi digitado', () => {
    const r = mesclarCep({ ...comEndereco, cidade: 'sao paulo' }, { logradouro: '', bairro: '', cidade: 'São Paulo', uf: 'SP' })
    expect(r).toEqual({ logradouro: 'Praça da Sé', bairro: 'Sé', cidade: 'São Paulo', uf: 'SP' })
  })

  it('CEP com rua e bairro substitui o endereço', () => {
    const r = mesclarCep(comEndereco, { logradouro: 'Rua 1', bairro: 'Centro', cidade: 'Rio Claro', uf: 'SP' })
    expect(r).toEqual({ logradouro: 'Rua 1', bairro: 'Centro', cidade: 'Rio Claro', uf: 'SP' })
  })
})

describe('trocarTipoCliente', () => {
  const empresa = form({
    tipo: 'PJ',
    documento: '12.403.843/0001-18',
    razaoSocial: 'PADARIA X LTDA',
    responsavel: 'João',
    email: 'joao@',
    cep: '1350',
    logradouro: 'Rua 1',
    numero: '10',
    bairro: 'Centro',
    cidade: 'Rio Claro',
    uf: 'SP',
    situacaoCadastral: 'ATIVA',
    consultadoEm: AGORA,
    nome: 'Barraca do Zé',
  })

  it('para avulso, limpa o que some da tela: nada escondido impede salvar nem é gravado', () => {
    const avulso = trocarTipoCliente(empresa, 'AVULSO')
    expect(avulso).toMatchObject({
      tipo: 'AVULSO',
      documento: '',
      razaoSocial: '',
      responsavel: '',
      email: '',
      cep: '',
      logradouro: '',
      numero: '',
      bairro: '',
      situacaoCadastral: '',
      consultadoEm: '',
    })
    // Continua o que aparece para o avulso
    expect(avulso).toMatchObject({ nome: 'Barraca do Zé', cidade: 'Rio Claro' })
    expect(normalizarCliente(avulso).erros).toEqual([])
  })

  it('para pessoa física, limpa os dados de empresa e ajusta a máscara', () => {
    const pf = trocarTipoCliente({ ...empresa, email: 'joao@x.com', cep: '13500-120' }, 'PF')
    expect(pf).toMatchObject({ tipo: 'PF', responsavel: '', razaoSocial: '', documento: '124.038.430-00' })
    expect(pf.email).toBe('joao@x.com')
  })

  it('mesmo tipo não muda nada', () => {
    expect(trocarTipoCliente(empresa, 'PJ')).toBe(empresa)
  })
})

describe('CNPJ/CPF duplicado', () => {
  const clientes = [
    { id: 'a', documento: '12.403.843/0001-18', nome: 'Padaria X' },
    { id: 'b', documento: '12.ABC.345/01DE-35', nome: 'Nova Empresa' },
    { id: 'c', documento: '', nome: 'Avulso' },
  ]

  it('acha outro cliente com o mesmo documento, com ou sem máscara', () => {
    expect(acharDuplicado(clientes, '12403843000118')?.id).toBe('a')
    expect(acharDuplicado(clientes, '12.abc.345/01de-35')?.id).toBe('b')
    expect(acharDuplicado(clientes, '12403843000118', 'a')).toBeUndefined()
    expect(acharDuplicado(clientes, '')).toBeUndefined()
    expect(acharDuplicado(clientes, '11.444.777/0001-61')).toBeUndefined()
  })

  it('distingue o 409 de duplicidade do 409 de conflito de versão', () => {
    const dup = new ErroApi(409, 'Já existe um cliente com este CNPJ/CPF: Padaria X.', {
      erro: 'Já existe…',
      duplicado: { id: 'a', nome: 'Padaria X' },
    })
    expect(duplicadoDoErro(dup)).toEqual({ id: 'a', nome: 'Padaria X' })
    expect(duplicadoDoErro(new ErroApi(409, 'Conflito', { atual: { id: 'a', versao: 2 } }))).toBeNull()
    expect(duplicadoDoErro(new ErroApi(400, 'x', { duplicado: { id: 'a' } }))).toBeNull()
    expect(duplicadoDoErro(new Error('x'))).toBeNull()
  })
})

describe('erroDeConsulta', () => {
  it('CNPJ alfanumérico que os serviços não reconhecem tem tipo próprio (sem "tentar de novo")', () => {
    const e = new ErroApi(404, 'Os serviços de consulta ainda não reconhecem…', { motivo: 'cnpj_alfanumerico' })
    expect(erroDeConsulta(e, 'CNPJ')).toEqual({ tipo: 'naoSuportado', mensagem: e.message })
    expect(erroDeConsulta(new ErroApi(404, 'CNPJ não encontrado na Receita Federal.'), 'CNPJ').tipo).toBe('naoEncontrado')
  })
})
