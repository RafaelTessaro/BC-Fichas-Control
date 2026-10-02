import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ErroApi } from '../erros.ts'
import type { Contexto } from '../contexto.ts'

type ComId = FastifyRequest<{ Params: { id: string } }>

/** Lê a versão que o usuário estava editando (controle de edições simultâneas). */
function versaoDo(corpo: unknown): number | undefined {
  const v = (corpo as { versao?: unknown } | null)?.versao
  return typeof v === 'number' && Number.isInteger(v) ? v : undefined
}

export async function rotasDados(app: FastifyInstance, { repo, tempoReal, backups }: Contexto) {
  app.get('/api/dados', async () => repo.dadosCompletos())

  // Atualizações em tempo real para todos os computadores conectados
  app.get('/api/stream', (req, reply) => {
    reply.hijack()
    tempoReal.assinar(reply.raw, repo.revisao())
    req.raw.on('close', () => reply.raw.end())
  })

  // ---- Clientes ----
  app.post('/api/clientes', async (req, reply) => reply.code(201).send(repo.criarCliente(req.body)))
  app.put('/api/clientes/:id', async (req: ComId) => repo.atualizarCliente(req.params.id, req.body, versaoDo(req.body)))
  app.delete('/api/clientes/:id', async (req: ComId, reply) => {
    repo.excluirCliente(req.params.id)
    return reply.code(204).send()
  })

  // ---- Eventos ----
  app.post('/api/eventos', async (req, reply) => reply.code(201).send(repo.criarEvento(req.body)))
  app.put('/api/eventos/:id', async (req: ComId) => repo.atualizarEvento(req.params.id, req.body, versaoDo(req.body)))
  app.patch('/api/eventos/:id', async (req: ComId) => repo.alterarEvento(req.params.id, req.body))
  app.post('/api/eventos/:id/duplicar', async (req: ComId, reply) => reply.code(201).send(repo.duplicarEvento(req.params.id)))
  app.delete('/api/eventos/:id', async (req: ComId, reply) => {
    repo.excluirEvento(req.params.id)
    return reply.code(204).send()
  })

  // ---- Máquinas ----
  app.post('/api/maquinas', async (req, reply) => reply.code(201).send(repo.criarMaquina(req.body)))
  // Quantidade de um tipo (cadastra as que faltam, retira as que sobram)
  app.post('/api/maquinas/quantidade', async (req) => repo.ajustarQuantidade(req.body))
  app.put('/api/maquinas/:id', async (req: ComId) => repo.atualizarMaquina(req.params.id, req.body, versaoDo(req.body)))
  app.delete('/api/maquinas/:id', async (req: ComId, reply) => {
    repo.excluirMaquina(req.params.id)
    return reply.code(204).send()
  })

  // ---- Ordens de serviço (manutenção) ----
  app.post('/api/ordens', async (req, reply) => reply.code(201).send(repo.criarOrdem(req.body)))
  app.put('/api/ordens/:id', async (req: ComId) => repo.atualizarOrdem(req.params.id, req.body, versaoDo(req.body)))
  app.delete('/api/ordens/:id', async (req: ComId, reply) => {
    repo.excluirOrdem(req.params.id)
    return reply.code(204).send()
  })

  // ---- Configurações ----
  app.put('/api/config', async (req) => repo.salvarConfig(req.body))

  // ---- Backup ----
  app.get('/api/backup', async (_req, reply) => {
    const data = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')
    reply.header('Content-Disposition', `attachment; filename="bc-fichas-backup_${data}.json"`)
    return repo.exportar()
  })

  app.post('/api/backup/restaurar', async (req) => {
    backups.copiar('antes-restaurar')
    return repo.restaurar(req.body)
  })

  // Acrescenta (sem apagar) — usado para trazer os dados que ficavam no navegador na versão anterior
  app.post('/api/backup/mesclar', async (req) => {
    backups.copiar('antes-restaurar')
    return repo.mesclar(req.body)
  })

  app.get('/api/backups', async () => ({ backups: backups.listar().slice(0, 10) }))
  app.post('/api/backups', async () => {
    backups.copiar('manual')
    return { backups: backups.listar().slice(0, 10) }
  })

  app.post('/api/exemplo', async () => {
    repo.carregarExemplo()
    return { ok: true }
  })

  app.post('/api/limpar', async (req) => {
    if ((req.body as { confirmacao?: string } | null)?.confirmacao !== 'APAGAR') {
      throw new ErroApi(400, 'Confirmação ausente. Digite APAGAR para confirmar.')
    }
    backups.copiar('antes-limpar')
    repo.limparTudo()
    return { ok: true }
  })
}
