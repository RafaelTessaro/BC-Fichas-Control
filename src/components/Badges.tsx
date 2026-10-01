import { CONFERENCIA, FORMAS_PAGAMENTO, STATUS_EVENTO, type StatusConferencia } from '../lib/calc'
import type { FormaPagamento, StatusEvento } from '../lib/types'
import { Badge } from './ui/Badge'

export function StatusBadge({ status }: { status: StatusEvento }) {
  const s = STATUS_EVENTO[status]
  return <Badge tom={s.tone}>{s.label}</Badge>
}

export function PagamentoBadge({ forma }: { forma: FormaPagamento }) {
  if (forma === 'NAO_PAGO') return <Badge tom="danger">Não pago</Badge>
  return <Badge tom="success">{FORMAS_PAGAMENTO[forma].label}</Badge>
}

export function ConferenciaBadge({ status }: { status: StatusConferencia }) {
  const c = CONFERENCIA[status]
  return <Badge tom={c.tone}>{c.label}</Badge>
}
