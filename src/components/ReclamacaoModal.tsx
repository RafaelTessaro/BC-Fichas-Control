// Esboço: o formulário de reclamação é construído junto com a ficha da máquina.
// O contrato (props) já é o definitivo, usado também pelo detalhe do evento.
import type { Reclamacao } from '#shared/tipos.ts'

export interface ReclamacaoModalProps {
  aberto: boolean
  aoFechar: () => void
  /** Edição de uma reclamação existente. */
  reclamacao?: Reclamacao
  /** Máquina já escolhida (ex.: na ficha da máquina). */
  maquinaId?: string
  /** Máquinas para escolher quando a reclamação vem de um evento (as enviadas para ele). */
  maquinasIds?: string[]
  /** Evento em que o cliente reclamou (já escolhido quando vem do evento). */
  eventoId?: string
}

export function ReclamacaoModal(_props: ReclamacaoModalProps) {
  return null
}
