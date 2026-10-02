import type {
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  DadosCompletos,
  Evento,
  EventoInput,
  EventoPatch,
  Maquina,
  MaquinaInput,
  MensagemTempoReal,
  OrdemServico,
  OrdemServicoInput,
  StatusMaquina,
  TipoMaquina,
} from '#shared/tipos.ts'

/** Resultado do ajuste da quantidade de máquinas de um tipo. */
export interface ResultadoAjuste {
  criadas: Maquina[]
  /** Ids das máquinas apagadas (não tinham histórico). */
  excluidas: string[]
  desativadas: Maquina[]
}

/** Erro devolvido pelo servidor (ou falta de conexão, com `status` 0). */
export class ErroApi extends Error {
  readonly status: number
  readonly dados: Record<string, unknown>

  constructor(status: number, mensagem: string, dados: Record<string, unknown> = {}) {
    super(mensagem)
    this.status = status
    this.dados = dados
  }

  get semConexao() {
    return this.status === 0
  }
}

const SEM_CONEXAO = 'Sem conexão com o servidor. Verifique a rede e se o servidor está ligado.'

async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController()
  // O tempo limite cobre a requisição inteira, inclusive a leitura da resposta
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let resp: Response
    try {
      resp = await fetch(caminho, {
        method: metodo,
        // O servidor só aceita gravações com este cabeçalho (proteção contra sites externos)
        headers: { 'x-bc-fichas': '1', ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      })
    } catch {
      throw new ErroApi(0, SEM_CONEXAO)
    }
    if (resp.status === 204) return undefined as T
    let json: Record<string, unknown> = {}
    try {
      json = await resp.json()
    } catch {
      if (ctrl.signal.aborted) throw new ErroApi(0, SEM_CONEXAO)
      if (resp.ok) throw new ErroApi(resp.status, 'Resposta inválida do servidor.')
    }
    if (!resp.ok) {
      throw new ErroApi(resp.status, typeof json.erro === 'string' ? json.erro : `Erro ${resp.status} no servidor.`, json)
    }
    return json as T
  } finally {
    clearTimeout(timer)
  }
}

export const api = {
  dados: () => requisitar<DadosCompletos>('GET', '/api/dados'),

  criarCliente: (dados: ClienteInput) => requisitar<Cliente>('POST', '/api/clientes', dados),
  atualizarCliente: (id: string, dados: ClienteInput, versao?: number) =>
    requisitar<Cliente>('PUT', `/api/clientes/${encodeURIComponent(id)}`, { ...dados, versao }),
  excluirCliente: (id: string) => requisitar<void>('DELETE', `/api/clientes/${encodeURIComponent(id)}`),

  criarEvento: (dados: EventoInput) => requisitar<Evento>('POST', '/api/eventos', dados),
  atualizarEvento: (id: string, dados: EventoInput, versao?: number) =>
    requisitar<Evento>('PUT', `/api/eventos/${encodeURIComponent(id)}`, { ...dados, versao }),
  alterarEvento: (id: string, patch: EventoPatch) => requisitar<Evento>('PATCH', `/api/eventos/${encodeURIComponent(id)}`, patch),
  duplicarEvento: (id: string) => requisitar<Evento>('POST', `/api/eventos/${encodeURIComponent(id)}/duplicar`),
  excluirEvento: (id: string) => requisitar<void>('DELETE', `/api/eventos/${encodeURIComponent(id)}`),

  criarMaquina: (dados: MaquinaInput) => requisitar<Maquina>('POST', '/api/maquinas', dados),
  atualizarMaquina: (id: string, dados: MaquinaInput, versao?: number) =>
    requisitar<Maquina>('PUT', `/api/maquinas/${encodeURIComponent(id)}`, { ...dados, versao }),
  excluirMaquina: (id: string) => requisitar<void>('DELETE', `/api/maquinas/${encodeURIComponent(id)}`),
  ajustarQuantidade: (tipo: TipoMaquina, quantidade: number) =>
    requisitar<ResultadoAjuste>('POST', '/api/maquinas/quantidade', { tipo, quantidade }),

  /** `statusMaquina` muda a situação da máquina junto (ex.: "Em manutenção" ao abrir a O.S.). */
  criarOrdem: (dados: OrdemServicoInput, statusMaquina?: StatusMaquina) =>
    requisitar<OrdemServico>('POST', '/api/ordens', { ...dados, statusMaquina }),
  atualizarOrdem: (id: string, dados: OrdemServicoInput, versao?: number, statusMaquina?: StatusMaquina) =>
    requisitar<OrdemServico>('PUT', `/api/ordens/${encodeURIComponent(id)}`, { ...dados, versao, statusMaquina }),
  excluirOrdem: (id: string) => requisitar<void>('DELETE', `/api/ordens/${encodeURIComponent(id)}`),

  salvarConfig: (config: Configuracoes) => requisitar<Configuracoes>('PUT', '/api/config', config),

  backup: () => requisitar<Backup>('GET', '/api/backup'),
  restaurar: (dados: unknown) =>
    requisitar<{ clientes: number; eventos: number; maquinas: number }>('POST', '/api/backup/restaurar', dados, 120_000),
  backupsAutomaticos: () =>
    requisitar<{ backups: Array<{ arquivo: string; tamanho: number; criadoEm: string }> }>('GET', '/api/backups'),
  copiaAgora: () =>
    requisitar<{ backups: Array<{ arquivo: string; tamanho: number; criadoEm: string }> }>('POST', '/api/backups'),
  /** Acrescenta os dados de um backup sem apagar os do servidor. */
  mesclar: (dados: unknown) =>
    requisitar<{ clientes: number; eventos: number; maquinas: number; ordens: number; ignorados: number }>(
      'POST',
      '/api/backup/mesclar',
      dados,
      120_000,
    ),
  carregarExemplo: () => requisitar<{ ok: true }>('POST', '/api/exemplo'),
  limparTudo: () => requisitar<{ ok: true }>('POST', '/api/limpar', { confirmacao: 'APAGAR' }),

  /** Requisição genérica para módulos opcionais (consultas, Google Agenda). */
  get: <T>(caminho: string, timeoutMs?: number) => requisitar<T>('GET', caminho, undefined, timeoutMs),
  enviar: <T>(metodo: 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown, timeoutMs?: number) =>
    requisitar<T>(metodo, caminho, corpo, timeoutMs),
}

