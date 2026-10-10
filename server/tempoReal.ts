import type { ServerResponse } from 'node:http'
import type { MensagemTempoReal } from '#shared/tipos.ts'

/** De quem é cada conexão: para fechá-la quando a sessão ou a conta deixar de valer. */
export interface DonoConexao {
  sessaoId: string
  usuarioId: string
}

/**
 * Distribui as alterações para todos os navegadores conectados via
 * Server-Sent Events (GET /api/stream). Cada aba aberta é um assinante.
 */
export class TempoReal {
  private assinantes = new Map<ServerResponse, DonoConexao | null>()
  private batimento: ReturnType<typeof setInterval>
  /**
   * Identifica a versão da interface compilada servida agora. Vai na mensagem de boas-vindas:
   * se mudar depois de uma reconexão (servidor atualizado), as abas recarregam sozinhas.
   */
  build = ''

  constructor(intervaloBatimentoMs = 25_000) {
    // Comentários periódicos mantêm a conexão viva em redes com proxy/firewall
    this.batimento = setInterval(() => this.escreverTodos(': ping\n\n'), intervaloBatimentoMs)
    this.batimento.unref?.()
  }

  get conectados() {
    return this.assinantes.size
  }

  /** `dono`: sessão e usuário da conexão (`null` nos testes com acesso livre). */
  assinar(res: ServerResponse, revisaoAtual: number, dono: DonoConexao | null = null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`retry: 3000\nevent: ola\ndata: ${JSON.stringify({ revisao: revisaoAtual, build: this.build })}\n\n`)
    this.assinantes.set(res, dono)
    // Sai da lista assim que a conexão termina por qualquer motivo. O listener de 'error' é
    // obrigatório: sem ele, um erro de escrita numa aba que acabou de fechar derrubaria o servidor.
    const sair = () => this.assinantes.delete(res)
    res.on('close', sair)
    res.on('finish', sair)
    res.on('error', sair)
  }

  publicar(msg: MensagemTempoReal) {
    this.escreverTodos(`id: ${msg.revisao}\ndata: ${JSON.stringify(msg)}\n\n`)
  }

  /**
   * Fecha as conexões destas sessões (sair, senha redefinida, conta desativada…). O navegador
   * reconecta em 3 s e recebe a boas-vindas com `semSessao`.
   */
  encerrarSessoes(ids: Iterable<string>) {
    const encerrar = new Set(ids)
    if (!encerrar.size) return
    for (const [res, dono] of this.assinantes) if (dono && encerrar.has(dono.sessaoId)) this.encerrar(res)
  }

  /** Fecha todas as conexões de um usuário (conta excluída). */
  encerrarUsuario(usuarioId: string) {
    for (const [res, dono] of this.assinantes) if (dono?.usuarioId === usuarioId) this.encerrar(res)
  }

  /** Sessões com conexão aberta (a varredura fecha as que deixaram de valer). */
  sessoesConectadas(): string[] {
    const ids = new Set<string>()
    for (const dono of this.assinantes.values()) if (dono) ids.add(dono.sessaoId)
    return [...ids]
  }

  fechar() {
    clearInterval(this.batimento)
    for (const res of this.assinantes.keys()) res.end()
    this.assinantes.clear()
  }

  private encerrar(res: ServerResponse) {
    this.assinantes.delete(res)
    try {
      res.end()
    } catch {
      /* conexão já encerrada */
    }
  }

  private escreverTodos(texto: string) {
    for (const res of this.assinantes.keys()) {
      if (res.writableEnded || res.destroyed) {
        this.assinantes.delete(res)
        continue
      }
      try {
        res.write(texto)
      } catch {
        this.assinantes.delete(res)
      }
    }
  }
}
