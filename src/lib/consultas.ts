// Consultas de CNPJ e CEP feitas pelo servidor (é ele quem acessa a internet).

import type { Tone } from '#shared/calc.ts'
import { somenteDigitos } from '#shared/documentos.ts'
import type { ClienteInput, TipoCliente } from '#shared/tipos.ts'
import { api, ErroApi } from './api'

/** Dados da empresa na Receita Federal (mesmo formato de `server/consultas/cnpj.ts`). */
export interface DadosCnpj {
  cnpj: string
  /** Razão social oficial. */
  razaoSocial: string
  /** Nome fantasia em formato de título; vazio quando a empresa não tem. */
  nomeFantasia: string
  /** Nome fantasia ou, na falta, a razão social em formato de título. */
  nomeSugerido: string
  /** ATIVA, BAIXADA, INAPTA, SUSPENSA ou NULA. */
  situacaoCadastral: string
  /** yyyy-MM-dd */
  dataAbertura: string
  atividadePrincipal: string
  telefone: string
  email: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  fonte: string
}

export interface DadosCep {
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
  fonte: string
}

/** Três provedores com até 8 s cada: o navegador espera um pouco mais que isso. */
const TEMPO_LIMITE = 30_000

export const consultarCnpj = (cnpj: string) => api.get<DadosCnpj>(`/api/consultas/cnpj/${somenteDigitos(cnpj)}`, TEMPO_LIMITE)

export const consultarCep = (cep: string) => api.get<DadosCep>(`/api/consultas/cep/${somenteDigitos(cep)}`, TEMPO_LIMITE)

// ---- Erros ------------------------------------------------------------------

export type TipoErroConsulta = 'invalido' | 'naoEncontrado' | 'semInternet' | 'semServidor' | 'outro'

/** Classifica o erro de uma consulta e devolve uma mensagem amigável. */
export function erroDeConsulta(e: unknown, oQue: 'CNPJ' | 'CEP'): { tipo: TipoErroConsulta; mensagem: string } {
  if (!(e instanceof ErroApi)) return { tipo: 'outro', mensagem: `Não foi possível consultar o ${oQue}.` }
  if (e.status === 0) {
    return { tipo: 'semServidor', mensagem: 'Sem conexão com o servidor. Verifique a rede e preencha os dados à mão.' }
  }
  if (e.status === 400) return { tipo: 'invalido', mensagem: e.message }
  if (e.status === 404) return { tipo: 'naoEncontrado', mensagem: e.message }
  if (e.status === 503) {
    return {
      tipo: 'semInternet',
      mensagem:
        e.dados.motivo === 'sem_internet'
          ? 'O servidor está sem internet agora, então não dá para consultar. Pode preencher os dados à mão normalmente.'
          : e.message,
    }
  }
  return { tipo: 'outro', mensagem: e.message }
}

// ---- Situação cadastral -------------------------------------------------------

/** Cor do selo da situação cadastral. */
export function tomSituacao(situacao: string): Tone {
  const s = situacao.toUpperCase()
  if (!s) return 'neutral'
  if (s === 'ATIVA') return 'success'
  if (s === 'BAIXADA' || s === 'NULA') return 'danger'
  return 'warning'
}

/** Aviso claro para situações que pedem atenção; `null` para ATIVA ou desconhecida. */
export function avisoSituacao(situacao: string): string | null {
  switch (situacao.toUpperCase()) {
    case 'BAIXADA':
      return 'Empresa encerrada (baixada) na Receita Federal. Confirme com o cliente antes de fechar negócio.'
    case 'INAPTA':
      return 'CNPJ inapto na Receita Federal, geralmente por falta de declarações. Confirme a situação com o cliente.'
    case 'SUSPENSA':
      return 'CNPJ suspenso na Receita Federal. Confirme a situação com o cliente.'
    case 'NULA':
      return 'CNPJ anulado pela Receita Federal. Não use este CNPJ em documentos.'
    default:
      return null
  }
}

/** Situação em texto de leitura ("ATIVA" → "Ativa"). */
export const rotuloSituacao = (situacao: string) =>
  situacao ? situacao.charAt(0).toUpperCase() + situacao.slice(1).toLowerCase() : ''

// ---- Preenchimento do formulário -------------------------------------------------

/** Campos do cliente preenchidos pela consulta de CNPJ. */
export function camposDoCnpj(d: DadosCnpj, agoraIso: string): Partial<ClienteInput> {
  return {
    razaoSocial: d.razaoSocial,
    nome: d.nomeSugerido,
    telefone: d.telefone,
    email: d.email,
    cep: d.cep,
    logradouro: d.logradouro,
    numero: d.numero,
    complemento: d.complemento,
    bairro: d.bairro,
    cidade: d.cidade,
    uf: d.uf,
    situacaoCadastral: d.situacaoCadastral,
    consultadoEm: agoraIso,
  }
}

/** Campos que só a consulta preenche: sempre são atualizados. */
const SEMPRE: Array<keyof ClienteInput> = ['situacaoCadastral', 'consultadoEm']

/**
 * Aplica os dados de uma consulta ao formulário.
 *
 * - `sobrescrever` (botão "Consultar"): troca todos os campos que vieram preenchidos.
 * - consulta automática: só preenche campos vazios ou que vieram de uma consulta anterior
 *   (`anteriores`); o que o usuário digitou à mão fica como está.
 *
 * Um valor vazio na consulta só limpa o campo se ele tinha vindo da consulta anterior.
 * Devolve o formulário novo e os valores aplicados (para comparar na próxima consulta).
 */
export function mesclarConsulta(
  atual: ClienteInput,
  novos: Partial<ClienteInput>,
  anteriores: Partial<ClienteInput>,
  sobrescrever: boolean,
): { form: ClienteInput; aplicados: Partial<ClienteInput> } {
  const form = { ...atual }
  const aplicados: Partial<ClienteInput> = {}
  for (const k of Object.keys(novos) as Array<keyof ClienteInput>) {
    const novo = novos[k]
    if (typeof novo !== 'string') continue
    const valorAtual = String(atual[k] ?? '')
    const veioDaConsulta = anteriores[k] !== undefined && anteriores[k] === valorAtual
    const pode = SEMPRE.includes(k) || veioDaConsulta || (novo !== '' && (sobrescrever || valorAtual.trim() === ''))
    if (!pode) continue
    ;(form as Record<string, unknown>)[k] = novo
    aplicados[k] = novo as never
  }
  return { form, aplicados }
}

// ---- Rótulos do cadastro -------------------------------------------------------

export const ROTULO_TIPO_CLIENTE: Record<TipoCliente, string> = {
  PJ: 'Empresa',
  PF: 'Pessoa física',
  AVULSO: 'Avulso',
}

/** `true` quando a empresa tem situação consultada e ela não é ATIVA. */
export const situacaoPedeAtencao = (c: { tipo: TipoCliente; situacaoCadastral: string }) =>
  c.tipo === 'PJ' && !!c.situacaoCadastral && c.situacaoCadastral.toUpperCase() !== 'ATIVA'
