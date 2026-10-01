// Tipos do domínio, compartilhados entre o servidor (Node) e a interface (navegador).

export type ID = string

/** PJ = empresa (CNPJ), PF = pessoa física (CPF), AVULSO = cliente eventual, sem documento. */
export type TipoCliente = 'PJ' | 'PF' | 'AVULSO'

export interface Cliente {
  id: ID
  /** Incrementa a cada alteração; usado para detectar edições simultâneas. */
  versao: number
  tipo: TipoCliente
  /** Nome de exibição: nome fantasia (PJ), nome completo (PF) ou apelido (avulso). */
  nome: string
  /** Razão social (somente PJ). */
  razaoSocial: string
  /** CNPJ ou CPF formatado; vazio para avulso. */
  documento: string
  responsavel: string
  telefone: string
  email: string
  cep: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  uf: string
  /** Situação na Receita Federal (ex.: "ATIVA"), preenchida pela consulta de CNPJ. */
  situacaoCadastral: string
  /** Data/hora ISO da última consulta automática do CNPJ; vazio se nunca consultado. */
  consultadoEm: string
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

/** Situação da cópia do evento no Google Agenda (somente leitura, definida pelo servidor). */
export interface SyncGoogle {
  status: 'pendente' | 'ok' | 'erro'
  erro?: string
  /** Data/hora ISO da última sincronização bem-sucedida. */
  em?: string
}

export interface Evento {
  id: ID
  versao: number
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
  /** Presente apenas quando a integração com o Google Agenda está ativa. */
  google?: SyncGoogle
}

export interface Configuracoes {
  valorDiariaPadrao: number
  valorBobinaPadrao: number
  /** Quantidade total de máquinas disponíveis para locação. */
  frotaMaquinas: number
  rodapePadrao: string
}

/** Campos editáveis de um cliente (o servidor controla id, versão e datas). */
export type ClienteInput = Omit<Cliente, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de um evento (o servidor controla id, versão, código e datas). */
export type EventoInput = Omit<Evento, 'id' | 'versao' | 'codigo' | 'criadoEm' | 'atualizadoEm' | 'google'>
/** Alterações rápidas permitidas sem reenviar o evento inteiro. */
export type EventoPatch = Partial<
  Pick<EventoInput, 'status' | 'formaPagamento' | 'dataPagamento' | 'bobinasDevolvidas' | 'observacoes'>
>

export interface DadosCompletos {
  clientes: Cliente[]
  eventos: Evento[]
  config: Configuracoes
  /** Contador global de alterações; aumenta a cada gravação no servidor. */
  revisao: number
}

export interface Backup {
  app: 'bc-fichas-control'
  versao: number
  exportadoEm: string
  clientes: Cliente[]
  eventos: Evento[]
  config: Configuracoes
  proximoCodigo: number
}

/** Mensagem enviada pelo servidor (Server-Sent Events) a cada alteração. */
export type MensagemTempoReal =
  | { revisao: number; tipo: 'cliente'; acao: 'salvo'; dado: Cliente }
  | { revisao: number; tipo: 'cliente'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'evento'; acao: 'salvo'; dado: Evento }
  | { revisao: number; tipo: 'evento'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'config'; acao: 'salvo'; dado: Configuracoes }
  | { revisao: number; tipo: 'tudo'; acao: 'recarregar' }
