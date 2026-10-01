import type { Cliente, Evento } from '#shared/tipos.ts'

/**
 * Pontos de extensão do repositório, usados por módulos opcionais
 * (ex.: sincronização com o Google Agenda) sem acoplá-los ao núcleo.
 * Todos os ganchos são chamados depois que a transação foi confirmada.
 */
export interface ExtensaoRepositorio {
  /** Acrescenta informações somente leitura ao evento devolvido pela API. */
  decorarEvento?(evento: Evento): Evento
  /** Evento criado ou alterado (inclui mudança de status/pagamento). */
  eventoSalvo?(evento: Evento, anterior: Evento | undefined): void
  /** Cliente alterado (nome, telefone etc. aparecem no conteúdo dos eventos dele). */
  clienteSalvo?(cliente: Cliente, anterior: Cliente): void
  /** Evento excluído definitivamente. */
  eventoExcluido?(evento: Evento): void
  /** Todos os dados foram substituídos (restauração de backup, exemplo ou limpeza). */
  dadosSubstituidos?(eventos: Evento[], anteriores: Evento[]): void
}
