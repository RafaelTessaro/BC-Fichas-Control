import { LockKeyhole, LogIn, UserRoundCog } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { NOME_NIVEL } from '#shared/permissoes.ts'
import { useSessao } from '../../store/sessao'
import { toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field } from '../ui/Form'
import { Avatar } from '../ui/Misc'
import { erroAoEntrar, formatarEspera, useEspera } from './auxiliares'
import { CampoSenha } from './CampoSenha'

/**
 * "Sua sessão terminou": aparece por cima da tela (que continua montada, com o que a pessoa estava
 * digitando) quando o servidor diz que a sessão acabou. Não fecha com Esc nem clicando fora: ou entra
 * de novo, ou recarrega como outra pessoa. Fica acima das outras janelas (z-50) e da busca (z-55).
 */
export function SessaoEncerradaModal() {
  const expirou = useSessao((s) => s.expirou)
  return createPortal(<AnimatePresence>{expirou && <Janela key="sessao" />}</AnimatePresence>, document.body)
}

function Janela() {
  const usuario = useSessao((s) => s.usuario)
  const entrar = useSessao((s) => s.entrar)
  const [senha, setSenha] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [faltam, esperar] = useEspera()

  // Esc não fecha esta janela nem a que estiver por baixo (o formulário dela continua lá)
  useEffect(() => {
    const segurar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', segurar, true)
    return () => window.removeEventListener('keydown', segurar, true)
  }, [])

  if (!usuario) return null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (!senha || faltam || enviando) return
    setEnviando(true)
    setErro('')
    try {
      await entrar({ login: usuario.login, senha })
      // Com outra pessoa (ou interface nova) a página recarrega: a janela fica até lá
      if (useSessao.getState().expirou) return
      toast.sucesso('Pronto, você entrou de novo.', 'Se estava salvando alguma coisa, clique de novo em Salvar.')
    } catch (err) {
      const r = erroAoEntrar(err)
      setErro(r.mensagem)
      esperar(r.esperarSegundos)
      setSenha('')
      setEnviando(false)
    }
  }

  return (
    // Centralizada também no celular: no pé da tela, o aviso de erro da ação que falhou (que fica por cima,
    // z-[60]) cobriria o botão Entrar
    <div className="fixed inset-0 z-[58] flex items-center justify-center p-4 sm:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="absolute inset-0 bg-[rgb(10_12_14/0.5)] backdrop-blur-[4px]"
      />
      <motion.div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="sessao-encerrada-titulo"
        aria-describedby="sessao-encerrada-texto"
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-float"
      >
        <form onSubmit={enviar} className="scroll-fino flex min-h-0 flex-col overflow-y-auto" noValidate>
          <div className="flex items-start gap-3 px-6 pt-6">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 id="sessao-encerrada-titulo" className="text-lg font-semibold tracking-[-0.015em] text-ink">
                Sua sessão terminou
              </h2>
              <p id="sessao-encerrada-texto" className="mt-1 text-sm text-muted">
                Entre de novo para continuar; o que você estava digitando continua na tela.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/70 px-3.5 py-3">
              <Avatar nome={usuario.nome} />
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-medium text-ink">{usuario.nome}</p>
                <p className="truncate text-xs text-muted">
                  {usuario.login} · {NOME_NIVEL[usuario.nivel]}
                </p>
              </div>
            </div>
            {/* Para o gerenciador de senhas do navegador preencher a senha certa */}
            <input type="text" name="username" autoComplete="username" value={usuario.login} readOnly hidden />
            <Field label="Senha" htmlFor="sessao-senha">
              <CampoSenha
                id="sessao-senha"
                autoComplete="current-password"
                autoFocus
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Field>
            {(erro || faltam > 0) && (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
                {faltam > 0 ? `Muitas tentativas. Aguarde ${formatarEspera(faltam)} para tentar de novo.` : erro}
              </p>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-line bg-surface-2/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variante="ghost"
              icone={<UserRoundCog className="h-4 w-4" />}
              onClick={() => location.reload()}
              title="Recarrega a página e mostra a tela de entrada (o que não foi salvo se perde)"
            >
              Entrar como outra pessoa
            </Button>
            <Button
              variante="primary"
              type="submit"
              icone={<LogIn className="h-4 w-4" />}
              disabled={!senha || enviando || faltam > 0}
            >
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
