import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cliente, Evento, RegistroAuditoria, ResultadoSenha, Usuario, UsuarioSessao } from '#shared/tipos.ts'
import { criarAppComLogin, SENHA_ADMIN, SENHA_COMUM, type AppComLogin } from './auxiliaresTeste.ts'
import { abrirBanco } from './db.ts'
import { ErroApi } from './erros.ts'
import * as senha from './senha.ts'
import { hashToken, PARAMETROS_LEVES } from './senha.ts'
import { ehLoopback, ServicoUsuarios, transplantarUsuarios } from './usuarios.ts'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

let t: AppComLogin

beforeEach(async () => {
  t = await criarAppComLogin()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await t.fechar()
})

const statusDados = async (cookie: string | null) => (await t.chamar('GET', '/api/dados', { cookie })).statusCode
const auditoria = (acao?: string) =>
  (t.ctx.db.prepare('SELECT * FROM auditoria ORDER BY id').all() as unknown as Array<Record<string, string>>).filter(
    (r) => !acao || r.acao === acao,
  )
const adminFicticio: UsuarioSessao = { id: 'outro-admin', login: 'outro', nome: 'Outro', nivel: 'ADMIN', trocarSenha: false }

async function erroDe(p: Promise<unknown> | (() => unknown)): Promise<ErroApi> {
  try {
    await (typeof p === 'function' ? p() : p)
  } catch (e) {
    if (e instanceof ErroApi) return e
    throw e
  }
  throw new Error('deveria ter dado erro')
}

describe('entrar', () => {
  it('exige o cabeçalho do app (CSRF)', async () => {
    const r = await t.app.inject({ method: 'POST', url: '/api/sessao', payload: { login: 'admin', senha: SENHA_ADMIN } })
    expect(r.statusCode).toBe(403)
  })

  it('senha errada e usuário inexistente dão a mesma resposta 401', async () => {
    const errada = await t.entrar('admin', 'senha-errada-aqui')
    const inexistente = await t.entrar('ninguem', 'senha-errada-aqui')
    expect(errada.status).toBe(401)
    expect(inexistente.status).toBe(401)
    expect(errada.resposta.json()).toEqual({ erro: 'Usuário ou senha incorretos.', codigo: 'CREDENCIAIS_INVALIDAS' })
    expect(inexistente.resposta.json()).toEqual(errada.resposta.json())
    expect(errada.cookie).toBeNull()
    expect((await t.chamar('POST', '/api/sessao', { payload: { login: 'admin' } })).statusCode).toBe(400)
  })

  it('a 6ª falha seguida do mesmo par dá 429 com Retry-After (sem conferir a senha), exista o login ou não', async () => {
    for (const login of ['comum', 'nao-existe']) {
      for (let i = 0; i < 5; i++) expect((await t.entrar(login, 'senha-errada-aqui')).status).toBe(401)
      const espiao = vi.spyOn(senha, 'conferirSenha')
      const bloqueado = await t.entrar(login, login === 'comum' ? SENHA_COMUM : 'qualquer-coisa')
      expect(bloqueado.status).toBe(429)
      // Com o bloqueio ativo, o scrypt nem roda (não gasta o processador de quem tenta em série)
      expect(espiao).not.toHaveBeenCalled()
      espiao.mockRestore()
      expect(bloqueado.resposta.headers['retry-after']).toBe('30')
      expect(bloqueado.resposta.json()).toEqual({
        erro: 'Muitas tentativas. Tente de novo em 1 minuto.',
        codigo: 'MUITAS_TENTATIVAS',
        esperarSegundos: 30,
      })
    }
    // De outro computador, o mesmo login continua entrando
    expect((await t.entrar('comum', SENHA_COMUM, { remoteAddress: '192.168.0.40' })).status).toBe(200)
  })

  it('um acerto zera as falhas seguidas do par', async () => {
    for (let i = 0; i < 4; i++) await t.entrar('comum', 'senha-errada-aqui')
    expect((await t.entrar('comum', SENHA_COMUM)).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await t.entrar('comum', 'senha-errada-aqui')).status).toBe(401)
    expect((await t.entrar('comum', SENHA_COMUM)).status).toBe(200)
  })

  it('20 falhas de um IP em logins diferentes bloqueiam esse IP, e a resposta diz que é o computador', async () => {
    const ip = '192.168.0.30'
    for (let i = 0; i < 20; i++)
      expect((await t.entrar(`login${i % 5}`, 'senha-errada-aqui', { remoteAddress: ip })).status).toBe(401)
    const bloqueado = await t.entrar('admin', SENHA_ADMIN, { remoteAddress: ip })
    expect(bloqueado.status).toBe(429)
    expect(bloqueado.resposta.json()).toEqual({
      erro: 'Muitas tentativas erradas neste computador. Tente de novo em 15 minutos ou entre por outro computador.',
      codigo: 'MUITAS_TENTATIVAS',
      esperarSegundos: 900,
      motivo: 'computador',
    })
    // Redefinir a senha destrava a conta, mas não o computador (o teto por IP continua de propósito)
    await t.usuarios.definirSenhaLocal({ login: 'admin', senha: 'outra-frase-boa' })
    expect((await t.entrar('admin', 'outra-frase-boa', { remoteAddress: ip })).resposta.json()).toMatchObject({
      motivo: 'computador',
    })
    expect((await t.entrar('admin', 'outra-frase-boa', { remoteAddress: '192.168.0.31' })).status).toBe(200)
  })

  it('50 falhas do mesmo login de vários IPs bloqueiam o login, mas não pelo próprio servidor', async () => {
    for (let i = 0; i < 50; i++)
      expect((await t.entrar('comum', 'senha-errada-aqui', { remoteAddress: `10.0.${Math.floor(i / 4)}.1` })).status).toBe(401)
    expect((await t.entrar('comum', SENHA_COMUM, { remoteAddress: '10.0.99.1' })).status).toBe(429)
    expect((await t.entrar('comum', SENHA_COMUM, { remoteAddress: '127.0.0.1' })).status).toBe(200)
    expect((await t.entrar('comum', SENHA_COMUM, { remoteAddress: '::1' })).status).toBe(200)
  })

  it('a ferramenta local (senha redefinida) destrava o bloqueio sem reiniciar', async () => {
    const ip = '10.1.1.1'
    for (let i = 0; i < 5; i++) await t.entrar('comum', 'senha-errada-aqui', { remoteAddress: ip })
    expect((await t.entrar('comum', SENHA_COMUM, { remoteAddress: ip })).status).toBe(429)
    await t.usuarios.definirSenhaLocal({ login: 'comum', senha: 'outra-frase-boa' })
    expect((await t.entrar('comum', 'outra-frase-boa', { remoteAddress: ip })).status).toBe(200)
  })

  it('cookie HttpOnly e SameSite=Strict, sem Secure; "manter conectado" dá Max-Age (30 dias; 7 para o administrador)', async () => {
    const normal = await t.entrar('comum', SENHA_COMUM)
    expect(normal.resposta.headers['set-cookie']).toMatch(/^bcf_sessao=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict$/)
    expect(normal.resposta.json()).toEqual({
      usuario: { id: t.comumId, login: 'comum', nome: 'Comum Teste', nivel: 'COMUM', trocarSenha: false },
      build: '',
    })
    const comum = await t.entrar('comum', SENHA_COMUM, { manterConectado: true })
    expect(comum.resposta.headers['set-cookie']).toMatch(/; HttpOnly; SameSite=Strict; Max-Age=2592000$/)
    const admin = await t.entrar('admin', SENHA_ADMIN, { manterConectado: true })
    expect(admin.resposta.headers['set-cookie']).toMatch(/; Max-Age=604800$/)
    expect(String(admin.resposta.headers['set-cookie'])).not.toMatch(/Secure|Domain/i)
    // GET /api/sessao diz se a sessão é "manter conectado" (a janela "Sua sessão terminou" repete a escolha)
    const sessao = async (cookie: string | null) => (await t.chamar('GET', '/api/sessao', { cookie })).json()
    expect(await sessao(comum.cookie)).toMatchObject({ usuario: { login: 'comum' }, persistente: true })
    expect(await sessao(normal.cookie)).toMatchObject({ usuario: { login: 'comum' }, persistente: false })
    expect(await sessao(null)).not.toHaveProperty('persistente')
  })

  it('com a porta, o cookie se chama bcf_sessao_<porta>', async () => {
    const outro = await criarAppComLogin({ porta: 3000 })
    try {
      const r = await outro.entrar('admin', SENHA_ADMIN)
      expect(r.resposta.headers['set-cookie']).toMatch(/^bcf_sessao_3000=/)
      expect((await outro.chamar('GET', '/api/dados', { cookie: outro.cookieAdmin })).statusCode).toBe(200)
      // O cookie com o nome de outra porta não vale aqui
      const r2 = await outro.app.inject({ method: 'GET', url: '/api/dados', cookies: { bcf_sessao: outro.cookieAdmin } })
      expect(r2.statusCode).toBe(401)
    } finally {
      await outro.fechar()
    }
  })

  it('login em maiúsculas e com espaços nas pontas funciona', async () => {
    expect((await t.entrar('ADMIN', SENHA_ADMIN)).status).toBe(200)
    expect((await t.entrar('  Comum ', SENHA_COMUM)).status).toBe(200)
  })

  it('conta desativada: 403 só depois de a senha conferir', async () => {
    await t.chamar('PUT', `/api/usuarios/${t.comumId}`, { cookie: t.cookieAdmin, payload: { ativo: false } })
    const certo = await t.entrar('comum', SENHA_COMUM)
    expect(certo.status).toBe(403)
    expect(certo.resposta.json()).toEqual({ erro: 'Usuário desativado. Fale com o administrador.', codigo: 'DESATIVADO' })
    expect((await t.entrar('comum', 'senha-errada-aqui')).status).toBe(401)
  })

  it('corpo com mais de 8 KB: 413', async () => {
    const r = await t.chamar('POST', '/api/sessao', { payload: { login: 'admin', senha: 'x'.repeat(9000) } })
    expect(r.statusCode).toBe(413)
  })

  it('entrar de novo com o cookie de uma sessão: a anterior deixa de valer', async () => {
    const anterior = await t.cookieDe('comum', SENHA_COMUM)
    const nova = await t.cookieDe('admin', SENHA_ADMIN, { cookie: anterior })
    expect(nova).not.toBe(anterior)
    expect(await statusDados(anterior)).toBe(401)
    expect(await statusDados(nova)).toBe(200)
  })
})

