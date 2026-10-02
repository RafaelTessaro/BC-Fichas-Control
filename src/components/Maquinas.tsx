// Peças visuais das máquinas, usadas na Manutenção, nos eventos e nas configurações.

import { useMemo, type ReactNode } from 'react'
import { ESTADO_MAQUINA, situacaoMaquina, STATUS_OS, type EstadoMaquina, type SituacaoMaquina } from '#shared/maquinas.ts'
import type { Maquina, StatusOS, TipoMaquina } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import { hojeISO } from '../lib/format'
import { useDados } from '../store/dados'
import { Badge } from './ui/Badge'

/** Situação de hoje de cada máquina (id → situação), recalculada quando máquinas ou eventos mudam. */
export function useSituacoes(): Map<string, SituacaoMaquina> {
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  return useMemo(() => {
    const hoje = hojeISO()
    return new Map(maquinas.map((m) => [m.id, situacaoMaquina(m, eventos, hoje)]))
  }, [maquinas, eventos])
}

export function SituacaoBadge({ estado, className }: { estado: EstadoMaquina; className?: string }) {
  const e = ESTADO_MAQUINA[estado]
  return (
    <Badge tom={e.tone} className={className}>
      {e.label}
    </Badge>
  )
}

export function StatusOSBadge({ status }: { status: StatusOS }) {
  const s = STATUS_OS[status]
  return <Badge tom={s.tone}>{s.label}</Badge>
}

/** "P" ou "G" num quadradinho (máquina pequena ou grande). */
export function TipoMaquinaBadge({ tipo, className }: { tipo: TipoMaquina; className?: string }) {
  return (
    <span
      title={tipo === 'P' ? 'Máquina pequena (P)' : 'Máquina grande (G)'}
      className={cn(
        'inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1 text-[11px] font-bold',
        tipo === 'P' ? 'bg-brand-soft text-brand-ink' : 'bg-info-soft text-info',
        className,
      )}
    >
      {tipo}
    </span>
  )
}

const CORES_ESTADO: Record<EstadoMaquina, string> = {
  DISPONIVEL: 'border-success/30 bg-success-soft text-success',
  LOCADA: 'border-info/30 bg-info-soft text-info',
  MANUTENCAO: 'border-warning/40 bg-warning-soft text-warning',
  DESATIVADA: 'border-line bg-surface-2 text-muted line-through',
}

/**
 * Identificação da máquina num chip colorido pela situação. Com `aoClicar` vira botão
 * (seleção de máquinas no evento); `selecionada` destaca com a cor da marca.
 */
export function MaquinaChip({
  maquina,
  estado,
  selecionada,
  aoClicar,
  aviso,
  titulo,
  className,
}: {
  maquina: Pick<Maquina, 'identificacao' | 'tipo'>
  estado: EstadoMaquina
  selecionada?: boolean
  aoClicar?: () => void
  /** Marca de atenção (ex.: em uso em outro evento nas mesmas datas). */
  aviso?: boolean
  titulo?: string
  className?: string
}) {
  const classes = cn(
    'relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold tnum transition-colors',
    selecionada ? 'border-brand bg-brand text-white shadow-xs' : CORES_ESTADO[estado],
    aoClicar &&
      'cursor-pointer hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    className,
  )
  const conteudo: ReactNode = (
    <>
      {maquina.identificacao}
      {aviso && (
        <span aria-hidden className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-surface bg-warning-dot" />
      )}
    </>
  )
  if (!aoClicar) {
    return (
      <span className={classes} title={titulo}>
        {conteudo}
      </span>
    )
  }
  return (
    <button type="button" className={classes} title={titulo} aria-pressed={!!selecionada} onClick={aoClicar}>
      {conteudo}
    </button>
  )
}
