// Esboço: o cartão "Arquivos do evento" é construído na tela de detalhe do evento.
// O contrato (props) já é o definitivo, usado também pelo formulário do evento.

export interface AnexosEventoProps {
  /** Evento já gravado: os arquivos vão direto para o servidor. Sem ele, ficam na fila (`pendentes`). */
  eventoId?: string
  /** Fila de arquivos escolhidos antes de salvar um evento novo (enviados depois de salvar). */
  pendentes?: File[]
  aoMudarPendentes?: (arquivos: File[]) => void
  /** id do cartão, para rolar até ele. */
  id?: string
}

export function AnexosEvento(_props: AnexosEventoProps) {
  return null
}
