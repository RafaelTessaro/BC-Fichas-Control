import { createSign } from 'node:crypto'

/**
 * Cliente mínimo da API do Google Agenda (REST v3), sem dependências externas.
 *
 * A autenticação usa uma CONTA DE SERVIÇO: o servidor assina um JWT (RS256) com a
 * chave privada da conta e troca esse JWT por um token de acesso no Google. Isso
 * dispensa o fluxo OAuth com redirecionamento, que não funciona com o servidor
 * acessado pelo IP da rede local.
 */

export const ESCOPO_AGENDA = 'https://www.googleapis.com/auth/calendar'
export const URL_API = 'https://www.googleapis.com/calendar/v3'
export const TOKEN_URI_PADRAO = 'https://oauth2.googleapis.com/token'

export type FuncaoFetch = (url: string, init?: RequestInit) => Promise<Response>

/** Campos usados da chave JSON da conta de serviço. */
export interface CredenciaisGoogle {
  type: 'service_account'
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  token_uri: string
}

export type MotivoErroGoogle =
  | 'rede' // sem internet, DNS, tempo esgotado
  | 'credenciais' // chave recusada ao pedir o token
  | 'permissao' // 401/403 na agenda
  | 'apiDesativada' // Google Calendar API não ativada no projeto
  | 'agendaNaoEncontrada' // 404 da agenda
  | 'limite' // 429 / cota
  | 'indisponivel' // 5xx
  | 'recusado' // 400 e outros

/** Erro da integração com mensagem pronta (em português) para exibir ao usuário. */
export class ErroGoogle extends Error {
  readonly status: number
  readonly motivo: MotivoErroGoogle

  constructor(status: number, motivo: MotivoErroGoogle, mensagem: string) {
    super(mensagem)
    this.status = status
    this.motivo = motivo
  }

  /** Erros que afetam todos os eventos (não adianta continuar a fila agora). */
  get geral() {
    return this.motivo !== 'recusado'
  }
}

export const MSG_SEM_INTERNET = 'Sem conexão com a internet no servidor — será enviado automaticamente quando a conexão voltar.'

export const msgSemPermissao = (email: string) =>
  `Sem permissão na agenda: compartilhe-a com ${email} com a permissão 'Fazer alterações nos eventos'.`

export const MSG_AGENDA_NAO_ENCONTRADA = 'Agenda não encontrada: confira o ID da agenda.'

/** Valida o conteúdo do arquivo JSON da chave. Lança `Error` com mensagem amigável. */
export function validarCredenciais(entrada: unknown): CredenciaisGoogle {
  let obj = entrada
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      throw new Error('O arquivo enviado não é um JSON válido. Envie o arquivo de chave baixado do Google Cloud.')
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('Envie o conteúdo do arquivo JSON da chave da conta de serviço.')
  }
  const r = obj as Record<string, unknown>
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  if (r.type !== 'service_account') {
    throw new Error(
      'Este arquivo não é a chave de uma conta de serviço (o campo "type" deve ser "service_account"). ' +
        'No Google Cloud, crie uma conta de serviço e gere uma chave do tipo JSON.',
    )
  }
  const email = texto(r.client_email)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('A chave não contém o e-mail da conta de serviço (client_email).')
  const chave = typeof r.private_key === 'string' ? r.private_key.replace(/\\n/g, '\n') : ''
  if (!/-----BEGIN (RSA )?PRIVATE KEY-----/.test(chave)) {
    throw new Error('A chave não contém a chave privada (private_key). Gere uma nova chave JSON no Google Cloud.')
  }
  try {
    createSign('RSA-SHA256').update('teste').sign(chave)
  } catch {
    throw new Error('A chave privada do arquivo é inválida ou está corrompida. Gere uma nova chave JSON no Google Cloud.')
  }
  const tokenUri = texto(r.token_uri) || TOKEN_URI_PADRAO
  if (!tokenUriConfiavel(tokenUri)) throw new Error('O endereço de autenticação (token_uri) da chave não é do Google.')
  return {
    type: 'service_account',
    project_id: texto(r.project_id),
    private_key_id: texto(r.private_key_id),
    private_key: chave,
    client_email: email,
    client_id: texto(r.client_id),
    token_uri: tokenUri,
  }
}

/** O JWT assinado só é enviado a endereços HTTPS do próprio Google. */
function tokenUriConfiavel(uri: string) {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' && (u.hostname === 'googleapis.com' || u.hostname.endsWith('.googleapis.com'))
  } catch {
    return false
  }
}

const base64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')

