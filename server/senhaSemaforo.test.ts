// O semáforo do scrypt (no máximo 2 hashes ao mesmo tempo, para não ocupar o threadpool das leituras e
// gravações de arquivo). Arquivo próprio: o vi.mock do node:crypto vale para o arquivo inteiro.
import { expect, it, vi } from 'vitest'

/** Derivações do scrypt em andamento agora e o maior número visto ao mesmo tempo. */
const medida = vi.hoisted(() => ({ agora: 0, maximo: 0 }))

vi.mock('node:crypto', async (original) => {
  const real = await original<typeof import('node:crypto')>()
  const scrypt = (...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, k?: Buffer) => void
    medida.agora++
    medida.maximo = Math.max(medida.maximo, medida.agora)
    ;(real.scrypt as unknown as (...a: unknown[]) => void)(...args.slice(0, -1), (e: Error | null, k?: Buffer) => {
      medida.agora--
      cb(e, k)
    })
  }
  return { ...real, scrypt, default: { ...real, scrypt } }
})

const { conferirSenha, gerarHashSenha, PARAMETROS_LEVES } = await import('./senha.ts')

it('no máximo 2 derivações do scrypt ao mesmo tempo, e todas terminam', async () => {
  const hashes = await Promise.all(Array.from({ length: 6 }, (_, i) => gerarHashSenha(`senha número ${i}`, PARAMETROS_LEVES)))
  expect(medida.maximo).toBe(2)
  expect(medida.agora).toBe(0)
  expect(await Promise.all(hashes.map((h, i) => conferirSenha(`senha número ${i}`, h)))).toEqual(Array(6).fill(true))
  expect(medida.maximo).toBe(2)
})
