import { describe, expect, it } from 'vitest'
import { SENHAS_COMUNS } from './senhasComuns.ts'
import type { AcaoAuditoria } from './tipos.ts'
import {
  GRUPOS_AUDITORIA,
  normalizarAlteracaoUsuario,
  normalizarLogin,
  normalizarNovoUsuario,
  ROTULO_ACAO_AUDITORIA,
  ROTULO_GRUPO_AUDITORIA,
  SENHA_MAX,
  SENHA_MIN,
  sugerirLogin,
  validarLogin,
  validarSenhaNova,
} from './usuarios.ts'

const MSG_LOGIN = 'Use de 3 a 32 letras sem acento, números, ponto, hífen ou sublinhado, sem espaços.'
const MSG = {
  tamanho: 'A senha precisa ter de 8 a 128 caracteres.',
  comum: 'Essa senha é muito comum. Use uma frase de 3 ou 4 palavras.',
  login: 'A senha não pode conter o seu nome de usuário.',
  sistema: 'A senha não pode conter o nome do sistema.',
  nome: 'A senha não pode conter o seu nome.',
  repetido: 'A senha não pode ser um caractere repetido.',
  sequencia: 'A senha não pode ser uma sequência (como 1234567890).',
}
const maria = { login: 'maria.souza', nome: 'Maria Souza' }

describe('login', () => {
  it('normaliza: minúsculo, sem espaços nas pontas, só texto', () => {
    expect(normalizarLogin('  Maria.Souza ')).toBe('maria.souza')
    expect(normalizarLogin(123)).toBe('123')
    expect(normalizarLogin(undefined)).toBe('')
    expect(normalizarLogin(null)).toBe('')
    expect(normalizarLogin(['maria'])).toBe('')
    expect(normalizarLogin({ login: 'maria' })).toBe('')
  })

  it('aceita de 3 a 32 letras sem acento, números, ponto, hífen e sublinhado', () => {
    for (const ok of ['ana', 'maria.souza', 'joao_lima', 'recepcao-2', '1caixa', 'a'.repeat(32)])
      expect(validarLogin(ok), ok).toBeNull()
    for (const ruim of ['', 'ab', 'a'.repeat(33), 'maria souza', 'joão', '.maria', '-ana', '_ana', 'Maria', 'ana@bc', 'ana/1'])
      expect(validarLogin(ruim), ruim).toBe(MSG_LOGIN)
  })

  it('sugere o primeiro e o último nome, sem acentos', () => {
    expect(sugerirLogin('Maria Souza')).toBe('maria.souza')
    expect(sugerirLogin('  João da Silva  ')).toBe('joao.silva')
    expect(sugerirLogin('Conceição')).toBe('conceicao')
    expect(sugerirLogin("Maria D'Ávila")).toBe('maria.davila')
    expect(sugerirLogin('Recepção 2')).toBe('recepcao.2')
    expect(sugerirLogin('Ana-Lúcia Prado')).toBe('analucia.prado')
  })

  it('sugestão corta em 32 caracteres e devolve vazio quando não dá', () => {
    const longa = sugerirLogin('Bartolomeuzinhodasilvasauro Albuquerquemaranhao')
    expect(longa.length).toBeLessThanOrEqual(32)
    expect(validarLogin(longa)).toBeNull()
    expect(sugerirLogin('Abcdefghijklmnopqrstuvwxyzabcde Souza')).toBe('abcdefghijklmnopqrstuvwxyzabcde')
    expect(sugerirLogin('')).toBe('')
    expect(sugerirLogin('   ')).toBe('')
    expect(sugerirLogin('Li')).toBe('')
    expect(sugerirLogin('李明')).toBe('')
    expect(sugerirLogin('!!! ???')).toBe('')
  })
})

