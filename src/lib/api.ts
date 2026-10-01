import type {
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  DadosCompletos,
  Evento,
  EventoInput,
  EventoPatch,
  MensagemTempoReal,
} from '#shared/tipos.ts'

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

async function requisitar<T>(metodo: string, caminho: string, corpo?: unknown, timeoutMs = 20_000): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
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
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique a rede e se o servidor está ligado.')
  } finally {
    clearTimeout(timer)
  }
  if (resp.status === 204) return undefined as T
  let json: Record<string, unknown> = {}
  try {
    json = await resp.json()
  } catch {
    /* resposta sem corpo JSON */
  }
  if (!resp.ok) {
    throw new ErroApi(resp.status, typeof json.erro === 'string' ? json.erro : `Erro ${resp.status} no servidor.`, json)
  }
  return json as T
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

  salvarConfig: (config: Configuracoes) => requisitar<Configuracoes>('PUT', '/api/config', config),

  backup: () => requisitar<Backup>('GET', '/api/backup'),
  restaurar: (dados: unknown) =>
    requisitar<{ clientes: number; eventos: number }>('POST', '/api/backup/restaurar', dados, 120_000),
  backupsAutomaticos: () =>
    requisitar<{ backups: Array<{ arquivo: string; tamanho: number; criadoEm: string }> }>('GET', '/api/backups'),
  copiaAgora: () =>
    requisitar<{ backups: Array<{ arquivo: string; tamanho: number; criadoEm: string }> }>('POST', '/api/backups'),
  carregarExemplo: () => requisitar<{ ok: true }>('POST', '/api/exemplo'),
  limparTudo: () => requisitar<{ ok: true }>('POST', '/api/limpar', { confirmacao: 'APAGAR' }),

  /** Requisição genérica para módulos opcionais (consultas, Google Agenda). */
  get: <T>(caminho: string, timeoutMs?: number) => requisitar<T>('GET', caminho, undefined, timeoutMs),
  enviar: <T>(metodo: 'POST' | 'PUT' | 'DELETE', caminho: string, corpo?: unknown, timeoutMs?: number) =>
    requisitar<T>(metodo, caminho, corpo, timeoutMs),
}

/**
 * Recebe as alterações feitas por qualquer computador da rede (Server-Sent Events).
 * O navegador reconecta sozinho se a conexão cair.
 */
export function conectarTempoReal(handlers: {
  aoConectar: (revisaoServidor: number) => void
  aoReceber: (msg: MensagemTempoReal) => void
  aoDesconectar: () => void
}) {
  const fonte = new EventSource('/api/stream')
  fonte.addEventListener('ola', (e) => {
    try {
      handlers.aoConectar(JSON.parse((e as MessageEvent).data).revisao)
    } catch {
      handlers.aoConectar(-1)
    }
  })
  fonte.onmessage = (e) => {
    try {
      handlers.aoReceber(JSON.parse(e.data))
    } catch {
      /* mensagem inválida: ignora */
    }
  }
  fonte.onerror = () => handlers.aoDesconectar()
  return () => fonte.close()
}
