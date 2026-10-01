import { Building2, User, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { mascaraDocumento, mascaraTelefone } from '../lib/format'
import type { Cliente } from '../lib/types'
import { useDados, type ClienteInput } from '../store/dados'
import { toast } from '../store/ui'
import { Button } from './ui/Button'
import { Field, Input, Select, Textarea } from './ui/Form'
import { Modal } from './ui/Modal'
import { Segmented } from './ui/Misc'

const VAZIO: ClienteInput = {
  nome: '',
  tipo: 'PJ',
  documento: '',
  responsavel: '',
  telefone: '',
  email: '',
  cidade: '',
  uf: 'SP',
  endereco: '',
  observacoes: '',
}

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

export function ClienteFormModal({
  aberto,
  aoFechar,
  cliente,
  nomeInicial,
  aoSalvar,
}: {
  aberto: boolean
  aoFechar: () => void
  cliente?: Cliente
  nomeInicial?: string
  aoSalvar?: (c: Cliente) => void
}) {
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-2xl"
      icone={<UserPlus className="h-5 w-5" />}
      titulo={cliente ? 'Editar cliente' : 'Novo cliente'}
      descricao="Dados usados nos eventos e no resumo em PDF."
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-cliente">
            {cliente ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </>
      }
    >
      {/* O formulário só existe com o modal aberto, então sempre começa com os dados atuais */}
      <FormularioCliente
        key={cliente?.id ?? 'novo'}
        cliente={cliente}
        nomeInicial={nomeInicial}
        aoSalvar={aoSalvar}
        aoFechar={aoFechar}
      />
    </Modal>
  )
}

function FormularioCliente({
  cliente,
  nomeInicial,
  aoSalvar,
  aoFechar,
}: {
  cliente?: Cliente
  nomeInicial?: string
  aoSalvar?: (c: Cliente) => void
  aoFechar: () => void
}) {
  const salvarCliente = useDados((s) => s.salvarCliente)
  const clientes = useDados((s) => s.clientes)
  const [f, setF] = useState<ClienteInput>(() => {
    if (!cliente) return { ...VAZIO, nome: nomeInicial ?? '' }
    const { id: _i, criadoEm: _c, atualizadoEm: _a, ...resto } = cliente
    return { ...VAZIO, ...resto }
  })
  const [tentou, setTentou] = useState(false)

  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const nomeDuplicado = clientes.some(
    (c) => c.id !== cliente?.id && c.nome.trim().toLowerCase() === f.nome.trim().toLowerCase() && f.nome.trim(),
  )
  const erroNome = !f.nome.trim() ? 'Informe o nome do cliente.' : null
  const emailInvalido = f.email && !/^\S+@\S+\.\S+$/.test(f.email) ? 'E-mail inválido.' : null

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroNome || emailInvalido) return
    const salvo = salvarCliente({ ...f, nome: f.nome.trim() }, cliente?.id)
    toast.sucesso(cliente ? 'Cliente atualizado' : 'Cliente cadastrado', salvo.nome)
    aoSalvar?.(salvo)
    aoFechar()
  }

  return (
    <form id="form-cliente" onSubmit={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-6">
      <Field label="Tipo" className="sm:col-span-6">
        <Segmented
          valor={f.tipo}
          aoMudar={(t) => setF((s) => ({ ...s, tipo: t, documento: mascaraDocumento(s.documento, t) }))}
          opcoes={[
            {
              valor: 'PJ',
              label: (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Pessoa jurídica
                </span>
              ),
            },
            {
              valor: 'PF',
              label: (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  Pessoa física
                </span>
              ),
            },
          ]}
        />
      </Field>
      <Field
        label="Nome / Razão social"
        htmlFor="cli-nome"
        className="sm:col-span-4"
        erro={tentou ? erroNome : null}
        hint={nomeDuplicado ? 'Já existe um cliente com este nome.' : undefined}
      >
        <Input
          id="cli-nome"
          autoFocus
          value={f.nome}
          onChange={(e) => set('nome', e.target.value)}
          placeholder="Ex.: Padaria Ideal"
        />
      </Field>
      <Field label={f.tipo === 'PJ' ? 'CNPJ' : 'CPF'} htmlFor="cli-doc" className="sm:col-span-2">
        <Input
          id="cli-doc"
          inputMode="numeric"
          value={f.documento}
          onChange={(e) => set('documento', mascaraDocumento(e.target.value, f.tipo))}
          placeholder={f.tipo === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
        />
      </Field>
      <Field label="Responsável / Contato" htmlFor="cli-resp" className="sm:col-span-2">
        <Input
          id="cli-resp"
          value={f.responsavel}
          onChange={(e) => set('responsavel', e.target.value)}
          placeholder="Nome do contato"
        />
      </Field>
      <Field label="Telefone / WhatsApp" htmlFor="cli-tel" className="sm:col-span-2">
        <Input
          id="cli-tel"
          inputMode="tel"
          value={f.telefone}
          onChange={(e) => set('telefone', mascaraTelefone(e.target.value))}
          placeholder="(19) 90000-0000"
        />
      </Field>
      <Field label="E-mail" htmlFor="cli-email" className="sm:col-span-2" erro={tentou ? emailInvalido : null}>
        <Input
          id="cli-email"
          type="email"
          value={f.email}
          onChange={(e) => set('email', e.target.value)}
          placeholder="contato@empresa.com"
        />
      </Field>
      <Field label="Endereço" htmlFor="cli-end" className="sm:col-span-3">
        <Input
          id="cli-end"
          value={f.endereco}
          onChange={(e) => set('endereco', e.target.value)}
          placeholder="Rua, número, bairro"
        />
      </Field>
      <Field label="Cidade" htmlFor="cli-cid" className="sm:col-span-2">
        <Input id="cli-cid" value={f.cidade} onChange={(e) => set('cidade', e.target.value)} placeholder="Rio Claro" />
      </Field>
      <Field label="UF" htmlFor="cli-uf" className="sm:col-span-1">
        <Select id="cli-uf" value={f.uf} onChange={(e) => set('uf', e.target.value)}>
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </Select>
      </Field>
      <Field label="Observações" htmlFor="cli-obs" className="sm:col-span-6">
        <Textarea
          id="cli-obs"
          value={f.observacoes}
          onChange={(e) => set('observacoes', e.target.value)}
          placeholder="Informações internas sobre o cliente"
        />
      </Field>
    </form>
  )
}
