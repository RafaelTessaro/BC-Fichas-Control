import { RefreshCw, ServerCrash } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import logo from '../../assets/logo-mark.png'
import { useDados } from '../../store/dados'
import { Button } from '../ui/Button'

/** Exibida enquanto os dados chegam do servidor ou quando ele não responde. */
export function TelaConexao() {
  const { status, erro, recarregar } = useDados()
  const endereco = typeof location !== 'undefined' ? location.host : ''
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <AnimatePresence mode="wait">
        {status === 'erro' ? (
          <motion.div
            key="erro"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-card"
          >
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-danger-soft text-danger">
              <ServerCrash className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-semibold text-ink">Não foi possível conectar ao servidor</h1>
            <p className="mt-2 text-sm text-muted">{erro}</p>
            <ul className="mt-5 space-y-1.5 rounded-2xl bg-surface-2 p-4 text-left text-[13px] text-ink-2">
              <li>• Confira se o computador servidor está ligado e com o sistema aberto.</li>
              <li>• Confira se este computador está na mesma rede da empresa.</li>
              <li>
                • Endereço usado: <b className="font-medium text-ink">{endereco}</b>
              </li>
            </ul>
            <Button
              variante="primary"
              className="mt-6 w-full"
              icone={<RefreshCw className="h-4 w-4" />}
              onClick={() => void recarregar()}
            >
              Tentar novamente
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="carregando"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <motion.img
              src={logo}
              alt=""
              className="h-14 w-14 rounded-full shadow-card"
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p className="text-sm text-muted">Conectando ao servidor…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
