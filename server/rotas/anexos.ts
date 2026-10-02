// Arquivos anexados aos eventos (prints da conversa, logo, cardápio, PDF…). Ficam no disco do
// servidor, em <pasta de dados>/anexos/<evento>/<arquivo>; o banco guarda nome, tipo e tamanho.

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Anexo, Evento } from '#shared/tipos.ts'
import type { Contexto } from '../contexto.ts'
import { ErroApi } from '../erros.ts'
import type { ExtensaoRepositorio } from '../extensoes.ts'

/** Tamanho máximo de cada arquivo. */
export const LIMITE_ARQUIVO = 25 * 1024 * 1024

/** Tipos que o navegador mostra direto na tela (os outros são sempre baixados). */
const TIPOS_NA_TELA = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'application/pdf',
  'text/plain',
])

type ComId = FastifyRequest<{ Params: { id: string }; Querystring: { baixar?: string } }>

/** Nome de pasta seguro para o evento (ids estranhos vindos de backups antigos viram um hash). */
const nomePasta = (eventoId: string) =>
  /^[A-Za-z0-9_-]{1,100}$/.test(eventoId) ? eventoId : `e-${createHash('sha1').update(eventoId).digest('hex')}`

/** Nome do arquivo sem caminho e sem caracteres que o Windows não aceita. */
export function nomeSeguro(bruto: string) {
  let nome = bruto
  try {
    nome = decodeURIComponent(bruto)
  } catch {
    /* já veio decodificado */
  }
  nome = nome
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f<>:"|?*]+/g, '-')
    .trim()
    .slice(0, 150)
  return nome && nome !== '.' && nome !== '..' ? nome : 'arquivo'
}

/** "attachment; filename="x.pdf"; filename*=UTF-8''..." com o nome original (acentos inclusive). */
function disposicao(tipo: 'inline' | 'attachment', nome: string) {
  const ascii =
    nome
      .normalize('NFD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '') || 'arquivo'
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

export async function rotasAnexos(app: FastifyInstance, { repo, pastaDados }: Contexto) {
  const pasta = join(pastaDados, 'anexos')
  const caminho = (a: Pick<Anexo, 'eventoId' | 'id'>) => join(pasta, nomePasta(a.eventoId), a.id)

  // Apaga do disco os arquivos de eventos excluídos ou que sumiram numa restauração de backup
  const limpeza: ExtensaoRepositorio = {
    eventoExcluido(evento: Evento) {
      rmSync(join(pasta, nomePasta(evento.id)), { recursive: true, force: true })
    },
    dadosSubstituidos(eventos: Evento[]) {
      if (!existsSync(pasta)) return
      const ficam = new Set(eventos.map((e) => nomePasta(e.id)))
      for (const nome of readdirSync(pasta)) {
        if (!ficam.has(nome)) rmSync(join(pasta, nome), { recursive: true, force: true })
      }
    },
  }
  repo.registrarExtensao(limpeza)

  // O conteúdo chega como está (sem multipart): nome e tipo vão nos cabeçalhos
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: LIMITE_ARQUIVO }, (_req, corpo, pronto) =>
    pronto(null, corpo),
  )

  app.post('/api/eventos/:id/anexos', async (req: ComId, reply) => {
    const corpo = req.body
    if (!Buffer.isBuffer(corpo)) throw new ErroApi(400, 'Envie o arquivo como application/octet-stream.')
    if (!corpo.length) throw new ErroApi(400, 'O arquivo está vazio.')
    const nome = nomeSeguro(String(req.headers['x-nome'] ?? 'arquivo'))
    const tipoBruto = String(req.headers['x-tipo'] ?? '').toLowerCase()
    const tipo = /^[\w.+-]+\/[\w.+-]+$/.test(tipoBruto) ? tipoBruto : 'application/octet-stream'
    const anexo = repo.registrarAnexo({ eventoId: req.params.id, nome, tipo, tamanho: corpo.length }, (id) => {
      const destino = caminho({ eventoId: req.params.id, id })
      mkdirSync(join(destino, '..'), { recursive: true })
      writeFileSync(destino, corpo)
    })
    return reply.code(201).send(anexo)
  })

  app.get('/api/anexos/:id', async (req: ComId, reply) => {
    const anexo = repo.obterAnexo(req.params.id)
    if (!anexo) throw new ErroApi(404, 'Arquivo não encontrado.')
    const arquivo = caminho(anexo)
    if (!existsSync(arquivo)) throw new ErroApi(404, 'O arquivo não está mais no servidor.')
    const naTela = TIPOS_NA_TELA.has(anexo.tipo) && req.query.baixar === undefined
    reply.header(
      'Content-Type',
      naTela ? (anexo.tipo === 'text/plain' ? 'text/plain; charset=utf-8' : anexo.tipo) : 'application/octet-stream',
    )
    reply.header('Content-Disposition', disposicao(naTela ? 'inline' : 'attachment', anexo.nome))
    reply.header('Content-Length', String(statSync(arquivo).size))
    // Mostrado direto na tela, nunca roda nada (texto e imagens; o PDF usa o leitor do navegador)
    if (naTela && anexo.tipo !== 'application/pdf')
      reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    return reply.send(createReadStream(arquivo))
  })

  app.delete('/api/anexos/:id', async (req: ComId, reply) => {
    const anexo = repo.excluirAnexo(req.params.id)
    rmSync(caminho(anexo), { force: true })
    return reply.code(204).send()
  })
}
