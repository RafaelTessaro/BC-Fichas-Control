import { STATUS_PROGRAMACAO, STATUS_PROGRAMACAO_LISTA } from '#shared/maquinas.ts'
import type { StatusProgramacao } from '#shared/tipos.ts'
import { Select } from './ui/Form'
import { Badge } from './ui/Badge'

/** Selo com o andamento da programação das máquinas ("Em programação", "Enviada ao cliente"…). */
export function ProgramacaoBadge({ status, className }: { status: StatusProgramacao; className?: string }) {
  const s = STATUS_PROGRAMACAO[status]
  return (
    <Badge tom={s.tone} className={className}>
      {s.label}
    </Badge>
  )
}

/** Lista para escolher o andamento da programação (formulário e detalhe do evento). */
export function SeletorProgramacao({
  id,
  valor,
  aoMudar,
  disabled,
  className,
}: {
  id?: string
  valor: StatusProgramacao
  aoMudar: (v: StatusProgramacao) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Select
      id={id}
      value={valor}
      onChange={(e) => aoMudar(e.target.value as StatusProgramacao)}
      disabled={disabled}
      className={className}
    >
      {STATUS_PROGRAMACAO_LISTA.map((s) => (
        <option key={s} value={s} title={STATUS_PROGRAMACAO[s].descricao}>
          {STATUS_PROGRAMACAO[s].label}
        </option>
      ))}
    </Select>
  )
}
