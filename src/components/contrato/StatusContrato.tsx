import type { StatusContrato } from '#shared/tipos.ts'
import { STATUS_CONTRATO } from '../../lib/contratos'
import { Badge } from '../ui/Badge'

/** Situação do contrato: esperando assinatura, assinado ou cancelado. */
export function StatusContratoBadge({ status, className }: { status: StatusContrato; className?: string }) {
  const s = STATUS_CONTRATO[status]
  return (
    <Badge tom={s.tone} className={className}>
      <span title={s.descricao}>{s.label}</span>
    </Badge>
  )
}