/** Monta e assina o JWT de solicitação de token (RFC 7523). */
export function assinarJwt(cred: CredenciaisGoogle, agoraSeg: number): string {
  const cabecalho: Record<string, string> = { alg: 'RS256', typ: 'JWT' }
  if (cred.private_key_id) cabecalho.kid = cred.private_key_id
  const corpo = { iss: cred.client_email, scope: ESCOPO_AGENDA, aud: cred.token_uri, iat: agoraSeg, exp: agoraSeg + 3600 }
  const dados = `${base64url(JSON.stringify(cabecalho))}.${base64url(JSON.stringify(corpo))}`
  const assinatura = createSign('RSA-SHA256').update(dados).sign(cred.private_key)
  return `${dados}.${base64url(assinatura)}`
}

export interface OpcoesCliente {
  fetch?: FuncaoFetch
  /** Relógio em milissegundos (injetável para testes). */
  agora?: () => number
  timeoutMs?: number
}

interface RespostaGoogle {
  status: number
  json: Record<string, unknown>
}

export class ClienteGoogle {
  readonly cred: CredenciaisGoogle
  private fetch: FuncaoFetch
  private agora: () => number
  private timeoutMs: number
  private token: { valor: string; expira: number } | null = null
  private pedindoToken: Promise<string> | null = null

  constructor(cred: CredenciaisGoogle, opcoes: OpcoesCliente = {}) {
    this.cred = cred
    // Resolve o fetch global na hora da chamada (permite substituí-lo em testes)
    this.fetch = opcoes.fetch ?? ((url, init) => globalThis.fetch(url, init))
    this.agora = opcoes.agora ?? Date.now
    this.timeoutMs = opcoes.timeoutMs ?? 15_000
  }

  /** Token de acesso, reaproveitado até 2 minutos antes de expirar. */
  async obterToken(): Promise<string> {
    if (this.token && this.token.expira - 120_000 > this.agora()) return this.token.valor
    this.pedindoToken ??= this.pedirToken().finally(() => {
      this.pedindoToken = null
    })
    return this.pedindoToken
  }

  private async pedirToken(): Promise<string> {
    const jwt = assinarJwt(this.cred, Math.floor(this.agora() / 1000))
    const corpo = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
    const r = await this.enviar(this.cred.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
    })
    const token = typeof r.json.access_token === 'string' ? r.json.access_token : ''
    if (r.status >= 200 && r.status < 300 && token) {
      const segundos = Number(r.json.expires_in) || 3600
      this.token = { valor: token, expira: this.agora() + segundos * 1000 }
      return token
    }
    if (r.status === 429 || r.status >= 500) throw erroPorStatus(r, 'token', this.cred.client_email)
    const codigo = typeof r.json.error === 'string' ? r.json.error : ''
    throw new ErroGoogle(
      r.status,
      'credenciais',
      codigo === 'invalid_grant'
        ? 'O Google recusou a chave da conta de serviço (invalid_grant). A chave pode ter sido excluída, ou o relógio do servidor está errado. Gere uma nova chave JSON e confira a data/hora do servidor.'
        : `O Google recusou a chave da conta de serviço${codigo ? ` (${codigo})` : ''}. Gere uma nova chave JSON e envie-a novamente.`,
    )
  }

  /** Chamada à API do Google Agenda. `aceitar` lista códigos de erro tratados por quem chama. */
  async chamar(
    metodo: 'GET' | 'POST' | 'PUT' | 'DELETE',
    caminho: string,
    corpo?: unknown,
    aceitar: number[] = [],
  ): Promise<RespostaGoogle> {
    const token = await this.obterToken()
    const r = await this.enviar(URL_API + caminho, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    })
    if (r.status === 401) this.token = null // token revogado/expirado: pede outro na próxima
    if ((r.status >= 200 && r.status < 300) || aceitar.includes(r.status)) return r
    throw erroPorStatus(r, 'agenda', this.cred.client_email)
  }

  private async enviar(url: string, init: RequestInit): Promise<RespostaGoogle> {
    let resp: Response
    try {
      resp = await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch {
      throw new ErroGoogle(0, 'rede', MSG_SEM_INTERNET)
    }
    let json: Record<string, unknown> = {}
    try {
      const texto = await resp.text()
      if (texto) json = JSON.parse(texto)
    } catch {
      /* resposta sem JSON */
    }
    return { status: resp.status, json }
  }

  // ---- Operações ---------------------------------------------------------------

  /** Lê os dados da agenda (usado no teste de conexão). */
  async obterAgenda(calendarId: string): Promise<{ summary: string; timeZone: string }> {
    const r = await this.chamar('GET', `/calendars/${encodeURIComponent(calendarId)}`)
    return { summary: String(r.json.summary ?? ''), timeZone: String(r.json.timeZone ?? '') }
  }

  /**
   * Cria ou atualiza o evento com o id informado. O PUT com status "confirmed" também
   * recupera um evento apagado anteriormente (o Google não permite reutilizar o id em
   * uma nova inserção); se o evento nunca existiu, o PUT devolve 404 e ele é inserido.
   */
  async salvarEvento<T extends { id: string }>(calendarId: string, evento: T) {
    const agenda = encodeURIComponent(calendarId)
    const r = await this.chamar('PUT', `/calendars/${agenda}/events/${encodeURIComponent(evento.id)}`, evento, [404])
    if (r.status !== 404) return
    await this.chamar('POST', `/calendars/${agenda}/events`, evento)
  }

  /**
   * Apaga o evento; se ele já foi apagado (410) ou nunca existiu (404), não faz nada.
   * O Google também responde 404 quando a AGENDA foi apagada ou deixou de ser
   * compartilhada com a conta de serviço; por isso, num 404 a agenda é conferida
   * (lança `agendaNaoEncontrada`/`permissao` se ela estiver inacessível), para a
   * exclusão não ser dada como feita sem ter apagado nada.
   */
  async apagarEvento(calendarId: string, id: string) {
    const agenda = encodeURIComponent(calendarId)
    const r = await this.chamar('DELETE', `/calendars/${agenda}/events/${encodeURIComponent(id)}`, undefined, [404, 410])
    if (r.status === 404) await this.chamar('GET', `/calendars/${agenda}`)
  }

  /**
   * Eventos da agenda criados por este sistema (com `extendedProperties.private.bcFichasId`),
   * sem os apagados. Percorre todas as páginas.
   */
  async listarEventosDoSistema(calendarId: string): Promise<Array<{ id: string; bcFichasId: string }>> {
    const encontrados: Array<{ id: string; bcFichasId: string }> = []
    let pagina = ''
    for (let i = 0; i < 1_000; i++) {
      const params = new URLSearchParams({
        maxResults: '2500',
        showDeleted: 'false',
        fields: 'items(id,extendedProperties/private/bcFichasId),nextPageToken',
      })
      if (pagina) params.set('pageToken', pagina)
      const r = await this.chamar('GET', `/calendars/${encodeURIComponent(calendarId)}/events?${params}`)
      const itens = Array.isArray(r.json.items) ? (r.json.items as Array<Record<string, unknown>>) : []
      for (const item of itens) {
        const privadas = (item?.extendedProperties as { private?: Record<string, unknown> } | undefined)?.private
        const bcFichasId = privadas?.bcFichasId
        if (typeof item?.id === 'string' && typeof bcFichasId === 'string' && bcFichasId)
          encontrados.push({ id: item.id, bcFichasId })
      }
      pagina = typeof r.json.nextPageToken === 'string' ? r.json.nextPageToken : ''
      if (!pagina) break
    }
    return encontrados
  }
}

