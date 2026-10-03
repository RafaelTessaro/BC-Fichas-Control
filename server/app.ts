import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyError } from 'fastify'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { hostname } from 'node:os'
import { join, resolve } from 'node:path'
import { BackupsAutomaticos } from './backup.ts'
import type { Contexto } from './contexto.ts'
import { abrirBanco } from './db.ts'
import { ErroApi } from './erros.ts'
import { criarModuloGoogle } from './google/modulo.ts'
import { Repositorio } from './repositorio.ts'
import { criarModuloEmail, type CriarTransporte } from './email.ts'
import { rotasAnexos } from './rotas/anexos.ts'
import { rotasContratos } from './rotas/contratos.ts'
import { rotasConsultas } from './rotas/consultas.ts'
import { rotasDados } from './rotas/dados.ts'
import { TempoReal } from './tempoReal.ts'

/** Versão do sistema, lida do package.json (a mesma que vai no nome do pacote para Windows). */
export const VERSAO_APP: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/** Cabeçalho exigido em toda gravação: bloqueia que sites externos alterem dados pela rede local (CSRF). */
export const CABECALHO_APP = 'x-bc-fichas'

/**
 * Nomes pelos quais o servidor pode ser acessado. Endereços IP, "localhost" e o nome do computador
 * sempre valem; outros nomes (ex.: um apelido no roteador) vão em HOSTS_PERMITIDOS, separados por vírgula.
 * Bloqueia o "DNS rebinding": um site de fora que aponta o próprio nome para o IP do servidor
 * para ler os dados pelo navegador de quem está na rede.
 */
export function hostPermitido(host: string | undefined, extras: ReadonlySet<string>, maquina = hostname()): boolean {
  if (!host) return false
  let nome: string
  try {
    nome = new URL(`http://${host}`).hostname.toLowerCase().replace(/\.$/, '')
  } catch {
    return false
  }
  if (nome.startsWith('[') && nome.endsWith(']')) nome = nome.slice(1, -1)
  if (isIP(nome)) return true
  if (nome === 'localhost' || nome.endsWith('.localhost')) return true
  const computador = maquina.toLowerCase()
  if (computador && (nome === computador || nome.startsWith(computador + '.'))) return true
  return extras.has(nome)
}

/** Lê HOSTS_PERMITIDOS ("bcfichas, servidor.local") como conjunto de nomes em minúsculas. */
export function lerHostsPermitidos(texto = process.env.HOSTS_PERMITIDOS ?? '') {
  return new Set(
    texto
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  )
}

export interface OpcoesApp {
  /** Pasta de dados (banco, backups, credenciais). */
  pastaDados: string
  /** Caminho do banco; padrão `<pastaDados>/bc-fichas.db`. Use ':memory:' em testes. */
  arquivoBanco?: string
  /** Pasta com a interface compilada (`dist`). `null` desativa. */
  pastaEstatica?: string | null
  logger?: boolean
  /** Transporte de e-mail (os testes trocam o SMTP por um que só guarda as mensagens). */
  transporteEmail?: CriarTransporte
  /** Ativa backups diários e o sincronizador do Google (desligado em testes). */
  tarefasEmSegundoPlano?: boolean
  /** Nomes extras aceitos no cabeçalho Host; padrão: HOSTS_PERMITIDOS do ambiente. */
  hostsPermitidos?: string
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
  const hostsExtras = lerHostsPermitidos(opcoes.hostsPermitidos)
  app.addHook('onRequest', async (req, reply) => {
    // Vale também para leituras: um site de fora com o nome apontado para este servidor não lê nada
    if (!hostPermitido(req.headers.host, hostsExtras)) {
      const aviso =
        `Acesso pelo nome "${String(req.headers.host ?? '').slice(0, 100)}" bloqueado. ` +
        'Use o endereço IP do servidor, ou inclua esse nome em HOSTS_PERMITIDOS no arquivo .env e reinicie o servidor.'
      if (req.url.startsWith('/api/')) throw new ErroApi(403, aviso)
      return reply.code(403).type('text/plain; charset=utf-8').send(aviso)
    }
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'SAMEORIGIN')
    reply.header('Referrer-Policy', 'same-origin')
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    // A verificação vale para QUALQUER requisição que não seja leitura, independentemente do
    // caminho (o roteador decodifica /%61pi/... para /api/..., então não dá para filtrar pelo prefixo).
    // A interface (arquivos estáticos) só usa GET/HEAD.
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
    build: tempoReal.build,
    conectados: tempoReal.conectados,
    horario: new Date().toISOString(),
  }))

  await rotasDados(app, ctx)
  await rotasAnexos(app, ctx)
  await rotasContratos(app, ctx)
  await criarModuloEmail(ctx, opcoes.transporteEmail).rotas(app)
  await rotasConsultas(app, ctx)
  await google.rotas(app)

  app.all('/api/*', async () => {
    throw new ErroApi(404, 'Rota não encontrada.')
  })

  // ---- Interface (arquivos compilados pelo Vite) ----
  const pastaEstatica = opcoes.pastaEstatica === undefined ? resolve('dist') : opcoes.pastaEstatica
  if (pastaEstatica && existsSync(join(pastaEstatica, 'index.html'))) {
    // O index.html referencia os arquivos com hash: o hash dele identifica a versão da interface
    tempoReal.build = createHash('sha1')
      .update(readFileSync(join(pastaEstatica, 'index.html')))
      .digest('hex')
      .slice(0, 12)
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

  // As conexões de tempo real (SSE) ficam abertas para sempre: precisam ser encerradas ANTES
  // do servidor HTTP fechar, senão app.close() espera por elas indefinidamente.
  app.addHook('preClose', async () => {
    tempoReal.fechar()
  })
  app.addHook('onClose', async () => {
    google.parar()
    backups.parar()
    try {
      // Consolida o WAL no arquivo principal para que dados/bc-fichas.db fique completo sozinho
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* banco já fechado ou em memória */
    }
    db.close()
  })

  return { app, ctx }
}
