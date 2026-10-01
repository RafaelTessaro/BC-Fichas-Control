import type { FastifyInstance } from 'fastify'
import { criarServicoConsultas, type OpcoesConsultas } from '../consultas/servico.ts'
import type { Contexto } from '../contexto.ts'

/**
 * Consultas a serviços públicos (precisam de internet no servidor):
 *   GET /api/consultas/cnpj/:cnpj  → dados da empresa na Receita Federal
 *   GET /api/consultas/cep/:cep    → endereço do CEP
 *
 * Sem internet o restante do sistema continua funcionando normalmente na rede local;
 * só estas rotas respondem 503 e o cadastro é feito à mão.
 */
export async function rotasConsultas(app: FastifyInstance, _ctx: Contexto, opcoes: OpcoesConsultas = {}) {
  const servico = criarServicoConsultas(opcoes)

  app.get<{ Params: { cnpj: string } }>('/api/consultas/cnpj/:cnpj', async (req) => servico.cnpj(req.params.cnpj))

  app.get<{ Params: { cep: string } }>('/api/consultas/cep/:cep', async (req) => servico.cep(req.params.cep))
}
