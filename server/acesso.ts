// Controle de acesso da API: quem pode chamar cada rota (tabela única), o cookie da sessão e os
// ganchos do Fastify que aplicam as regras. Falha fechada: rota /api sem classificação na tabela
// faz o servidor recusar a subida; sem sessão, a API de dados responde 401.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { chaveServico, STATUS_MAQUINA_LISTA } from '#shared/maquinas.ts'
import { pode, SEM_PERMISSAO, type Permissao } from '#shared/permissoes.ts'
import type { AcaoAuditoria, StatusMaquina, UsuarioSessao } from '#shared/tipos.ts'
import { ErroApi } from './erros.ts'
import type { Repositorio } from './repositorio.ts'
import { hashToken } from './senha.ts'
import type { TempoReal } from './tempoReal.ts'
import type { ServicoUsuarios } from './usuarios.ts'

/** `publico`: sem sessão; `logado`: os dois níveis; uma Permissao: só quem a tem (shared/permissoes.ts). */
export type RegraAcesso = 'publico' | 'logado' | Permissao

declare module 'fastify' {
  interface FastifyRequest {
    /** Quem fez a requisição (o nível vem sempre do banco, nunca do cookie). */
    usuario: UsuarioSessao | null
    /** Id (hash do token) da sessão do cookie, quando vigente. */
    sessaoId: string | null
  }
  interface FastifyContextConfig {
    acesso?: RegraAcesso
    /** 'MÉTODO /padrão' da rota na tabela (HEAD vale como GET). */
    chaveAcesso?: string
  }
}

/**
 * Toda rota /api registrada precisa estar aqui, e toda entrada precisa de uma rota registrada
 * (o servidor não sobe se faltar uma ou outra). HEAD vale como GET. Só `app.all('/api/*')` vira 'ALL'.
 */
export const TABELA_ACESSO: Record<string, RegraAcesso> = {
  // app.ts
  'GET /api/saude': 'publico',
  'ALL /api/*': 'publico', // só responde 404

  // rotas/usuarios.ts
  'GET /api/sessao': 'publico',
  'POST /api/sessao': 'publico',
  'DELETE /api/sessao': 'publico',
  'PUT /api/minha-senha': 'logado', // aceita com a troca de senha pendente
  'GET /api/usuarios': 'usuarios',
  'POST /api/usuarios': 'usuarios',
  'PUT /api/usuarios/:id': 'usuarios',
  'DELETE /api/usuarios/:id': 'usuarios',
  'POST /api/usuarios/:id/senha': 'usuarios',
  'DELETE /api/usuarios/:id/sessoes': 'usuarios',
  'GET /api/auditoria': 'usuarios',

  // rotas/dados.ts
  'GET /api/dados': 'logado',
  'GET /api/stream': 'logado', // sem sessão: SSE com `semSessao` (responderStreamSemSessao)
  'POST /api/clientes': 'logado',
  'PUT /api/clientes/:id': 'logado',
  'DELETE /api/clientes/:id': 'excluirCliente',
  'POST /api/eventos': 'logado',
  'PUT /api/eventos/:id': 'logado',
  'PATCH /api/eventos/:id': 'logado',
  'POST /api/eventos/:id/duplicar': 'logado',
  'POST /api/eventos/:id/repetir': 'logado',
  'DELETE /api/eventos/:id': 'excluirEvento',
  'POST /api/maquinas': 'gerenciarFrota',
  'POST /api/maquinas/quantidade': 'gerenciarFrota',
  'PUT /api/maquinas/:id': 'logado', // + regra fina F1
  'DELETE /api/maquinas/:id': 'gerenciarFrota',
  'POST /api/ordens': 'logado', // + regra fina F2
  'PUT /api/ordens/:id': 'logado', // + regra fina F2
  'DELETE /api/ordens/:id': 'excluirManutencao',
  'POST /api/reclamacoes': 'logado',
  'PUT /api/reclamacoes/:id': 'logado',
  'DELETE /api/reclamacoes/:id': 'excluirReclamacao',
  'PUT /api/config': 'configuracoes',
  'PUT /api/config/servicos': 'logado', // + regra fina F3
  'GET /api/backup': 'dadosEBackup',
  'POST /api/backup/restaurar': 'dadosEBackup',
  'POST /api/backup/mesclar': 'dadosEBackup',
  'GET /api/backups': 'dadosEBackup',
  'POST /api/backups': 'dadosEBackup',
  'POST /api/exemplo': 'dadosEBackup',
  'POST /api/limpar': 'dadosEBackup',

  // rotas/anexos.ts
  'POST /api/eventos/:id/anexos': 'logado',
  'GET /api/anexos/:id': 'logado',
  'DELETE /api/anexos/:id': 'excluirAnexo',

  // rotas/contratos.ts
  'POST /api/contratos': 'logado',
  'PATCH /api/contratos/:id': 'logado',
  'DELETE /api/contratos/:id': 'excluirContrato',
  'POST /api/contratos/:id/arquivo': 'logado',
  'GET /api/contratos/:id/arquivo': 'logado',
  'DELETE /api/contratos/:id/arquivo': 'apagarCopiaAssinada',

  // email.ts
  'GET /api/email/config': 'logado', // resposta reduzida para quem não tem `configuracoes`
  'PUT /api/email/config': 'configuracoes',
  'DELETE /api/email/config': 'configuracoes',
  'POST /api/email/teste': 'configuracoes',
  'POST /api/email/enviar': 'logado',

  // rotas/consultas.ts
  'GET /api/consultas/cnpj/:cnpj': 'logado',
  'GET /api/consultas/cep/:cep': 'logado',

  // google/modulo.ts
  'GET /api/google/status': 'configuracoes',
  'PUT /api/google/config': 'configuracoes',
  'POST /api/google/credenciais': 'configuracoes',
  'DELETE /api/google/credenciais': 'configuracoes',
  'POST /api/google/testar': 'configuracoes',
  'POST /api/google/sincronizar': 'configuracoes',
}

