import type { Cliente, Evento } from '#shared/tipos.ts'
import { ErroGoogle, type ClienteGoogle } from './cliente.ts'
import {
  antigasDaLinha,
  idsDaLinha,
  temCopias,
  type ConfigGoogle,
  type CopiaAntiga,
  type EstadoGoogle,
  type LinhaSync,
} from './estado.ts'
import { hashConteudo, montarEventosGoogle } from './mapeamento.ts'

export const ATRASO_DEBOUNCE_MS = 1_500
export const INTERVALO_VERIFICACAO_MS = 15_000
const BACKOFF_INICIAL_MS = 30_000
const BACKOFF_MAXIMO_MS = 30 * 60_000
/** Sem internet, tentar custa quase nada: espera no máximo 5 min para perceber que a conexão voltou. */
const BACKOFF_MAXIMO_SEM_INTERNET_MS = 5 * 60_000
/** Com o sincronizador ligado, a agenda é conferida inteira uma vez por dia (ver `conferirAgenda`). */
export const INTERVALO_CONFERENCIA_MS = 24 * 60 * 60_000

/** Espera antes da próxima tentativa: 30 s, 1 min, 2 min, 4 min… até 30 min (ou `maximo`). */
export function atrasoBackoff(tentativas: number, maximo = BACKOFF_MAXIMO_MS) {
  return Math.min(BACKOFF_INICIAL_MS * 2 ** Math.max(0, tentativas - 1), maximo)
}

/** O erro mostra que a agenda não existe mais ou não está acessível (não adianta insistir nela). */
const semAcessoAgenda = (e: unknown) =>
  e instanceof ErroGoogle && (e.motivo === 'agendaNaoEncontrada' || (e.motivo === 'permissao' && e.status === 403))

/** Acrescenta (sem repetir) as cópias de uma agenda anterior à lista das que faltam apagar. */
function juntarAntiga(antigas: CopiaAntiga[], calendarId: string, ids: string[]): CopiaAntiga[] {
  if (!ids.length) return antigas
  const existente = antigas.find((a) => a.calendarId === calendarId)
  if (!existente) return [...antigas, { calendarId, ids: [...ids] }]
  return antigas.map((a) => (a === existente ? { calendarId, ids: [...new Set([...a.ids, ...ids])] } : a))
}

export interface DepsSincronizador {
  estado: EstadoGoogle
  obterEvento: (id: string) => Evento | undefined
  obterCliente: (id: string) => Cliente | undefined
  /** Todos os eventos do sistema (para conferir a agenda inteira). */
  listarEventos: () => Evento[]
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
 *
 * Além da fila, confere a agenda inteira (`conferirAgenda`) quando pedido — ao iniciar
 * o servidor, ao ativar/trocar a agenda e em "Sincronizar tudo agora" — e depois uma
 * vez por dia. Isso corrige o que a fila sozinha não enxerga, como a volta de uma cópia
 * antiga do banco (.db), que traz junto um registro de sincronização antigo.
 */
export class SincronizadorGoogle {
  private deps: DepsSincronizador
  private rodando = false
  private encerrado = false
  private emAndamento: Promise<void> | null = null
  private repetir = false
  private debounce?: ReturnType<typeof setTimeout>
  private intervalo?: ReturnType<typeof setInterval>
  /** Quando conferir a agenda inteira (epoch em ms); null = não pedido. */
  private proximaConferencia: number | null = null
  private falhasConferencia = 0

  constructor(deps: DepsSincronizador) {
    this.deps = deps
  }

  iniciar() {
    if (this.rodando) return
    this.rodando = true
    this.encerrado = false
    this.agendar(3_000)
    this.intervalo = setInterval(() => {
      if (this.deps.estado.temPendencias() || this.conferenciaVencida()) void this.processar()
    }, INTERVALO_VERIFICACAO_MS)
    this.intervalo.unref?.()
  }

  parar() {
    this.rodando = false
    this.encerrado = true
    clearTimeout(this.debounce)
    clearInterval(this.intervalo)
  }

  /** Pede uma conferência da agenda inteira na próxima rodada (e, depois, uma por dia). */
  solicitarConferencia() {
    this.proximaConferencia = 0
    this.falhasConferencia = 0
  }

