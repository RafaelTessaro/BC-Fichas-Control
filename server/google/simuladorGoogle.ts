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

const resposta = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), {
    status,
    headers: corpo === undefined ? {} : { 'Content-Type': 'application/json' },
  })

const erroGoogle = (code: number, message: string, reason = 'notFound') =>
  resposta(code, { error: { code, message, errors: [{ domain: 'global', reason, message }] } })

/**
 * Simula o Google: valida o JWT com a chave pública, emite tokens e guarda os
 * eventos por agenda. Eventos apagados ficam com status "cancelled" (como no Google):
 * o PUT os recupera, mas o POST com o mesmo id é recusado (409).
 */
export function criarSimuladorGoogle(chavePublica: string) {
  const agendas = new Map<string, Map<string, EventoSimulado>>()
  const permitidas = new Set<string>()
  const chamadas: Chamada[] = []
  const jwts: Array<{ cabecalho: Record<string, unknown>; corpo: Record<string, unknown> }> = []
  let tokensEmitidos = 0
  const sim = {
    offline: false,
    /** Força um código de erro em todas as chamadas à API (ex.: 500). */
    falharCom: 0,
    chamadas,
    jwts,
    get tokensEmitidos() {
      return tokensEmitidos
    },
    /** Cria uma agenda; `compartilhada` = a conta de serviço tem permissão de edição. */
    criarAgenda(id: string, compartilhada = true) {
      agendas.set(id, new Map())
      if (compartilhada) permitidas.add(id)
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
      const caminho = url.slice(URL_API.length)
      const corpo = corpoTexto ? (JSON.parse(corpoTexto) as Record<string, unknown>) : null
      chamadas.push({ metodo, url, caminho, corpo })

      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ''
      if (!/^Bearer token-\d+$/.test(auth)) return erroGoogle(401, 'Invalid Credentials', 'authError')
      if (sim.falharCom) return erroGoogle(sim.falharCom, 'Backend Error', 'backendError')

      const m = /^\/calendars\/([^/]+)(\/events(?:\/([^/]+))?)?$/.exec(caminho)
      if (!m) return erroGoogle(404, 'Not Found')
      const agendaId = decodeURIComponent(m[1])
      const agenda = agendas.get(agendaId)
      if (!agenda) return erroGoogle(404, 'Not Found')
      if (!permitidas.has(agendaId)) {
        return metodo === 'GET' && !m[2] ? erroGoogle(404, 'Not Found') : erroGoogle(403, 'Forbidden', 'requiredAccessLevel')
      }

      if (!m[2] && metodo === 'GET')
        return resposta(200, { id: agendaId, summary: 'Agenda BC Fichas', timeZone: 'America/Sao_Paulo' })
      const eventoId = m[3] ? decodeURIComponent(m[3]) : ''

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
    }) as FuncaoFetch,
  }
  return sim
}
