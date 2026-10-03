// Texto programado nas máquinas (o nome do evento, que sai no topo das fichas, e o rodapé), com
// botão de copiar. Cada máquina tem o seu próprio layout de ficha, então aqui não há prévia: só o texto.

import { Check, Copy } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from '../store/ui'
import { Button } from './ui/Button'

/**
 * Copia para a área de transferência. O sistema roda na rede da empresa por http, onde o
 * navegador pode bloquear `navigator.clipboard`; nesse caso usa o método antigo.
 */
async function copiarTexto(texto: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    /* tenta o método antigo abaixo */
  }
  const campo = document.createElement('textarea')
  campo.value = texto
  campo.setAttribute('readonly', '')
  campo.style.position = 'fixed'
  campo.style.opacity = '0'
  document.body.appendChild(campo)
  campo.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  campo.remove()
  return ok
}

/** Texto programado nas máquinas, preservando as quebras de linha, com botão de copiar. */
export function TextoFicha({
  rotulo,
  dica,
  texto,
  vazio,
}: {
  rotulo: string
  /** Onde o texto sai na ficha (ex.: "topo da ficha"), ao lado do rótulo. */
  dica?: string
  texto: string
  vazio: string
}) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const limpo = texto.trim()

  const copiar = async () => {
    if (await copiarTexto(limpo)) {
      setCopiado(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopiado(false), 1800)
      toast.sucesso(`${rotulo} copiado`)
    } else toast.erro('Não foi possível copiar', 'Selecione o texto e use Ctrl + C.')
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex h-8 items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-medium text-ink-2">
          {rotulo}
          {dica && <span className="font-normal text-muted"> · {dica}</span>}
        </p>
        {limpo && (
          <Button
            variante="ghost"
            tamanho="sm"
            onClick={copiar}
            aria-label={`Copiar ${rotulo.toLowerCase()}`}
            icone={
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={copiado ? 'ok' : 'copiar'}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.12 }}
                  className="inline-flex"
                >
                  {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                </motion.span>
              </AnimatePresence>
            }
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        )}
      </div>
      {limpo ? (
        <pre className="scroll-fino overflow-x-auto rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
          {limpo}
        </pre>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-[13px] text-muted">{vazio}</p>
      )}
    </div>
  )
}
