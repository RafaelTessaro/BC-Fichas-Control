import { describe, expect, it } from 'vitest'
import {
  conferirSenha,
  gerarHashSenha,
  gerarSenhaTemporaria,
  gerarToken,
  hashToken,
  PARAMETROS_LEVES,
  PARAMETROS_SENHA,
  precisaRefazerHash,
} from './senha.ts'

describe('hash de senha (scrypt)', () => {
  it('grava no formato $scrypt$ln=…,r=…,p=…$sal$hash e confere', async () => {
    const hash = await gerarHashSenha('cavalo azul pulando', PARAMETROS_LEVES)
    expect(hash).toMatch(/^\$scrypt\$ln=10,r=8,p=1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/)
    expect(await conferirSenha('cavalo azul pulando', hash)).toBe(true)
    expect(await conferirSenha('cavalo azul pulandO', hash)).toBe(false)
    expect(await conferirSenha('', hash)).toBe(false)
    // Sal novo a cada hash
    expect(await gerarHashSenha('cavalo azul pulando', PARAMETROS_LEVES)).not.toBe(hash)
  })

  it('"é" composto e decomposto conferem (normalização NFC)', async () => {
    const composto = 'café com pão quente'
    const decomposto = composto.normalize('NFD')
    expect(decomposto).not.toBe(composto)
    const hash = await gerarHashSenha(decomposto, PARAMETROS_LEVES)
    expect(await conferirSenha(composto, hash)).toBe(true)
  })

  it('hash ilegível ou com parâmetros fora dos limites não confere (nem lança)', async () => {
    const bom = await gerarHashSenha('senha boa demais', PARAMETROS_LEVES)
    const [, , , sal, chave] = bom.split('$')
    const ruins = [
      '',
      'texto qualquer',
      '$scrypt$ln=10,r=8,p=1$',
      `$scrypt$ln=9,r=8,p=1$${sal}$${chave}`, // custo baixo demais
      `$scrypt$ln=17,r=8,p=1$${sal}$${chave}`, // custo alto demais (negação de serviço)
      `$scrypt$ln=10,r=17,p=1$${sal}$${chave}`,
      `$scrypt$ln=10,r=8,p=5$${sal}$${chave}`,
      `$scrypt$ln=10,r=8,p=1$${sal.slice(2)}$${chave}`, // sal de outro tamanho
      `$scrypt$ln=10,r=8,p=1$${sal}$${chave.slice(4)}`, // hash de outro tamanho
      `$bcrypt$ln=10,r=8,p=1$${sal}$${chave}`,
    ]
    for (const h of ruins) expect(await conferirSenha('senha boa demais', h), h).toBe(false)
    // Tamanhos de senha diferentes não lançam erro (timingSafeEqual exige o mesmo tamanho)
    expect(await conferirSenha('x'.repeat(500), bom)).toBe(false)
  })

  it('precisaRefazerHash compara com os parâmetros em uso', async () => {
    const leve = await gerarHashSenha('outra senha boa', PARAMETROS_LEVES)
    expect(precisaRefazerHash(leve, PARAMETROS_LEVES)).toBe(false)
    expect(precisaRefazerHash(leve, PARAMETROS_SENHA)).toBe(true)
    expect(precisaRefazerHash('ilegível', PARAMETROS_LEVES)).toBe(true)
  })

  it('os parâmetros de produção funcionam (maxmem calculado)', async () => {
    const hash = await gerarHashSenha('frase longa de verdade', PARAMETROS_SENHA)
    expect(hash.startsWith('$scrypt$ln=15,r=8,p=3$')).toBe(true)
    expect(await conferirSenha('frase longa de verdade', hash)).toBe(true)
  }, 20_000)

  it('vários hashes ao mesmo tempo (semáforo) terminam todos', async () => {
    const hashes = await Promise.all(Array.from({ length: 6 }, (_, i) => gerarHashSenha(`senha número ${i}`, PARAMETROS_LEVES)))
    const conferidos = await Promise.all(hashes.map((h, i) => conferirSenha(`senha número ${i}`, h)))
    expect(conferidos).toEqual([true, true, true, true, true, true])
  })
})

describe('senha temporária e token', () => {
  it('senha temporária: 3 grupos de 4, sem letras e números que se confundem', () => {
    const vistas = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const s = gerarSenhaTemporaria()
      expect(s).toMatch(/^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/)
      vistas.add(s)
    }
    expect(vistas.size).toBe(200)
  })

  it('token de 256 bits; o banco guarda só o SHA-256 em hexadecimal', () => {
    const token = gerarToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(gerarToken()).not.toBe(token)
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).toBe(hashToken(token))
  })
})
