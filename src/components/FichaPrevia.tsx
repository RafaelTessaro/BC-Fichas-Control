// Prévia da ficha impressa pelas máquinas (cabeçalho no topo, rodapé no fim) e
// blocos de texto com botão de copiar, usados no formulário e no detalhe do evento.

import { Check, Copy } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { cn } from '../lib/cn'
import { dataCurta } from '../lib/format'
import { toast } from '../store/ui'
import { Button } from './ui/Button'

/** Bordas serrilhadas em cima e embaixo, como papel de ficha destacado. */
const SERRILHADO =
  'conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 10px 51% repeat-x, ' +
  'conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 51% repeat-x'
const ESTILO_PAPEL: CSSProperties = { mask: SERRILHADO, WebkitMask: SERRILHADO }

function Linhas({ texto, vazio, className }: { texto: string; vazio: string; className?: string }) {
  const limpo = texto.trim()
  if (!limpo) return <p className="text-[10.5px] text-muted italic">{vazio}</p>
  return <p className={cn('break-words whitespace-pre-wrap', className)}>{limpo}</p>
}

/**
 * Ficha de exemplo com o cabeçalho e o rodapé exatamente como digitados.
 * O miolo (quantidade e valor) é só ilustrativo: quem define é a máquina.
 */
export function FichaPrevia({
  cabecalho,
  rodape,
  data,
  legenda = true,
  className,
}: {
  cabecalho: string
  rodape: string
  /** Data mostrada na ficha de exemplo (`yyyy-MM-dd`). */
  data?: string | null
  legenda?: boolean
  className?: string
}) {
  return (
    <figure className={cn('flex flex-col items-center gap-2.5', className)}>
      <div className="flex w-full justify-center rounded-2xl bg-surface-2 px-4 py-5 dark:bg-bg">
        <div className="w-full max-w-[236px] drop-shadow-md">
          <div
            style={ESTILO_PAPEL}
            className="bg-surface px-4 py-5 text-center font-mono text-[11.5px] leading-[1.45] text-ink dark:bg-surface-3"
            aria-label="Prévia da ficha impressa"
          >
            <Linhas texto={cabecalho} vazio="(sem cabeçalho)" className="font-bold" />
            <div className="my-2.5 border-t border-dashed border-line-strong" />
            <p className="text-[17px] leading-tight font-bold tracking-wide">1 FICHA</p>
            <p className="mt-1 text-[13px] font-semibold">R$ 5,00</p>
            <p className="tnum mt-1 text-[9.5px] text-muted">{data ? dataCurta(data) : 'dd/mm/aaaa'} · Nº 000001</p>
            <div className="my-2.5 border-t border-dashed border-line-strong" />
            <Linhas texto={rodape} vazio="(sem rodapé)" />
          </div>
        </div>
      </div>
      {legenda && (
        <figcaption className="text-center text-[11.5px] text-muted">
          Prévia ilustrativa: o produto e o valor vêm da máquina.
        </figcaption>
      )}
    </figure>
  )
}

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

/** Texto programado nas máquinas (cabeçalho ou rodapé), preservando as quebras de linha, com botão de copiar. */
export function TextoFicha({ rotulo, texto, vazio }: { rotulo: string; texto: string; vazio: string }) {
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
        <p className="text-[13px] font-medium text-ink-2">{rotulo}</p>
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
