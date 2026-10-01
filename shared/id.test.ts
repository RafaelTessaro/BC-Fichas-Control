import { afterEach, describe, expect, it, vi } from 'vitest'
import { novoId } from './id.ts'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('novoId', () => {
  afterEach(() => vi.restoreAllMocks())

  it('gera UUID v4', () => {
    expect(novoId()).toMatch(UUID_V4)
  })

  it('funciona fora de contexto seguro (http://IP da rede, sem crypto.randomUUID)', () => {
    const original = globalThis.crypto
    const semRandomUUID = { getRandomValues: original.getRandomValues.bind(original) } as unknown as typeof globalThis.crypto
    vi.stubGlobal('crypto', semRandomUUID)
    try {
      const ids = new Set(Array.from({ length: 500 }, () => novoId()))
      expect(ids.size).toBe(500)
      for (const id of ids) expect(id).toMatch(UUID_V4)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
