import { motion } from 'motion/react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { cn } from '../../lib/cn'
import { moeda, moedaCompacta } from '../../lib/format'
import { useCores } from '../../lib/useCores'

export interface PontoMensal {
  rotulo: string
  rotuloLongo: string
  diarias: number
  bobinas: number
}

const SERIES = [
  { chave: 'diarias' as const, nome: 'Diárias', cor: 'series-1' as const },
  { chave: 'bobinas' as const, nome: 'Bobinas', cor: 'series-2' as const },
]

export function Legenda() {
  const cores = useCores()
  return (
    <div className="flex items-center gap-4 text-xs text-ink-2">
      {SERIES.map((s) => (
        <span key={s.chave} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: cores[s.cor] }} />
          {s.nome}
        </span>
      ))}
    </div>
  )
}

function DicaMensal({ active, payload }: Pick<TooltipContentProps<ValueType, NameType>, 'active' | 'payload'>) {
  const cores = useCores()
  if (!active || !payload?.length) return null
  const p = payload[0].payload as PontoMensal
  return (
    <div className="min-w-[190px] rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] shadow-float">
      <p className="mb-2 font-medium text-ink">{p.rotuloLongo}</p>
      {SERIES.map((s) => (
        <div key={s.chave} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: cores[s.cor] }} />
            {s.nome}
          </span>
          <span className="tnum font-medium text-ink">{moeda(p[s.chave])}</span>
        </div>
      ))}
      <div className="mt-1.5 flex items-center justify-between gap-4 border-t border-line pt-1.5">
        <span className="text-ink-2">Total</span>
        <span className="tnum font-semibold text-ink">{moeda(p.diarias + p.bobinas)}</span>
      </div>
    </div>
  )
}

/** Colunas empilhadas (diárias + bobinas) por período. */
export function GraficoFaturamento({ dados, altura = 280 }: { dados: PontoMensal[]; altura?: number }) {
  const cores = useCores()
  const vazio = dados.every((d) => d.diarias + d.bobinas === 0)
  return (
    <div style={{ height: altura }} className="relative w-full">
      {vazio && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pb-6">
          <p className="rounded-lg bg-surface px-3 py-1.5 text-sm text-muted">Sem faturamento no período</p>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={cores.grid} strokeWidth={1} />
          <XAxis
            dataKey="rotulo"
            tickLine={false}
            axisLine={{ stroke: cores.axis }}
            tick={{ fill: cores.muted, fontSize: 12 }}
            tickMargin={8}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={vazio ? [0, 1000] : [0, 'auto']}
            tickLine={false}
            axisLine={false}
            tick={{ fill: cores.muted, fontSize: 12 }}
            tickFormatter={(v: number) => moedaCompacta(v).replace(',00', '')}
            width={72}
          />
          <Tooltip content={(p) => <DicaMensal {...p} />} cursor={{ fill: cores['surface-2'], radius: 6 }} />
          <Bar
            dataKey="diarias"
            stackId="a"
            fill={cores['series-1']}
            stroke={cores.surface}
            strokeWidth={2}
            maxBarSize={26}
            animationDuration={700}
          />
          <Bar
            dataKey="bobinas"
            stackId="a"
            fill={cores['series-2']}
            stroke={cores.surface}
            strokeWidth={2}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
            animationDuration={700}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Barras horizontais em HTML, ordenadas, com valor na ponta. */
export function BarrasHorizontais({
  itens,
  formatar = moeda,
  vazio = 'Sem dados no período.',
}: {
  itens: Array<{ rotulo: string; valor: number; detalhe?: string }>
  formatar?: (v: number) => string
  vazio?: string
}) {
  const cores = useCores()
  const [foco, setFoco] = useState<number | null>(null)
  const max = Math.max(1, ...itens.map((i) => i.valor))
  if (!itens.length) return <p className="py-10 text-center text-sm text-muted">{vazio}</p>
  return (
    <ul className="flex flex-col gap-3" onMouseLeave={() => setFoco(null)}>
      {itens.map((it, i) => (
        <li
          key={it.rotulo}
          onMouseEnter={() => setFoco(i)}
          className={cn('transition-opacity duration-150', foco !== null && foco !== i && 'opacity-55')}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-ink-2" title={it.rotulo}>
              {it.rotulo}
              {it.detalhe && <span className="ml-1.5 text-xs text-muted">{it.detalhe}</span>}
            </span>
            <span className="tnum shrink-0 font-medium text-ink">{formatar(it.valor)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: cores['surface-2'] }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(it.valor / max) * 100}%` }}
              transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{ background: cores['series-1'] }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
