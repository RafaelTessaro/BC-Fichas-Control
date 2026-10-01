import type { ServerResponse } from 'node:http'
import type { MensagemTempoReal } from '#shared/tipos.ts'

/**
 * Distribui as alterações para todos os navegadores conectados via
 * Server-Sent Events (GET /api/stream). Cada aba aberta é um assinante.
 */
export class TempoReal {
  private assinantes = new Set<ServerResponse>()
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

  assinar(res: ServerResponse, revisaoAtual: number) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`retry: 3000\nevent: ola\ndata: ${JSON.stringify({ revisao: revisaoAtual, build: this.build })}\n\n`)
    this.assinantes.add(res)
    res.on('close', () => this.assinantes.delete(res))
  }

  publicar(msg: MensagemTempoReal) {
    this.escreverTodos(`id: ${msg.revisao}\ndata: ${JSON.stringify(msg)}\n\n`)
  }

  fechar() {
    clearInterval(this.batimento)
    for (const res of this.assinantes) res.end()
    this.assinantes.clear()
  }

  private escreverTodos(texto: string) {
    for (const res of this.assinantes) {
      try {
        res.write(texto)
      } catch {
        this.assinantes.delete(res)
      }
    }
  }
}