describe('política de senha', () => {
  it('aceita frases e senhas longas sem regra de composição', () => {
    expect(validarSenhaNova('cavalo bateria grampo certo', maria)).toBeNull()
    expect(validarSenhaNova('tomate azul na janela', maria)).toBeNull()
    expect(validarSenhaNova('x'.repeat(7) + 'y', maria)).toBeNull()
    expect(validarSenhaNova('ç'.repeat(SENHA_MAX - 1) + 'a', maria)).toBeNull()
  })

  it('tamanho de 8 a 128, contado em caracteres (NFC)', () => {
    expect(SENHA_MIN).toBe(8)
    expect(SENHA_MAX).toBe(128)
    expect(validarSenhaNova('', maria)).toBe(MSG.tamanho)
    expect(validarSenhaNova('tomate7', maria)).toBe(MSG.tamanho)
    expect(validarSenhaNova('tomate7!', maria)).toBeNull()
    expect(validarSenhaNova('a'.repeat(64) + 'b'.repeat(65), maria)).toBe(MSG.tamanho)
    expect(validarSenhaNova('a'.repeat(64) + 'b'.repeat(64), maria)).toBeNull()
    // "é" decomposto (e + acento) conta como 1 caractere depois da normalização
    const decomposto = 'café pa'
    expect([...decomposto].length).toBe(8)
    expect(validarSenhaNova(decomposto, maria)).toBe(MSG.tamanho)
    expect(validarSenhaNova('café pao', maria)).toBeNull()
    expect(validarSenhaNova('café pa', maria)).toBe(MSG.tamanho)
    // Emoji conta como 1
    expect(validarSenhaNova('🔑🔑🔑🔑🔑🔑🔑', maria)).toBe(MSG.tamanho)
  })

  it('recusa senhas comuns, sem diferenciar maiúsculas', () => {
    for (const s of ['1234567890', 'senha12345', 'qwertyuiop', 'mudar12345', 'brasil2026', 'flamengo123', 'password123'])
      expect(validarSenhaNova(s, maria), s).toBe(MSG.comum)
    expect(validarSenhaNova('Senha12345', maria)).toBe(MSG.comum)
    expect(validarSenhaNova('PASSWORD123', maria)).toBe(MSG.comum)
  })

  it('a lista de senhas comuns tem só minúsculas com o tamanho mínimo', () => {
    expect(SENHAS_COMUNS.size).toBeGreaterThanOrEqual(200)
    for (const s of SENHAS_COMUNS) {
      expect(s, s).toBe(s.toLowerCase())
      expect([...s].length, s).toBeGreaterThanOrEqual(SENHA_MIN)
    }
  })

  it('recusa o nome de usuário dentro da senha (com 3 caracteres ou mais)', () => {
    expect(validarSenhaNova('eu sou maria.souza', maria)).toBe(MSG.login)
    expect(validarSenhaNova('xxJOAOxxyy', { login: 'joao', nome: 'J' })).toBe(MSG.login)
    expect(validarSenhaNova('banana split', { login: 'ana', nome: 'A' })).toBe(MSG.login)
    // Login curto demais não conta
    expect(validarSenhaNova('ab ab ab ab', { login: 'ab', nome: '' })).toBeNull()
  })

  it('recusa o nome do sistema', () => {
    expect(validarSenhaNova('bcfichas2026', maria)).toBe(MSG.sistema)
    expect(validarSenhaNova('Minhas Fichas Boas', maria)).toBe(MSG.sistema)
    expect(validarSenhaNova('fíchas da festa', maria)).toBe(MSG.sistema)
  })

  it('recusa uma palavra inteira do nome com 4 letras ou mais, sem acento', () => {
    expect(validarSenhaNova('souza e cia ltda', maria)).toBe(MSG.nome)
    expect(validarSenhaNova('SOUZAMARIA!', { login: 'msz', nome: 'Maria Souza' })).toBe(MSG.nome)
    expect(validarSenhaNova('joao gosta de pao', { login: 'jl', nome: 'João Lima' })).toBe(MSG.nome)
    expect(validarSenhaNova('limão com sal', { login: 'jl', nome: 'João Lima' })).toBe(MSG.nome)
    expect(validarSenhaNova('JOÃO na praia', { login: 'jl', nome: 'Joao Lima' })).toBe(MSG.nome)
    // Palavras com menos de 4 letras não contam ("da", "Ana")
    expect(validarSenhaNova('ana da praia azul', { login: 'xyz', nome: 'Ana da Praia' })).toBe(MSG.nome)
    expect(validarSenhaNova('ana da costa azul', { login: 'xyz', nome: 'Ana da Praia' })).toBeNull()
  })

  it('recusa caractere repetido', () => {
    expect(validarSenhaNova('%%%%%%%%%%', maria)).toBe(MSG.repetido)
    expect(validarSenhaNova('ççççççççç', maria)).toBe(MSG.repetido)
  })

  it('recusa sequências crescentes ou decrescentes', () => {
    for (const s of ['23456789', '0987654321', 'ABCDEFGHIJK', 'zyxwvutsrq', 'wertyuio', 'poiuytrewq', 'sdfghjkl', 'lkjhgfdsa'])
      expect(validarSenhaNova(s, maria), s).toBe(MSG.sequencia)
    expect(validarSenhaNova('13572468', maria)).toBeNull()
  })

  it('devolve o primeiro problema, na ordem da política', () => {
    // comum antes de conter o login
    expect(validarSenhaNova('password123', { login: 'pass', nome: '' })).toBe(MSG.comum)
    // login antes do nome do sistema
    expect(validarSenhaNova('maria.souza fichas', maria)).toBe(MSG.login)
    // nome do sistema antes do nome da pessoa
    expect(validarSenhaNova('fichas da maria', maria)).toBe(MSG.sistema)
  })
})

