// Peças visuais das máquinas, usadas na Manutenção, nos eventos e nas configurações.

import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { ESTADO_MAQUINA, situacaoMaquina, STATUS_OS, type EstadoMaquina, type SituacaoMaquina } from '#shared/maquinas.ts'
import type { Maquina, StatusOS, TipoMaquina } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import { useHoje } from '../lib/hoje'
import { useDados } from '../store/dados'
import { Badge } from './ui/Badge'

/** Situação de hoje de cada máquina (id → situação), recalculada quando máquinas ou eventos mudam. */
export function useSituacoes(): Map<string, SituacaoMaquina> {
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const hoje = useHoje()
  return useMemo(() => new Map(maquinas.map((m) => [m.id, situacaoMaquina(m, eventos, hoje)])), [maquinas, eventos, hoje])
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

/** Selinho "R" da máquina que vai como reserva (o mesmo da legenda e do menu). */
export function SeloReserva({ pequeno, className }: { pequeno?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[4px] bg-warning px-0.5 leading-none font-bold text-surface',
        pequeno ? 'h-3.5 min-w-3.5 text-[9px]' : 'h-4 min-w-4 text-[10px]',
        className,
      )}
    >
      R
    </span>
  )
}

/** Toque longo (no celular e no tablet não existe o botão direito) que abre o menu da máquina. */
const TOQUE_LONGO_MS = 500

/**
 * Identificação da máquina num chip colorido pela situação. Com `aoClicar` vira botão
 * (seleção de máquinas no evento); `selecionada` destaca com a cor da marca. A máquina que vai
 * como `reserva` tem borda tracejada âmbar e o selinho "R" (marcada, fica toda âmbar).
 * `aoAbrirMenu` liga o botão direito, a tecla de menu e o toque longo (sem abrir o menu do navegador).
 */
export function MaquinaChip({
  maquina,
  estado,
  selecionada,
  reserva,
  aoClicar,
  aoAbrirMenu,
  aviso,
  desabilitado,
  titulo,
  className,
}: {
  maquina: Pick<Maquina, 'identificacao' | 'tipo'>
  estado: EstadoMaquina
  selecionada?: boolean
  /** Vai como reserva no evento (locada, parada com o cliente se não for usada). */
  reserva?: boolean
  aoClicar?: () => void
  /** Botão direito, tecla de menu ou toque longo: `ponto` é onde abrir (`null` pelo teclado). */
  aoAbrirMenu?: (alvo: HTMLElement, ponto: { x: number; y: number } | null) => void
  /** Marca de atenção (ex.: em uso em outro evento nas mesmas datas). */
  aviso?: boolean
  /** Não pode ser escolhida (em manutenção, em outro evento…): fica apagada e não responde ao clique. */
  desabilitado?: boolean
  titulo?: string
  className?: string
}) {
  // Toque longo em andamento; `abriu` evita que o clique de quando o dedo sai marque a máquina
  const toque = useRef<{ timer: number; x: number; y: number; abriu: boolean } | null>(null)
  useEffect(() => () => window.clearTimeout(toque.current?.timer), [])

  const classes = cn(
    'relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold tnum transition-colors',
    selecionada && reserva
      ? 'border-dashed border-warning-dot bg-warning-soft text-warning shadow-xs'
      : selecionada
        ? 'border-brand bg-brand text-white shadow-xs'
        : cn(CORES_ESTADO[estado], reserva && 'border-dashed border-warning-dot!'),
    aoClicar &&
      !desabilitado &&
      'cursor-pointer hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    aoAbrirMenu && 'select-none [-webkit-touch-callout:none]',
    desabilitado && 'cursor-not-allowed opacity-45 saturate-50',
    className,
  )
  const conteudo: ReactNode = (
    <>
      {maquina.identificacao}
      {reserva && (
        <>
          <SeloReserva />
          <span className="sr-only">, reserva</span>
        </>
      )}
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

  const cancelarToque = () => window.clearTimeout(toque.current?.timer)
  const menu = aoAbrirMenu && {
    onContextMenu: (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      cancelarToque()
      // Pela tecla de menu (ou Shift+F10) o ponto pode vir zerado ou fora do chip: abre embaixo dele
      const r = e.currentTarget.getBoundingClientRect()
      const dentro = e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2
      aoAbrirMenu(e.currentTarget, dentro ? { x: e.clientX, y: e.clientY } : null)
    },
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      cancelarToque()
      toque.current = null
      if (e.pointerType === 'mouse') return
      const alvo = e.currentTarget
      const atual = { x: e.clientX, y: e.clientY, abriu: false, timer: 0 }
      atual.timer = window.setTimeout(() => {
        atual.abriu = true
        aoAbrirMenu(alvo, { x: atual.x, y: atual.y })
      }, TOQUE_LONGO_MS)
      toque.current = atual
    },
    // Arrastou (rolando a tela): não é toque longo
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const t = toque.current
      if (t && !t.abriu && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) cancelarToque()
    },
    onPointerUp: cancelarToque,
    onPointerCancel: cancelarToque,
    onPointerLeave: cancelarToque,
  }
  return (
    <button
      type="button"
      className={classes}
      title={titulo}
      aria-pressed={!!selecionada}
      aria-haspopup={aoAbrirMenu ? 'menu' : undefined}
      disabled={desabilitado}
      onClick={(e) => {
        // O clique de quando o dedo sai depois do toque longo não marca (pelo teclado, `detail` é 0)
        const abriuMenu = toque.current?.abriu && e.detail !== 0
        toque.current = null
        if (!abriuMenu) aoClicar()
      }}
      {...menu}
    >
      {conteudo}
    </button>
  )
}
