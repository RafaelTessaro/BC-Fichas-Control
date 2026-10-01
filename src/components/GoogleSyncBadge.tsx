import { CalendarCheck, CalendarClock, CalendarX } from 'lucide-react'
import { format } from 'date-fns'
import type { Evento, SyncGoogle } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import { Badge } from './ui/Badge'

function descricao(g: SyncGoogle) {
  if (g.status === 'ok') {
    const quando = g.em ? ` (atualizado em ${format(new Date(g.em), "dd/MM/yyyy 'às' HH:mm")})` : ''
    return `Sincronizado com o Google Agenda${quando}.`
  }
  if (g.status === 'pendente') return 'Enviando ao Google Agenda…'
  return `Erro ao enviar ao Google Agenda: ${g.erro || 'tente novamente em Configurações.'}`
}

/** Indica se o evento está sincronizado com o Google Agenda. */
export function GoogleSyncBadge({ evento, compacto }: { evento: Evento; compacto?: boolean }) {
  const g = evento.google
  if (!g) return null
  const titulo = descricao(g)

  if (compacto) {
    const Icone = g.status === 'ok' ? CalendarCheck : g.status === 'pendente' ? CalendarClock : CalendarX
    return (
      <span
        title={titulo}
        aria-label={titulo}
        role="img"
        className={cn(
          'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
          g.status === 'ok' && 'text-success',
          g.status === 'pendente' && 'animate-pulse text-info',
          g.status === 'erro' && 'bg-danger-soft text-danger',
        )}
      >
        <Icone className="h-3.5 w-3.5" />
      </span>
    )
  }

  return (
    <span title={titulo} className="inline-flex">
      {g.status === 'ok' ? (
        <Badge tom="success">No Google Agenda</Badge>
      ) : g.status === 'pendente' ? (
        <Badge tom="info" className="[&>span:first-child]:animate-pulse">
          Enviando ao Google
        </Badge>
      ) : (
        <Badge tom="danger">Erro no Google</Badge>
      )}
    </span>
  )
}
