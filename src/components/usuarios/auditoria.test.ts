import { describe, expect, it } from 'vitest'
import type { RegistroAuditoria } from '#shared/tipos.ts'
import { autorDoRegistro, descreverRegistro, enderecoDoLink, grupoDaAcao, textoDoAutor } from './auditoria'

const registro = (r: Partial<RegistroAuditoria>): RegistroAuditoria => ({
  id: 1,
  em: '2026-10-11T12:03:00.000Z',
  usuarioId: 'u1',
  login: 'maria',
  ip: '192.168.0.23',
  acao: 'ALTERACAO',
  alvo: '',
  detalhe: '',
  ...r,
})

describe('descreverRegistro', () => {
  it('gravação vira frase, com os campos do pagamento e o link do evento', () => {
    const d = descreverRegistro(registro({ alvo: 'e81', detalhe: 'PATCH /api/eventos/:id | pago,dataPagamento' }))
    expect(d.titulo).toBe('Alterou o evento (pagamento)')
    expect(d.link).toEqual({ tipo: 'evento', id: 'e81' })
    expect(enderecoDoLink(d.link!)).toBe('/eventos/e81')
  })

  it('PATCH sem campos usa o texto geral', () => {
    expect(descreverRegistro(registro({ alvo: 'e1', detalhe: 'PATCH /api/eventos/:id' })).titulo).toBe(
      'Alterou o evento (pagamento, devolução ou situação)',
    )
  })

  it('cliente, máquina e contrato têm link; exclusão e cadastro sem alvo, não', () => {
    expect(descreverRegistro(registro({ alvo: 'c1', detalhe: 'PUT /api/clientes/:id' })).link).toEqual({
      tipo: 'cliente',
      id: 'c1',
    })
    expect(enderecoDoLink({ tipo: 'contrato', id: 'k 1' })).toBe('/contratos?contrato=k%201')
    expect(descreverRegistro(registro({ alvo: 'e1', detalhe: 'DELETE /api/eventos/:id' }))).toEqual({
      titulo: 'Excluiu um evento',
      detalhe: '',
    })
    expect(descreverRegistro(registro({ detalhe: 'POST /api/clientes' })).link).toBeUndefined()
  })

  it('rota desconhecida aparece como a chave', () => {
    expect(descreverRegistro(registro({ detalhe: 'POST /api/novidade' })).titulo).toBe('POST /api/novidade')
  })

  it('acesso negado diz o que a pessoa tentou', () => {
    const d = descreverRegistro(registro({ acao: 'ACESSO_NEGADO', detalhe: 'DELETE /api/eventos/:id' }))
    expect(d.titulo).toBe('Ação recusada por falta de permissão')
    expect(d.detalhe).toBe('Tentou excluir um evento.')
  })

  it('ações sobre usuários mostram quem foi afetado', () => {
    const nomes = new Map([['u2', 'João Lima']])
    const d = descreverRegistro(
      registro({ acao: 'USUARIO_ALTERADO', alvo: 'u2', detalhe: 'joao: nível: Comum → Administrador' }),
      nomes,
    )
    expect(d).toEqual({ titulo: 'Alterou um usuário', detalhe: 'João Lima · joao: nível: Comum → Administrador' })
    expect(descreverRegistro(registro({ acao: 'LOGIN' }))).toEqual({ titulo: 'Entrou no sistema', detalhe: '' })
  })

  it('na própria conta não repete o nome de quem fez', () => {
    const nomes = new Map([['u2', 'João Lima']])
    const d = descreverRegistro(
      registro({ acao: 'SENHA_TROCADA', usuarioId: 'u2', alvo: 'u2', detalhe: 'senha temporária substituída' }),
      nomes,
    )
    expect(d).toEqual({ titulo: 'Trocou a própria senha', detalhe: 'senha temporária substituída' })
  })

  it('ferramenta do servidor: a conta ajustada vai no detalhe, mesmo sendo a do registro', () => {
    const nomes = new Map([['u2', 'Maria Souza']])
    const d = descreverRegistro(
      registro({
        acao: 'FERRAMENTA_LOCAL',
        usuarioId: 'u2',
        login: 'maria',
        alvo: 'u2',
        ip: 'local',
        detalhe: 'senha redefinida; nível: Comum → Administrador',
      }),
      nomes,
    )
    expect(d).toEqual({
      titulo: 'Ajuste de usuário no computador do servidor',
      detalhe: 'Maria Souza · senha redefinida; nível: Comum → Administrador',
    })
  })

  it('grupo de cada ação vem de GRUPOS_AUDITORIA', () => {
    expect(grupoDaAcao('LOGIN_FALHOU')).toBe('acessos')
    expect(grupoDaAcao('SENHA_REDEFINIDA')).toBe('usuarios')
    expect(grupoDaAcao('BACKUP_BAIXADO')).toBe('dados')
    expect(grupoDaAcao('ALTERACAO')).toBe('alteracoes')
  })
})

describe('autorDoRegistro (linha de baixo: quem fez)', () => {
  const nomes = new Map([['u1', 'Maria Souza']])
  const autor = (r: Partial<RegistroAuditoria>) => textoDoAutor(autorDoRegistro(registro(r), nomes))

  it('quem fez, com o login entre parênteses', () => {
    expect(autor({ acao: 'LOGIN' })).toBe('Maria Souza (maria)')
    expect(autor({ acao: 'LOGIN', usuarioId: 'excluido', login: 'jose' })).toBe('jose')
    expect(autor({ acao: 'LOGIN', usuarioId: '', login: '' })).toBe('—')
  })

  it('entrada recusada ou bloqueada: o usuário foi só o digitado, não quem tentou', () => {
    expect(autor({ acao: 'LOGIN_FALHOU' })).toBe('Tentativa com o usuário Maria Souza (maria)')
    expect(autor({ acao: 'BLOQUEIO', detalhe: '5 falhas seguidas do mesmo usuário neste computador' })).toBe(
      'Tentativa com o usuário Maria Souza (maria)',
    )
    expect(autor({ acao: 'LOGIN_FALHOU', usuarioId: 'excluido', login: 'jose' })).toBe('Tentativa com o usuário jose')
    expect(autor({ acao: 'LOGIN_FALHOU', usuarioId: '', login: '' })).toBe('Usuário inexistente')
    // A troca da própria senha só acontece com a pessoa logada
    expect(autor({ acao: 'BLOQUEIO', detalhe: 'senha atual errada várias vezes na troca de senha' })).toBe('Maria Souza (maria)')
  })

  it('ferramenta do servidor e cópia restaurada: no computador do servidor', () => {
    expect(autor({ acao: 'FERRAMENTA_LOCAL', alvo: 'u1', ip: 'local' })).toBe('No computador do servidor')
    expect(autor({ acao: 'COPIA_RESTAURADA', usuarioId: '', login: '', ip: 'local' })).toBe('No computador do servidor')
  })
})