/** Usuário fictício dos testes antigos (`acessoLivreParaTestes`): administrador. */
export const USUARIO_TESTE: UsuarioSessao = { id: 'teste', login: 'teste', nome: 'Teste', nivel: 'ADMIN', trocarSenha: false }

// ---- Cookie (lido e escrito à mão) --------------------------------------------------

/** Um nome por porta: duas instalações no mesmo computador não derrubam a sessão uma da outra. */
export function nomeCookieSessao(porta?: number): string {
  return porta ? `bcf_sessao_${porta}` : 'bcf_sessao'
}

/** Valor do cookie `nome` no cabeçalho Cookie (o primeiro, se vier repetido). */
export function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  if (!cabecalho) return undefined
  for (const parte of cabecalho.split(';')) {
    const i = parte.indexOf('=')
    if (i < 0 || parte.slice(0, i).trim() !== nome) continue
    const valor = parte
      .slice(i + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
    return valor || undefined
  }
  return undefined
}

/**
 * Cookie da sessão: HttpOnly e SameSite=Strict. Sem `Secure` (o acesso é por HTTP pelo IP da rede
 * local, e o navegador não gravaria) e sem `Domain`. Sem Max-Age, vale até fechar o navegador.
 */
export function cookieSessao(nome: string, token: string, maxAgeSegundos: number | null): string {
  return `${nome}=${token}; Path=/; HttpOnly; SameSite=Strict${maxAgeSegundos ? `; Max-Age=${maxAgeSegundos}` : ''}`
}

