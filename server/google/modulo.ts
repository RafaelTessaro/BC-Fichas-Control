import type { FastifyInstance } from 'fastify'
import type { Contexto } from '../contexto.ts'
import type { ExtensaoRepositorio } from '../extensoes.ts'

export interface ModuloGoogle {
  /** Ganchos do repositório (marca eventos para sincronizar, anexa o status). */
  extensao: ExtensaoRepositorio
  /** Rotas em /api/google/*. */
  rotas(app: FastifyInstance): Promise<void>
  /** Inicia o sincronizador em segundo plano. */
  iniciar(): void
  parar(): void
}

/** Integração com o Google Agenda (envia os eventos do sistema para uma agenda do Google). */
export function criarModuloGoogle(_ctx: Contexto): ModuloGoogle {
  return {
    extensao: {},
    async rotas(app) {
      app.get('/api/google/status', async () => ({ configurado: false, ativo: false }))
    },
    iniciar() {},
    parar() {},
  }
}
