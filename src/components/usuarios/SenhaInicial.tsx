import { Dices, KeyRound } from 'lucide-react'
import { SENHA_MIN } from '#shared/usuarios.ts'
import { CampoSenha } from '../sessao/CampoSenha'
import { Field } from '../ui/Form'
import { Segmented } from '../ui/Misc'

export type ModoSenha = 'gerar' | 'digitar'

/**
 * Senha que o administrador entrega: gerada pelo sistema (padrão) ou digitada. As duas são
 * temporárias: no primeiro acesso a pessoa cria a própria senha.
 */
export function SenhaInicial({
  modo,
  aoMudarModo,
  senha,
  aoMudarSenha,
  erro,
  rotulo = 'Senha inicial',
}: {
  modo: ModoSenha
  aoMudarModo: (m: ModoSenha) => void
  senha: string
  aoMudarSenha: (s: string) => void
  /** Problema da senha digitada (já com a regra de mostrar só depois de digitar ou tentar). */
  erro?: string | null
  rotulo?: string
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-ink-2">{rotulo}</span>
        <Segmented
          tamanho="sm"
          valor={modo}
          aoMudar={aoMudarModo}
          opcoes={[
            {
              valor: 'gerar',
              label: (
                <span className="flex items-center gap-1.5">
                  <Dices className="h-3.5 w-3.5" /> Gerar senha temporária
                </span>
              ),
            },
            {
              valor: 'digitar',
              label: (
                <span className="flex items-center gap-1.5">
                  <KeyRound className="h-3.5 w-3.5" /> Digitar
                </span>
              ),
            },
          ]}
        />
      </div>
      {modo === 'gerar' ? (
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
          O sistema cria uma senha (como <span className="font-mono text-ink">k7pw-9xqm-3tfa</span>) e mostra uma única vez, para
          você entregar à pessoa. No primeiro acesso ela cria a própria senha.
        </p>
      ) : (
        <Field
          erro={erro}
          hint={`Pelo menos ${SENHA_MIN} caracteres. Também é temporária: no primeiro acesso a pessoa cria a própria senha.`}
        >
          <CampoSenha
            aria-label="Senha inicial"
            autoComplete="new-password"
            autoFocus
            value={senha}
            onChange={(e) => aoMudarSenha(e.target.value)}
          />
        </Field>
      )}
    </div>
  )
}
