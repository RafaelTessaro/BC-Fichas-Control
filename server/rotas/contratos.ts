// Contratos de locação: gerar (com os dados congelados), mudar a situação e guardar o arquivo
// assinado (foto ou PDF digitalizado) em <pasta de dados>/contratos/<contrato>/assinado.
// O PDF do contrato em si é montado no navegador a partir dos dados gravados.

import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Contexto } from '../contexto.ts'
import { ErroApi } from '../erros.ts'
import { disposicao, nomeSeguro, TIPOS_NA_TELA } from './anexos.ts'

type ComId = FastifyRequest<{ Params: { id: string }; Querystring: { baixar?: string } }>

/** Tipos aceitos para a cópia assinada: PDF ou foto. */
const TIPOS_ASSINADO = /^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/

export async function rotasContratos(app: FastifyInstance, { repo, pastaDados }: Contexto) {
  const pasta = join(pastaDados, 'contratos')
  // Os ids são gerados pelo servidor (UUID); de backups antigos, só letras, números e hífen
  const caminho = (id: string) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new ErroApi(404, 'Contrato não encontrado.')
    return join(pasta, id, 'assinado')
  }

  app.post('/api/contratos', async (req, reply) => reply.code(201).send(repo.criarContrato(req.body)))
  app.patch('/api/contratos/:id', async (req: ComId) => repo.alterarContrato(req.params.id, req.body))
  app.delete('/api/contratos/:id', async (req: ComId, reply) => {
    const contrato = repo.excluirContrato(req.params.id)
    // A cópia assinada sai junto (a pasta do contrato inteira)
    rmSync(join(caminho(contrato.id), '..'), { recursive: true, force: true })
    return reply.code(204).send()
  })

  // O parser de application/octet-stream é o dos anexos (registrado em rotasAnexos)
  app.post('/api/contratos/:id/arquivo', async (req: ComId) => {
    const corpo = req.body
    if (!Buffer.isBuffer(corpo)) throw new ErroApi(400, 'Envie o arquivo como application/octet-stream.')
    if (!corpo.length) throw new ErroApi(400, 'O arquivo está vazio.')
    const nome = nomeSeguro(String(req.headers['x-nome'] ?? 'contrato-assinado'))
    const tipo = String(req.headers['x-tipo'] ?? '').toLowerCase()
    if (!TIPOS_ASSINADO.test(tipo)) throw new ErroApi(400, 'Envie o contrato assinado em PDF ou foto (JPG, PNG).')
    const destino = caminho(req.params.id)
    return repo.registrarArquivoContrato(req.params.id, { nome, tipo, tamanho: corpo.length }, () => {
      mkdirSync(join(destino, '..'), { recursive: true })
      // Grava num arquivo temporário e troca: se algo falhar, o anterior continua inteiro
      const temporario = `${destino}.novo`
      writeFileSync(temporario, corpo)
      renameSync(temporario, destino)
    })
  })

  app.get('/api/contratos/:id/arquivo', async (req: ComId, reply) => {
    const contrato = repo.obterContrato(req.params.id)
    if (!contrato) throw new ErroApi(404, 'Contrato não encontrado.')
    const arquivo = caminho(contrato.id)
    if (!contrato.arquivo || !existsSync(arquivo)) throw new ErroApi(404, 'O contrato assinado não está no servidor.')
    const naTela = TIPOS_NA_TELA.has(contrato.arquivo.tipo) && req.query.baixar === undefined
    reply.header('Content-Type', naTela ? contrato.arquivo.tipo : 'application/octet-stream')
    reply.header('Content-Disposition', disposicao(naTela ? 'inline' : 'attachment', contrato.arquivo.nome))
    reply.header('Content-Length', String(statSync(arquivo).size))
    if (naTela && contrato.arquivo.tipo !== 'application/pdf')
      reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'")
    return reply.send(createReadStream(arquivo))
  })

  app.delete('/api/contratos/:id/arquivo', async (req: ComId) => {
    const { contrato } = repo.removerArquivoContrato(req.params.id)
    rmSync(caminho(contrato.id), { force: true })
    return contrato
  })
}
