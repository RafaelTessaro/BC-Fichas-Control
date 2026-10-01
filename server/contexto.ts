import type { FastifyBaseLogger } from 'fastify'
import type { BackupsAutomaticos } from './backup.ts'
import type { Banco } from './db.ts'
import type { Repositorio } from './repositorio.ts'
import type { TempoReal } from './tempoReal.ts'

/** Dependências compartilhadas pelos módulos do servidor. */
export interface Contexto {
  db: Banco
  repo: Repositorio
  tempoReal: TempoReal
  backups: BackupsAutomaticos
  /** Pasta onde ficam o banco, os backups e as credenciais. */
  pastaDados: string
  log: FastifyBaseLogger
}
