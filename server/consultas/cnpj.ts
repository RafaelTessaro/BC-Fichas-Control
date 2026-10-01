// Consulta de CNPJ em serviços públicos que espelham a base da Receita Federal.

import { mascaraCnpj } from '#shared/documentos.ts'
import { comoObjeto, type Interpretacao, type Objeto, type Provedor } from './motor.ts'
import {
  formatarCep,
  formatarData,
  formatarEmail,
  formatarTelefone,
  formatarUf,
  formatoTitulo,
  juntarLogradouro,
  textoLimpo,
} from './texto.ts'

/** Dados da empresa já normalizados para o cadastro de clientes. */
export interface DadosCnpj {
  /** CNPJ formatado (00.000.000/0000-00). */
  cnpj: string
  /** Razão social oficial, como consta na Receita. */
  razaoSocial: string
  /** Nome fantasia em formato de título; vazio quando a empresa não tem. */
  nomeFantasia: string
  /** Nome sugerido para exibição: nome fantasia ou, na falta, a razão social em formato de título. */
  nomeSugerido: string
  /** Situação cadastral em maiúsculas (ATIVA, BAIXADA, INAPTA, SUSPENSA, NULA). */
  situacaoCadastral: string
  /** Data de abertura (yyyy-MM-dd). */
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
  /** Serviço que respondeu a consulta. */
  fonte: string
}

interface Bruto {
  cnpj: string
  razaoSocial: unknown
  nomeFantasia: unknown
  situacao: unknown
  dataAbertura: unknown
  atividade: unknown
  telefone: string
  email: unknown
  cep: unknown
  tipoLogradouro: unknown
  logradouro: unknown
  numero: unknown
  complemento: unknown
  bairro: unknown
  cidade: unknown
  uf: unknown
}

/** Converte os campos crus de qualquer provedor no formato do sistema. */
function montar(b: Bruto, fonte: string): Interpretacao<DadosCnpj> {
  const razaoSocial = textoLimpo(b.razaoSocial)
  if (!razaoSocial) return { tipo: 'falha', motivo: 'resposta sem razão social' }
  const nomeFantasia = formatoTitulo(textoLimpo(b.nomeFantasia), { siglas: true })
  return {
    tipo: 'ok',
    dados: {
      cnpj: mascaraCnpj(b.cnpj),
      razaoSocial,
      nomeFantasia,
      nomeSugerido: nomeFantasia || formatoTitulo(razaoSocial, { siglas: true }),
      situacaoCadastral: textoLimpo(b.situacao).toLocaleUpperCase('pt-BR'),
      dataAbertura: formatarData(b.dataAbertura),
      atividadePrincipal: textoLimpo(b.atividade),
      telefone: b.telefone,
      email: formatarEmail(b.email),
      cep: formatarCep(b.cep),
      logradouro: juntarLogradouro(b.tipoLogradouro, b.logradouro),
      numero: textoLimpo(b.numero),
      complemento: formatoTitulo(textoLimpo(b.complemento)),
      bairro: formatoTitulo(textoLimpo(b.bairro)),
      cidade: formatoTitulo(textoLimpo(b.cidade)),
      uf: formatarUf(b.uf),
      fonte,
    },
  }
}

/** BrasilAPI e Minha Receita usam o mesmo formato (campos da base aberta da Receita). */
function interpretarFormatoReceita(fonte: string) {
  return (status: number, corpo: unknown): Interpretacao<DadosCnpj> => {
    if (status === 404) return { tipo: 'naoEncontrado', definitivo: true }
    if (status !== 200) return { tipo: 'falha', motivo: `HTTP ${status}` }
    const j = comoObjeto(corpo)
    return montar(
      {
        cnpj: textoLimpo(j.cnpj),
        razaoSocial: j.razao_social,
        nomeFantasia: j.nome_fantasia,
        situacao: j.descricao_situacao_cadastral,
        dataAbertura: j.data_inicio_atividade,
        atividade: j.cnae_fiscal_descricao,
        telefone: formatarTelefone(j.ddd_telefone_1) || formatarTelefone(j.ddd_telefone_2),
        email: j.email,
        cep: j.cep,
        tipoLogradouro: j.descricao_tipo_de_logradouro,
        logradouro: j.logradouro,
        numero: j.numero,
        complemento: j.complemento,
        bairro: j.bairro,
        cidade: j.municipio,
        uf: j.uf,
      },
      fonte,
    )
  }
}

/** CNPJ.ws (API pública): dados do estabelecimento ficam em `estabelecimento`. */
function interpretarCnpjWs(status: number, corpo: unknown): Interpretacao<DadosCnpj> {
  if (status === 404) return { tipo: 'naoEncontrado', definitivo: true }
  if (status !== 200) return { tipo: 'falha', motivo: `HTTP ${status}` }
  const j = comoObjeto(corpo)
  const e: Objeto = comoObjeto(j.estabelecimento)
  return montar(
    {
      cnpj: textoLimpo(e.cnpj),
      razaoSocial: j.razao_social,
      nomeFantasia: e.nome_fantasia,
      situacao: e.situacao_cadastral,
      dataAbertura: e.data_inicio_atividade,
      atividade: comoObjeto(e.atividade_principal).descricao,
      telefone: formatarTelefone(e.ddd1, e.telefone1) || formatarTelefone(e.ddd2, e.telefone2),
      email: e.email,
      cep: e.cep,
      tipoLogradouro: e.tipo_logradouro,
      logradouro: e.logradouro,
      numero: e.numero,
      complemento: e.complemento,
      bairro: e.bairro,
      cidade: comoObjeto(e.cidade).nome,
      uf: comoObjeto(e.estado).sigla,
    },
    'CNPJ.ws',
  )
}

/** Ordem de tentativa: BrasilAPI → CNPJ.ws → Minha Receita. */
export const PROVEDORES_CNPJ: Provedor<DadosCnpj>[] = [
  {
    nome: 'BrasilAPI',
    url: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
    interpretar: interpretarFormatoReceita('BrasilAPI'),
  },
  { nome: 'CNPJ.ws', url: (cnpj) => `https://publica.cnpj.ws/cnpj/${cnpj}`, interpretar: interpretarCnpjWs },
  {
    nome: 'Minha Receita',
    url: (cnpj) => `https://minhareceita.org/${cnpj}`,
    interpretar: interpretarFormatoReceita('Minha Receita'),
  },
]
