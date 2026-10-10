// Senhas e tokens de sessão, só com o node:crypto (nada nativo além do próprio Node: o argon2 e o
// bcrypt quebrariam o pacote para Windows). O hash é o scrypt, com os parâmetros gravados no próprio
// texto do hash: dá para endurecer os parâmetros no futuro sem invalidar as senhas já gravadas.

import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'

export interface ParametrosSenha {
  /** log2 do custo N do scrypt (N = 2^ln). */
  ln: number
  r: number
  p: number
}

/** N=2^15, r=8, p=3: equivale (OWASP) a N=2^17, r=8, p=1; uns 260 ms por senha. */
export const PARAMETROS_SENHA: ParametrosSenha = { ln: 15, r: 8, p: 3 }
/** Só para os testes (o criarApp recusa fora do vitest). */
export const PARAMETROS_LEVES: ParametrosSenha = { ln: 10, r: 8, p: 1 }

const TAMANHO_SAL = 16
const TAMANHO_HASH = 32
/** Limites aceitos ao ler um hash gravado (fora disso, a senha simplesmente não confere). */
const LIMITES = { ln: [10, 16], r: [1, 16], p: [1, 4] } as const
const FORMATO = /^\$scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/

// ---- Semáforo: no máximo 2 hashes ao mesmo tempo ----------------------------------
// O scrypt roda no threadpool do libuv, o mesmo das leituras e gravações de arquivo.

const MAX_SIMULTANEOS = 2
let emUso = 0
const fila: Array<() => void> = []

async function comVaga<T>(fn: () => Promise<T>): Promise<T> {
  while (emUso >= MAX_SIMULTANEOS) await new Promise<void>((ok) => fila.push(ok))
  emUso++
  try {
    return await fn()
  } finally {
    emUso--
    fila.shift()?.()
  }
}

function derivar(senha: string, sal: Buffer, { ln, r, p }: ParametrosSenha): Promise<Buffer> {
  // Sem o maxmem calculado, o padrão do Node (32 MiB) recusa N=2^15 com r=8
  const opcoes = { N: 2 ** ln, r, p, maxmem: 256 * 2 ** ln * r }
  return comVaga(
    () =>
      new Promise<Buffer>((ok, falha) =>
        scrypt(senha.normalize('NFC'), sal, TAMANHO_HASH, opcoes, (erro, chave) => (erro ? falha(erro) : ok(chave))),
      ),
  )
}

/** Hash no formato `$scrypt$ln=15,r=8,p=3$<sal>$<hash>` (base64url). A senha nunca é truncada. */
export async function gerarHashSenha(senha: string, params: ParametrosSenha = PARAMETROS_SENHA): Promise<string> {
  const sal = randomBytes(TAMANHO_SAL)
  const chave = await derivar(senha, sal, params)
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${sal.toString('base64url')}$${chave.toString('base64url')}`
}

interface HashLido {
  params: ParametrosSenha
  sal: Buffer
  chave: Buffer
}

function lerHash(hash: string): HashLido | null {
  const m = FORMATO.exec(String(hash ?? ''))
  if (!m) return null
  const params = { ln: Number(m[1]), r: Number(m[2]), p: Number(m[3]) }
  const dentro = (v: number, [min, max]: readonly [number, number]) => v >= min && v <= max
  if (!dentro(params.ln, LIMITES.ln) || !dentro(params.r, LIMITES.r) || !dentro(params.p, LIMITES.p)) return null
  const sal = Buffer.from(m[4], 'base64url')
  const chave = Buffer.from(m[5], 'base64url')
  if (sal.length !== TAMANHO_SAL || chave.length !== TAMANHO_HASH) return null
  return { params, sal, chave }
}

/** Confere a senha com o hash gravado. Hash ilegível ou com parâmetros fora dos limites: `false`. */
export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const lido = lerHash(hash)
  if (!lido || typeof senha !== 'string') return false
  try {
    const chave = await derivar(senha, lido.sal, lido.params)
    return chave.length === lido.chave.length && timingSafeEqual(chave, lido.chave)
  } catch {
    return false
  }
}

/** O hash foi feito com outros parâmetros (ou não dá para ler): refazer no próximo login certo. */
export function precisaRefazerHash(hash: string, emUso: ParametrosSenha): boolean {
  const lido = lerHash(hash)
  return !lido || lido.params.ln !== emUso.ln || lido.params.r !== emUso.r || lido.params.p !== emUso.p
}

/** Sem letras e números que se confundem (i, l, o, 0, 1). */
const ALFABETO_TEMPORARIA = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Senha temporária fácil de ditar, ex.: "k7pw-9xqm-3tfa" (3 grupos de 4; ~59 bits). */
export function gerarSenhaTemporaria(): string {
  const grupo = () => Array.from({ length: 4 }, () => ALFABETO_TEMPORARIA[randomInt(ALFABETO_TEMPORARIA.length)]).join('')
  return [grupo(), grupo(), grupo()].join('-')
}

/** Token da sessão (256 bits). Só existe no cookie do navegador. */
export function gerarToken(): string {
  return randomBytes(32).toString('base64url')
}

/** O que o banco guarda no lugar do token (sessoes.id): SHA-256 em hexadecimal. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