export function cookieApagar(nome: string): string {
  return `${nome}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}

/** Id (hash) da sessão do cookie, vigente ou não (para apagar a anterior ao entrar ou sair). */
export function sessaoIdDoCookie(req: FastifyRequest, nomeCookie: string): string | null {
  const token = lerCookie(req.headers.cookie, nomeCookie)
  return token && token.length <= 200 ? hashToken(token) : null
}

/** IP de quem chamou (sem o prefixo ::ffff:). Com trustProxy desligado, não dá para falsificar. */
export function ipDe(req: FastifyRequest): string {
  return String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/i, '')
}

// ---- Ganchos ---------------------------------------------------------------------

export interface DependenciasAcesso {
  usuarios: ServicoUsuarios
  tempoReal: TempoReal
  /** Para as regras finas (máquina e lista de serviços atuais). */
  repo: Repositorio
}

export interface OpcoesAcesso {
  /** Sem sessão, toda requisição vale como o administrador fictício (só nos testes). */
  acessoLivreParaTestes?: boolean
  nomeCookie: string
}

/** Rotas cujas gravações não vão para a auditoria como ALTERACAO (têm registro próprio ou não gravam dados). */
const foraDaAuditoria = (url: string) =>
  url === '/api/sessao' || url === '/api/minha-senha' || url === '/api/*' || url.startsWith('/api/usuarios')

/** Ações próprias do registro de atividades, por rota. */
const ACAO_DA_ROTA: Record<string, AcaoAuditoria> = {
  'GET /api/backup': 'BACKUP_BAIXADO',
  'POST /api/backup/restaurar': 'BACKUP_RESTAURADO',
  'POST /api/backup/mesclar': 'BACKUP_MESCLADO',
  'POST /api/limpar': 'DADOS_APAGADOS',
}

const MENSAGEM_DESATIVAR = 'Só o administrador desativa ou reativa máquinas.'

type Bruto = Record<string, unknown>
const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) ? (v as Bruto) : {})
const idDaRota = (req: FastifyRequest) => {
  const id = (req.params as { id?: unknown } | undefined)?.id
  return typeof id === 'string' ? id : ''
}

/**
 * Instala o controle de acesso. Chamar logo depois do gancho de Host e CSRF e antes de registrar
 * qualquer rota (o onRoute classifica as rotas na hora do registro).
 */
export function instalarAcesso(app: FastifyInstance, { usuarios, tempoReal, repo }: DependenciasAcesso, opcoes: OpcoesAcesso) {
  const { nomeCookie } = opcoes
  const livre = !!opcoes.acessoLivreParaTestes
  const registradas = new Set<string>()
  /** Último ACESSO_NEGADO gravado por usuário e rota (no máximo 1 por minuto). */
  const negados = new Map<string, number>()

  app.decorateRequest('usuario', null)
  app.decorateRequest('sessaoId', null)

  app.addHook('onRoute', (rota) => {
    const url = rota.url ?? ''
    if (!url.startsWith('/api')) return
    let metodo: string
    if (Array.isArray(rota.method)) {
      const todos = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].every((m) => (rota.method as string[]).includes(m))
      if (url !== '/api/*' || !todos) throw new Error(`Rota com lista de métodos não permitida: ${rota.method.join(',')} ${url}`)
      metodo = 'ALL'
    } else {
      metodo = rota.method === 'HEAD' ? 'GET' : String(rota.method)
    }
    const chave = `${metodo} ${url}`
    const acesso = TABELA_ACESSO[chave]
    if (!acesso) throw new Error(`Rota sem classificação de acesso: ${chave}`)
    rota.config = { ...rota.config, acesso, chaveAcesso: chave }
    registradas.add(chave)
  })

  app.addHook('onReady', async () => {
    const sobrando = Object.keys(TABELA_ACESSO).filter((c) => !registradas.has(c))
    if (sobrando.length) throw new Error(`Entradas da tabela de acesso sem rota registrada: ${sobrando.join(', ')}`)
  })

  /** Tempo real sem sessão: uma mensagem de boas-vindas com `semSessao` e a resposta termina. */
  function responderStreamSemSessao(reply: FastifyReply) {
    return reply
      .code(200)
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(`retry: 3000\nevent: ola\ndata: ${JSON.stringify({ revisao: -1, build: tempoReal.build, semSessao: true })}\n\n`)
  }

  // Ordem dos erros: Host 403, CSRF 403 (gancho anterior), sessão 401, troca de senha pendente 403,
  // permissão 403 e, já com o corpo lido, as regras finas 403 (preHandler). Tudo antes de ler o
  // corpo: um envio de arquivo ou uma restauração sem permissão é recusado sem ser lido.
  app.addHook('onRequest', async (req, reply) => {
    if (req.is404) return
    // Sempre pela rota encontrada, nunca por req.url (o roteador decodifica /%61pi/... para /api/...)
    const { acesso, chaveAcesso } = req.routeOptions.config ?? {}
    if (chaveAcesso === undefined) return // fora de /api: interface compilada
    if (acesso === undefined) throw new ErroApi(403, 'Requisição bloqueada.')

    const uso =
      (req.method !== 'GET' && req.method !== 'HEAD') ||
      (chaveAcesso === 'GET /api/sessao' && (req.query as { uso?: unknown } | undefined)?.uso === '1')
    const sessao = usuarios.validarSessao(lerCookie(req.headers.cookie, nomeCookie), uso, ipDe(req))
    if (sessao) {
      req.usuario = sessao.usuario
      req.sessaoId = sessao.sessaoId
    } else if (livre) {
      req.usuario = USUARIO_TESTE
    }
    if (acesso === 'publico') return

    const usuario = req.usuario
    if (!usuario) {
      if (chaveAcesso === 'GET /api/stream') return responderStreamSemSessao(reply)
      if (req.method === 'GET' && /text\/html/i.test(String(req.headers.accept ?? '')))
        return reply
          .code(401)
          .header('Cache-Control', 'no-store')
          .type('text/html; charset=utf-8')
          .send(
            '<!doctype html><meta charset="utf-8"><title>BC Fichas Control</title>' +
              '<p style="font-family:sans-serif;margin:2rem">Sua sessão terminou. Volte ao BC Fichas e entre de novo.</p>',
          )
      throw new ErroApi(401, 'Sua sessão terminou. Entre de novo para continuar.', { codigo: 'SEM_SESSAO' })
    }
    if (usuario.trocarSenha && chaveAcesso !== 'PUT /api/minha-senha') {
      if (chaveAcesso === 'GET /api/stream') return responderStreamSemSessao(reply)
      throw new ErroApi(403, 'Crie sua senha antes de continuar.', { codigo: 'TROCAR_SENHA' })
    }
    if (acesso !== 'logado' && !pode(usuario.nivel, acesso)) {
      const chaveNegado = `${usuario.id}|${chaveAcesso}`
      const agora = usuarios.agora()
      if (agora - (negados.get(chaveNegado) ?? -Infinity) >= 60_000) {
        if (negados.size > 1000) for (const [k, em] of negados) if (agora - em >= 60_000) negados.delete(k)
        negados.set(chaveNegado, agora)
        usuarios.registrar('ACESSO_NEGADO', { usuario, ip: ipDe(req), alvo: idDaRota(req), detalhe: chaveAcesso })
      }
      throw new ErroApi(403, SEM_PERMISSAO[acesso], { codigo: 'SEM_PERMISSAO', permissao: acesso })
    }
  })

  // ---- Regras finas (com o corpo já lido), só para quem não tem a permissão ----
  app.addHook('preHandler', async (req) => {
    const chave = req.routeOptions.config?.chaveAcesso
    const nivel = req.usuario?.nivel
    if (chave === 'PUT /api/maquinas/:id' && !pode(nivel, 'gerenciarFrota')) regraF1(req)
    else if ((chave === 'POST /api/ordens' || chave === 'PUT /api/ordens/:id') && !pode(nivel, 'gerenciarFrota')) regraF2(req)
    else if (chave === 'PUT /api/config/servicos' && !pode(nivel, 'gerenciarServicos')) regraF3(req)
  })

  /**
   * F1: o comum só alterna a situação Disponível/Manutenção. O corpo é reescrito com o cadastro
   * atual (o resto do que veio é ignorado); desativar ou reativar é recusado.
   */
  function regraF1(req: FastifyRequest) {
    const atual = repo.obterMaquina(idDaRota(req))
    if (!atual) return // o handler responde 404
    const corpo = obj(req.body)
    const versao = corpo.versao
    const desatualizada = typeof versao === 'number' && versao !== atual.versao
    const pedido = STATUS_MAQUINA_LISTA.includes(corpo.status as StatusMaquina) ? (corpo.status as StatusMaquina) : atual.status
    // Tela desatualizada: segue para o repositório responder o 409 de conflito (não um 403 enganoso)
    if (!desatualizada && pedido !== atual.status && (pedido === 'DESATIVADA' || atual.status === 'DESATIVADA'))
      throw new ErroApi(403, MENSAGEM_DESATIVAR, { codigo: 'SEM_PERMISSAO', permissao: 'gerenciarFrota' })
    const { tipo, identificacao, modelo, numeroSerie, dataAquisicao, observacoes } = atual
    req.body = {
      tipo,
      identificacao,
      modelo,
      numeroSerie,
      dataAquisicao,
      observacoes,
      status: desatualizada ? atual.status : pedido,
      versao,
    }
  }

  /** F2: a O.S. do comum não desativa nem reativa a máquina (registrar O.S. numa desativada pode). */
  function regraF2(req: FastifyRequest) {
    const corpo = obj(req.body)
    const status = corpo.statusMaquina
    if (status === 'DESATIVADA')
      throw new ErroApi(403, MENSAGEM_DESATIVAR, { codigo: 'SEM_PERMISSAO', permissao: 'gerenciarFrota' })
    if (!STATUS_MAQUINA_LISTA.includes(status as StatusMaquina)) return
    const maquina = typeof corpo.maquinaId === 'string' ? repo.obterMaquina(corpo.maquinaId) : undefined
    if (maquina?.status === 'DESATIVADA' && status !== maquina.status)
      throw new ErroApi(403, MENSAGEM_DESATIVAR, { codigo: 'SEM_PERMISSAO', permissao: 'gerenciarFrota' })
  }

  /**
   * F3: o comum só acrescenta serviços. A lista vira "a atual + os itens novos"; remoções e
   * renomeações (inclusive só de maiúscula ou acento) são ignoradas, nunca recusadas.
   */
  function regraF3(req: FastifyRequest) {
    const corpo = obj(req.body)
    if (!Array.isArray(corpo.servicos)) return // o handler responde 400
    const atuais = repo.obterConfig().servicosManutencao
    const conhecidas = new Set(atuais.map((s) => chaveServico(s)))
    const novos = corpo.servicos.filter(
      (s): s is string => typeof s === 'string' && !conhecidas.has(chaveServico(s.replace(/\s+/g, ' ').trim())),
    )
    req.body = { ...corpo, servicos: [...atuais, ...novos] }
  }

  // ---- Registro de atividades das gravações -------------------------------------
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400 || !req.usuario) return
    const chave = req.routeOptions.config?.chaveAcesso
    if (!chave) return
    const url = chave.slice(chave.indexOf(' ') + 1)
    let acao = ACAO_DA_ROTA[chave]
    if (acao === 'BACKUP_BAIXADO' && req.method === 'HEAD') return
    let detalhe = chave
    if (!acao) {
      if (req.method === 'GET' || req.method === 'HEAD' || foraDaAuditoria(url)) return
      acao = 'ALTERACAO'
      // Na alteração parcial, os nomes dos campos enviados (nunca os valores)
      if (req.method === 'PATCH') {
        const campos = Object.keys(obj(req.body))
          .filter((c) => c !== 'versao')
          .slice(0, 12)
          .map((c) => c.slice(0, 30))
        if (campos.length) detalhe += ` | ${campos.join(',')}`
      }
    }
    try {
      usuarios.registrar(acao, { usuario: req.usuario, ip: ipDe(req), alvo: idDaRota(req), detalhe })
    } catch (e) {
      req.log.error(e, 'falha ao gravar o registro de atividades')
    }
  })
}