function erroPorStatus(r: RespostaGoogle, onde: 'token' | 'agenda', email: string): ErroGoogle {
  const erro = (r.json.error && typeof r.json.error === 'object' ? r.json.error : {}) as Record<string, unknown>
  const mensagem = typeof erro.message === 'string' ? erro.message : ''
  const motivos = [...(Array.isArray(erro.errors) ? erro.errors : []), ...(Array.isArray(erro.details) ? erro.details : [])].map(
    (x) => String((x as Record<string, unknown>)?.reason ?? ''),
  )
  const s = r.status

  if (s === 429 || motivos.some((m) => /rateLimitExceeded|quotaExceeded|RATE_LIMIT/i.test(m))) {
    return new ErroGoogle(s, 'limite', 'Muitas solicitações ao Google no momento — tentará de novo automaticamente.')
  }
  if (s >= 500) {
    return new ErroGoogle(
      s,
      'indisponivel',
      `O Google está temporariamente indisponível (erro ${s}) — tentará de novo automaticamente.`,
    )
  }
  if (
    s === 403 &&
    (motivos.some((m) => /accessNotConfigured|SERVICE_DISABLED/i.test(m)) || /has not been used|is disabled/i.test(mensagem))
  ) {
    return new ErroGoogle(
      s,
      'apiDesativada',
      'A Google Calendar API não está ativada no projeto da conta de serviço. Ative-a no Google Cloud Console e tente de novo.',
    )
  }
  if (onde === 'agenda' && (s === 401 || s === 403)) return new ErroGoogle(s, 'permissao', msgSemPermissao(email))
  if (onde === 'agenda' && s === 404) return new ErroGoogle(s, 'agendaNaoEncontrada', MSG_AGENDA_NAO_ENCONTRADA)
  return new ErroGoogle(s, 'recusado', `O Google recusou a solicitação (erro ${s})${mensagem ? `: ${mensagem}` : '.'}`)
}
