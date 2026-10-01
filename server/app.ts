import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyError } from 'fastify'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BackupsAutomaticos } from './backup.ts'
import type { Contexto } from './contexto.ts'
import { abrirBanco } from './db.ts'
import { ErroApi } from './erros.ts'
import { criarModuloGoogle } from './google/modulo.ts'
import { Repositorio } from './repositorio.ts'
import { rotasConsultas } from './rotas/consultas.ts'
import { rotasDados } from './rotas/dados.ts'
import { TempoReal } from './tempoReal.ts'

export const VERSAO_APP = '2.0.0'

/** Cabeçalho exigido em toda gravação: bloqueia que sites externos alterem dados pela rede local (CSRF). */
export const CABECALHO_APP = 'x-bc-fichas'

export interface OpcoesApp {
  /** Pasta de dados (banco, backups, credenciais). */
  pastaDados: string
  /** Caminho do banco; padrão `<pastaDados>/bc-fichas.db`. Use ':memory:' em testes. */
  arquivoBanco?: string
  /** Pasta com a interface compilada (`dist`). `null` desativa. */
  pastaEstatica?: string | null
  logger?: boolean
  /** Ativa backups diários e o sincronizador do Google (desligado em testes). */
  tarefasEmSegundoPlano?: boolean
}

export async function criarApp(opcoes: OpcoesApp) {
  const pastaDados = resolve(opcoes.pastaDados)
  const app = Fastify({
    logger: opcoes.logger ? { level: 'warn' } : false,
    bodyLimit: 50 * 1024 * 1024,
    trustProxy: false,
  })

  const db = abrirBanco(opcoes.arquivoBanco ?? join(pastaDados, 'bc-fichas.db'))
  const tempoReal = new TempoReal()
  const repo = new Repositorio(db, (msg) => tempoReal.publicar(msg))
  const backups = new BackupsAutomaticos(db, join(pastaDados, 'backups'))
  const ctx: Contexto = { db, repo, tempoReal, backups, pastaDados, log: app.log }

  const google = criarModuloGoogle(ctx)
  repo.registrarExtensao(google.extensao)

  // ---- Segurança básica para uso em rede local ----
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.header('Referrer-Policy', 'same-origin')
    if (!req.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    if (req.method === 'GET' || req.method === 'HEAD') return
    const origem = req.headers.origin
    if (origem) {
      let hostOrigem = ''
      try {
        hostOrigem = new URL(origem).host
      } catch {
        /* origem inválida */
      }
      if (hostOrigem !== req.headers.host) throw new ErroApi(403, 'Requisição de outro site bloqueada.')
    }
    if (req.headers[CABECALHO_APP] !== '1') throw new ErroApi(403, 'Requisição bloqueada.')
  })

  app.setErrorHandler((erro: FastifyError | ErroApi, req, reply) => {
    if (erro instanceof ErroApi) {
      const extra = erro.dados && typeof erro.dados === 'object' ? erro.dados : {}
      return reply.code(erro.status).send({ erro: erro.message, ...extra })
    }
    const status = (erro as FastifyError).statusCode ?? 500
    if (status >= 500) {
      req.log.error(erro)
      return reply.code(500).send({ erro: 'Erro interno do servidor. Tente novamente.' })
    }
    if (status === 413) return reply.code(413).send({ erro: 'Arquivo muito grande.' })
    return reply.code(status).send({ erro: 'Requisição inválida.' })
  })

  app.get('/api/saude', async () => ({
    ok: true,
    versao: VERSAO_APP,
    revisao: repo.revisao(),
    conectados: tempoReal.conectados,
    horario: new Date().toISOString(),
  }))

  await rotasDados(app, ctx)
  await rotasConsultas(app, ctx)
  await google.rotas(app)

  app.all('/api/*', async () => {
    throw new ErroApi(404, 'Rota não encontrada.')
  })

  // ---- Interface (arquivos compilados pelo Vite) ----
  const pastaEstatica = opcoes.pastaEstatica === undefined ? resolve('dist') : opcoes.pastaEstatica
  if (pastaEstatica && existsSync(join(pastaEstatica, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: pastaEstatica,
      setHeaders(reply, caminho) {
        // Arquivos com hash no nome nunca mudam; o index.html sempre é revalidado
        if (/[\\/]assets[\\/]/.test(caminho)) reply.header('Cache-Control', 'public, max-age=31536000, immutable')
        else reply.header('Cache-Control', 'no-cache')
      },
    })
  } else if (pastaEstatica !== null) {
    app.get('/', async (_req, reply) =>
      reply
        .type('text/html; charset=utf-8')
        .send(
          '<h1>BC Fichas Control</h1><p>A interface ainda não foi compilada. Rode <code>npm run build</code> e reinicie o servidor.</p>',
        ),
    )
  }

  if (opcoes.tarefasEmSegundoPlano) {
    backups.iniciar()
    google.iniciar()
  }

  app.addHook('onClose', async () => {
    google.parar()
    backups.parar()
    tempoReal.fechar()
    db.close()
  })

  return { app, ctx }
}
