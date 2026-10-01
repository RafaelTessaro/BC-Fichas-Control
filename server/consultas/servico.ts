// Serviço de consultas usado pelas rotas: valida, consulta com fallback, guarda em cache e traduz erros.

import { cnpjAlfanumerico, cnpjValido, mascaraCep, mascaraCnpj, normalizarCnpj, somenteDigitos } from '#shared/documentos.ts'
import { ErroApi } from '../erros.ts'
import { PROVEDORES_CEP, type DadosCep } from './cep.ts'
import { PROVEDORES_CNPJ, type DadosCnpj } from './cnpj.ts'
import { CacheTemporario, consultarEmOrdem, type Fetch, type Provedor, type ResultadoConsulta } from './motor.ts'

export type { DadosCep } from './cep.ts'
export type { DadosCnpj } from './cnpj.ts'

const HORA = 60 * 60 * 1000

export interface OpcoesConsultas {
  /** Implementação de `fetch` (injetável nos testes). */
  fetch?: Fetch
  /** Tempo máximo por provedor; padrão 8 s. */
  timeoutMs?: number
  /** Validade do cache de resultados encontrados; padrão 24 h. */
  validadeMs?: number
  /** Validade do cache de "não encontrado" (um CNPJ recém-aberto pode aparecer depois); padrão 1 h. */
  validadeNaoEncontradoMs?: number
  agora?: () => number
  provedoresCnpj?: Provedor<DadosCnpj>[]
  provedoresCep?: Provedor<DadosCep>[]
}

export const MENSAGENS = {
  cnpjInvalido: 'CNPJ inválido. Confira o número digitado.',
  cnpjNaoEncontrado: 'CNPJ não encontrado na Receita Federal.',
  cnpjAlfanumerico:
    'Os serviços de consulta ainda não reconhecem este CNPJ no formato novo, com letras. Preencha os dados da empresa à mão.',
  cepInvalido: 'CEP inválido. Informe os 8 números.',
  cepNaoEncontrado: 'CEP não encontrado.',
  semInternet: 'Sem conexão com a internet no servidor. Preencha os dados manualmente.',
  indisponivel: 'Os serviços de consulta não responderam agora. Tente de novo em instantes ou preencha os dados manualmente.',
}

type Guardado<T> = { tipo: 'ok'; dados: T } | { tipo: 'naoEncontrado' }

/** Consulta com cache e sem repetir pedidos simultâneos para a mesma chave. */
function criarConsulta<T>(
  provedores: Provedor<T>[],
  opcoes: Required<Pick<OpcoesConsultas, 'fetch' | 'timeoutMs' | 'validadeMs' | 'validadeNaoEncontradoMs' | 'agora'>>,
) {
  const cache = new CacheTemporario<Guardado<T>>(1000, opcoes.agora)
  const emAndamento = new Map<string, Promise<ResultadoConsulta<T>>>()

  async function consultar(chave: string): Promise<ResultadoConsulta<T>> {
    const guardado = cache.obter(chave)
    if (guardado) return guardado
    let pedido = emAndamento.get(chave)
    if (!pedido) {
      pedido = consultarEmOrdem(chave, provedores, opcoes).finally(() => emAndamento.delete(chave))
      emAndamento.set(chave, pedido)
    }
    const r = await pedido
    if (r.tipo === 'ok') cache.guardar(chave, r, opcoes.validadeMs)
    else if (r.tipo === 'naoEncontrado') cache.guardar(chave, r, opcoes.validadeNaoEncontradoMs)
    return r
  }

  return { consultar, cache }
}

function erroIndisponivel(r: Extract<ResultadoConsulta<unknown>, { tipo: 'indisponivel' }>) {
  return r.semInternet
    ? new ErroApi(503, MENSAGENS.semInternet, { motivo: 'sem_internet' })
    : new ErroApi(503, MENSAGENS.indisponivel, { motivo: 'servicos_indisponiveis' })
}

export function criarServicoConsultas(opcoes: OpcoesConsultas = {}) {
  const base = {
    fetch: opcoes.fetch ?? ((...args: Parameters<Fetch>) => fetch(...args)),
    timeoutMs: opcoes.timeoutMs ?? 8000,
    validadeMs: opcoes.validadeMs ?? 24 * HORA,
    validadeNaoEncontradoMs: opcoes.validadeNaoEncontradoMs ?? HORA,
    agora: opcoes.agora ?? Date.now,
  }
  const cnpj = criarConsulta(opcoes.provedoresCnpj ?? PROVEDORES_CNPJ, base)
  const cep = criarConsulta(opcoes.provedoresCep ?? PROVEDORES_CEP, base)

  return {
    /** Dados da empresa na Receita Federal. Lança ErroApi 400, 404 ou 503. */
    async cnpj(valor: string): Promise<DadosCnpj> {
      // Enviado como está (só sem pontuação): o CNPJ alfanumérico mantém as letras maiúsculas
      const chave = normalizarCnpj(valor)
      if (!cnpjValido(chave)) throw new ErroApi(400, MENSAGENS.cnpjInvalido)
      const r = await cnpj.consultar(chave)
      if (r.tipo === 'ok') return { ...r.dados, cnpj: mascaraCnpj(chave) }
      // Os provedores podem ainda não aceitar o CNPJ com letras (respondem 400, 404 ou erro):
      // repetir não adianta, então avisa para preencher à mão (só a falta de internet é tratada como tal)
      if (cnpjAlfanumerico(chave) && !(r.tipo === 'indisponivel' && r.semInternet)) {
        throw new ErroApi(404, MENSAGENS.cnpjAlfanumerico, { motivo: 'cnpj_alfanumerico' })
      }
      if (r.tipo === 'naoEncontrado') throw new ErroApi(404, MENSAGENS.cnpjNaoEncontrado)
      throw erroIndisponivel(r)
    },

    /** Endereço do CEP. Lança ErroApi 400, 404 ou 503. */
    async cep(valor: string): Promise<DadosCep> {
      const digitos = somenteDigitos(valor)
      if (digitos.length !== 8 || valor.replace(/[\d.\-\s]/g, '') !== '') throw new ErroApi(400, MENSAGENS.cepInvalido)
      const r = await cep.consultar(digitos)
      if (r.tipo === 'ok') return { ...r.dados, cep: mascaraCep(digitos) }
      if (r.tipo === 'naoEncontrado') throw new ErroApi(404, MENSAGENS.cepNaoEncontrado)
      throw erroIndisponivel(r)
    },

    limparCache() {
      cnpj.cache.limpar()
      cep.cache.limpar()
    },
  }
}

export type ServicoConsultas = ReturnType<typeof criarServicoConsultas>
