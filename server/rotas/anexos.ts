// Arquivos anexados aos eventos (prints da conversa, logo, cardápio, PDF…). Ficam no disco do
// servidor, em <pasta de dados>/anexos/<evento>/<arquivo>; o banco guarda nome, tipo e tamanho.
// Os arquivos de eventos excluídos ou que saem numa restauração/limpeza não são apagados: vão para
// <pasta de dados>/anexos-removidos/<data>/<evento>, e voltam sozinhos se o evento voltar (ex.: ao
// restaurar uma cópia do banco).

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Anexo, Evento } from '#shared/tipos.ts'
import type { Contexto } from '../contexto.ts'
import { ErroApi } from '../erros.ts'
import type { ExtensaoRepositorio } from '../extensoes.ts'

/** Tamanho máximo de cada arquivo. */
export const LIMITE_ARQUIVO = 25 * 1024 * 1024

/** Tipos que o navegador mostra direto na tela (os outros são sempre baixados). */
export const TIPOS_NA_TELA = new Set([
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
export function disposicao(tipo: 'inline' | 'attachment', nome: string) {
  const ascii =
    nome
      .normalize('NFD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\]/g, '') || 'arquivo'
  return `${tipo}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`
}

export async function rotasAnexos(app: FastifyInstance, { repo, pastaDados }: Contexto) {
  const pasta = join(pastaDados, 'anexos')
  const removidos = join(pastaDados, 'anexos-removidos')
  const caminho = (a: Pick<Anexo, 'eventoId' | 'id'>) => join(pasta, nomePasta(a.eventoId), a.id)

  /** Tira a pasta do evento de "anexos" sem apagar nada (vai para anexos-removidos/<data>). */
  function guardar(nome: string) {
    const origem = join(pasta, nome)
    if (!existsSync(origem)) return
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
    let destino = join(removidos, carimbo, nome)
    for (let n = 2; existsSync(destino); n++) destino = join(removidos, `${carimbo}-${n}`, nome)
    mkdirSync(join(destino, '..'), { recursive: true })
    renameSync(origem, destino)
  }

  /** Arquivo de um evento que voltou (cópia do banco restaurada): traz de anexos-removidos, o mais recente. */
  function recuperar(a: Anexo): string | null {
    const destino = caminho(a)
    if (existsSync(destino)) return destino
    if (!existsSync(removidos)) return null
    for (const data of readdirSync(removidos).sort().reverse()) {
      const guardado = join(removidos, data, nomePasta(a.eventoId), a.id)
      if (!existsSync(guardado)) continue
      mkdirSync(join(destino, '..'), { recursive: true })
      renameSync(guardado, destino)
      return destino
    }
    return null
  }

  // Eventos excluídos ou que saíram numa restauração/limpeza: os arquivos vão para anexos-removidos
  const limpeza: ExtensaoRepositorio = {
    eventoExcluido(evento: Evento) {
      guardar(nomePasta(evento.id))
    },
    dadosSubstituidos(eventos: Evento[]) {
      if (!existsSync(pasta)) return
      const ficam = new Set(eventos.map((e) => nomePasta(e.id)))
      for (const nome of readdirSync(pasta)) if (!ficam.has(nome)) guardar(nome)
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
    const arquivo = recuperar(anexo)
    if (!arquivo) throw new ErroApi(404, 'O arquivo não está mais no servidor.')
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
