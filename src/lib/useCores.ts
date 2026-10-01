import { useEffect, useState } from 'react'

const NOMES = ['series-1', 'series-2', 'grid', 'axis', 'muted', 'surface', 'surface-2', 'ink', 'ink-2', 'border'] as const
type Cores = Record<(typeof NOMES)[number], string>

function ler(): Cores {
  const css = getComputedStyle(document.documentElement)
  return Object.fromEntries(NOMES.map((n) => [n, css.getPropertyValue(`--${n}`).trim()])) as Cores
}

/** Cores do tema atual para bibliotecas de gráfico (SVG não lê var() em atributos com segurança). */
export function useCores() {
  const [cores, setCores] = useState<Cores>(ler)
  useEffect(() => {
    const obs = new MutationObserver(() => setCores(ler()))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return cores
}
