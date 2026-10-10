import { UserPen } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { AlteracaoUsuario, NivelUsuario, Usuario } from '#shared/tipos.ts'
import { NOME_USUARIO_MAX } from '#shared/usuarios.ts'
import { api, ErroApi } from '../../lib/api'
import { avisarErro } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field, Input } from '../ui/Form'
import { Modal } from '../ui/Modal'
import { EscolhaNivel } from './EscolhaNivel'

/** Editar o nome e o nível. Mudar o nível encerra as sessões da pessoa (ela entra de novo com o nível novo). */
export function EditarUsuarioModal({
  usuario,
  motivoNivel,
  aoFechar,
  aoSalvar,
  aoDesatualizado,
}: {
  usuario: Usuario | null
  /** Por que o nível não pode mudar (a própria conta, o último administrador), ou nada. */
  motivoNivel?: string
  aoFechar: () => void
  aoSalvar: (u: Usuario) => void
  /** Outra pessoa alterou (ou excluiu) o usuário: a lista precisa ser recarregada. */
  aoDesatualizado: () => void
}) {
  const [salvando, setSalvando] = useState(false)
  // Continua mostrando o último usuário enquanto a janela se fecha
  const [ultimo, setUltimo] = useState(usuario)
  if (usuario && usuario !== ultimo) setUltimo(usuario)
  const u = usuario ?? ultimo
  return (
    <Modal
      aberto={!!usuario}
      aoFechar={aoFechar}
      largura="max-w-xl"
      icone={<UserPen className="h-5 w-5" />}
      titulo={u ? `Editar ${u.nome}` : 'Editar usuário'}
      descricao={
        u && (
          <>
            Usuário <span className="font-mono text-[13px] text-ink-2">{u.login}</span> (o login não muda).
          </>
        )
      }
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-editar-usuario" disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      {usuario && (
        <FormEditar
          key={usuario.id}
          usuario={usuario}
          motivoNivel={motivoNivel}
          aoSalvar={aoSalvar}
          aoDesatualizado={aoDesatualizado}
          setSalvando={setSalvando}
        />
      )}
    </Modal>
  )
}

function FormEditar({
  usuario,
  motivoNivel,
  aoSalvar,
  aoDesatualizado,
  setSalvando,
}: {
  usuario: Usuario
  motivoNivel?: string
  aoSalvar: (u: Usuario) => void
  aoDesatualizado: () => void
  setSalvando: (v: boolean) => void
}) {
  const [nome, setNome] = useState(usuario.nome)
  const [nivel, setNivel] = useState<NivelUsuario>(usuario.nivel)
  const [tentou, setTentou] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const erroNome = !nome.trim() ? 'Informe o nome da pessoa.' : null
  const mudouNivel = nivel !== usuario.nivel

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroNome || enviando) return
    const alteracao: AlteracaoUsuario = { versao: usuario.versao }
    if (nome.trim() !== usuario.nome) alteracao.nome = nome
    if (mudouNivel) alteracao.nivel = nivel
    if (alteracao.nome === undefined && alteracao.nivel === undefined) return aoSalvar(usuario)
    setEnviando(true)
    setSalvando(true)
    try {
      const r = await api.alterarUsuario(usuario.id, alteracao)
      aoSalvar(r.usuario)
    } catch (err) {
      avisarErro('Não foi possível salvar', err)
      if (err instanceof ErroApi && (err.status === 404 || err.dados.codigo === 'CONFLITO')) aoDesatualizado()
      setEnviando(false)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form id="form-editar-usuario" onSubmit={enviar} className="flex flex-col gap-5" noValidate>
      <Field label="Nome" htmlFor="editar-nome" erro={tentou ? erroNome : null} hint="Como aparece nas telas.">
        <Input
          id="editar-nome"
          autoFocus
          autoComplete="off"
          maxLength={NOME_USUARIO_MAX}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </Field>
      <EscolhaNivel valor={nivel} aoMudar={setNivel} desabilitado={!!motivoNivel} motivo={motivoNivel} />
      {mudouNivel && (
        <p className="rounded-xl bg-info-soft px-3.5 py-2.5 text-[13px] text-info">
          Ao salvar, {usuario.nome.split(' ')[0]} sai do sistema em todos os computadores e entra de novo já com o nível{' '}
          {nivel === 'ADMIN' ? 'Administrador' : 'Comum'}.
        </p>
      )}
    </form>
  )
}
