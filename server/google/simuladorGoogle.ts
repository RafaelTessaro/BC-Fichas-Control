// Simulador do Google (token + API do Agenda) usado SOMENTE nos testes — nenhuma chamada de rede real.

import { createVerify, generateKeyPairSync } from 'node:crypto'
import { TOKEN_URI_PADRAO, URL_API, type FuncaoFetch } from './cliente.ts'

export const EMAIL_TESTE = 'bc-fichas@bc-fichas-teste.iam.gserviceaccount.com'

/** Par de chaves RSA e o JSON de uma conta de serviço fictícia. */
export function gerarContaServico() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const json = {
    type: 'service_account',
    project_id: 'bc-fichas-teste',
    private_key_id: 'chave123',
    private_key: privateKey,
    client_email: EMAIL_TESTE,
    client_id: '1234567890',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: TOKEN_URI_PADRAO,
  }
  return { json, chavePublica: publicKey }
}

export interface Chamada {
  metodo: string
  url: string
  caminho: string
  corpo: Record<string, unknown> | null
}

type EventoSimulado = Record<string, unknown> & { id: string; status: string }

/**
 * Acesso da conta de serviço a uma agenda: `edicao` (Fazer alterações nos eventos),
 * `leitura` (lê a agenda e os eventos, mas não altera: 403) ou `nenhum` (não
 * compartilhada: o Google responde 404 a tudo, como se ela não existisse).
 */
export type AcessoAgenda = 'edicao' | 'leitura' | 'nenhum'

const resposta = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
  })

export const erroGoogle = (code: number, message: string, reason = 'notFound') =>
  resposta(code, { error: { code, message, errors: [{ domain: 'global', reason, message }] } })

/**
 * Simula o Google: valida o JWT com a chave pública, emite tokens e guarda os
 * eventos por agenda. Eventos apagados ficam com status "cancelled" (como no Google):
 * o PUT os recupera, mas o POST com o mesmo id é recusado (409).
 */
