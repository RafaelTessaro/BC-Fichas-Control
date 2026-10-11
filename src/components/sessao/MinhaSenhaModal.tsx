import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ErroApi } from '../../lib/api'
import { useSessao } from '../../store/sessao'
import { toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { erroAoEntrar, problemasSenhaNova, useEspera } from './auxiliares'
import { CampoSenha } from './CampoSenha'
import { fecharMinhaSenha, useMinhaSenha } from './minhaSenha'
import { SenhaNova } from './SenhaNova'

/** "Trocar minha senha": senha atual, nova e repetir. A sessão deste computador continua; as outras caem. */
export function MinhaSenhaModal() {
  const aberta = useMinhaSenha((s) => s.aberta)
  const [salvando, setSalvando] = useState(false)
  return (
    <Modal
      aberto={aberta}
      aoFechar={fecharMinhaSenha}
      largura="max-w-md"
      icone={<KeyRound className="h-5 w-5" />}
      titulo="Trocar minha senha"
      descricao="Neste computador você continua conectado. Nos outros, o sistema vai pedir para entrar de novo."
      rodape={
        <>
          <Button onClick={fecharMinhaSenha}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-minha-senha" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Trocar senha'}
          </Button>
        </>
      }
    >
      {/* Só existe com a janela aberta: sempre começa em branco */}
      <FormMinhaSenha setSalvando={setSalvando} />
    </Modal>
  )
}

function FormMinhaSenha({ setSalvando }: { setSalvando: (v: boolean) => void }) {
  const usuario = useSessao((s) => s.usuario)
  const trocarSenha = useSessao((s) => s.trocarSenha)
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [repetir, setRepetir] = useState('')
  const [tentou, setTentou] = useState(false)
  const [erroAtual, setErroAtual] = useState('')
  const [erroNova, setErroNova] = useState('')
  const [erro, setErro] = useState('')
  const [faltam, esperar, aviso] = useEspera()

  if (!usuario) return null
  const dono = { login: usuario.login, nome: usuario.nome }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    setErro('')
    if (!atual) return setErroAtual('Digite a sua senha atual.')
    const p = problemasSenhaNova(nova, repetir, dono)
    if (p.nova || p.repetir || faltam) return
    setSalvando(true)
    try {
      await trocarSenha({ senhaAtual: atual, senhaNova: nova })
      toast.sucesso('Senha trocada', 'Nos outros computadores o sistema vai pedir para entrar de novo.')
      fecharMinhaSenha()
    } catch (err) {
      const codigo = err instanceof ErroApi ? err.dados.codigo : undefined
      const mensagem = err instanceof Error ? err.message : 'Erro inesperado.'
      if (codigo === 'SENHA_ATUAL') setErroAtual(mensagem)
      else if (codigo === 'SENHA_IGUAL' || (err instanceof ErroApi && err.status === 400)) setErroNova(mensagem)
      else {
        const r = erroAoEntrar(err)
        setErro(r.mensagem)
        esperar(r.esperarSegundos, r.porComputador)
      }
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form id="form-minha-senha" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      {/* Para o gerenciador de senhas do navegador saber de quem é a senha */}
      <input type="text" name="username" autoComplete="username" value={usuario.login} readOnly hidden />
      <Field label="Senha atual" htmlFor="minha-senha-atual" erro={erroAtual || null}>
        <CampoSenha
          id="minha-senha-atual"
          autoComplete="current-password"
          autoFocus
          value={atual}
          onChange={(e) => {
            setAtual(e.target.value)
            setErroAtual('')
          }}
        />
      </Field>
      <SenhaNova
        idBase="minha-senha"
        nova={nova}
        repetir={repetir}
        aoMudarNova={(v) => {
          setNova(v)
          setErroNova('')
        }}
        aoMudarRepetir={setRepetir}
        dono={dono}
        tentou={tentou}
        erroNova={erroNova}
      />
      {(erro || faltam > 0) && (
        <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-[13px] font-medium text-danger">
          {aviso || erro}
        </p>
      )}
    </form>
  )
}
