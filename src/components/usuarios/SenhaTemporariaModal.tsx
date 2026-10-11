import { Check, Copy, KeyRound, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Usuario } from '#shared/tipos.ts'
import { toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

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

/** Senha gerada pelo servidor: aparece uma única vez, para o administrador entregar à pessoa. */
export function SenhaTemporariaModal({
  dados,
  aoFechar,
}: {
  /** `nova`: acabou de cadastrar (senão, a senha foi redefinida). */
  dados: { usuario: Usuario; senha: string; nova: boolean } | null
  aoFechar: () => void
}) {
  // Continua mostrando o último conteúdo enquanto a janela se fecha
  const [ultimo, setUltimo] = useState(dados)
  if (dados && dados !== ultimo) setUltimo(dados)
  const d = dados ?? ultimo
  return (
    <Modal
      aberto={!!dados}
      aoFechar={aoFechar}
      largura="max-w-md"
      icone={<KeyRound className="h-5 w-5" />}
      titulo={d?.nova ? 'Usuário cadastrado' : 'Senha redefinida'}
      descricao={`Entregue esta senha à pessoa. ${d?.nova ? 'No primeiro acesso' : 'No próximo acesso'} o sistema pede para ela criar a própria senha.`}
      rodape={
        <Button variante="primary" onClick={aoFechar}>
          Pronto
        </Button>
      }
    >
      {d && <Conteudo key={d.senha} usuario={d.usuario} senha={d.senha} />}
    </Modal>
  )
}

function Conteudo({ usuario, senha }: { usuario: Usuario; senha: string }) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const copiar = async () => {
    if (!(await copiarTexto(senha))) {
      toast.erro('Não foi possível copiar', 'Selecione a senha e copie com Ctrl+C.')
      return
    }
    setCopiado(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Nome</dt>
        <dd className="min-w-0 truncate font-medium text-ink">{usuario.nome}</dd>
        <dt className="text-muted">Usuário</dt>
        <dd className="min-w-0 truncate font-mono text-[13px] text-ink">{usuario.login}</dd>
      </dl>
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface-2/70 p-2 pl-4">
        <span className="tnum min-w-0 flex-1 font-mono text-[19px] font-semibold tracking-[0.06em] break-all text-ink select-all">
          {senha}
        </span>
        <Button
          variante={copiado ? 'soft' : 'secondary'}
          onClick={() => void copiar()}
          aria-label="Copiar a senha"
          icone={
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={copiado ? 'ok' : 'copiar'}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex"
              >
                {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </motion.span>
            </AnimatePresence>
          }
        >
          {copiado ? 'Copiada' : 'Copiar'}
        </Button>
      </div>
      <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Esta senha não aparece de novo. Se ela se perder, use “Redefinir senha” para gerar outra. Entregue pessoalmente ou por
          uma mensagem só para a pessoa.
        </span>
      </p>
    </div>
  )
}