export function criarSimuladorGoogle(chavePublica: string) {
  const agendas = new Map<string, Map<string, EventoSimulado>>()
  const acessos = new Map<string, AcessoAgenda>()
  const chamadas: Chamada[] = []
  const jwts: Array<{ cabecalho: Record<string, unknown>; corpo: Record<string, unknown> }> = []
  let tokensEmitidos = 0
  type Interceptador = (c: Chamada, seguir: () => Response) => Response
  let interceptar: Interceptador | null = null
  const sim = {
    offline: false,
    /** Força um código de erro em todas as chamadas à API (ex.: 500). */
    falharCom: 0,
    chamadas,
    jwts,
    get tokensEmitidos() {
      return tokensEmitidos
    },
    /**
     * Permite simular falhas em chamadas específicas: recebe a chamada e a função que a
     * aplica no Google simulado (lançar `TypeError` = falha de rede, como o `fetch`).
     */
    get interceptar(): Interceptador | null {
      return interceptar
    },
    set interceptar(f: Interceptador | null) {
      interceptar = f
    },
    /** Eventos por página na listagem (o Google usa `maxResults`; aqui pode ser menor para testar a paginação). */
    tamanhoPagina: 250,
    /** Cria uma agenda; `true` = edição, `false` = somente leitura. */
    criarAgenda(id: string, acesso: boolean | AcessoAgenda = true) {
      agendas.set(id, new Map())
      sim.definirAcesso(id, acesso)
    },
    definirAcesso(id: string, acesso: boolean | AcessoAgenda) {
      acessos.set(id, acesso === true ? 'edicao' : acesso === false ? 'leitura' : acesso)
    },
    /** Grava um evento direto na agenda (como se tivesse sido enviado antes). */
    inserir(agenda: string, evento: Record<string, unknown> & { id: string }) {
      agendas.get(agenda)?.set(evento.id, { ...evento, status: 'confirmed' })
    },
    /** Apaga um evento direto na agenda (como se alguém o tivesse apagado no Google). */
    apagar(agenda: string, id: string) {
      const ev = agendas.get(agenda)?.get(id)
      if (ev) ev.status = 'cancelled'
    },
    /** Eventos ativos (não apagados) de uma agenda. */
    eventos(agenda: string): EventoSimulado[] {
      return [...(agendas.get(agenda)?.values() ?? [])].filter((e) => e.status !== 'cancelled')
    },
    limparChamadas() {
      chamadas.length = 0
    },
    fetch: (async (url, init) => {
      if (sim.offline) throw new TypeError('fetch failed')
      const metodo = init?.method ?? 'GET'
      const corpoTexto = typeof init?.body === 'string' ? init.body : ''

      if (url === TOKEN_URI_PADRAO) {
        chamadas.push({ metodo, url, caminho: 'token', corpo: null })
        const params = new URLSearchParams(corpoTexto)
        if (params.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer')
          return resposta(400, { error: 'unsupported_grant_type' })
        const [c, p, assinatura] = (params.get('assertion') ?? '').split('.')
        const valido =
          !!assinatura &&
          createVerify('RSA-SHA256').update(`${c}.${p}`).verify(chavePublica, Buffer.from(assinatura, 'base64url'))
        if (!valido) return resposta(400, { error: 'invalid_grant', error_description: 'Invalid JWT Signature.' })
        jwts.push({
          cabecalho: JSON.parse(Buffer.from(c, 'base64url').toString()),
          corpo: JSON.parse(Buffer.from(p, 'base64url').toString()),
        })
        tokensEmitidos++
        return resposta(200, { access_token: `token-${tokensEmitidos}`, expires_in: 3599, token_type: 'Bearer' })
      }

      if (!url.startsWith(URL_API)) return resposta(404, {})
      const [caminho, consulta = ''] = url.slice(URL_API.length).split('?')
      const params = new URLSearchParams(consulta)
      const corpo = corpoTexto ? (JSON.parse(corpoTexto) as Record<string, unknown>) : null
      const chamada: Chamada = { metodo, url, caminho, corpo }
      chamadas.push(chamada)
      return interceptar ? interceptar(chamada, responderApi) : responderApi()

      function responderApi(): Response {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
        if (!/^Bearer token-\d+$/.test(auth)) return erroGoogle(401, 'Invalid Credentials', 'authError')
        if (sim.falharCom) return erroGoogle(sim.falharCom, 'Backend Error', 'backendError')

        const m = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(caminho)
        if (!m) return erroGoogle(404, 'Not Found')
        const agendaId = decodeURIComponent(m[1])
        const agenda = agendas.get(agendaId)
        const acesso = acessos.get(agendaId) ?? 'nenhum'
        if (!agenda || acesso === 'nenhum') return erroGoogle(404, 'Not Found')
        if (acesso === 'leitura' && metodo !== 'GET') return erroGoogle(403, 'Forbidden', 'requiredAccessLevel')

        if (!m[2] && metodo === 'GET')
          return resposta(200, { id: agendaId, summary: 'Agenda BC Fichas', timeZone: 'America/Sao_Paulo' })
        const eventoId = m[3] ? decodeURIComponent(m[3]) : ''

        if (metodo === 'GET' && !eventoId) {
          // Lista paginada; sem `showDeleted`, os apagados (cancelled) não aparecem
          const todos = [...agenda.values()].filter((e) => params.get('showDeleted') === 'true' || e.status !== 'cancelled')
          const pagina = Math.min(Number(params.get('maxResults')) || 250, sim.tamanhoPagina)
          const inicio = Number(params.get('pageToken') ?? 0)
          const fim = inicio + pagina
          return resposta(200, {
            items: todos.slice(inicio, fim),
            ...(fim < todos.length ? { nextPageToken: String(fim) } : {}),
          })
        }

        if (metodo === 'POST' && !eventoId) {
          const id = String(corpo?.id ?? '')
          if (agenda.has(id)) return erroGoogle(409, 'The requested identifier already exists.', 'duplicate')
          agenda.set(id, { ...corpo, id, status: 'confirmed' })
          return resposta(200, agenda.get(id))
        }
        if (metodo === 'PUT' && eventoId) {
          if (!agenda.has(eventoId)) return erroGoogle(404, 'Not Found')
          agenda.set(eventoId, { ...corpo, id: eventoId, status: String(corpo?.status ?? 'confirmed') })
          return resposta(200, agenda.get(eventoId))
        }
        if (metodo === 'DELETE' && eventoId) {
          const ev = agenda.get(eventoId)
          if (!ev) return erroGoogle(404, 'Not Found')
          if (ev.status === 'cancelled') return erroGoogle(410, 'Resource has been deleted', 'deleted')
          ev.status = 'cancelled'
          return resposta(204)
        }
        return erroGoogle(400, 'Bad Request', 'badRequest')
      }
    }) as FuncaoFetch,
  }
  return sim
}
