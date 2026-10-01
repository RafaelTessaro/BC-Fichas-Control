import type { FastifyInstance } from 'fastify'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Evento, SyncGoogle } from '#shared/tipos.ts'
import type { Contexto } from '../contexto.ts'
import { ErroApi } from '../erros.ts'
import type { ExtensaoRepositorio } from '../extensoes.ts'
import { ClienteGoogle, ErroGoogle, validarCredenciais, type CredenciaisGoogle, type FuncaoFetch } from './cliente.ts'
import { EstadoGoogle, idsDaLinha, temCopias, type ConfigGoogle } from './estado.ts'
import { SincronizadorGoogle } from './sincronizador.ts'

export interface ModuloGoogle {
  /** Ganchos do repositório (marca eventos para sincronizar, anexa o status). */
  extensao: ExtensaoRepositorio
  /** Rotas em /api/google/*. */
  rotas(app: FastifyInstance): Promise<void>
  /** Inicia o sincronizador em segundo plano. */
  iniciar(): void
  parar(): void
  /** Processa agora as pendências vencidas (usado nos testes). */
  sincronizarAgora(): Promise<void>
}

export interface OpcoesModuloGoogle {
  /** Substitui o `fetch` (testes). */
  fetch?: FuncaoFetch
  /** Relógio em milissegundos (testes). */
  agora?: () => number
}

/** Resposta de GET /api/google/status (nunca inclui a chave privada). */
export interface StatusGoogle {
  configurado: boolean
  ativo: boolean
  contaServico: string
  projeto: string
  calendarId: string
  incluirValores: boolean
  resumo: { ok: number; pendentes: number; erros: number }
  ultimaSincronizacao: string
  ultimoErro: string
  ultimoErroEm: string
}

/** Aceita o ID da agenda ou um link de incorporação/compartilhamento que o contenha (`?src=` / `?cid=`). */
export function normalizarCalendarId(valor: unknown): string {
  let id = typeof valor === 'string' ? valor.trim() : ''
  if (/^https?:\/\//i.test(id)) {
    try {
      const u = new URL(id)
      id = u.searchParams.get('src') ?? u.searchParams.get('cid') ?? id
    } catch {
      /* não é um link válido: mantém o texto */
    }
  }
  return id.trim()
}

function validarCalendarId(id: string) {
  if (id.length > 512 || /\s/.test(id))
    throw new ErroApi(400, 'ID da agenda inválido. Copie-o em Configurações da agenda > Integrar agenda.')
  if (id.toLowerCase() === 'primary') {
    throw new ErroApi(
      400,
      'Use o ID da sua agenda (ex.: seu-email@gmail.com ou …@group.calendar.google.com). "primary" seria a agenda da própria conta de serviço, que ninguém vê.',
    )
  }
}

/** Código HTTP devolvido ao navegador para cada tipo de falha do Google. */
function statusHttp(e: ErroGoogle) {
  if (e.motivo === 'rede') return 503
  if (e.motivo === 'limite' || e.motivo === 'indisponivel') return 502
  return 400
}

