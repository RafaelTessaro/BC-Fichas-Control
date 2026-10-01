// Motor das consultas: tenta cada provedor em ordem, com tempo limite, e guarda o resultado em cache.

export type Fetch = typeof fetch

/** Como um provedor entendeu a resposta. */
export type Interpretacao<T> =
  | { tipo: 'ok'; dados: T }
  /** `definitivo`: o provedor é confiável para afirmar que não existe (encerra a busca). */
  | { tipo: 'naoEncontrado'; definitivo: boolean }
  | { tipo: 'falha'; motivo: string }

export interface Provedor<T> {
  nome: string
  url: (chave: string) => string
  /** Recebe o status HTTP (exceto 429/5xx, que já contam como falha) e o JSON da resposta. */
  interpretar: (status: number, corpo: unknown) => Interpretacao<T>
}

export type ResultadoConsulta<T> =
  | { tipo: 'ok'; dados: T }
  | { tipo: 'naoEncontrado' }
  /** Nenhum provedor respondeu; `semInternet` quando todos falharam por rede/tempo esgotado. */
  | { tipo: 'indisponivel'; semInternet: boolean; falhas: string[] }

export interface OpcoesMotor {
  fetch: Fetch
  /** Tempo máximo por provedor, em milissegundos. */
  timeoutMs: number
}

const CABECALHOS = { Accept: 'application/json', 'User-Agent': 'BC-Fichas-Control/2.0 (+servidor local)' }

/** Consulta os provedores em ordem até um deles responder de forma conclusiva. */
export async function consultarEmOrdem<T>(
  chave: string,
  provedores: Provedor<T>[],
  { fetch, timeoutMs }: OpcoesMotor,
): Promise<ResultadoConsulta<T>> {
  const falhas: string[] = []
  let falhasDeRede = 0
  let naoEncontrado = false

  for (const p of provedores) {
    let resp: Response
    try {
      resp = await fetch(p.url(chave), { headers: CABECALHOS, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    } catch (e) {
      falhasDeRede++
      const tempo = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      falhas.push(`${p.nome}: ${tempo ? 'tempo esgotado' : 'sem conexão'}`)
      continue
    }

    if (resp.status === 429 || resp.status >= 500) {
      falhas.push(`${p.nome}: HTTP ${resp.status}`)
      await resp.body?.cancel().catch(() => {})
      continue
    }

    let corpo: unknown = null
    try {
      corpo = await resp.json()
    } catch (e) {
      // Conexão caiu no meio da leitura: conta como rede; corpo que não é JSON conta como falha do serviço
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        falhasDeRede++
        falhas.push(`${p.nome}: tempo esgotado`)
        continue
      }
      corpo = null
    }

    let r: Interpretacao<T>
    try {
      r = p.interpretar(resp.status, corpo)
    } catch {
      r = { tipo: 'falha', motivo: 'resposta inesperada' }
    }
    if (r.tipo === 'ok') return r
    if (r.tipo === 'naoEncontrado') {
      if (r.definitivo) return { tipo: 'naoEncontrado' }
      naoEncontrado = true
      falhas.push(`${p.nome}: não encontrado`)
      continue
    }
    falhas.push(`${p.nome}: ${r.motivo}`)
  }

  if (naoEncontrado) return { tipo: 'naoEncontrado' }
  return { tipo: 'indisponivel', semInternet: falhasDeRede === provedores.length, falhas }
}

/** Cache em memória com validade e limite de itens (descarta os mais antigos). */
export class CacheTemporario<T> {
  private readonly itens = new Map<string, { valor: T; expira: number }>()
  private readonly maximo: number
  private readonly agora: () => number

  constructor(maximo = 500, agora: () => number = Date.now) {
    this.maximo = maximo
    this.agora = agora
  }

  obter(chave: string): T | undefined {
    const item = this.itens.get(chave)
    if (!item) return undefined
    if (item.expira <= this.agora()) {
      this.itens.delete(chave)
      return undefined
    }
    return item.valor
  }

  guardar(chave: string, valor: T, validadeMs: number) {
    this.itens.delete(chave)
    this.itens.set(chave, { valor, expira: this.agora() + validadeMs })
    while (this.itens.size > this.maximo) {
      const maisAntiga = this.itens.keys().next().value
      if (maisAntiga === undefined) break
      this.itens.delete(maisAntiga)
    }
  }

  limpar() {
    this.itens.clear()
  }

  get tamanho() {
    return this.itens.size
  }
}

// ---- Leitura defensiva do JSON dos provedores ----

export type Objeto = Record<string, unknown>

export const comoObjeto = (v: unknown): Objeto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Objeto) : {})
