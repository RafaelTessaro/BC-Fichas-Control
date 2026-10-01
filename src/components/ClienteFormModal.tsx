import { Building2, User, UserPlus, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CLIENTE_VAZIO, normalizarCliente, UFS } from '#shared/dominio.ts'
import { mascaraCep, mascaraDocumento, mascaraTelefone } from '#shared/documentos.ts'
import type { Cliente, ClienteInput, TipoCliente } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Field, Input, Select, Textarea } from './ui/Form'
import { Modal } from './ui/Modal'
import { Segmented } from './ui/Misc'

export function ClienteFormModal({
  aberto,
  aoFechar,
  cliente,
  nomeInicial,
  tipoInicial,
  aoSalvar,
}: {
  aberto: boolean
  aoFechar: () => void
  cliente?: Cliente
  nomeInicial?: string
  tipoInicial?: TipoCliente
  aoSalvar?: (c: Cliente) => void
}) {
  const [salvando, setSalvando] = useState(false)
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-2xl"
      icone={<UserPlus className="h-5 w-5" />}
      titulo={cliente ? 'Editar cliente' : 'Novo cliente'}
      descricao="Empresa (CNPJ), pessoa física (CPF) ou cliente avulso."
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-cliente" disabled={salvando}>
            {salvando ? 'Salvando…' : cliente ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </>
      }
    >
      {/* O formulário só existe com o modal aberto, então sempre começa com os dados atuais */}
      <FormularioCliente
        key={cliente?.id ?? 'novo'}
        cliente={cliente}
        nomeInicial={nomeInicial}
        tipoInicial={tipoInicial}
        aoSalvar={aoSalvar}
        aoFechar={aoFechar}
        setSalvando={setSalvando}
      />
    </Modal>
  )
}

