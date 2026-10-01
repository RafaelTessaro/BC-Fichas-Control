export type ID = string

export type TipoPessoa = 'PF' | 'PJ'

export interface Cliente {
  id: ID
  nome: string
  tipo: TipoPessoa
  documento: string
  responsavel: string
  telefone: string
  email: string
  cidade: string
  uf: string
  endereco: string
  observacoes: string
  criadoEm: string
  atualizadoEm: string
}

export type StatusEvento = 'EM_ABERTO' | 'PENDENTE' | 'FINALIZADO' | 'CANCELADO'

export type FormaPagamento = 'NAO_PAGO' | 'DINHEIRO' | 'BOLETO' | 'CREDITO' | 'DEBITO' | 'PIX'

/** Um dia de utilização das máquinas dentro de um evento. */
export interface DiaEvento {
  id: ID
  /** Data no formato ISO `yyyy-MM-dd`. */
  data: string
  /** Quantidade de máquinas usadas no dia (cada máquina conta uma diária). */
  maquinas: number
}

export interface Evento {
  id: ID
  codigo: number
  clienteId: ID
  nome: string
  local: string
  cidade: string
  dias: DiaEvento[]
  valorDiaria: number
  valorBobina: number
  bobinasConsignadas: number
  /** `null` enquanto as bobinas ainda não foram devolvidas/conferidas. */
  bobinasDevolvidas: number | null
  desconto: number
  formaPagamento: FormaPagamento
  dataPagamento: string
  status: StatusEvento
  rodape: string
  observacoes: string
  criadoEm: string
  atualizadoEm: string
}

export interface Configuracoes {
  valorDiariaPadrao: number
  valorBobinaPadrao: number
  /** Quantidade total de máquinas disponíveis para locação. */
  frotaMaquinas: number
  rodapePadrao: string
}
