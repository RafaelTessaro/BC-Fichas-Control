import { AtSign, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { NivelUsuario, ResultadoSenha, Usuario } from '#shared/tipos.ts'
import { NOME_USUARIO_MAX, normalizarLogin, sugerirLogin, validarLogin, validarSenhaNova } from '#shared/usuarios.ts'
import { api, ErroApi } from '../../lib/api'
import { avisarErro } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { EscolhaNivel } from './EscolhaNivel'
import { SenhaInicial, type ModoSenha } from './SenhaInicial'

/** Cadastro de um usuário: nome, login (sugerido pelo nome), nível e a senha inicial (temporária). */
export function NovoUsuarioModal({
  aberto,
  aoFechar,
  usuarios,
  aoCriar,
}: {
  aberto: boolean
  aoFechar: () => void
  /** Os já cadastrados (para avisar do login repetido antes de enviar). */
  usuarios: Usuario[]
  aoCriar: (r: ResultadoSenha) => void
}) {
  const [salvando, setSalvando] = useState(false)
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-xl"
      icone={<UserPlus className="h-5 w-5" />}
      titulo="Novo usuário"
      descricao="Cada pessoa tem o seu próprio usuário: assim o registro de atividades mostra quem fez cada coisa."
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-novo-usuario" disabled={salvando}>
            {salvando ? 'Cadastrando…' : 'Cadastrar usuário'}
          </Button>
        </>
      }
    >
      <FormNovoUsuario usuarios={usuarios} aoCriar={aoCriar} setSalvando={setSalvando} />
    </Modal>
  )
}

function FormNovoUsuario({
  usuarios,
  aoCriar,
  setSalvando,
}: {
  usuarios: Usuario[]
  aoCriar: (r: ResultadoSenha) => void
  setSalvando: (v: boolean) => void
}) {
  const [nome, setNome] = useState('')
  const [login, setLogin] = useState('')
  /** O login acompanha o nome até a pessoa digitar outro. */
  const [loginEditado, setLoginEditado] = useState(false)
  const [nivel, setNivel] = useState<NivelUsuario>('COMUM')
  const [modo, setModo] = useState<ModoSenha>('gerar')
  const [senha, setSenha] = useState('')
  const [tentou, setTentou] = useState(false)
  const [loginRecusado, setLoginRecusado] = useState('')
  const [enviando, setEnviando] = useState(false)

  const loginFinal = normalizarLogin(login)
  const erroNome = !nome.trim() ? 'Informe o nome da pessoa.' : null
  const repetido = usuarios.some((u) => u.login === loginFinal)
  const erroLogin = !loginFinal
    ? 'Informe o usuário (o login para entrar).'
    : (validarLogin(loginFinal) ?? (repetido || loginRecusado === loginFinal ? 'Já existe um usuário com este login.' : null))
  const erroSenha = modo === 'digitar' ? validarSenhaNova(senha, { login: loginFinal, nome }, { deOutraPessoa: true }) : null
  // O login repetido aparece na hora (mesmo o sugerido); os outros problemas, depois de digitar ou tentar
  const mostrarErroLogin = tentou || (loginEditado && !!login) || (!!loginFinal && (repetido || loginRecusado === loginFinal))

  const mudarNome = (v: string) => {
    setNome(v)
    if (!loginEditado) setLogin(sugerirLogin(v))
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroNome || erroLogin || erroSenha || enviando) return
    setEnviando(true)
    setSalvando(true)
    try {
      const r = await api.criarUsuario({ nome, login: loginFinal, nivel, senha: modo === 'digitar' ? senha : '' })
      aoCriar(r)
    } catch (err) {
      if (err instanceof ErroApi && err.dados.codigo === 'LOGIN_EXISTENTE') setLoginRecusado(loginFinal)
      else avisarErro('Não foi possível cadastrar', err)
      setEnviando(false)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form id="form-novo-usuario" onSubmit={enviar} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor="novo-nome" erro={tentou ? erroNome : null} hint="Como aparece nas telas.">
          <Input
            id="novo-nome"
            autoFocus
            autoComplete="off"
            maxLength={NOME_USUARIO_MAX}
            placeholder="Ex.: Maria Souza"
            value={nome}
            onChange={(e) => mudarNome(e.target.value)}
          />
        </Field>
        <Field
          label="Usuário"
          htmlFor="novo-login"
          erro={mostrarErroLogin ? erroLogin : null}
          hint="Para entrar. Minúsculas, sem espaços nem acentos."
        >
          <Input
            id="novo-login"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            placeholder="maria.souza"
            icone={<AtSign className="h-4 w-4" />}
            className="font-mono text-[13px]"
            value={login}
            onChange={(e) => {
              setLogin(e.target.value.toLowerCase().replace(/\s/g, ''))
              setLoginEditado(true)
            }}
          />
        </Field>
      </div>
      <EscolhaNivel valor={nivel} aoMudar={setNivel} />
      <SenhaInicial
        modo={modo}
        aoMudarModo={setModo}
        senha={senha}
        aoMudarSenha={setSenha}
        erro={(tentou || senha) && erroSenha ? erroSenha : null}
      />
    </form>
  )
}
