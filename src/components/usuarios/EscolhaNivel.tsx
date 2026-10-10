import { ShieldCheck, UserRound } from 'lucide-react'
import { NOME_NIVEL, RESUMO_NIVEL } from '#shared/permissoes.ts'
import type { NivelUsuario } from '#shared/tipos.ts'
import { cn } from '../../lib/cn'

const NIVEIS: Array<{ nivel: NivelUsuario; icone: typeof UserRound }> = [
  { nivel: 'COMUM', icone: UserRound },
  { nivel: 'ADMIN', icone: ShieldCheck },
]

/** Os dois níveis lado a lado, cada um com o resumo do que pode. */
export function EscolhaNivel({
  valor,
  aoMudar,
  desabilitado,
  motivo,
  nome = 'nivel',
}: {
  valor: NivelUsuario
  aoMudar: (n: NivelUsuario) => void
  desabilitado?: boolean
  /** Por que não dá para mudar (aparece abaixo e ao passar o mouse). */
  motivo?: string
  nome?: string
}) {
  return (
    <fieldset className="flex flex-col gap-1.5" disabled={desabilitado}>
      <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Nível</legend>
      <div className="grid gap-2 sm:grid-cols-2" title={desabilitado ? motivo : undefined}>
        {NIVEIS.map(({ nivel, icone: Icone }) => {
          const ativo = valor === nivel
          return (
            <label
              key={nivel}
              className={cn(
                'relative flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 transition-[border-color,background-color,box-shadow] duration-150',
                desabilitado ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                ativo
                  ? 'border-brand bg-brand-soft/50 ring-4 ring-[var(--ring)]/40'
                  : 'border-line-strong/80 bg-surface hover:border-line-strong',
              )}
            >
              <input type="radio" name={nome} value={nivel} checked={ativo} onChange={() => aoMudar(nivel)} className="sr-only" />
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-lg',
                    ativo ? 'bg-brand text-white dark:text-bg' : 'bg-surface-2 text-ink-2',
                  )}
                >
                  <Icone className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-ink">{NOME_NIVEL[nivel]}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'ml-auto h-4 w-4 rounded-full border-2 transition-colors',
                    ativo ? 'border-brand bg-brand shadow-[inset_0_0_0_2px_var(--surface)]' : 'border-line-strong',
                  )}
                />
              </span>
              <span className="text-[12.5px] leading-snug text-ink-2">{RESUMO_NIVEL[nivel]}</span>
            </label>
          )
        })}
      </div>
      {desabilitado && motivo && <p className="text-xs text-muted">{motivo}</p>}
    </fieldset>
  )
}
