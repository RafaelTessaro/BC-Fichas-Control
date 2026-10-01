import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { cn } from '../../lib/cn'
import { useToasts } from '../../store/ui'
import { Button } from './Button'
import { Input } from './Form'
import { Modal } from './Modal'

// ---- Toasts ----------------------------------------------------------------

export function Toaster() {
  const { toasts, fechar } = useToasts()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icone = t.tipo === 'sucesso' ? CircleCheck : t.tipo === 'erro' ? CircleAlert : Info
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
              transition={{ type: 'spring', stiffness: 460, damping: 34 }}
              role="status"
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 pr-2.5 shadow-float"
            >
              <Icone
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  t.tipo === 'sucesso' && 'text-success',
                  t.tipo === 'erro' && 'text-danger',
                  t.tipo === 'info' && 'text-info',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{t.titulo}</p>
                {t.descricao && <p className="mt-0.5 text-[13px] text-muted">{t.descricao}</p>}
              </div>
              <button
                onClick={() => fechar(t.id)}
                aria-label="Fechar aviso"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

// ---- Confirmação -------------------------------------------------------------

interface PedidoConfirmacao {
  titulo: string
  descricao?: string
  confirmar?: string
  perigo?: boolean
  /** Exige que o usuário digite esta palavra para liberar o botão (ações irreversíveis). */
  digitar?: string
  resolver: (ok: boolean) => void
}

const useConfirmacao = create<{ pedido: PedidoConfirmacao | null }>(() => ({ pedido: null }))

export function confirmar(opcoes: Omit<PedidoConfirmacao, 'resolver'>) {
  return new Promise<boolean>((resolver) => useConfirmacao.setState({ pedido: { ...opcoes, resolver } }))
}

export function ConfirmHost() {
  const pedido = useConfirmacao((s) => s.pedido)
  const responder = (ok: boolean) => {
    pedido?.resolver(ok)
    useTextoDigitado.setState({ texto: '' })
    useConfirmacao.setState({ pedido: null })
  }
  return (
    <Modal
      aberto={!!pedido}
      aoFechar={() => responder(false)}
      largura="max-w-md"
      titulo={pedido?.titulo}
      descricao={pedido?.descricao}
      icone={pedido?.perigo ? <TriangleAlert className="h-5 w-5 text-danger" /> : undefined}
      rodape={pedido && <BotoesConfirmacao key={pedido.titulo} pedido={pedido} responder={responder} />}
    >
      {pedido?.digitar && <CampoDigitar palavra={pedido.digitar} />}
    </Modal>
  )
}

const useTextoDigitado = create<{ texto: string }>(() => ({ texto: '' }))

function CampoDigitar({ palavra }: { palavra: string }) {
  const texto = useTextoDigitado((s) => s.texto)
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-ink-2">
      <span>
        Para confirmar, digite <b className="font-semibold text-ink">{palavra}</b>
      </span>
      <Input autoFocus value={texto} onChange={(e) => useTextoDigitado.setState({ texto: e.target.value })} autoComplete="off" />
    </label>
  )
}

function BotoesConfirmacao({ pedido, responder }: { pedido: PedidoConfirmacao; responder: (ok: boolean) => void }) {
  const texto = useTextoDigitado((s) => s.texto)
  const liberado = !pedido.digitar || texto.trim().toUpperCase() === pedido.digitar.toUpperCase()
  return (
    <>
      <Button onClick={() => responder(false)}>Cancelar</Button>
      <Button
        variante={pedido.perigo ? 'danger' : 'primary'}
        onClick={() => responder(true)}
        disabled={!liberado}
        autoFocus={!pedido.digitar}
      >
        {pedido.confirmar ?? 'Confirmar'}
      </Button>
    </>
  )
}
