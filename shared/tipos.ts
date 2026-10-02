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
  cidade: string
  /** Texto programado no topo das fichas impressas pelas máquinas (pode ter várias linhas). */
  cabecalho: string
  dias: DiaEvento[]
  /** Máquinas enviadas para o evento (ids de `Maquina`). */
  maquinasIds: ID[]
  valorDiaria: number
  valorBobina: number
  bobinasConsignadas: number
  /** `null` enquanto as bobinas ainda não foram devolvidas/conferidas. */
  bobinasDevolvidas: number | null
  desconto: number
  formaPagamento: FormaPagamento
  dataPagamento: string
  status: StatusEvento
  /** Texto programado no fim das fichas; também fecha o resumo em PDF entregue ao cliente. */
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
  /**
   * Quantidade de máquinas considerada enquanto nenhuma máquina estiver cadastrada
   * (com máquinas cadastradas, vale a quantidade delas — ver `capacidade` em maquinas.ts).
   */
  frotaMaquinas: number
  rodapePadrao: string
  /** Empresa que emite o recibo (nome fantasia, razão social, CNPJ e cidade do recibo). */
  empresaNome: string
  empresaRazaoSocial: string
  empresaCnpj: string
  empresaCidade: string
}

// ---- Máquinas e manutenção ---------------------------------------------------

/** P = máquina pequena, G = máquina grande. */
export type TipoMaquina = 'P' | 'G'

/** Situação cadastrada. "Locada" não é cadastrada: vem dos eventos (ver `situacaoMaquina`). */
export type StatusMaquina = 'DISPONIVEL' | 'MANUTENCAO' | 'DESATIVADA'

export interface Maquina {
  id: ID
  versao: number
  tipo: TipoMaquina
  /** Identificação única, ex.: "P-01", "G-03" (sem diferenciar maiúsculas). */
  identificacao: string
  status: StatusMaquina
  modelo: string
  numeroSerie: string
  /** Data de aquisição `yyyy-MM-dd`, ou vazio. */
  dataAquisicao: string
  observacoes: string
  criadoEm: string
  atualizadoEm: string
}

export type StatusOS = 'ABERTA' | 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA'
export type TipoOS = 'PREVENTIVA' | 'CORRETIVA'

/** Ordem de serviço interna de manutenção de uma máquina. */
export interface OrdemServico {
  id: ID
  versao: number
  /** Número sequencial da O.S. (exibido como "O.S. 0001"). */
  numero: number
  maquinaId: ID
  tipo: TipoOS
  status: StatusOS
  /** Data de abertura `yyyy-MM-dd`. */
  abertura: string
  /** Data de conclusão `yyyy-MM-dd`; vazio enquanto não concluída. */
  conclusao: string
  /** Serviços feitos/pedidos, ex.: "Limpeza completa", "Higienização". */
  servicos: string[]
  /** Problema relatado ou motivo da manutenção. */
  problema: string
  /** O que foi feito. */
  solucao: string
  pecas: string
  responsavel: string
  custo: number
  criadoEm: string
  atualizadoEm: string
}

/** Campos editáveis de um cliente (o servidor controla id, versão e datas). */
export type ClienteInput = Omit<Cliente, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de uma máquina. */
export type MaquinaInput = Omit<Maquina, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de uma ordem de serviço (o servidor controla id, versão, número e datas). */
export type OrdemServicoInput = Omit<OrdemServico, 'id' | 'versao' | 'numero' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de um evento (o servidor controla id, versão, código e datas). */
export type EventoInput = Omit<Evento, 'id' | 'versao' | 'codigo' | 'criadoEm' | 'atualizadoEm' | 'google'>
/** Alterações rápidas permitidas sem reenviar o evento inteiro. */
export type EventoPatch = Partial<
  Pick<EventoInput, 'status' | 'formaPagamento' | 'dataPagamento' | 'bobinasDevolvidas' | 'observacoes'>
>

export interface DadosCompletos {
  clientes: Cliente[]
  eventos: Evento[]
  maquinas: Maquina[]
  ordens: OrdemServico[]
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
  maquinas: Maquina[]
  ordens: OrdemServico[]
  config: Configuracoes
  proximoCodigo: number
  proximaOS: number
}

/** Mensagem enviada pelo servidor (Server-Sent Events) a cada alteração. */
export type MensagemTempoReal =
  | { revisao: number; tipo: 'cliente'; acao: 'salvo'; dado: Cliente }
  | { revisao: number; tipo: 'cliente'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'evento'; acao: 'salvo'; dado: Evento }
  | { revisao: number; tipo: 'evento'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'maquina'; acao: 'salvo'; dado: Maquina }
  | { revisao: number; tipo: 'maquina'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'os'; acao: 'salvo'; dado: OrdemServico }
  | { revisao: number; tipo: 'os'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'config'; acao: 'salvo'; dado: Configuracoes }
  | { revisao: number; tipo: 'tudo'; acao: 'recarregar' }
