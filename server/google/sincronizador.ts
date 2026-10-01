import type { Cliente, Evento } from '#shared/tipos.ts'
import { ErroGoogle, type ClienteGoogle } from './cliente.ts'
import { idsDaLinha, type ConfigGoogle, type EstadoGoogle, type LinhaSync } from './estado.ts'
import { hashConteudo, montarEventosGoogle } from './mapeamento.ts'

export const ATRASO_DEBOUNCE_MS = 1_500
export const INTERVALO_VERIFICACAO_MS = 15_000
const BACKOFF_INICIAL_MS = 30_000
const BACKOFF_MAXIMO_MS = 30 * 60_000

/** Espera antes da próxima tentativa: 30 s, 1 min, 2 min, 4 min… até 30 min. */
export function atrasoBackoff(tentativas: number) {
  return Math.min(BACKOFF_INICIAL_MS * 2 ** Math.max(0, tentativas - 1), BACKOFF_MAXIMO_MS)
}

export interface DepsSincronizador {
  estado: EstadoGoogle
  obterEvento: (id: string) => Evento | undefined
  obterCliente: (id: string) => Cliente | undefined
  /** Cliente do Google com as credenciais atuais (null se não houver). */
  clienteGoogle: () => ClienteGoogle | null
  /** Avisa que o status de sincronização de um evento mudou (reenviar aos navegadores). */
  aoMudarStatus: (eventoId: string) => void
  agora: () => number
  aviso: (msg: string, erro?: unknown) => void
}

/**
 * Fila de envio ao Google Agenda. Processa um evento por vez; é disparada logo após
 * as alterações (com espera curta para agrupar edições) e por um temporizador
 * periódico enquanto houver pendências. Nunca lança erro para fora.
 */
export class SincronizadorGoogle {
  private deps: DepsSincronizador
  private rodando = false
  private encerrado = false
  private emAndamento: Promise<void> | null = null
  private repetir = false
  private debounce?: ReturnType<typeof setTimeout>
  private intervalo?: ReturnType<typeof setInterval>

  constructor(deps: DepsSincronizador) {
    this.deps = deps
  }

  iniciar() {
    if (this.rodando) return
    this.rodando = true
    this.encerrado = false
    this.agendar(3_000)
    this.intervalo = setInterval(() => {
      if (this.deps.estado.temPendencias()) void this.processar()
    }, INTERVALO_VERIFICACAO_MS)
    this.intervalo.unref?.()
  }

  parar() {
    this.rodando = false
    this.encerrado = true
    clearTimeout(this.debounce)
    clearInterval(this.intervalo)
  }

  /** Agenda uma rodada (somente com o sincronizador em segundo plano ligado). */
  agendar(ms = ATRASO_DEBOUNCE_MS) {
    if (!this.rodando) return
    clearTimeout(this.debounce)
    this.debounce = setTimeout(() => void this.processar(), ms)
    this.debounce.unref?.()
  }

  /** Processa as pendências vencidas. Chamadas simultâneas aguardam a rodada atual (e uma nova). */
  processar(): Promise<void> {
    if (this.emAndamento) {
      this.repetir = true
      return this.emAndamento
    }
    this.emAndamento = (async () => {
      try {
        do {
          this.repetir = false
          await this.rodada()
        } while (this.repetir && !this.encerrado)
      } catch (e) {
        this.deps.aviso('[google] falha inesperada no sincronizador', e)
      } finally {
        this.emAndamento = null
      }
    })()
    return this.emAndamento
  }

  private async rodada() {
    const { estado } = this.deps
    const config = estado.lerConfig()
    const cliente = this.deps.clienteGoogle()
    if (!config.ativo || !config.calendarId || !cliente) return

    let enviados = 0
    for (const linha of estado.vencidas(this.deps.agora())) {
      if (this.encerrado) return
      try {
        await this.processarEvento(linha, cliente, config)
        enviados++
      } catch (e) {
        if (this.encerrado) return
        const erro =
          e instanceof ErroGoogle
            ? e
            : new ErroGoogle(0, 'recusado', `Erro inesperado ao enviar ao Google: ${(e as Error)?.message ?? e}`)
        if (!(e instanceof ErroGoogle)) this.deps.aviso('[google] erro inesperado', e)
        estado.falhar(linha, erro.message, this.deps.agora() + atrasoBackoff(linha.tentativas + 1))
        estado.gravarInfo({ ultimoErro: erro.message, ultimoErroEm: new Date(this.deps.agora()).toISOString() })
        this.deps.aoMudarStatus(linha.evento_id)
        // Sem internet, sem permissão, agenda inexistente…: os demais falhariam igual
        if (erro.geral) break
      }
    }
    if (this.encerrado) return
    if (enviados > 0) estado.gravarInfo({ ultimaSincronizacao: new Date(this.deps.agora()).toISOString() })
    if (estado.resumo().erros === 0 && estado.lerInfo().ultimoErro) estado.gravarInfo({ ultimoErro: '', ultimoErroEm: '' })
  }

  private async processarEvento(linha: LinhaSync, cliente: ClienteGoogle, config: ConfigGoogle) {
    const { estado } = this.deps
    const id = linha.evento_id
    let ids = idsDaLinha(linha)
    let agenda = linha.calendar_id || config.calendarId

    try {
      // 1. A agenda mudou: apaga da antiga (melhor esforço) antes de criar na nova
      if (agenda !== config.calendarId) {
        for (const gid of ids) {
          try {
            await cliente.apagarEvento(agenda, gid)
          } catch (e) {
            // Falhas temporárias tentam de novo; sem acesso à agenda antiga, desiste dela
            if (!(e instanceof ErroGoogle) || ['rede', 'limite', 'indisponivel', 'credenciais'].includes(e.motivo)) throw e
            break
          }
        }
        ids = []
        agenda = config.calendarId
        estado.gravarIds(id, agenda, ids)
      }

      // 2. Conteúdo desejado (nada, se o evento foi cancelado ou excluído)
      const evento = linha.excluido ? undefined : this.deps.obterEvento(id)
      const desejados = evento
        ? montarEventosGoogle(evento, this.deps.obterCliente(evento.clienteId), { incluirValores: config.incluirValores })
        : []
      const hash = hashConteudo(agenda, desejados)

      if (hash !== linha.hash || linha.calendar_id !== agenda) {
        for (const g of desejados) {
          await cliente.salvarEvento(agenda, g)
          if (!ids.includes(g.id)) ids.push(g.id)
        }
        const manter = new Set(desejados.map((g) => g.id))
        for (const gid of [...ids]) {
          if (manter.has(gid)) continue
          await cliente.apagarEvento(agenda, gid)
          ids = ids.filter((x) => x !== gid)
        }
      }

      if (!evento) estado.remover(linha)
      else estado.concluir(linha, { calendarId: agenda, ids, hash, em: new Date(this.deps.agora()).toISOString() })
    } catch (e) {
      // Guarda o que já foi enviado/apagado para a próxima tentativa continuar daí
      if (!this.encerrado) estado.gravarIds(id, agenda, ids)
      throw e
    }
    if (!this.encerrado) this.deps.aoMudarStatus(id)
  }
}
