// Auxiliar dos testes do servidor com login de verdade (sem o acesso livre dos testes antigos):
// um administrador criado pela ferramenta local e um comum criado pela tela, já com a senha trocada.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResultadoSenha } from '#shared/tipos.ts'
import { nomeCookieSessao } from './acesso.ts'
import { criarApp, type OpcoesApp } from './app.ts'
import { PARAMETROS_LEVES } from './senha.ts'

export const H = { 'x-bc-fichas': '1' }
export const SENHA_ADMIN = 'cavalo-azul-pulando'
export const SENHA_COMUM = 'girafa-verde-dancando'

type Metodo = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface OpcoesRequisicao {
  /** Token da sessão (valor do cookie). */
  cookie?: string | null
  payload?: unknown
  headers?: Record<string, string>
  remoteAddress?: string
}

export interface OpcoesEntrar {
  manterConectado?: boolean
  remoteAddress?: string
  /** Cookie de uma sessão anterior deste "navegador". */
  cookie?: string | null
}

/**
 * App com o banco em memória, o hash leve e dois usuários: `admin` (ADMIN) e `comum` (COMUM).
 * `semUsuarios`: não cria ninguém (para o caso do banco novo).
 */
export async function criarAppComLogin(opcoes: Partial<OpcoesApp> & { semUsuarios?: boolean } = {}) {
  const { semUsuarios, ...resto } = opcoes
  const pasta = mkdtempSync(join(tmpdir(), 'bcf-login-'))
  const { app, ctx, usuarios } = await criarApp({
    pastaDados: pasta,
    arquivoBanco: ':memory:',
    pastaEstatica: null,
    parametrosSenha: PARAMETROS_LEVES,
    ...resto,
  })
  const nomeCookie = nomeCookieSessao(resto.porta)

  /** Requisição com o cabeçalho do app; `cookie` é o token da sessão. */
  function chamar(metodo: Metodo, url: string, o: OpcoesRequisicao = {}) {
    return app.inject({
      method: metodo,
      url,
      headers: { ...H, ...o.headers },
      ...(o.cookie ? { cookies: { [nomeCookie]: o.cookie } } : {}),
      ...(o.payload !== undefined ? { payload: o.payload as object } : {}),
      ...(o.remoteAddress ? { remoteAddress: o.remoteAddress } : {}),
    })
  }

  /** POST /api/sessao; `cookie` é o token novo (ou `null` se não entrou). */
  async function entrar(login: string, senha: string, o: OpcoesEntrar = {}) {
    const resposta = await chamar('POST', '/api/sessao', {
      payload: { login, senha, manterConectado: !!o.manterConectado },
      remoteAddress: o.remoteAddress,
      cookie: o.cookie,
    })
    const cookie = resposta.cookies.find((c) => c.name === nomeCookie)?.value || null
    return { resposta, cookie, status: resposta.statusCode }
  }

  /** Entra e devolve o token (lança se não entrar). */
  async function cookieDe(login: string, senha: string, o: OpcoesEntrar = {}) {
    const r = await entrar(login, senha, o)
    if (r.status !== 200 || !r.cookie) throw new Error(`não entrou como ${login}: ${r.status} ${r.resposta.body}`)
    return r.cookie
  }

  let cookieAdmin = ''
  let cookieComum = ''
  let adminId = ''
  let comumId = ''
  if (!semUsuarios) {
    const admin = await usuarios.definirSenhaLocal({ login: 'admin', nome: 'Admin Teste', senha: SENHA_ADMIN, tornarAdmin: true })
    adminId = admin.usuario.id
    cookieAdmin = await cookieDe('admin', SENHA_ADMIN)
    const criado = await chamar('POST', '/api/usuarios', {
      cookie: cookieAdmin,
      payload: { nome: 'Comum Teste', login: 'comum', nivel: 'COMUM', senha: '' },
    })
    if (criado.statusCode !== 201) throw new Error(`não criou o comum: ${criado.body}`)
    const { usuario, senhaTemporaria } = criado.json() as ResultadoSenha
    comumId = usuario.id
    cookieComum = await cookieDe('comum', senhaTemporaria!)
    const troca = await chamar('PUT', '/api/minha-senha', {
      cookie: cookieComum,
      payload: { senhaAtual: senhaTemporaria, senhaNova: SENHA_COMUM },
    })
    if (troca.statusCode !== 200) throw new Error(`não trocou a senha do comum: ${troca.body}`)
  }

  async function fechar() {
    await app.close()
    rmSync(pasta, { recursive: true, force: true })
  }

  return { app, ctx, usuarios, pasta, nomeCookie, cookieAdmin, cookieComum, adminId, comumId, chamar, entrar, cookieDe, fechar }
}

export type AppComLogin = Awaited<ReturnType<typeof criarAppComLogin>>
