// Abertura do banco por vários processos ao mesmo tempo (o serviço subindo enquanto a ferramenta de
// senha roda): todos precisam conseguir, e a migração roda uma vez só.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { abrirBanco } from './db.ts'

const DB_TS = fileURLToPath(new URL('./db.ts', import.meta.url))

let pasta: string
beforeEach(() => {
  pasta = mkdtempSync(join(tmpdir(), 'bcf-db-'))
})
afterEach(() => {
  rmSync(pasta, { recursive: true, force: true })
})

/** Abre `arquivo` em `quantos` processos, todos no mesmo instante; devolve o que cada um respondeu. */
async function abrirJuntos(arquivo: string, quantos: number): Promise<string[]> {
  const largada = Date.now() + 700
  const codigo = `
    const { abrirBanco } = await import(${JSON.stringify(DB_TS)})
    while (Date.now() < ${largada});
    try {
      const db = abrirBanco(${JSON.stringify(arquivo)})
      const { user_version } = db.prepare('PRAGMA user_version').get()
      db.close()
      console.log('ok ' + user_version)
    } catch (e) {
      console.log('ERRO ' + e.message)
    }`
  return Promise.all(
    Array.from(
      { length: quantos },
      () =>
        new Promise<string>((ok) => {
          const p = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', codigo])
          let saida = ''
          p.stdout.on('data', (d) => (saida += d))
          p.on('close', () => ok(saida.trim()))
        }),
    ),
  )
}

/** Banco da 2.5 (sem as tabelas de usuários), fechado e sem -wal ao lado; `rollback`: como sai do VACUUM INTO. */
function banco25(arquivo: string, rollback: boolean) {
  const db = abrirBanco(arquivo)
  db.exec('DROP TABLE sessoes; DROP TABLE auditoria; DROP TABLE usuarios; PRAGMA user_version = 4')
  if (rollback) db.exec('PRAGMA journal_mode = DELETE')
  db.close()
  expect(existsSync(`${arquivo}-wal`)).toBe(false)
}

describe('abrirBanco em vários processos ao mesmo tempo', { timeout: 60_000 }, () => {
  const versaoAtual = () => {
    const db = abrirBanco(':memory:')
    try {
      return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    } finally {
      db.close()
    }
  }

  it('banco a migrar, já em WAL, e banco vindo de uma cópia (VACUUM INTO): todos abrem e migram', async () => {
    const esperado = `ok ${versaoAtual()}`
    for (const [i, rollback] of [false, true, false, true].entries()) {
      const arquivo = join(pasta, `b${i}.db`)
      banco25(arquivo, rollback)
      expect(await abrirJuntos(arquivo, 4)).toEqual(Array(4).fill(esperado))
    }
  })

  it('banco que ainda não existe', async () => {
    const esperado = `ok ${versaoAtual()}`
    for (let i = 0; i < 2; i++) expect(await abrirJuntos(join(pasta, `novo${i}.db`), 4)).toEqual(Array(4).fill(esperado))
  })
})