/** Mensagem de boas-vindas da conexão em tempo real. */
export interface Ola {
  revisao: number
  /** Versão da interface servida agora (muda quando o servidor é atualizado). */
  build: string
}

/**
 * Recebe as alterações feitas por qualquer computador da rede (Server-Sent Events).
 * O navegador reconecta sozinho se a conexão cair.
 *
 * Cada conexão aberta ocupa uma das ~6 conexões que o navegador permite por servidor; por isso
 * abas que ficam escondidas por mais de 30 s fecham a sua e reabrem ao voltar (a mensagem de
 * boas-vindas traz a revisão, e a tela se atualiza se algo mudou enquanto estava escondida).
 */
export function conectarTempoReal(handlers: {
  aoConectar: (ola: Ola) => void
  aoReceber: (msg: MensagemTempoReal) => void
  aoDesconectar: () => void
}) {
  let fonte: EventSource | null = null
  let timerOculta: ReturnType<typeof setTimeout> | undefined

  const abrir = () => {
    clearTimeout(timerOculta)
    if (fonte) return
    const f = new EventSource('/api/stream')
    fonte = f
    f.addEventListener('ola', (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data)
        handlers.aoConectar({ revisao: Number(d.revisao), build: String(d.build ?? '') })
      } catch {
        handlers.aoConectar({ revisao: -1, build: '' })
      }
    })
    f.onmessage = (e) => {
      try {
        handlers.aoReceber(JSON.parse(e.data))
      } catch {
        /* mensagem inválida: ignora */
      }
    }
    f.onerror = () => handlers.aoDesconectar()
  }

  const fechar = () => {
    fonte?.close()
    fonte = null
  }

  const aoMudarVisibilidade = () => {
    if (document.hidden) {
      clearTimeout(timerOculta)
      timerOculta = setTimeout(fechar, 30_000)
    } else abrir()
  }

  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  abrir()
  // Aba aberta em segundo plano (Ctrl+clique): também libera a conexão se continuar escondida
  if (document.hidden) timerOculta = setTimeout(fechar, 30_000)
  return () => {
    clearTimeout(timerOculta)
    document.removeEventListener('visibilitychange', aoMudarVisibilidade)
    fechar()
  }
}