describe('normalização das entradas', () => {
  it('novo usuário', () => {
    const r = normalizarNovoUsuario({ nome: '  Maria \n  Souza ', login: ' Maria.Souza ', nivel: 'ADMIN', senha: '' })
    expect(r.erros).toEqual([])
    expect(r.valor).toEqual({ nome: 'Maria Souza', login: 'maria.souza', nivel: 'ADMIN', senha: '' })
  })

  it('novo usuário: nível inválido vira comum e senha vazia é aceita', () => {
    const r = normalizarNovoUsuario({ nome: 'João Lima', login: 'joao', nivel: 'DONO' })
    expect(r.erros).toEqual([])
    expect(r.valor).toEqual({ nome: 'João Lima', login: 'joao', nivel: 'COMUM', senha: '' })
  })

  it('novo usuário: valida nome, login e senha digitada', () => {
    expect(normalizarNovoUsuario({}).erros).toEqual(['Informe o nome da pessoa.', MSG_LOGIN])
    expect(normalizarNovoUsuario(null).erros).toHaveLength(2)
    expect(normalizarNovoUsuario({ nome: 'a'.repeat(61), login: 'ana' }).erros).toEqual(['O nome pode ter até 60 caracteres.'])
    expect(normalizarNovoUsuario({ nome: 'á'.repeat(60), login: 'ana' }).erros).toEqual([])
    expect(normalizarNovoUsuario({ nome: 'João Lima', login: 'joão' }).erros).toEqual([MSG_LOGIN])
    expect(normalizarNovoUsuario({ nome: 'João Lima', login: 'joao', senha: 'curta' }).erros).toEqual([MSG.tamanho])
    expect(normalizarNovoUsuario({ nome: 'João Lima', login: 'joao', senha: 'o joao chegou' }).erros).toEqual([MSG.login])
    expect(normalizarNovoUsuario({ nome: 'João Lima', login: 'jlm', senha: 'lima da pérsia' }).erros).toEqual([MSG.nome])
    const ok = normalizarNovoUsuario({ nome: 'João Lima', login: 'joao', senha: 'tomate azul na janela' })
    expect(ok.erros).toEqual([])
    expect(ok.valor.senha).toBe('tomate azul na janela')
  })

  it('novo usuário: caracteres de controle no nome', () => {
    expect(normalizarNovoUsuario({ nome: 'Ma​ria\tSouza\u0000', login: 'maria' }).valor.nome).toBe('Maria Souza')
  })

  it('alteração: só os campos presentes', () => {
    expect(normalizarAlteracaoUsuario({})).toEqual({ valor: {}, erros: [] })
    expect(normalizarAlteracaoUsuario({ nivel: 'ADMIN', versao: 3 })).toEqual({ valor: { nivel: 'ADMIN', versao: 3 }, erros: [] })
    expect(normalizarAlteracaoUsuario({ nome: ' Ana  Prado ', ativo: false, login: 'outro' })).toEqual({
      valor: { nome: 'Ana Prado', ativo: false },
      erros: [],
    })
  })

  it('alteração: nível, situação, versão e nome inválidos são erro', () => {
    expect(normalizarAlteracaoUsuario({ nivel: 'DONO' }).erros).toEqual(['Nível inválido. Escolha Administrador ou Comum.'])
    expect(normalizarAlteracaoUsuario({ nivel: 'DONO' }).valor).toEqual({})
    expect(normalizarAlteracaoUsuario({ ativo: 'sim' }).erros).toHaveLength(1)
    expect(normalizarAlteracaoUsuario({ versao: 1.5 }).erros).toHaveLength(1)
    expect(normalizarAlteracaoUsuario({ versao: '2' }).erros).toHaveLength(1)
    expect(normalizarAlteracaoUsuario({ versao: 0 }).erros).toHaveLength(1)
    expect(normalizarAlteracaoUsuario({ nome: '' }).erros).toEqual(['Informe o nome da pessoa.'])
  })
})

describe('registro de atividades', () => {
  const TODAS: AcaoAuditoria[] = Object.keys(ROTULO_ACAO_AUDITORIA) as AcaoAuditoria[]

  it('cada ação está em exatamente um grupo', () => {
    const nosGrupos = Object.values(GRUPOS_AUDITORIA).flat()
    expect(nosGrupos.length).toBe(TODAS.length)
    expect([...nosGrupos].sort()).toEqual([...TODAS].sort())
    expect(GRUPOS_AUDITORIA.alteracoes).toEqual(['ALTERACAO'])
    expect(GRUPOS_AUDITORIA.acessos).toEqual(['LOGIN', 'LOGIN_FALHOU', 'BLOQUEIO', 'LOGOUT', 'ACESSO_NEGADO'])
  })

  it('rótulos para as ações e para os grupos', () => {
    expect(TODAS).toHaveLength(18)
    for (const a of TODAS) expect(ROTULO_ACAO_AUDITORIA[a].length, a).toBeGreaterThan(3)
    expect(Object.keys(ROTULO_GRUPO_AUDITORIA).sort()).toEqual(Object.keys(GRUPOS_AUDITORIA).sort())
  })
})