describe('sessão', () => {
  let agora: number
  beforeEach(() => {
    agora = Date.now()
    t.usuarios.agora = () => agora
  })

  it('normal: vence com 4 h sem uso; os GETs (dados, sessão sem uso) não renovam', async () => {
    const c = await t.cookieDe('comum', SENHA_COMUM)
    agora += 2 * HORA
    expect(await statusDados(c)).toBe(200)
    expect((await t.chamar('GET', '/api/sessao', { cookie: c })).json().usuario.login).toBe('comum')
    agora += 2 * HORA - 1000
    expect(await statusDados(c)).toBe(200)
    agora += 2000
    expect(await statusDados(c)).toBe(401)
  })

  it('POST e GET /api/sessao?uso=1 renovam; no total, 12 h', async () => {
    const t0 = agora
    const c = await t.cookieDe('comum', SENHA_COMUM)
    agora = t0 + 3 * HORA
    expect((await t.chamar('GET', '/api/sessao?uso=1', { cookie: c })).json().usuario.login).toBe('comum')
    agora = t0 + 6 * HORA + 59 * MINUTO
    expect(await statusDados(c)).toBe(200) // renovado às 3 h
    expect(
      (await t.chamar('POST', '/api/clientes', { cookie: c, payload: { tipo: 'AVULSO', nome: 'Barraca' } })).statusCode,
    ).toBe(201)
    agora = t0 + 10 * HORA
    expect(await statusDados(c)).toBe(200) // renovado pelo POST
    expect((await t.chamar('GET', '/api/sessao?uso=1', { cookie: c })).statusCode).toBe(200)
    agora = t0 + 12 * HORA - 1000
    expect(await statusDados(c)).toBe(200)
    agora = t0 + 12 * HORA + 1000
    expect(await statusDados(c)).toBe(401)
  })

  it('"manter conectado": 7 dias sem uso e 30 dias no total; administrador, 7 dias no total', async () => {
    const t0 = agora
    const parado = await t.cookieDe('comum', SENHA_COMUM, { manterConectado: true })
    const ativo = await t.cookieDe('comum', SENHA_COMUM, { manterConectado: true })
    const admin = await t.cookieDe('admin', SENHA_ADMIN, { manterConectado: true })
    for (const dia of [6, 12, 18, 24]) {
      agora = t0 + dia * DIA
      expect((await t.chamar('GET', '/api/sessao?uso=1', { cookie: ativo })).json().usuario).not.toBeNull()
      if (dia === 6) expect((await t.chamar('GET', '/api/sessao?uso=1', { cookie: admin })).json().usuario).not.toBeNull()
      if (dia === 6) expect(await statusDados(parado)).toBe(200)
    }
    agora = t0 + 7 * DIA + 1000
    expect(await statusDados(admin)).toBe(401) // administrador: no máximo 7 dias, mesmo em uso
    agora = t0 + 12 * DIA
    expect(await statusDados(parado)).toBe(401) // 7 dias sem uso
    agora = t0 + 30 * DIA - 1000
    expect(await statusDados(ativo)).toBe(200)
    agora = t0 + 30 * DIA + 1000
    expect(await statusDados(ativo)).toBe(401)
  })

  it('limparVencidas apaga as vencidas por inatividade e as de conta desativada', async () => {
    t.ctx.db.exec('DELETE FROM sessoes')
    const admin = await t.cookieDe('admin', SENHA_ADMIN)
    await t.cookieDe('comum', SENHA_COMUM)
    await t.cookieDe('comum', SENHA_COMUM)
    t.ctx.db.prepare("UPDATE usuarios SET ativo = 0 WHERE login = 'comum'").run() // ex.: ferramenta ou corrida
    const desativadas = t.usuarios.limparVencidas()
    expect(desativadas).toHaveLength(2)
    expect(await statusDados(admin)).toBe(200)
    agora += 4 * HORA + 1000
    expect(t.usuarios.limparVencidas()).toEqual([hashToken(admin)])
    expect(t.ctx.db.prepare('SELECT COUNT(*) AS n FROM sessoes').get()).toEqual({ n: 0 })
  })

  it('sair invalida o cookie e é idempotente', async () => {
    const c = await t.cookieDe('comum', SENHA_COMUM)
    const sair = await t.chamar('DELETE', '/api/sessao', { cookie: c })
    expect(sair.statusCode).toBe(204)
    expect(sair.headers['set-cookie']).toBe('bcf_sessao=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
    expect(await statusDados(c)).toBe(401)
    expect((await t.chamar('DELETE', '/api/sessao', { cookie: c })).statusCode).toBe(204)
    expect((await t.chamar('DELETE', '/api/sessao')).statusCode).toBe(204)
    expect(auditoria('LOGOUT')).toHaveLength(1)
  })

  it('o banco guarda só o SHA-256 do token', async () => {
    const c = await t.cookieDe('comum', SENHA_COMUM)
    const ids = (t.ctx.db.prepare('SELECT id FROM sessoes').all() as Array<{ id: string }>).map((l) => l.id)
    expect(ids).toContain(hashToken(c))
    expect(JSON.stringify(t.ctx.db.prepare('SELECT * FROM sessoes').all())).not.toContain(c)
    expect(JSON.stringify(t.ctx.db.prepare('SELECT * FROM auditoria').all())).not.toContain(c)
  })

  it('GET /api/sessao com cookie inválido manda apagar o cookie', async () => {
    const r = await t.chamar('GET', '/api/sessao', { cookie: 'token-que-nao-existe' })
    expect(r.json()).toEqual({ usuario: null, semUsuarios: false, build: '' })
    expect(r.headers['set-cookie']).toBe('bcf_sessao=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
    // Sem cookie, nada a apagar
    expect((await t.chamar('GET', '/api/sessao')).headers['set-cookie']).toBeUndefined()
  })
})

describe('revogação', () => {
  const comoAdmin = (metodo: 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    t.chamar(metodo, url, { cookie: t.cookieAdmin, payload })

  it('desativar, mudar o nível, redefinir a senha, encerrar sessões e excluir derrubam o cookie na hora', async () => {
    const id = t.comumId
    let c = await t.cookieDe('comum', SENHA_COMUM)
    expect((await comoAdmin('PUT', `/api/usuarios/${id}`, { ativo: false })).statusCode).toBe(200)
    expect(await statusDados(c)).toBe(401)
    await comoAdmin('PUT', `/api/usuarios/${id}`, { ativo: true })

    c = await t.cookieDe('comum', SENHA_COMUM)
    expect((await comoAdmin('PUT', `/api/usuarios/${id}`, { nivel: 'ADMIN' })).statusCode).toBe(200)
    expect(await statusDados(c)).toBe(401)
    await comoAdmin('PUT', `/api/usuarios/${id}`, { nivel: 'COMUM' })

    c = await t.cookieDe('comum', SENHA_COMUM)
    const redefinida = await comoAdmin('POST', `/api/usuarios/${id}/senha`, {})
    expect(redefinida.statusCode).toBe(200)
    expect(redefinida.json().senhaTemporaria).toMatch(/^\w{4}-\w{4}-\w{4}$/)
    expect(await statusDados(c)).toBe(401)
    await t.usuarios.definirSenhaLocal({ login: 'comum', senha: SENHA_COMUM })

    c = await t.cookieDe('comum', SENHA_COMUM)
    const encerrar = await comoAdmin('DELETE', `/api/usuarios/${id}/sessoes`)
    expect(encerrar.statusCode).toBe(200)
    expect(encerrar.json().usuario).toMatchObject({ id, sessoesAtivas: 0 })
    expect(await statusDados(c)).toBe(401)

    c = await t.cookieDe('comum', SENHA_COMUM)
    expect((await comoAdmin('DELETE', `/api/usuarios/${id}`)).statusCode).toBe(204)
    expect(await statusDados(c)).toBe(401)
    expect((await t.entrar('comum', SENHA_COMUM)).status).toBe(401)
  })

  it('mudar só o nome não derruba a sessão', async () => {
    const c = await t.cookieDe('comum', SENHA_COMUM)
    const r = await comoAdmin('PUT', `/api/usuarios/${t.comumId}`, { nome: 'Comum Renomeado' })
    expect(r.json().usuario).toMatchObject({ nome: 'Comum Renomeado', versao: 3 })
    expect(await statusDados(c)).toBe(200)
  })

  it('trocar a própria senha mantém a sessão atual (mesmo cookie) e derruba as outras', async () => {
    const atual = await t.cookieDe('comum', SENHA_COMUM)
    const outra = await t.cookieDe('comum', SENHA_COMUM)
    const r = await t.chamar('PUT', '/api/minha-senha', {
      cookie: atual,
      payload: { senhaAtual: SENHA_COMUM, senhaNova: 'nova-frase-secreta' },
    })
    expect(r.statusCode, r.body).toBe(200)
    expect(r.json()).toEqual({
      usuario: { id: t.comumId, login: 'comum', nome: 'Comum Teste', nivel: 'COMUM', trocarSenha: false },
    })
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(await statusDados(atual)).toBe(200)
    expect(await statusDados(outra)).toBe(401)
    expect((await t.entrar('comum', 'nova-frase-secreta')).status).toBe(200)
  })

  it('"encerrar sessões" na própria conta mantém a atual', async () => {
    const outra = await t.cookieDe('admin', SENHA_ADMIN)
    const r = await comoAdmin('DELETE', `/api/usuarios/${t.adminId}/sessoes`)
    expect(r.json().usuario.sessoesAtivas).toBe(1)
    expect(await statusDados(t.cookieAdmin)).toBe(200)
    expect(await statusDados(outra)).toBe(401)
  })
})

describe('regras dos usuários', () => {
  const comoAdmin = (metodo: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown) =>
    t.chamar(metodo, url, { cookie: t.cookieAdmin, payload })

  it('lista os administradores primeiro, sem o hash', async () => {
    await comoAdmin('POST', '/api/usuarios', { nome: 'Ana Admin', login: 'ana', nivel: 'ADMIN', senha: '' })
    const r = await comoAdmin('GET', '/api/usuarios')
    const lista = r.json().usuarios as Usuario[]
    expect(lista.map((u) => u.login)).toEqual(['admin', 'ana', 'comum'])
    expect(r.body).not.toMatch(/scrypt|senha_hash|senhaHash/)
    expect(lista[0]).toMatchObject({
      nivel: 'ADMIN',
      ativo: true,
      trocarSenha: false,
      sessoesAtivas: 1,
      ultimoAcessoIp: '127.0.0.1',
    })
    expect(lista[1]).toMatchObject({ trocarSenha: true, ultimoAcessoEm: '', sessoesAtivas: 0 })
  })

  it('a própria conta: não muda o nível, não se desativa nem se exclui (o nome pode)', async () => {
    for (const corpo of [{ nivel: 'COMUM' }, { ativo: false }]) {
      const r = await comoAdmin('PUT', `/api/usuarios/${t.adminId}`, corpo)
      expect(r.statusCode).toBe(409)
      expect(r.json().codigo).toBe('PROPRIA_CONTA')
    }
    expect((await comoAdmin('DELETE', `/api/usuarios/${t.adminId}`)).json()).toEqual({
      erro: 'Você não pode desativar, excluir ou mudar o nível da própria conta. Peça a outro administrador.',
      codigo: 'PROPRIA_CONTA',
    })
    expect((await comoAdmin('PUT', `/api/usuarios/${t.adminId}`, { nome: 'Dono' })).statusCode).toBe(200)
    expect((await comoAdmin('PUT', `/api/usuarios/${t.adminId}`, { ativo: true, nivel: 'ADMIN' })).statusCode).toBe(200)
  })

  it('nunca deixa zero administradores ativos', async () => {
    for (const acao of [
      () => t.usuarios.alterar(t.adminId, { nivel: 'COMUM' }, adminFicticio, ''),
      () => t.usuarios.alterar(t.adminId, { ativo: false }, adminFicticio, ''),
      () => t.usuarios.excluir(t.adminId, adminFicticio, ''),
    ]) {
      const e = await erroDe(acao)
      expect(e.status).toBe(409)
      expect(e.dados).toEqual({ codigo: 'ULTIMO_ADMIN' })
    }
    // Com outro administrador ativo, pode
    const ana = (await comoAdmin('POST', '/api/usuarios', { nome: 'Ana', login: 'ana', nivel: 'ADMIN', senha: '' })).json()
    expect((await comoAdmin('PUT', `/api/usuarios/${ana.usuario.id}`, { nivel: 'COMUM' })).statusCode).toBe(200)
    expect((await comoAdmin('PUT', `/api/usuarios/${ana.usuario.id}`, { nivel: 'ADMIN' })).statusCode).toBe(200)
    expect((await comoAdmin('PUT', `/api/usuarios/${ana.usuario.id}`, { ativo: false })).statusCode).toBe(200)
    expect(t.usuarios.administradoresAtivos()).toBe(1)
  })

  it('versão velha: 409 CONFLITO; usuário inexistente: 404', async () => {
    const r = await comoAdmin('PUT', `/api/usuarios/${t.comumId}`, { nome: 'X', versao: 1 })
    expect(r.statusCode).toBe(409)
    expect(r.json()).toEqual({ erro: 'Outra pessoa alterou este usuário. Feche e abra de novo.', codigo: 'CONFLITO' })
    expect((await comoAdmin('PUT', '/api/usuarios/nao-existe', { nome: 'X' })).statusCode).toBe(404)
    expect((await comoAdmin('PUT', `/api/usuarios/${t.comumId}`, { nivel: 'CHEFE' })).statusCode).toBe(400)
  })

  it('login repetido: 409 (também em dois cadastros simultâneos, nunca 500)', async () => {
    const r = await comoAdmin('POST', '/api/usuarios', { nome: 'Outro', login: 'Comum', nivel: 'COMUM', senha: '' })
    expect(r.statusCode).toBe(409)
    expect(r.json()).toEqual({ erro: 'Já existe um usuário com este login.', codigo: 'LOGIN_EXISTENTE' })
    const corpo = { nome: 'João Lima', login: 'joao', nivel: 'COMUM', senha: '' }
    const juntos = await Promise.all([comoAdmin('POST', '/api/usuarios', corpo), comoAdmin('POST', '/api/usuarios', corpo)])
    expect(juntos.map((x) => x.statusCode).sort()).toEqual([201, 409])
  })

  it('cadastro: sempre com troca de senha; a senha digitada também é temporária', async () => {
    const gerada = await comoAdmin('POST', '/api/usuarios', { nome: 'João Lima', login: 'joao', nivel: 'COMUM', senha: '' })
    expect(gerada.statusCode).toBe(201)
    const g = gerada.json() as ResultadoSenha
    expect(g.usuario).toMatchObject({
      login: 'joao',
      nivel: 'COMUM',
      ativo: true,
      trocarSenha: true,
      versao: 1,
      sessoesAtivas: 0,
    })
    expect(g.senhaTemporaria).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    const digitada = await comoAdmin('POST', '/api/usuarios', {
      nome: 'Maria',
      login: 'maria',
      nivel: 'ADMIN',
      senha: 'sol-de-verao-forte',
    })
    expect(digitada.json().senhaTemporaria).toBeUndefined()
    expect(digitada.json().usuario).toMatchObject({ nivel: 'ADMIN', trocarSenha: true })
    expect((await t.entrar('maria', 'sol-de-verao-forte')).resposta.json().usuario.trocarSenha).toBe(true)
  })

  it('política de senha, com as mensagens', async () => {
    const criar = (senha: string) =>
      comoAdmin('POST', '/api/usuarios', { nome: 'Pedro Alves', login: 'pedro', nivel: 'COMUM', senha })
    expect((await criar('curta')).json()).toEqual({
      erro: 'A senha precisa ter de 8 a 128 caracteres.',
      erros: ['A senha precisa ter de 8 a 128 caracteres.'],
    })
    expect((await criar('12345678')).json().erro).toBe('Essa senha é muito comum. Use uma frase de 3 ou 4 palavras.')
    // O administrador digita a senha de outra pessoa: "da pessoa", não "o seu"
    expect((await criar('o-pedro-chegou')).json().erro).toBe('A senha não pode conter o usuário (login) da pessoa.')
    expect((await criar('meu-alves-favorito')).json().erro).toBe('A senha não pode conter o nome da pessoa.')
    expect((await criar('bcfichas2026')).json().erro).toBe('A senha não pode conter o nome do sistema.')
    // Redefinir com senha fraca
    const fraca = await comoAdmin('POST', `/api/usuarios/${t.comumId}/senha`, { senha: '1234' })
    expect(fraca.statusCode).toBe(400)
    const comNome = await comoAdmin('POST', `/api/usuarios/${t.comumId}/senha`, { senha: 'teste-de-verao-bom' })
    expect(comNome.json().erro).toBe('A senha não pode conter o nome da pessoa.')
    // Troca da própria senha
    const trocar = (senhaAtual: string, senhaNova: string) =>
      t.chamar('PUT', '/api/minha-senha', { cookie: t.cookieComum, payload: { senhaAtual, senhaNova } })
    expect((await trocar(SENHA_COMUM, 'meu-teste-favorito')).json()).toEqual({
      erro: 'A senha não pode conter o seu nome.',
      erros: ['A senha não pode conter o seu nome.'],
    })
    expect((await trocar('senha-errada-aqui', 'frase-nova-boa')).json()).toEqual({
      erro: 'A senha atual não confere.',
      codigo: 'SENHA_ATUAL',
    })
    expect((await trocar(SENHA_COMUM, SENHA_COMUM)).json()).toEqual({
      erro: 'A senha nova precisa ser diferente da atual.',
      codigo: 'SENHA_IGUAL',
    })
  })

  it('a senha atual errada na troca conta no limite de tentativas', async () => {
    const trocar = (senhaAtual: string) =>
      t.chamar('PUT', '/api/minha-senha', { cookie: t.cookieComum, payload: { senhaAtual, senhaNova: 'frase-nova-boa' } })
    for (let i = 0; i < 5; i++) expect((await trocar('senha-errada-aqui')).statusCode).toBe(400)
    const bloqueado = await trocar(SENHA_COMUM)
    expect(bloqueado.statusCode).toBe(429)
    expect(bloqueado.headers['retry-after']).toBe('30')
    expect(auditoria('BLOQUEIO')).toHaveLength(1)
  })

  it('redefinir com senha digitada: sem senha temporária na resposta, mas com troca obrigatória', async () => {
    const r = await comoAdmin('POST', `/api/usuarios/${t.comumId}/senha`, { senha: 'senha-digitada-forte' })
    expect(r.statusCode).toBe(200)
    expect(r.json().senhaTemporaria).toBeUndefined()
    expect(r.json().usuario).toMatchObject({ trocarSenha: true, ativo: true })
    expect((await t.entrar('comum', 'senha-digitada-forte')).resposta.json().usuario.trocarSenha).toBe(true)
    expect((await comoAdmin('POST', '/api/usuarios/nao-existe/senha', {})).statusCode).toBe(404)
  })

  it('limite de 50 usuários', async () => {
    for (let i = 0; i < 48; i++)
      await t.usuarios.criar({ nome: `Pessoa ${i}`, login: `pessoa${i}`, nivel: 'COMUM', senha: '' }, adminFicticio, '')
    const r = await comoAdmin('POST', '/api/usuarios', { nome: 'Uma a mais', login: 'mais', nivel: 'COMUM', senha: '' })
    expect(r.statusCode).toBe(409)
    expect(r.json()).toEqual({ erro: 'O limite é de 50 usuários.', codigo: 'LIMITE_USUARIOS' })
  })
})

describe('troca de senha obrigatória', () => {
  it('só /api/sessao e /api/minha-senha passam; o resto dá 403 TROCAR_SENHA e o tempo real, semSessao', async () => {
    const novo = (
      await t.chamar('POST', '/api/usuarios', {
        cookie: t.cookieAdmin,
        payload: { nome: 'Novo Funcionário', login: 'novo', nivel: 'ADMIN', senha: '' },
      })
    ).json() as ResultadoSenha
    const c = await t.cookieDe('novo', novo.senhaTemporaria!)
    expect((await t.chamar('GET', '/api/sessao', { cookie: c })).json().usuario).toMatchObject({
      login: 'novo',
      trocarSenha: true,
    })
    const dados = await t.chamar('GET', '/api/dados', { cookie: c })
    expect(dados.statusCode).toBe(403)
    expect(dados.json()).toEqual({ erro: 'Crie sua senha antes de continuar.', codigo: 'TROCAR_SENHA' })
    expect((await t.chamar('GET', '/api/usuarios', { cookie: c })).json().codigo).toBe('TROCAR_SENHA')
    expect((await t.chamar('POST', '/api/clientes', { cookie: c, payload: { tipo: 'AVULSO', nome: 'X' } })).statusCode).toBe(403)
    const stream = await t.chamar('GET', '/api/stream', { cookie: c })
    expect(stream.statusCode).toBe(200)
    expect(stream.body).toContain('"semSessao":true')
    const troca = await t.chamar('PUT', '/api/minha-senha', {
      cookie: c,
      payload: { senhaAtual: novo.senhaTemporaria, senhaNova: 'minha-frase-nova' },
    })
    expect(troca.statusCode).toBe(200)
    expect(await statusDados(c)).toBe(200)
  })
})

describe('sem usuários cadastrados', () => {
  it('a sessão avisa; a API de dados e o login dão 401', async () => {
    const vazio = await criarAppComLogin({ semUsuarios: true })
    try {
      expect((await vazio.chamar('GET', '/api/sessao')).json()).toEqual({ usuario: null, semUsuarios: true, build: '' })
      expect((await vazio.chamar('GET', '/api/dados')).statusCode).toBe(401)
      expect((await vazio.entrar('admin', 'qualquer-senha')).status).toBe(401)
      expect(vazio.usuarios.situacao()).toEqual({ usuarios: 0, administradoresAtivos: 0, lista: [] })
    } finally {
      await vazio.fechar()
    }
  })
})

describe('backup e banco', () => {
  it('o JSON do backup não leva usuários, sessões nem hashes; limpar e restaurar não mexem nas contas', async () => {
    const backup = await t.chamar('GET', '/api/backup', { cookie: t.cookieAdmin })
    expect(backup.statusCode).toBe(200)
    expect(backup.body).not.toMatch(/usuarios|senha_hash|scrypt|sessoes|auditoria/)
    expect(
      (await t.chamar('POST', '/api/limpar', { cookie: t.cookieAdmin, payload: { confirmacao: 'APAGAR' } })).statusCode,
    ).toBe(200)
    expect(await statusDados(t.cookieAdmin)).toBe(200)
    expect(await statusDados(t.cookieComum)).toBe(200)
    const restaurar = await t.chamar('POST', '/api/backup/restaurar', { cookie: t.cookieAdmin, payload: backup.json() })
    expect(restaurar.statusCode).toBe(200)
    expect((await t.entrar('comum', SENHA_COMUM)).status).toBe(200)
    expect(t.usuarios.situacao().usuarios).toBe(2)
  })

  it('nenhuma tabela guarda senha em texto puro', async () => {
    const tabelas = t.ctx.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>
    expect(tabelas.map((x) => x.name)).toEqual(expect.arrayContaining(['usuarios', 'sessoes', 'auditoria']))
    for (const { name } of tabelas) {
      const conteudo = JSON.stringify(t.ctx.db.prepare(`SELECT * FROM "${name}"`).all())
      expect(conteudo, name).not.toContain(SENHA_ADMIN)
      expect(conteudo, name).not.toContain(SENHA_COMUM)
    }
  })

  it('transplantarUsuarios: o destino fica com os usuários e o registro da origem, sem sessões', async () => {
    const destino = abrirBanco(':memory:')
    try {
      const antigo = new ServicoUsuarios(destino, { parametrosSenha: PARAMETROS_LEVES })
      await antigo.definirSenhaLocal({ login: 'velho', senha: 'senha-de-antes-123', tornarAdmin: true })
      destino
        .prepare("INSERT INTO sessoes (id, usuario_id, criada_em, usada_em, expira_em) SELECT 'x', id, 0, 0, 9e15 FROM usuarios")
        .run()
      const registrosOrigem = auditoria().length
      expect(transplantarUsuarios(t.ctx.db, destino)).toEqual({ usuarios: 2, auditoria: registrosOrigem })
      expect(antigo.situacao().lista.map((u) => u.login)).toEqual(['admin', 'comum'])
      expect(destino.prepare('SELECT COUNT(*) AS n FROM sessoes').get()).toEqual({ n: 0 })
      const registros = antigo.listarAuditoria({ limite: 200 })
      expect(registros).toHaveLength(registrosOrigem + 1)
      expect(registros[0]).toMatchObject({ acao: 'COPIA_RESTAURADA', detalhe: 'as contas e senhas atuais foram mantidas' })
      // As senhas atuais valem no banco restaurado
      const comoNoServidor = new ServicoUsuarios(destino, { parametrosSenha: PARAMETROS_LEVES })
      expect((await comoNoServidor.entrar({ login: 'comum', senha: SENHA_COMUM }, '127.0.0.1')).usuario.login).toBe('comum')
      await expect(comoNoServidor.entrar({ login: 'velho', senha: 'senha-de-antes-123' }, '127.0.0.1')).rejects.toThrow(
        'Usuário ou senha incorretos.',
      )
    } finally {
      destino.close()
    }
  })
})

describe('registro de atividades', () => {
  const listar = async (consulta = '') =>
    (await t.chamar('GET', `/api/auditoria${consulta}`, { cookie: t.cookieAdmin })).json().registros as RegistroAuditoria[]

  it('LOGIN, LOGIN_FALHOU (login vazio quando não existe) e BLOQUEIO uma vez por bloqueio', async () => {
    expect(auditoria('LOGIN').map((r) => r.login)).toEqual(['admin', 'comum'])
    await t.entrar('ninguem', 'senha-errada-aqui', { remoteAddress: '192.168.0.9' })
    await t.entrar('comum', 'senha-errada-aqui')
    const falhas = auditoria('LOGIN_FALHOU')
    expect(falhas.map((r) => [r.login, r.usuario_id, r.ip])).toEqual([
      ['', '', '192.168.0.9'],
      ['comum', t.comumId, '127.0.0.1'],
    ])
    for (let i = 0; i < 4; i++) await t.entrar('comum', 'senha-errada-aqui')
    for (let i = 0; i < 3; i++) expect((await t.entrar('comum', 'senha-errada-aqui')).status).toBe(429)
    expect(auditoria('BLOQUEIO')).toHaveLength(1)
    expect(JSON.stringify(auditoria())).not.toContain('senha-errada-aqui')
  })

  it('ACESSO_NEGADO no máximo 1 por minuto por usuário e rota', async () => {
    let agora = Date.now()
    t.usuarios.agora = () => agora
    for (let i = 0; i < 3; i++) {
      const r = await t.chamar('GET', '/api/backup', { cookie: t.cookieComum })
      expect(r.statusCode).toBe(403)
      expect(r.json()).toEqual({
        erro: 'Só o administrador cuida das cópias de segurança e dos dados.',
        codigo: 'SEM_PERMISSAO',
        permissao: 'dadosEBackup',
      })
    }
    await t.chamar('DELETE', '/api/eventos/abc', { cookie: t.cookieComum })
    expect(auditoria('ACESSO_NEGADO').map((r) => [r.login, r.detalhe, r.alvo])).toEqual([
      ['comum', 'GET /api/backup', ''],
      ['comum', 'DELETE /api/eventos/:id', 'abc'],
    ])
    agora += 61_000
    await t.chamar('GET', '/api/backup', { cookie: t.cookieComum })
    expect(auditoria('ACESSO_NEGADO')).toHaveLength(3)
  })

  it('BACKUP_BAIXADO, e ALTERACAO com o alvo e os campos do PATCH (sem valores)', async () => {
    await t.chamar('GET', '/api/backup', { cookie: t.cookieAdmin })
    expect(auditoria('BACKUP_BAIXADO').map((r) => r.login)).toEqual(['admin'])
    const cli = (
      await t.chamar('POST', '/api/clientes', { cookie: t.cookieComum, payload: { tipo: 'AVULSO', nome: 'Barraca do Zé' } })
    ).json() as Cliente
    const evento = (
      await t.chamar('POST', '/api/eventos', {
        cookie: t.cookieComum,
        payload: { clienteId: cli.id, nome: 'Festa', dias: [{ data: '2026-08-01', maquinas: 1 }], status: 'EM_ABERTO' },
      })
    ).json() as Evento
    const pago = await t.chamar('PATCH', `/api/eventos/${evento.id}`, {
      cookie: t.cookieComum,
      payload: { formaPagamento: 'PIX', dataPagamento: '2026-08-02', versao: 1 },
    })
    expect(pago.statusCode, pago.body).toBe(200)
    // Gravação recusada (404) não entra
    expect((await t.chamar('PUT', '/api/clientes/nao-existe', { cookie: t.cookieComum, payload: cli })).statusCode).toBe(404)
    const alteracoes = auditoria('ALTERACAO')
    expect(alteracoes.map((r) => [r.login, r.alvo, r.detalhe])).toEqual([
      ['comum', '', 'POST /api/clientes'],
      ['comum', '', 'POST /api/eventos'],
      ['comum', evento.id, 'PATCH /api/eventos/:id | formaPagamento,dataPagamento'],
    ])
    expect(JSON.stringify(alteracoes)).not.toMatch(/PIX|Barraca|2026-08-02/)
    // Login, troca de senha e cadastro de usuários têm registro próprio (não viram ALTERACAO)
    expect(alteracoes.some((r) => /sessao|minha-senha|usuarios/.test(r.detalhe))).toBe(false)
  })

  it('filtros por grupo e por usuário, do mais novo para o mais antigo, com paginação', async () => {
    await t.chamar('POST', '/api/clientes', { cookie: t.cookieComum, payload: { tipo: 'AVULSO', nome: 'Barraca' } })
    const acessos = await listar('?grupo=acessos')
    expect(acessos.length).toBeGreaterThan(0)
    expect(acessos.every((r) => ['LOGIN', 'LOGIN_FALHOU', 'BLOQUEIO', 'LOGOUT', 'ACESSO_NEGADO'].includes(r.acao))).toBe(true)
    const doComum = await listar(`?usuarioId=${t.comumId}`)
    expect(doComum.every((r) => r.usuarioId === t.comumId)).toBe(true)
    expect(doComum.map((r) => r.acao)).toEqual(['ALTERACAO', 'SENHA_TROCADA', 'LOGIN'])
    const todos = await listar()
    expect(todos.map((r) => r.id)).toEqual([...todos.map((r) => r.id)].sort((a, b) => b - a))
    const pagina = await listar(`?limite=2&antes=${todos[0].id}`)
    expect(pagina.map((r) => r.id)).toEqual(todos.slice(1, 3).map((r) => r.id))
    expect((await t.chamar('GET', '/api/auditoria?grupo=outro', { cookie: t.cookieAdmin })).statusCode).toBe(400)
    expect((await t.chamar('GET', '/api/auditoria', { cookie: t.cookieComum })).statusCode).toBe(403)
  })

  it('apaga os registros com mais de 365 dias', async () => {
    const hoje = Date.now()
    t.usuarios.agora = () => hoje - 400 * DIA
    t.usuarios.registrar('LOGIN', { usuario: { id: 'x', login: 'antigo' }, ip: '10.0.0.1' })
    t.usuarios.agora = () => hoje
    const antes = auditoria().length
    expect(t.usuarios.limparAuditoriaAntiga()).toBe(1)
    expect(auditoria()).toHaveLength(antes - 1)
    expect(auditoria().some((r) => r.login === 'antigo')).toBe(false)
  })
})

describe('ferramenta local (API usada pelo redefinir-senha.mjs)', () => {
  it('situacao: contas e administradores ativos, sem hash', () => {
    const s = t.usuarios.situacao()
    expect(s).toEqual({
      usuarios: 2,
      administradoresAtivos: 1,
      lista: [
        { login: 'admin', nome: 'Admin Teste', nivel: 'ADMIN', ativo: true },
        { login: 'comum', nome: 'Comum Teste', nivel: 'COMUM', ativo: true },
      ],
    })
  })

  it('definirSenhaLocal cria um ADMIN com senha temporária quando o login não existe', async () => {
    const r = await t.usuarios.definirSenhaLocal({ login: ' Fabio ', nome: 'Fábio Souza' })
    expect(r.criado).toBe(true)
    expect(r.senhaTemporaria).toMatch(/^\w{4}-\w{4}-\w{4}$/)
    expect(r.usuario).toMatchObject({ login: 'fabio', nome: 'Fábio Souza', nivel: 'ADMIN', ativo: true, trocarSenha: true })
    expect((await t.entrar('fabio', r.senhaTemporaria!)).resposta.json().usuario.trocarSenha).toBe(true)
    const semNome = await t.usuarios.definirSenhaLocal({ login: 'chefe', senha: 'mesa-de-madeira' })
    expect(semNome.usuario).toMatchObject({ nome: 'Administrador', nivel: 'ADMIN', trocarSenha: false })
    const registro = auditoria('FERRAMENTA_LOCAL').at(-2)!
    expect(registro).toMatchObject({ login: 'fabio', ip: 'local', alvo: r.usuario.id })
    // Os nomes dos níveis, como no resto da tela (não os códigos COMUM e ADMIN)
    expect(registro.detalhe).toBe('criado como Administrador; senha temporária')
    expect(auditoria('USUARIO_CRIADO')[0].detalhe).toBe('comum (Comum); senha gerada pelo sistema')
  })

  it('redefine a senha (digitada: sem troca, ou com trocarSenha), promove, reativa e derruba as sessões da conta', async () => {
    t.ctx.db.prepare("UPDATE usuarios SET ativo = 0 WHERE login = 'comum'").run()
    const r = await t.usuarios.definirSenhaLocal({ login: 'comum', senha: 'frase-local-nova', tornarAdmin: true })
    expect(r.criado).toBe(false)
    expect(r.senhaTemporaria).toBeUndefined()
    expect(r.usuario).toMatchObject({ nivel: 'ADMIN', ativo: true, trocarSenha: false, nome: 'Comum Teste' })
    expect(await statusDados(t.cookieComum)).toBe(401)
    expect(auditoria('FERRAMENTA_LOCAL').at(-1)!.detalhe).toBe('senha redefinida; nível: Comum → Administrador; reativado')
    const temporaria = await t.usuarios.definirSenhaLocal({ login: 'comum', senha: 'outra-frase-local', trocarSenha: true })
    expect(temporaria.usuario.trocarSenha).toBe(true)
    const gerada = await t.usuarios.definirSenhaLocal({ login: 'comum', nome: 'Novo Nome' })
    expect(gerada.senhaTemporaria).toBeTruthy()
    expect(gerada.usuario).toMatchObject({ trocarSenha: true, nome: 'Novo Nome', nivel: 'ADMIN' })
  })

  it('recusa senha fraca, login inválido e nome comprido', async () => {
    expect((await erroDe(t.usuarios.definirSenhaLocal({ login: 'admin', senha: '1234' }))).message).toBe(
      'A senha precisa ter de 8 a 128 caracteres.',
    )
    expect((await erroDe(t.usuarios.definirSenhaLocal({ login: 'admin', senha: 'admin-123456' }))).message).toBe(
      'A senha não pode conter o usuário (login) da pessoa.',
    )
    expect((await erroDe(t.usuarios.definirSenhaLocal({ login: 'a b' }))).message).toMatch(/Use de 3 a 32 letras/)
    expect((await erroDe(t.usuarios.definirSenhaLocal({ login: 'novo', nome: 'x'.repeat(61) }))).message).toMatch(/até 60/)
    expect(t.usuarios.situacao().usuarios).toBe(2)
  })

  it('encerrarTodasAsSessoes apaga todas e devolve quantas', async () => {
    await t.cookieDe('comum', SENHA_COMUM)
    expect(t.usuarios.encerrarTodasAsSessoes()).toBe(3)
    expect(await statusDados(t.cookieAdmin)).toBe(401)
    expect(t.usuarios.encerrarTodasAsSessoes()).toBe(0)
  })

  it('funciona num banco em arquivo, sem o servidor', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'bcf-ferr-'))
    try {
      const db = abrirBanco(join(pasta, 'bc-fichas.db'))
      const s = new ServicoUsuarios(db, { parametrosSenha: PARAMETROS_LEVES })
      await s.definirSenhaLocal({ login: 'admin', nome: 'João — Recepção', senha: 'açúcar-com-canela' })
      db.close()
      const db2 = abrirBanco(join(pasta, 'bc-fichas.db'))
      const s2 = new ServicoUsuarios(db2, { parametrosSenha: PARAMETROS_LEVES })
      expect(s2.situacao().lista).toEqual([{ login: 'admin', nome: 'João — Recepção', nivel: 'ADMIN', ativo: true }])
      expect((await s2.entrar({ login: 'admin', senha: 'açúcar-com-canela'.normalize('NFD') }, '127.0.0.1')).usuario.nome).toBe(
        'João — Recepção',
      )
      db2.close()
    } finally {
      rmSync(pasta, { recursive: true, force: true })
    }
  })
})

