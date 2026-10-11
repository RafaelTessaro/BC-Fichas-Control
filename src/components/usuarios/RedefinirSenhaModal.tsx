import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { ResultadoSenha, Usuario } from '#shared/tipos.ts'
import { validarSenhaNova } from '#shared/usuarios.ts'
import { api, ErroApi } from '../../lib/api'
import { avisarErro } from '../../store/ui'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { SenhaInicial, type ModoSenha } from './SenhaInicial'

/**
 * Redefinir a senha de alguém que esqueceu: a senha nova é temporária (a pessoa cria a dela ao
 * entrar) e as sessões abertas caem.
 */
export function RedefinirSenhaModal({
  usuario,
  aoFechar,
  aoRedefinir,
  aoDesatualizado,
}: {
  usuario: Usuario | null
  aoFechar: () => void
  /** `senhaTemporaria` vem só quando o servidor gerou a senha. */
  aoRedefinir: (r: ResultadoSenha) => void
  aoDesatualizado: () => void
}) {
  const [salvando, setSalvando] = useState(false)
  const [ultimo, setUltimo] = useState(usuario)
  if (usuario && usuario !== ultimo) setUltimo(usuario)
  const u = usuario ?? ultimo
  return (
    <Modal
      aberto={!!usuario}
      aoFechar={aoFechar}
      largura="max-w-lg"
      icone={<KeyRound className="h-5 w-5" />}
      titulo={u ? `Redefinir a senha de ${u.nome}` : 'Redefinir senha'}
      descricao="Para quem esqueceu a senha. A pessoa sai do sistema em todos os computadores e, ao entrar com a senha nova, cria a própria senha."
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-redefinir-senha" disabled={salvando}>
            {salvando ? 'Redefinindo…' : 'Redefinir senha'}
          </Button>
        </>
      }
    >
      {usuario && (
        <FormRedefinir
          key={usuario.id}
          usuario={usuario}
          aoRedefinir={aoRedefinir}
          aoDesatualizado={aoDesatualizado}
          setSalvando={setSalvando}
        />
      )}
    </Modal>
  )
}

function FormRedefinir({
  usuario,
  aoRedefinir,
  aoDesatualizado,
  setSalvando,
}: {
  usuario: Usuario
  aoRedefinir: (r: ResultadoSenha) => void
  aoDesatualizado: () => void
  setSalvando: (v: boolean) => void
}) {
  const [modo, setModo] = useState<ModoSenha>('gerar')
  const [senha, setSenha] = useState('')
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const erroSenha = modo === 'digitar' ? validarSenhaNova(senha, usuario, { deOutraPessoa: true }) : null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroSenha || enviando) return
    setEnviando(true)
    setSalvando(true)
    try {
      aoRedefinir(await api.redefinirSenha(usuario.id, modo === 'digitar' ? senha : undefined))
    } catch (err) {
      avisarErro('Não foi possível redefinir a senha', err)
      if (err instanceof ErroApi && err.status === 404) aoDesatualizado()
      setEnviando(false)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form id="form-redefinir-senha" onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <input type="text" name="username" autoComplete="off" value={usuario.login} readOnly hidden />
      <SenhaInicial
        rotulo="Senha nova"
        modo={modo}
        aoMudarModo={setModo}
        senha={senha}
        aoMudarSenha={setSenha}
        erro={(tentou || senha) && erroSenha ? erroSenha : null}
      />
      {!usuario.ativo && (
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2">
          O usuário continua desativado: para ele voltar a entrar, use também “Reativar”.
        </p>
      )}
    </form>
  )
}
