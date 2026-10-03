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

/** Andamento da programação das máquinas para o evento (acompanhado pela secretária). */
export type StatusProgramacao = 'NAO_INICIADA' | 'EM_PROGRAMACAO' | 'ENVIADA' | 'CONCLUIDA'

export type FormaPagamento = 'NAO_PAGO' | 'DINHEIRO' | 'BOLETO' | 'CREDITO' | 'DEBITO' | 'PIX'

/** Um dia de utilização das máquinas dentro de um evento. */
export interface DiaEvento {
  id: ID
  /** Data no formato ISO `yyyy-MM-dd`. */
  data: string
  /** Quantidade de máquinas titulares usadas no dia (cada uma conta uma diária). */
  maquinas: number
  /**
   * Máquinas reserva que ficam com o cliente no dia, além das titulares: estão locadas (contam na
   * agenda e na disponibilidade), mas só são cobradas se forem usadas (ver `reservasUsadas`).
   */
  reservas: number
  /** Quantas das reservas do dia o cliente acabou usando: cobradas pelo mesmo valor da diária. */
  reservasUsadas: number
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
  /** Nome do evento: também é o que sai no topo das fichas programadas nas máquinas. */
  nome: string
  /** Não é mais preenchida na tela (vale a cidade do cliente); mantida nos eventos antigos. */
  cidade: string
  /**
   * Antigo cabeçalho das fichas (o nome do evento faz esse papel). Ao ler um evento antigo, o
   * texto vai para as observações e este campo fica vazio.
   */
  cabecalho: string
  dias: DiaEvento[]
  /**
   * As máquinas ficam com o cliente do primeiro ao último dia (ex.: usa só nos fins de semana do
   * mês, mas não devolve no meio da semana). Para a agenda e a disponibilidade, contam como
   * ocupadas todos os dias desse período; as diárias continuam só nos dias de uso.
   */
  periodoCorrido: boolean
  /** Andamento da programação das máquinas para este evento. */
  programacao: StatusProgramacao
  /** Máquinas enviadas para o evento (ids de `Maquina`), titulares e reservas. */
  maquinasIds: ID[]
  /** Quais das máquinas enviadas vão como reserva (sempre contidas em `maquinasIds`). */
  reservasIds: ID[]
  /**
   * Eventos criados juntos por "Repetir em outras datas" (ex.: as festas do ano de um cliente)
   * têm o mesmo grupo; '' quando o evento não faz parte de uma série.
   */
  grupoId: ID
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
  /** Serviços de manutenção que o usuário cadastrou para marcar nas manutenções (ex.: "Higienização"). */
  servicosManutencao: string[]
  /** Dados da empresa que aparecem no contrato de locação (além de nome, razão social, CNPJ e cidade). */
  empresaEndereco: string
  empresaTelefone: string
  empresaEmail: string
  /** Quem assina os contratos pela empresa (nome e CPF); vazio deixa a linha para preencher à mão. */
  empresaRepresentante: string
  empresaRepresentanteCpf: string
  /** Comarca do foro do contrato (ex.: "Rio Claro - SP"); vazio usa a cidade da empresa. */
  contratoForo: string
  /** Valor de reposição de cada máquina, em caso de perda ou dano sem conserto (0 = valor de mercado, por orçamento). */
  valorReposicaoP: number
  valorReposicaoG: number
  /** Condições a mais que saem em todos os contratos (texto livre, opcional). */
  contratoCondicoes: string
}

// ---- Contrato de locação ------------------------------------------------------

/** AGUARDANDO = gerado, esperando a assinatura do cliente. */
export type StatusContrato = 'AGUARDANDO' | 'ASSINADO' | 'CANCELADO'

/** Data e hora combinadas (retirada ou devolução); a hora pode ficar em branco para preencher à mão. */
export interface DataHora {
  /** `yyyy-MM-dd`. */
  data: string
  /** `HH:mm` ou vazio. */
  hora: string
}

/**
 * Tudo o que sai no contrato, congelado no momento em que foi gerado: o PDF é sempre o mesmo,
 * mesmo que depois o cliente, o evento ou as configurações mudem.
 */
export interface DadosContrato {
  /** Data de emissão `yyyy-MM-dd` (a da assinatura, no fim do contrato). */
  emitidoEm: string
  empresa: {
    nome: string
    razaoSocial: string
    cnpj: string
    endereco: string
    telefone: string
    email: string
    cidade: string
    representante: string
    representanteCpf: string
  }
  cliente: {
    tipo: TipoCliente
    /** Razão social (empresa) ou nome. */
    nome: string
    /** Nome fantasia, quando diferente da razão social. */
    fantasia: string
    /** "CPF 123..." / "CNPJ 12..." ou vazio. */
    documento: string
    endereco: string
    telefone: string
    email: string
  }
  /** Quem assina pelo cliente (o próprio cliente, ou o responsável pela empresa). */
  assinante: { nome: string; cpf: string }
  evento: {
    id: ID
    codigo: number
    nome: string
    /** Onde as máquinas vão ser usadas (opcional). */
    local: string
    dias: Array<Pick<DiaEvento, 'data' | 'maquinas' | 'reservas'>>
    periodoCorrido: boolean
    /** Do primeiro ao último dia com as máquinas (período corrido); vazio sem período corrido. */
    comCliente: { inicio: string; fim: string } | null
    /** Máquinas enviadas (identificação e tipo); vazio enquanto não escolhidas. */
    maquinas: Array<{ identificacao: string; tipo: TipoMaquina; reserva: boolean }>
    rodape: string
  }
  valores: {
    diaria: number
    /** Diárias das máquinas titulares (as reservas só são cobradas se usadas). */
    diarias: number
    desconto: number
    /** Diárias × valor − desconto (sem as bobinas e as reservas usadas, acertadas na devolução). */
    total: number
    bobina: number
    bobinasConsignadas: number
    formaPagamento: FormaPagamento
    reposicaoP: number
    reposicaoG: number
  }
  retirada: DataHora
  devolucao: DataHora
  foro: string
  /** Condições a mais (das configurações e as deste contrato). */
  condicoes: string
}