/** Integração com o Google Agenda (envia os eventos do sistema para uma agenda do Google). */
export function criarModuloGoogle(ctx: Contexto, opcoes: OpcoesModuloGoogle = {}): ModuloGoogle {
  const agora = opcoes.agora ?? Date.now
  const estado = new EstadoGoogle(ctx.db)
  const pasta = join(ctx.pastaDados, 'google')
  const arquivoCredenciais = join(pasta, 'credenciais.json')

  // ---- Credenciais (arquivo JSON da conta de serviço) ----------------------------

  let credenciais: CredenciaisGoogle | null = null
  let cliente: ClienteGoogle | null = null

  const definirCredenciais = (cred: CredenciaisGoogle | null) => {
    credenciais = cred
    cliente = cred ? new ClienteGoogle(cred, { fetch: opcoes.fetch, agora }) : null
  }

  if (existsSync(arquivoCredenciais)) {
    try {
      definirCredenciais(validarCredenciais(readFileSync(arquivoCredenciais, 'utf8')))
    } catch (e) {
      ctx.log.warn(`[google] arquivo de credenciais inválido: ${(e as Error).message}`)
    }
  }

  const gravarCredenciais = (cred: CredenciaisGoogle) => {
    mkdirSync(pasta, { recursive: true, mode: 0o700 })
    writeFileSync(arquivoCredenciais, JSON.stringify(cred, null, 2), { mode: 0o600 })
    chmodSync(arquivoCredenciais, 0o600)
    definirCredenciais(cred)
  }

  // ---- Sincronizador -------------------------------------------------------------

  const republicar = (id: string) => {
    try {
      ctx.repo.republicarEvento(id)
    } catch {
      /* banco fechado ou evento inexistente */
    }
  }

  const sinc = new SincronizadorGoogle({
    estado,
    obterEvento: (id) => ctx.repo.obterEventoBruto(id),
    obterCliente: (id) => ctx.repo.obterCliente(id),
    listarEventos: () => ctx.repo.listarEventosBrutos(),
    clienteGoogle: () => cliente,
    aoMudarStatus: republicar,
    agora,
    aviso: (msg, erro) => ctx.log.warn({ err: erro }, msg),
  })

  const integracaoAtiva = () => estado.lerConfig().ativo && credenciais !== null

  /** Marca todos os eventos para envio e as cópias de eventos que não existem mais para exclusão. */
  const reconciliar = (forcar: boolean) => {
    const eventos = ctx.repo.listarEventosBrutos()
    const existentes = new Set(eventos.map((e) => e.id))
    let marcados = 0
    for (const e of eventos) {
      const linha = estado.obter(e.id)
      // Cancelado que nunca foi enviado: nada a fazer
      if (e.status === 'CANCELADO' && (!linha || !temCopias(linha))) continue
      estado.marcarPendente(e.id, { forcar })
      marcados++
    }
    for (const l of estado.todas()) {
      if (!existentes.has(l.evento_id) && temCopias(l)) {
        estado.marcarPendente(l.evento_id, { excluido: true })
        marcados++
      }
    }
    return { eventos, marcados }
  }

  const republicarTodos = (eventos: Evento[] = ctx.repo.listarEventosBrutos()) => {
    for (const e of eventos) republicar(e.id)
  }

  // ---- Ganchos do repositório ------------------------------------------------------

  const extensao: ExtensaoRepositorio = {
    decorarEvento(evento) {
      if (!integracaoAtiva()) return evento
      const linha = estado.obter(evento.id)
      if (!linha) return evento.status === 'CANCELADO' ? evento : { ...evento, google: { status: 'pendente' } }
      const semCopia = idsDaLinha(linha).length === 0
      // Nada no Google (cancelado já removido, ou evento sem datas): não mostra o selo
      if (semCopia && (linha.status === 'ok' || (evento.status === 'CANCELADO' && linha.status !== 'erro'))) return evento
      const google: SyncGoogle = { status: linha.status }
      if (linha.status === 'erro' && linha.erro) google.erro = linha.erro
      if (linha.sincronizado_em) google.em = linha.sincronizado_em
      return { ...evento, google }
    },

    eventoSalvo(evento) {
      if (!integracaoAtiva() && !estado.obter(evento.id)) return
      estado.marcarPendente(evento.id)
      sinc.agendar()
    },

    clienteSalvo(cliente, anterior) {
      // Só o nome e o telefone do cliente aparecem nos eventos do Google (ver mapeamento.ts)
      if (cliente.nome === anterior.nome && cliente.telefone === anterior.telefone) return
      let marcados = 0
      for (const e of ctx.repo.listarEventosBrutos()) {
        if (e.clienteId !== cliente.id) continue
        const linha = estado.obter(e.id)
        if (!integracaoAtiva() && !linha) continue
        // Cancelado que nunca foi enviado: nada a atualizar
        if (e.status === 'CANCELADO' && (!linha || !temCopias(linha))) continue
        estado.marcarPendente(e.id)
        republicar(e.id)
        marcados++
      }
      if (marcados) sinc.agendar()
    },

    eventoExcluido(evento) {
      const linha = estado.obter(evento.id)
      if (!linha) return // nunca foi enviado
      estado.marcarPendente(evento.id, { excluido: true })
      sinc.agendar()
    },

    dadosSubstituidos(eventos) {
      const novos = new Set(eventos.map((e) => e.id))
      for (const l of estado.todas()) {
        if (!novos.has(l.evento_id)) estado.marcarPendente(l.evento_id, { excluido: true })
      }
      if (integracaoAtiva()) {
        for (const e of eventos) estado.marcarPendente(e.id)
      } else {
        for (const e of eventos) if (estado.obter(e.id)) estado.marcarPendente(e.id)
      }
      sinc.agendar()
    },
  }

  // ---- Rotas -------------------------------------------------------------------------

  const status = (): StatusGoogle => {
    const config = estado.lerConfig()
    const info = estado.lerInfo()
    return {
      configurado: credenciais !== null,
      ativo: config.ativo && credenciais !== null,
      contaServico: credenciais?.client_email ?? '',
      projeto: credenciais?.project_id ?? '',
      calendarId: config.calendarId,
      incluirValores: config.incluirValores,
      resumo: estado.resumo(),
      ultimaSincronizacao: info.ultimaSincronizacao,
      ultimoErro: info.ultimoErro,
      ultimoErroEm: info.ultimoErroEm,
    }
  }

  const corpo = (body: unknown) =>
    body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}

  async function rotas(app: FastifyInstance) {
    app.get('/api/google/status', async () => status())

    app.put('/api/google/config', async (req) => {
      const b = corpo(req.body)
      const anterior = estado.lerConfig()
      const nova: ConfigGoogle = { ...anterior }
      if ('ativo' in b) {
        if (typeof b.ativo !== 'boolean') throw new ErroApi(400, 'Valor inválido para "ativo".')
        nova.ativo = b.ativo
      }
      if ('incluirValores' in b) {
        if (typeof b.incluirValores !== 'boolean') throw new ErroApi(400, 'Valor inválido para "incluirValores".')
        nova.incluirValores = b.incluirValores
      }
      if ('calendarId' in b) {
        if (typeof b.calendarId !== 'string') throw new ErroApi(400, 'Informe o ID da agenda.')
        nova.calendarId = normalizarCalendarId(b.calendarId)
        if (nova.calendarId) validarCalendarId(nova.calendarId)
      }
      if (nova.ativo && !credenciais) {
        throw new ErroApi(400, 'Envie primeiro o arquivo JSON da chave da conta de serviço do Google.')
      }
      if (nova.ativo && !nova.calendarId) throw new ErroApi(400, 'Informe o ID da agenda do Google antes de ativar.')

      const ativou = nova.ativo && !anterior.ativo
      const desativou = !nova.ativo && anterior.ativo
      const trocouAgenda = nova.ativo && anterior.ativo && nova.calendarId !== anterior.calendarId
      const mudouConteudo = nova.ativo && anterior.ativo && nova.incluirValores !== anterior.incluirValores
      // Antes de enviar (e mover) os eventos, confirma que a agenda existe e está acessível.
      // Permissão só de leitura passa aqui; o sincronizador cuida disso (só apaga da agenda
      // anterior depois de criar na nova).
      if ((ativou || trocouAgenda) && cliente) {
        try {
          await cliente.obterAgenda(nova.calendarId)
        } catch (e) {
          if (e instanceof ErroGoogle) throw new ErroApi(statusHttp(e), e.message)
          throw e
        }
      }

      estado.gravarConfig(nova)
      if (ativou || trocouAgenda || mudouConteudo) {
        const { eventos } = reconciliar(ativou)
        republicarTodos(eventos)
        if (ativou || trocouAgenda) sinc.solicitarConferencia()
        sinc.agendar(300)
      } else if (desativou) {
        republicarTodos()
      }
      return status()
    })

    app.post('/api/google/credenciais', async (req) => {
      const b = corpo(req.body)
      if (b.json === undefined || b.json === null || b.json === '') {
        throw new ErroApi(400, 'Envie o arquivo JSON da chave da conta de serviço.')
      }
      let cred: CredenciaisGoogle
      try {
        cred = validarCredenciais(b.json)
      } catch (e) {
        throw new ErroApi(400, (e as Error).message)
      }
      const anterior = credenciais?.client_email
      gravarCredenciais(cred)
      if (integracaoAtiva() && anterior !== cred.client_email) {
        reconciliar(false)
        sinc.agendar(300)
      }
      return status()
    })

    app.delete('/api/google/credenciais', async () => {
      const estavaAtivo = integracaoAtiva()
      estado.gravarConfig({ ...estado.lerConfig(), ativo: false })
      rmSync(arquivoCredenciais, { force: true })
      definirCredenciais(null)
      if (estavaAtivo) republicarTodos()
      return status()
    })

    app.post('/api/google/testar', async (req) => {
      const b = corpo(req.body)
      if (!cliente) throw new ErroApi(400, 'Envie primeiro o arquivo JSON da chave da conta de serviço do Google.')
      const calendarId = normalizarCalendarId(b.calendarId) || estado.lerConfig().calendarId
      if (!calendarId) throw new ErroApi(400, 'Informe o ID da agenda do Google.')
      validarCalendarId(calendarId)
      try {
        const agenda = await cliente.obterAgenda(calendarId)
        return { ok: true, agenda: agenda.summary || calendarId, fusoHorario: agenda.timeZone }
      } catch (e) {
        if (e instanceof ErroGoogle) throw new ErroApi(statusHttp(e), e.message)
        throw e
      }
    })

    app.post('/api/google/sincronizar', async () => {
      if (!integracaoAtiva()) throw new ErroApi(400, 'Ative a integração com o Google Agenda antes de sincronizar.')
      const { eventos, marcados } = reconciliar(true)
      republicarTodos(eventos)
      // Também confere a agenda inteira: apaga cópias que o sistema não conhece mais
      sinc.solicitarConferencia()
      sinc.agendar(0)
      return { marcados, ...status() }
    })
  }

  return {
    extensao,
    rotas,
    iniciar: () => {
      // Ao subir o servidor, confere a agenda: o banco pode ter sido trocado por uma cópia antiga
      if (integracaoAtiva()) sinc.solicitarConferencia()
      sinc.iniciar()
    },
    parar: () => sinc.parar(),
    sincronizarAgora: () => sinc.processar(),
  }
}