describe('hash da senha', () => {
  it('login certo com o hash feito com outros parâmetros: refaz com os atuais', async () => {
    const db = abrirBanco(':memory:')
    try {
      await new ServicoUsuarios(db, { parametrosSenha: { ln: 11, r: 8, p: 1 } }).definirSenhaLocal({
        login: 'admin',
        senha: 'frase-de-antigamente',
      })
      const hash = () => (db.prepare('SELECT senha_hash AS h FROM usuarios').get() as { h: string }).h
      expect(hash()).toMatch(/^\$scrypt\$ln=11,/)
      const s = new ServicoUsuarios(db, { parametrosSenha: PARAMETROS_LEVES })
      await expect(s.entrar({ login: 'admin', senha: 'errada-de-novo' }, '127.0.0.1')).rejects.toThrow()
      expect(hash()).toMatch(/^\$scrypt\$ln=11,/)
      await s.entrar({ login: 'admin', senha: 'frase-de-antigamente' }, '127.0.0.1')
      expect(hash()).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$/)
      expect((await s.entrar({ login: 'admin', senha: 'frase-de-antigamente' }, '127.0.0.1')).usuario.login).toBe('admin')
    } finally {
      db.close()
    }
  })
})

describe('auxiliares', () => {
  it('loopback: 127.0.0.0/8 e ::1 (com ou sem ::ffff:)', () => {
    expect(['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'].every(ehLoopback)).toBe(true)
    expect(['192.168.0.1', '10.0.0.1', '', '::ffff:192.168.0.1', '1270.0.0.1'].some(ehLoopback)).toBe(false)
  })
})