  private conferenciaVencida() {
    return this.proximaConferencia !== null && this.deps.agora() >= this.proximaConferencia
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

    if (this.conferenciaVencida()) await this.conferir(cliente, config)
    if (this.encerrado) return

    let enviados = 0
    let antecipou = false
    for (const linha of estado.vencidas(this.deps.agora())) {
      if (this.encerrado) return
      try {
        const falouComGoogle = await this.processarEvento(linha, cliente, config)
        enviados++
        // O Google respondeu (a internet voltou, por exemplo): quem esperava por um erro
        // geral tenta já, em vez de cada um aguardar o próprio prazo
        if (falouComGoogle && !antecipou) {
          antecipou = true
          if (estado.anteciparErrosGerais(this.deps.agora()) > 0) this.repetir = true
        }
      } catch (e) {
        if (this.encerrado) return
        const erro =
          e instanceof ErroGoogle
            ? e
            : new ErroGoogle(0, 'recusado', `Erro inesperado ao enviar ao Google: ${(e as Error)?.message ?? e}`)
        if (!(e instanceof ErroGoogle)) this.deps.aviso('[google] erro inesperado', e)
        const maximo = erro.motivo === 'rede' ? BACKOFF_MAXIMO_SEM_INTERNET_MS : BACKOFF_MAXIMO_MS
        estado.falhar(linha, erro.message, this.deps.agora() + atrasoBackoff(linha.tentativas + 1, maximo), erro.geral)
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

  /**
   * Envia um evento. Devolve se alguma chamada ao Google deu certo (prova de que a
   * conexão está funcionando).
   *
   * Na troca de agenda, as cópias da agenda anterior só são apagadas DEPOIS que o
   * evento estiver completo na nova: um ID de agenda errado, sem permissão de edição ou
   * fora do ar nunca esvazia a agenda que a equipe usa.
   */
  private async processarEvento(linha: LinhaSync, cliente: ClienteGoogle, config: ConfigGoogle): Promise<boolean> {
    const { estado } = this.deps
    const id = linha.evento_id
    const agenda = config.calendarId
    const agendaDaLinha = linha.calendar_id || agenda
    let ids = idsDaLinha(linha)
    let antigas = antigasDaLinha(linha)
    let chamadas = 0

    // 1. A agenda mudou: as cópias da anterior entram na lista para apagar no fim
    if (agendaDaLinha !== agenda) {
      antigas = juntarAntiga(antigas, agendaDaLinha, ids)
      ids = []
    }
    // Voltou para uma agenda usada antes: as cópias que ficaram nela voltam a ser controladas
    const daAtual = antigas.filter((a) => a.calendarId === agenda).flatMap((a) => a.ids)
    antigas = antigas.filter((a) => a.calendarId !== agenda)
    for (const gid of daAtual) if (!ids.includes(gid)) ids.push(gid)
    const trocouAgenda = agendaDaLinha !== agenda || daAtual.length > 0

    try {
      // 2. Conteúdo desejado (nada, se o evento foi cancelado ou excluído)
      const evento = linha.excluido ? undefined : this.deps.obterEvento(id)
      const desejados = evento
        ? montarEventosGoogle(evento, this.deps.obterCliente(evento.clienteId), { incluirValores: config.incluirValores })
        : []
      const hash = hashConteudo(agenda, desejados)

      if (hash !== linha.hash || trocouAgenda) {
        // Antes do primeiro envio: invalida o hash e guarda as cópias antigas
        estado.gravarProgresso(id, agenda, ids, antigas)
        for (const g of desejados) {
          // Registra antes de enviar: um POST aplicado no Google cuja resposta se perdeu
          // (tempo esgotado) não vira uma cópia desconhecida
          if (!ids.includes(g.id)) ids.push(g.id)
          await cliente.salvarEvento(agenda, g)
          chamadas++
        }
        const manter = new Set(desejados.map((g) => g.id))
        for (const gid of [...ids]) {
          if (manter.has(gid)) continue
          await cliente.apagarEvento(agenda, gid)
          chamadas++
          ids = ids.filter((x) => x !== gid)
        }
      }

      // 3. Só agora apaga das agendas anteriores
      for (const antiga of [...antigas]) {
        for (const gid of antiga.ids) {
          try {
            await cliente.apagarEvento(antiga.calendarId, gid)
            chamadas++
          } catch (e) {
            // Agenda anterior apagada ou sem acesso: desiste dela. Qualquer outro erro
            // (sem internet, API desativada, token recusado…) tenta de novo depois
            if (semAcessoAgenda(e)) break
            throw e
          }
          antigas = antigas.map((a) => (a.calendarId === antiga.calendarId ? { ...a, ids: a.ids.filter((x) => x !== gid) } : a))
        }
        antigas = antigas.filter((a) => a.calendarId !== antiga.calendarId)
      }

      if (!evento) estado.remover(linha)
      else estado.concluir(linha, { calendarId: agenda, ids, hash, em: new Date(this.deps.agora()).toISOString() })
    } catch (e) {
      // Guarda o que já foi enviado/apagado para a próxima tentativa continuar daí
      if (!this.encerrado) estado.gravarProgresso(id, agenda, ids, antigas)
      throw e
    }
    if (!this.encerrado) this.deps.aoMudarStatus(id)
    return chamadas > 0
  }

  private async conferir(cliente: ClienteGoogle, config: ConfigGoogle) {
    try {
      await this.conferirAgenda(cliente, config)
      this.falhasConferencia = 0
      this.proximaConferencia = this.deps.agora() + INTERVALO_CONFERENCIA_MS
    } catch (e) {
      if (this.encerrado) return
      this.falhasConferencia++
      this.proximaConferencia = this.deps.agora() + atrasoBackoff(this.falhasConferencia)
      if (e instanceof ErroGoogle) this.deps.aviso(`[google] não foi possível conferir a agenda: ${e.message}`)
      else this.deps.aviso('[google] falha ao conferir a agenda', e)
    }
  }

  /**
   * Confere a agenda inteira com o banco. Necessário porque o registro de sincronização
   * (`google_sync`) fica no mesmo arquivo do banco: ao voltar uma cópia antiga do .db,
   * ele volta junto e deixa de corresponder ao que está no Google.
   *  - Cópias criadas pelo sistema (`extendedProperties.private.bcFichasId`) que nenhum
   *    evento conhece são apagadas (eventos criados depois da cópia, blocos perdidos).
   *    Eventos criados à mão no Google (sem `bcFichasId`) nunca são tocados.
   *  - Eventos marcados como enviados cujas cópias sumiram do Google, ou cujo conteúdo
   *    não confere com o último envio, voltam para a fila.
   *  - Eventos sem registro, ou registros de eventos que não existem mais, entram na fila.
   * Atenção: a agenda deve ser usada por uma só instalação do sistema (um servidor de
   * teste apontando para a mesma agenda teria os eventos do outro apagados).
   */
  private async conferirAgenda(cliente: ClienteGoogle, config: ConfigGoogle) {
    const { estado } = this.deps
    const agenda = config.calendarId
    const noGoogle = await cliente.listarEventosDoSistema(agenda)
    if (this.encerrado) return
    // O banco é lido depois da listagem (o Google só muda pelas mãos deste sincronizador)
    const presentes = new Set(noGoogle.map((g) => g.id))
    const linhas = estado.todas()
    const porEvento = new Map(linhas.map((l) => [l.evento_id, l]))
    const conhecidos = new Set<string>()
    for (const l of linhas) {
      if ((l.calendar_id || agenda) === agenda) for (const gid of idsDaLinha(l)) conhecidos.add(gid)
      for (const a of antigasDaLinha(l)) if (a.calendarId === agenda) for (const gid of a.ids) conhecidos.add(gid)
    }

    const eventos = this.deps.listarEventos()
    for (const evento of eventos) {
      const desejados = montarEventosGoogle(evento, this.deps.obterCliente(evento.clienteId), {
        incluirValores: config.incluirValores,
      })
      for (const g of desejados) conhecidos.add(g.id)
      const l = porEvento.get(evento.id)
      let forcar: boolean | null = null
      if (!l) {
        if (desejados.length) forcar = false
      } else if (l.status === 'ok' && !l.excluido) {
        const faltando = l.calendar_id === agenda && idsDaLinha(l).some((gid) => !presentes.has(gid))
        if (faltando) forcar = true
        else if (l.calendar_id !== agenda || l.hash !== hashConteudo(agenda, desejados)) forcar = false
      }
      if (forcar === null) continue
      estado.marcarPendente(evento.id, { forcar })
      this.deps.aoMudarStatus(evento.id)
    }
    const existentes = new Set(eventos.map((e) => e.id))
    for (const l of linhas) {
      if (!existentes.has(l.evento_id) && !l.excluido && temCopias(l)) estado.marcarPendente(l.evento_id, { excluido: true })
    }

    for (const g of noGoogle) {
      if (this.encerrado) return
      if (!conhecidos.has(g.id)) await cliente.apagarEvento(agenda, g.id)
    }
  }
}
