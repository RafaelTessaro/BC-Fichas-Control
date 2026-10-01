// Consulta de endereço pelo CEP.

import { comoObjeto, type Interpretacao, type Provedor } from './motor.ts'
import { formatarCep, formatarUf, textoLimpo } from './texto.ts'

export interface DadosCep {
  /** CEP formatado (00000-000). */
  cep: string
  logradouro: string
  bairro: string
  cidade: string
  uf: string
  /** Serviço que respondeu a consulta. */
  fonte: string
}

function montar(
  campos: { cep: unknown; logradouro: unknown; bairro: unknown; cidade: unknown; uf: unknown },
  fonte: string,
): Interpretacao<DadosCep> {
  const cidade = textoLimpo(campos.cidade)
  const uf = formatarUf(campos.uf)
  if (!cidade || !uf) return { tipo: 'falha', motivo: 'resposta sem cidade/UF' }
  return {
    tipo: 'ok',
    dados: {
      cep: formatarCep(campos.cep),
      logradouro: textoLimpo(campos.logradouro),
      bairro: textoLimpo(campos.bairro),
      cidade,
      uf,
      fonte,
    },
  }
}

/** BrasilAPI v2. O 404 dela também aparece quando os serviços que ela consulta falham, então não é definitivo. */
function interpretarBrasilApi(status: number, corpo: unknown): Interpretacao<DadosCep> {
  if (status === 404) return { tipo: 'naoEncontrado', definitivo: false }
  if (status !== 200) return { tipo: 'falha', motivo: `HTTP ${status}` }
  const j = comoObjeto(corpo)
  return montar({ cep: j.cep, logradouro: j.street, bairro: j.neighborhood, cidade: j.city, uf: j.state }, 'BrasilAPI')
}

/** ViaCEP e OpenCEP usam o mesmo formato; o ViaCEP responde 200 com `erro: true` quando o CEP não existe. */
function interpretarFormatoViaCep(fonte: string) {
  return (status: number, corpo: unknown): Interpretacao<DadosCep> => {
    const j = comoObjeto(corpo)
    if (status === 404 || j.erro === true || j.erro === 'true' || j.error === true) {
      return { tipo: 'naoEncontrado', definitivo: true }
    }
    if (status !== 200) return { tipo: 'falha', motivo: `HTTP ${status}` }
    return montar({ cep: j.cep, logradouro: j.logradouro, bairro: j.bairro, cidade: j.localidade, uf: j.uf }, fonte)
  }
}

/** Ordem de tentativa: BrasilAPI → ViaCEP → OpenCEP. */
export const PROVEDORES_CEP: Provedor<DadosCep>[] = [
  { nome: 'BrasilAPI', url: (cep) => `https://brasilapi.com.br/api/cep/v2/${cep}`, interpretar: interpretarBrasilApi },
  { nome: 'ViaCEP', url: (cep) => `https://viacep.com.br/ws/${cep}/json/`, interpretar: interpretarFormatoViaCep('ViaCEP') },
  { nome: 'OpenCEP', url: (cep) => `https://opencep.com/v1/${cep}`, interpretar: interpretarFormatoViaCep('OpenCEP') },
]