/** Arquivo do contrato assinado (foto ou PDF digitalizado), guardado no servidor. */
export interface ArquivoContrato {
  nome: string
  tipo: string
  tamanho: number
  enviadoEm: string
}

export interface Contrato {
  id: ID
  versao: number
  /** Número sequencial ("Contrato nº 0007"). */
  numero: number
  eventoId: ID
  clienteId: ID
  status: StatusContrato
  /** Data `yyyy-MM-dd` em que foi assinado; vazio enquanto não. */
  assinadoEm: string
  /** Por que foi cancelado (ex.: "Substituído pelo contrato nº 0008"). */
  motivoCancelamento: string
  dados: DadosContrato
  arquivo: ArquivoContrato | null
  criadoEm: string
  atualizadoEm: string
}

/** O que a tela informa ao gerar o contrato de um evento (o resto vem do cadastro). */
export interface NovoContrato {
  eventoId: ID
  local: string
  retirada: DataHora
  devolucao: DataHora
  assinante: { nome: string; cpf: string }
  condicoes: string
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

/**
 * Registro interno de uma manutenção feita (ou a fazer) numa máquina. No código continua com o
 * nome antigo, "ordem de serviço"; na tela aparece só como "manutenção".
 */
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
  /** Campos da versão anterior (não aparecem mais na tela; preservados nos registros antigos). */
  solucao: string
  pecas: string
  responsavel: string
  custo: number
  criadoEm: string
  atualizadoEm: string
}

/** Reclamação de um cliente sobre uma máquina (ex.: "travando"), para o histórico da máquina. */
export interface Reclamacao {
  id: ID
  versao: number
  maquinaId: ID
  /** Evento em que a máquina estava ('' quando não é de um evento). */
  eventoId: ID
  /** Data da reclamação `yyyy-MM-dd`. */
  data: string
  descricao: string
  criadoEm: string
  atualizadoEm: string
}

/** Arquivo anexado a um evento (print da conversa, logo, cardápio…), guardado no servidor. */
export interface Anexo {
  id: ID
  eventoId: ID
  /** Nome original do arquivo. */
  nome: string
  /** Tipo do conteúdo (ex.: "image/png", "application/pdf"). */
  tipo: string
  /** Tamanho em bytes. */
  tamanho: number
  criadoEm: string
}

/** Campos editáveis de um cliente (o servidor controla id, versão e datas). */
export type ClienteInput = Omit<Cliente, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de uma máquina. */
export type MaquinaInput = Omit<Maquina, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de uma ordem de serviço (o servidor controla id, versão, número e datas). */
export type OrdemServicoInput = Omit<OrdemServico, 'id' | 'versao' | 'numero' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de uma reclamação. */
export type ReclamacaoInput = Omit<Reclamacao, 'id' | 'versao' | 'criadoEm' | 'atualizadoEm'>
/** Campos editáveis de um evento (o servidor controla id, versão, código e datas). */
export type EventoInput = Omit<Evento, 'id' | 'versao' | 'codigo' | 'criadoEm' | 'atualizadoEm' | 'google'>
/** Alterações rápidas permitidas sem reenviar o evento inteiro. */
export type EventoPatch = Partial<
  Pick<EventoInput, 'status' | 'formaPagamento' | 'dataPagamento' | 'bobinasDevolvidas' | 'observacoes' | 'programacao'>
>

export interface DadosCompletos {
  clientes: Cliente[]
  eventos: Evento[]
  maquinas: Maquina[]
  ordens: OrdemServico[]
  reclamacoes: Reclamacao[]
  /** Arquivos anexados aos eventos (só os dados; o conteúdo é baixado sob demanda). */
  anexos: Anexo[]
  contratos: Contrato[]
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
  /** A partir da versão 4 do backup. Os arquivos anexados não vão no backup (ficam em dados/anexos). */
  reclamacoes: Reclamacao[]
  /** A partir da versão 6 (os arquivos assinados ficam em dados/contratos, fora do backup). */
  contratos: Contrato[]
  config: Configuracoes
  proximoCodigo: number
  proximaOS: number
  proximoContrato: number
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
  | { revisao: number; tipo: 'reclamacao'; acao: 'salvo'; dado: Reclamacao }
  | { revisao: number; tipo: 'reclamacao'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'anexo'; acao: 'salvo'; dado: Anexo }
  | { revisao: number; tipo: 'anexo'; acao: 'excluido'; id: ID }
  | { revisao: number; tipo: 'contrato'; acao: 'salvo'; dado: Contrato }
  | { revisao: number; tipo: 'config'; acao: 'salvo'; dado: Configuracoes }
  | { revisao: number; tipo: 'tudo'; acao: 'recarregar' }
