// Sessão (entrar, sair, quem sou eu), troca da própria senha e o cadastro de usuários e o registro
// de atividades (só o administrador; a tabela de acesso em server/acesso.ts garante).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { EstadoSessao, GrupoAuditoria, RespostaLogin, UsuarioSessao } from '#shared/tipos.ts'
import { GRUPOS_AUDITORIA } from '#shared/usuarios.ts'
import { cookieApagar, cookieSessao, ipDe, lerCookie, sessaoIdDoCookie } from '../acesso.ts'
import { ErroApi } from '../erros.ts'
import type { TempoReal } from '../tempoReal.ts'
import type { ServicoUsuarios } from '../usuarios.ts'

type ComId = FastifyRequest<{ Params: { id: string } }>

/** Corpos pequenos (login, senha, nome): nada justifica mais que isso. */
const LIMITE_CORPO = 8192

export interface DependenciasRotasUsuarios {
  usuarios: ServicoUsuarios
  tempoReal: TempoReal
  nomeCookie: string
}

export async function rotasUsuarios(app: FastifyInstance, { usuarios, tempoReal, nomeCookie }: DependenciasRotasUsuarios) {
  const opcoes = { bodyLimit: LIMITE_CORPO }
  /** As rotas de administrador só passam com sessão (a tabela de acesso exige `usuarios`). */
  const autor = (req: FastifyRequest): UsuarioSessao => {
    if (!req.usuario) throw new ErroApi(401, 'Sua sessão terminou. Entre de novo para continuar.', { codigo: 'SEM_SESSAO' })
    return req.usuario
  }

  // ---- Sessão ----

  // `?uso=1` (abrir a página, batimento com interação) conta como atividade; sem ele, só confere
  app.get('/api/sessao', opcoes, async (req, reply): Promise<EstadoSessao> => {
    if (lerCookie(req.headers.cookie, nomeCookie) && !req.sessaoId) reply.header('Set-Cookie', cookieApagar(nomeCookie))
    return {
      usuario: req.usuario,
      semUsuarios: usuarios.quantos() === 0,
      build: tempoReal.build,
      ...(req.sessaoId ? { persistente: req.sessaoPersistente } : {}),
    }
  })

  app.post('/api/sessao', opcoes, async (req, reply): Promise<RespostaLogin> => {
    const r = await usuarios.entrar(req.body, ipDe(req), sessaoIdDoCookie(req, nomeCookie))
    // A sessão que este navegador usava (de quem quer que seja) deixa de valer, e o tempo real dela fecha
    tempoReal.encerrarSessoes(r.sessoesEncerradas)
    reply.header('Set-Cookie', cookieSessao(nomeCookie, r.token, r.maxAgeSegundos))
    return { usuario: r.usuario, build: tempoReal.build }
  })

  app.delete('/api/sessao', opcoes, async (req, reply) => {
    const sessaoId = sessaoIdDoCookie(req, nomeCookie)
    if (sessaoId) {
      usuarios.sair(sessaoId, ipDe(req))
      tempoReal.encerrarSessoes([sessaoId])
    }
    return reply.header('Set-Cookie', cookieApagar(nomeCookie)).code(204).send()
  })

  // Mantém a sessão atual (o mesmo cookie) e encerra as outras
  app.put('/api/minha-senha', opcoes, async (req) => {
    if (!req.sessaoId) throw new ErroApi(401, 'Sua sessão terminou. Entre de novo para continuar.', { codigo: 'SEM_SESSAO' })
    const r = await usuarios.trocarPropriaSenha(req.sessaoId, req.body, ipDe(req))
    tempoReal.encerrarSessoes(r.sessoesEncerradas)
    return { usuario: r.usuario }
  })

  // ---- Usuários (administrador) ----

  app.get('/api/usuarios', opcoes, async () => ({ usuarios: usuarios.listar() }))

  app.post('/api/usuarios', opcoes, async (req, reply) =>
    reply.code(201).send(await usuarios.criar(req.body, autor(req), ipDe(req))),
  )

  app.put('/api/usuarios/:id', opcoes, async (req: ComId) => {
    const r = usuarios.alterar(req.params.id, req.body, autor(req), ipDe(req))
    tempoReal.encerrarSessoes(r.sessoesEncerradas)
    return { usuario: r.usuario }
  })

  app.post('/api/usuarios/:id/senha', opcoes, async (req: ComId) => {
    const { sessoesEncerradas, ...resultado } = await usuarios.redefinirSenha(
      req.params.id,
      req.body ?? {},
      autor(req),
      ipDe(req),
    )
    tempoReal.encerrarSessoes(sessoesEncerradas)
    return resultado
  })

  // Na própria conta, a sessão atual continua ("encerrar minhas outras sessões")
  app.delete('/api/usuarios/:id/sessoes', opcoes, async (req: ComId) => {
    const quem = autor(req)
    const exceto = req.params.id === quem.id ? req.sessaoId : null
    tempoReal.encerrarSessoes(usuarios.encerrarSessoesDe(req.params.id, quem, ipDe(req), exceto))
    return { usuario: usuarios.obter(req.params.id) }
  })

  app.delete('/api/usuarios/:id', opcoes, async (req: ComId, reply) => {
    const r = usuarios.excluir(req.params.id, autor(req), ipDe(req))
    tempoReal.encerrarSessoes(r.sessoesEncerradas)
    tempoReal.encerrarUsuario(req.params.id)
    return reply.code(204).send()
  })

  // ---- Registro de atividades ----

  app.get('/api/auditoria', opcoes, async (req) => {
    const q = (req.query ?? {}) as Record<string, string | undefined>
    const inteiro = (v: string | undefined) => (v && /^\d{1,15}$/.test(v) ? Number(v) : undefined)
    let grupo: GrupoAuditoria | undefined
    if (q.grupo) {
      if (!Object.hasOwn(GRUPOS_AUDITORIA, q.grupo)) throw new ErroApi(400, 'Grupo do registro de atividades inválido.')
      grupo = q.grupo as GrupoAuditoria
    }
    return {
      registros: usuarios.listarAuditoria({
        antes: inteiro(q.antes),
        limite: inteiro(q.limite),
        grupo,
        usuarioId: q.usuarioId || undefined,
      }),
    }
  })
}
