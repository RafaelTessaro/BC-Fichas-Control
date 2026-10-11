import { Check, Minus, ShieldCheck, UserRound } from 'lucide-react'
import { LISTA_PERMISSOES, NOME_NIVEL, PERMISSOES, RESUMO_NIVEL, ROTULO_PERMISSAO, SO_NA_TELA } from '#shared/permissoes.ts'
import type { NivelUsuario } from '#shared/tipos.ts'
import { cn } from '../../lib/cn'
import { Card, CardHeader } from '../ui/Card'

const NIVEIS: NivelUsuario[] = ['ADMIN', 'COMUM']
const ICONE_NIVEL = { ADMIN: ShieldCheck, COMUM: UserRound }

function Marca({ pode, nivel }: { pode: boolean; nivel: NivelUsuario }) {
  return (
    <span
      role="img"
      aria-label={`${NOME_NIVEL[nivel]}: ${pode ? 'pode' : 'não pode'}`}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-full',
        pode ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted',
      )}
    >
      {pode ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Minus className="h-3.5 w-3.5" />}
    </span>
  )
}

/**
 * "O que cada nível pode": a tabela de shared/permissoes.ts. O servidor barra as ações; faturamento e
 * planilhas só são escondidos na tela (SO_NA_TELA).
 */
export function PermissoesNiveis() {
  const linhas: Array<{ rotulo: string; pode: Record<NivelUsuario, boolean>; base?: boolean; soTela?: boolean }> = [
    {
      rotulo: 'Agenda, clientes, eventos (com valores), contratos, pagamentos e manutenção',
      pode: { ADMIN: true, COMUM: true },
      base: true,
    },
    ...LISTA_PERMISSOES.map((p) => ({
      rotulo: ROTULO_PERMISSAO[p],
      pode: { ADMIN: PERMISSOES[p].includes('ADMIN'), COMUM: PERMISSOES[p].includes('COMUM') },
      soTela: SO_NA_TELA.has(p),
    })),
  ]
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icone={<ShieldCheck className="h-4 w-4" />}
        titulo="O que cada nível pode"
        descricao="O servidor recusa as ações proibidas ao comum, mesmo que ele tente por outro caminho. O faturamento e as planilhas só ficam escondidos na tela: o comum vê o valor de cada evento e poderia somar à mão."
      />
      <div className="grid gap-3 px-5 pb-4 sm:grid-cols-2">
        {NIVEIS.map((n) => {
          const Icone = ICONE_NIVEL[n]
          return (
            <div key={n} className="rounded-xl border border-line bg-surface-2/50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icone className={cn('h-4 w-4', n === 'ADMIN' ? 'text-brand' : 'text-ink-2')} />
                {NOME_NIVEL[n]}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-ink-2">{RESUMO_NIVEL[n]}</p>
            </div>
          )
        })}
      </div>
      <div className="scroll-fino overflow-x-auto border-t border-line">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="border-b border-line bg-surface-2/70 px-5 py-2.5 text-left text-[12px] font-medium text-muted">
                O que
              </th>
              {NIVEIS.map((n) => (
                <th
                  key={n}
                  className="w-16 border-b border-line bg-surface-2/70 px-2 py-2.5 text-center text-[12px] font-medium whitespace-nowrap text-muted last:pr-5 sm:w-32 sm:px-3"
                >
                  {/* No celular, "Admin." deixa mais espaço para o texto de cada linha */}
                  <span className="sm:hidden" title={NOME_NIVEL[n]}>
                    {n === 'ADMIN' ? 'Admin.' : NOME_NIVEL[n]}
                  </span>
                  <span className="max-sm:hidden">{NOME_NIVEL[n]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo} className="group/linha">
                <td
                  className={cn(
                    'border-b border-line px-5 py-2.5 text-[13px] group-last/linha:border-b-0',
                    l.base ? 'font-medium text-ink' : 'text-ink-2',
                  )}
                >
                  {l.rotulo}
                  {l.soTela && <span className="text-muted"> · só escondido na tela</span>}
                </td>
                {NIVEIS.map((n) => (
                  <td
                    key={n}
                    className="border-b border-line px-2 py-2.5 text-center group-last/linha:border-b-0 last:pr-5 sm:px-3"
                  >
                    <Marca pode={l.pode[n]} nivel={n} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
