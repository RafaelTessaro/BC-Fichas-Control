import type { FastifyInstance } from 'fastify'
import type { Contexto } from '../contexto.ts'

/**
 * Consultas a serviços públicos (precisam de internet no servidor):
 *   GET /api/consultas/cnpj/:cnpj  → dados da empresa na Receita Federal
 *   GET /api/consultas/cep/:cep    → endereço do CEP
 */
export async function rotasConsultas(app: FastifyInstance, _ctx: Contexto) {
  app.get('/api/consultas/cnpj/:cnpj', async (_req, reply) =>
    reply.code(501).send({ erro: 'Consulta de CNPJ ainda não disponível.' }),
  )
  app.get('/api/consultas/cep/:cep', async (_req, reply) =>
    reply.code(501).send({ erro: 'Consulta de CEP ainda não disponível.' }),
  )
}