function FormularioCliente({
  cliente,
  nomeInicial,
  tipoInicial,
  aoSalvar,
  aoFechar,
  setSalvando,
}: {
  cliente?: Cliente
  nomeInicial?: string
  tipoInicial?: TipoCliente
  aoSalvar?: (c: Cliente) => void
  aoFechar: () => void
  setSalvando: (v: boolean) => void
}) {
  const salvarCliente = useDados((s) => s.salvarCliente)
  const clientes = useDados((s) => s.clientes)
  const [f, setF] = useState<ClienteInput>(() => {
    if (!cliente) return { ...CLIENTE_VAZIO, tipo: tipoInicial ?? 'PJ', nome: nomeInicial ?? '', uf: 'SP' }
    const { id: _i, versao: _v, criadoEm: _c, atualizadoEm: _a, ...resto } = cliente
    return { ...CLIENTE_VAZIO, ...resto }
  })
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(cliente?.versao)
  const [tentou, setTentou] = useState(false)

  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const mudarTipo = (tipo: TipoCliente) =>
    setF((s) => ({ ...s, tipo, documento: tipo === 'AVULSO' ? '' : mascaraDocumento(s.documento, tipo) }))

  const { erros } = normalizarCliente(f)
  const erroDoc = erros.find((e) => /CNPJ|CPF/.test(e))
  const erroNome = erros.find((e) => /nome|razão/i.test(e))
  const erroEmail = erros.find((e) => /e-mail/i.test(e))
  const erroCep = erros.find((e) => /CEP/.test(e))
  const docDigitos = f.documento.replace(/\D/g, '')
  const duplicado = docDigitos
    ? clientes.find((c) => c.id !== cliente?.id && c.documento.replace(/\D/g, '') === docDigitos)
    : undefined

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erros.length) return
    setSalvando(true)
    try {
      const alvo = cliente && versaoBase !== undefined ? { id: cliente.id, versao: versaoBase } : undefined
      const salvo = await salvarCliente(f, alvo)
      toast.sucesso(cliente ? 'Cliente atualizado' : 'Cliente cadastrado', salvo.nome)
      aoSalvar?.(salvo)
      aoFechar()
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409 && cliente) {
        const atual = err.dados.atual as Cliente | undefined
        const sobrescrever = await confirmar({
          titulo: 'Cliente alterado por outra pessoa',
          descricao: 'Alguém salvou este cliente enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em “Salvar alterações” novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar o cliente', err)
    } finally {
      setSalvando(false)
    }
  }

  const ehPJ = f.tipo === 'PJ'
  const ehAvulso = f.tipo === 'AVULSO'

  return (
    <form id="form-cliente" onSubmit={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-6" noValidate>
      <Field label="Tipo de cliente" className="sm:col-span-6">
        <Segmented
          valor={f.tipo}
          aoMudar={mudarTipo}
          opcoes={[
            {
              valor: 'PJ',
              label: (
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5" />
                  Empresa (CNPJ)
                </span>
              ),
            },
            {
              valor: 'PF',
              label: (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  Pessoa física (CPF)
                </span>
              ),
            },
            {
              valor: 'AVULSO',
              label: (
                <span className="flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" />
                  Avulso
                </span>
              ),
            },
          ]}
        />
      </Field>

      {!ehAvulso && (
        <Field
          label={ehPJ ? 'CNPJ' : 'CPF'}
          htmlFor="cli-doc"
          className="sm:col-span-2"
          erro={tentou || docDigitos.length >= (ehPJ ? 14 : 11) ? erroDoc : null}
          hint={duplicado ? `Já cadastrado: ${duplicado.nome}` : 'Opcional'}
        >
          <Input
            id="cli-doc"
            inputMode="numeric"
            autoFocus
            value={f.documento}
            onChange={(e) => set('documento', mascaraDocumento(e.target.value, ehPJ ? 'PJ' : 'PF'))}
            placeholder={ehPJ ? '00.000.000/0000-00' : '000.000.000-00'}
          />
        </Field>
      )}

      {ehPJ && (
        <Field label="Razão social" htmlFor="cli-razao" className="sm:col-span-4">
          <Input
            id="cli-razao"
            value={f.razaoSocial}
            onChange={(e) => set('razaoSocial', e.target.value)}
            placeholder="Como consta na Receita Federal"
          />
        </Field>
      )}

      <Field
        label={ehPJ ? 'Nome fantasia' : ehAvulso ? 'Nome ou apelido' : 'Nome completo'}
        htmlFor="cli-nome"
        className={ehPJ ? 'sm:col-span-3' : ehAvulso ? 'sm:col-span-6' : 'sm:col-span-4'}
        erro={tentou ? erroNome : null}
        hint={ehAvulso ? 'Se ficar em branco, será salvo como “Cliente avulso”.' : undefined}
      >
        <Input
          id="cli-nome"
          autoFocus={ehAvulso}
          value={f.nome}
          onChange={(e) => set('nome', e.target.value)}
          placeholder={ehPJ ? 'Ex.: Padaria Ideal' : ehAvulso ? 'Ex.: Barraca do Seu Zé' : 'Nome da pessoa'}
        />
      </Field>

      {ehPJ && (
        <Field label="Responsável / Contato" htmlFor="cli-resp" className="sm:col-span-3">
          <Input
            id="cli-resp"
            value={f.responsavel}
            onChange={(e) => set('responsavel', e.target.value)}
            placeholder="Nome do contato"
          />
        </Field>
      )}

      <Field label="Telefone / WhatsApp" htmlFor="cli-tel" className="sm:col-span-3">
        <Input
          id="cli-tel"
          inputMode="tel"
          value={f.telefone}
          onChange={(e) => set('telefone', mascaraTelefone(e.target.value))}
          placeholder="(19) 90000-0000"
        />
      </Field>

      {!ehAvulso && (
        <Field label="E-mail" htmlFor="cli-email" className="sm:col-span-3" erro={tentou ? erroEmail : null}>
          <Input
            id="cli-email"
            type="email"
            value={f.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="contato@empresa.com"
          />
        </Field>
      )}

      {!ehAvulso && (
        <>
          <Field label="CEP" htmlFor="cli-cep" className="sm:col-span-2" erro={tentou ? erroCep : null}>
            <Input
              id="cli-cep"
              inputMode="numeric"
              value={f.cep}
              onChange={(e) => set('cep', mascaraCep(e.target.value))}
              placeholder="00000-000"
            />
          </Field>
          <Field label="Endereço" htmlFor="cli-log" className="sm:col-span-3">
            <Input
              id="cli-log"
              value={f.logradouro}
              onChange={(e) => set('logradouro', e.target.value)}
              placeholder="Rua, avenida…"
            />
          </Field>
          <Field label="Número" htmlFor="cli-num" className="sm:col-span-1">
            <Input id="cli-num" value={f.numero} onChange={(e) => set('numero', e.target.value)} />
          </Field>
          <Field label="Complemento" htmlFor="cli-comp" className="sm:col-span-2">
            <Input id="cli-comp" value={f.complemento} onChange={(e) => set('complemento', e.target.value)} />
          </Field>
          <Field label="Bairro" htmlFor="cli-bairro" className="sm:col-span-2">
            <Input id="cli-bairro" value={f.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </Field>
        </>
      )}

      <Field label="Cidade" htmlFor="cli-cid" className={ehAvulso ? 'sm:col-span-2' : 'sm:col-span-1'}>
        <Input id="cli-cid" value={f.cidade} onChange={(e) => set('cidade', e.target.value)} placeholder="Rio Claro" />
      </Field>
      <Field label="UF" htmlFor="cli-uf" className="sm:col-span-1">
        <Select id="cli-uf" value={f.uf} onChange={(e) => set('uf', e.target.value)}>
          <option value="">—</option>
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
