import {
  Building2,
  Check,
  CircleAlert,
  Loader2,
  RotateCw,
  Search,
  SearchX,
  Sparkles,
  TriangleAlert,
  User,
  UserPlus,
  UserRound,
  WifiOff,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CLIENTE_VAZIO, normalizarCliente, UFS } from '#shared/dominio.ts'
import {
  cnpjValido,
  cpfValido,
  mascaraCep,
  mascaraDocumento,
  mascaraTelefone,
  normalizarCnpj,
  somenteDigitos,
} from '#shared/documentos.ts'
import type { Cliente, ClienteInput, TipoCliente } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import {
  acharDuplicado,
  avisoSituacao,
  camposDoCnpj,
  camposMantidos,
  consultarCep,
  consultarCnpj,
  duplicadoDoErro,
  erroDeConsulta,
  mesclarCep,
  mesclarConsulta,
  rotuloSituacao,
  tomSituacao,
  trocarTipoCliente,
  valoresDaConsultaAnterior,
  type DadosCnpj,
  type TipoErroConsulta,
} from '../lib/consultas'
import { dataCurta } from '../lib/format'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Badge } from './ui/Badge'
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

type EstadoConsulta =
  | { estado: 'ocioso' }
  | { estado: 'carregando'; cnpj: string }
  /** `mantidos`: campos já preenchidos que a consulta automática não trocou. */
  | { estado: 'ok'; cnpj: string; dados: DadosCnpj; mantidos: boolean }
  /** `manual`: modo da consulta que falhou ("Tentar de novo" repete no mesmo modo). */
  | { estado: 'erro'; cnpj: string; tipo: TipoErroConsulta; mensagem: string; manual: boolean }

type EstadoCep = { estado: 'ocioso' | 'carregando' } | { estado: 'ok' | 'erro'; mensagem: string }

/** Estado inicial: aceita um CNPJ/CPF digitado na busca de outra tela como "nome inicial". */
function formularioInicial(cliente?: Cliente, nomeInicial?: string, tipoInicial?: TipoCliente): ClienteInput {
  if (cliente) {
    const { id: _i, versao: _v, criadoEm: _c, atualizadoEm: _a, ...resto } = cliente
    return { ...CLIENTE_VAZIO, ...resto }
  }
  const base: ClienteInput = { ...CLIENTE_VAZIO, tipo: tipoInicial ?? 'PJ', nome: nomeInicial?.trim() ?? '', uf: 'SP' }
  const digitos = somenteDigitos(base.nome)
  if (/^[\d./\-\s]+$/.test(base.nome) && tipoInicial !== 'AVULSO') {
    if (cnpjValido(digitos)) return { ...base, tipo: 'PJ', nome: '', documento: mascaraDocumento(digitos, 'PJ') }
    if (cpfValido(digitos)) return { ...base, tipo: 'PF', nome: '', documento: mascaraDocumento(digitos, 'PF') }
  }
  // CNPJ alfanumérico ("12.ABC.345/01DE-35"): só letras, números e pontuação, com vários algarismos (não é um nome)
  if (/^[\dA-Za-z./\-\s]+$/.test(base.nome) && digitos.length >= 4 && tipoInicial !== 'AVULSO' && cnpjValido(base.nome)) {
    return { ...base, tipo: 'PJ', nome: '', documento: mascaraDocumento(base.nome, 'PJ') }
  }
  return base
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
  const navegar = useNavigate()
  const [f, setF] = useState<ClienteInput>(() => formularioInicial(cliente, nomeInicial, tipoInicial))
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(cliente?.versao)
  const [tentou, setTentou] = useState(false)
  const [consulta, setConsulta] = useState<EstadoConsulta>({ estado: 'ocioso' })
  const [cepEstado, setCepEstado] = useState<EstadoCep>({ estado: 'ocioso' })

  // ---- Controle das consultas (fora do render) ----
  const fRef = useRef(f)
  useEffect(() => {
    fRef.current = f
  })
  /** CNPJ já consultado automaticamente (não repete a consulta para o mesmo número). */
  const ultimoCnpj = useRef(cliente ? normalizarCnpj(cliente.documento) : '')
  /** CNPJ a que pertencem a situação cadastral e a data de consulta guardadas. */
  const cnpjDaSituacao = useRef(cliente ? normalizarCnpj(cliente.documento) : '')
  /**
   * Valores que a última consulta colocou no formulário (para saber o que foi digitado à mão).
   * Na edição de uma empresa já consultada, começa com os dados da Receita gravados: trocar o CNPJ
   * substitui razão social e endereço pelos da empresa nova, em vez de misturar as duas.
   */
  const valoresConsulta = useRef<Partial<ClienteInput>>(valoresDaConsultaAnterior(cliente))
  const seqCnpj = useRef(0)
  const ultimoCep = useRef(cliente ? somenteDigitos(cliente.cep) : '')
  const seqCep = useRef(0)
  const timerCnpj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const numeroRef = useRef<HTMLInputElement>(null)
  const logradouroRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => clearTimeout(timerCnpj.current), [])

  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setF((s) => ({ ...s, [k]: v }))

  async function buscarCnpj(cnpj: string, manual: boolean) {
    clearTimeout(timerCnpj.current)
    ultimoCnpj.current = cnpj
    const seq = ++seqCnpj.current
    setConsulta({ estado: 'carregando', cnpj })
    try {
      const dados = await consultarCnpj(cnpj)
      if (seq !== seqCnpj.current) return
      const atual = fRef.current
      // O usuário trocou o CNPJ ou o tipo enquanto esperava: descarta e deixa a consulta automática
      // livre para rodar de novo se o mesmo número voltar ao campo
      if (atual.tipo !== 'PJ' || normalizarCnpj(atual.documento) !== cnpj) {
        if (ultimoCnpj.current === cnpj) ultimoCnpj.current = ''
        return setConsulta({ estado: 'ocioso' })
      }
      const novos = camposDoCnpj(dados, new Date().toISOString())
      const { form, aplicados } = mesclarConsulta(atual, novos, valoresConsulta.current, manual)
      valoresConsulta.current = { ...valoresConsulta.current, ...aplicados }
      cnpjDaSituacao.current = cnpj
      // O endereço veio da Receita: não consulta o CEP por cima
      ultimoCep.current = somenteDigitos(form.cep)
      setCepEstado({ estado: 'ocioso' })
      setF(form)
      setConsulta({ estado: 'ok', cnpj, dados, mantidos: camposMantidos(form, novos).length > 0 })
    } catch (e) {
      if (seq !== seqCnpj.current) return
      // Permite tentar de novo redigitando o mesmo número
      ultimoCnpj.current = ''
      setConsulta({ estado: 'erro', cnpj, manual, ...erroDeConsulta(e, 'CNPJ') })
    }
  }

  /** Consulta automática ~400 ms depois de completar um CNPJ válido (já normalizado). */
  function agendarCnpj(cnpj: string) {
    clearTimeout(timerCnpj.current)
    if (cnpj.length !== 14 || !cnpjValido(cnpj) || cnpj === ultimoCnpj.current) return
    timerCnpj.current = setTimeout(() => void buscarCnpj(cnpj, false), 400)
  }

  // CNPJ vindo da busca de outra tela: consulta assim que o formulário abre
  // (para um cliente já cadastrado, `ultimoCnpj` já contém o número e nada acontece)
  useEffect(() => {
    const inicial = fRef.current
    if (inicial.tipo === 'PJ') agendarCnpj(normalizarCnpj(inicial.documento))
    // Somente ao abrir
  }, [])

  async function buscarCep(cep: string) {
    ultimoCep.current = cep
    const seq = ++seqCep.current
    setCepEstado({ estado: 'carregando' })
    try {
      const r = await consultarCep(cep)
      if (seq !== seqCep.current || somenteDigitos(fRef.current.cep) !== cep) return
      // CEP geral da cidade (sem rua e bairro) não deixa a rua e o bairro de outra cidade no formulário
      setF((s) => mesclarCep(s, r))
      setCepEstado({
        estado: 'ok',
        mensagem: r.logradouro ? 'Endereço preenchido pelo CEP.' : 'CEP geral da cidade: informe a rua e o bairro.',
      })
      // Leva o cursor para o próximo campo a preencher
      requestAnimationFrame(() => (r.logradouro ? numeroRef : logradouroRef).current?.focus())
    } catch (e) {
      if (seq !== seqCep.current) return
      ultimoCep.current = ''
      const erro = erroDeConsulta(e, 'CEP')
      setCepEstado({
        estado: 'erro',
        mensagem: erro.tipo === 'naoEncontrado' ? 'CEP não encontrado. Confira o número ou preencha o endereço.' : erro.mensagem,
      })
    }
  }

  const mudarDocumento = (valor: string) => {
    const documento = mascaraDocumento(valor, f.tipo === 'PJ' ? 'PJ' : 'PF')
    const chave = f.tipo === 'PJ' ? normalizarCnpj(documento) : somenteDigitos(documento)
    setF((s) => {
      const novo = { ...s, documento }
      // Situação da Receita pertence ao CNPJ consultado: some se o número mudar
      if ((s.situacaoCadastral || s.consultadoEm) && chave !== cnpjDaSituacao.current) {
        novo.situacaoCadastral = ''
        novo.consultadoEm = ''
      }
      return novo
    })
    if (f.tipo === 'PJ') agendarCnpj(chave)
  }

  const mudarCep = (valor: string) => {
    const cep = mascaraCep(valor)
    set('cep', cep)
    const d = somenteDigitos(cep)
    if (d.length === 8 && d !== ultimoCep.current) void buscarCep(d)
    else if (d.length < 8) {
      seqCep.current++
      ultimoCep.current = ''
      setCepEstado({ estado: 'ocioso' })
    }
  }

  const mudarTipo = (tipo: TipoCliente) => {
    clearTimeout(timerCnpj.current)
    // Limpa o que some da tela (e-mail, endereço, responsável…): nada escondido impede salvar ou é gravado
    setF((s) => trocarTipoCliente(s, tipo))
    if (tipo === 'AVULSO') {
      seqCep.current++
      ultimoCep.current = ''
      setCepEstado({ estado: 'ocioso' })
    }
  }

  const ehPJ = f.tipo === 'PJ'
  const ehAvulso = f.tipo === 'AVULSO'
  const { erros } = normalizarCliente(f)
  const erroDoc = erros.find((e) => /CNPJ|CPF/.test(e))
  const erroNome = erros.find((e) => /nome|razão/i.test(e))
  const erroEmail = erros.find((e) => /e-mail/i.test(e))
  const erroCep = erros.find((e) => /CEP/.test(e))
  // CNPJ pode ter letras (formato alfanumérico); CPF só números
  const docChave = ehPJ ? normalizarCnpj(f.documento) : somenteDigitos(f.documento)
  // Na edição, só quando o documento muda: um cliente que já estava repetido continua editável
  const duplicado = acharDuplicado(clientes, f.documento, cliente?.id, cliente?.documento)

  /** CNPJ/CPF já cadastrado em outro cliente: o servidor recusa, então oferece o cadastro existente. */
  async function oferecerExistente(outro: { id: string; nome: string }) {
    const doc = ehPJ ? 'CNPJ' : 'CPF'
    const motivo = `Já existe um cliente com este ${doc}: ${outro.nome || 'sem nome'}. O mesmo ${doc} não pode ser cadastrado duas vezes.`
    // No lançamento de evento (cadastro novo com `aoSalvar`), dá para usar o cliente existente direto
    const usarNoEvento = !cliente && !!aoSalvar
    const existente = usarNoEvento ? useDados.getState().clientes.find((c) => c.id === outro.id) : undefined
    // Sair da tela do evento perderia o que foi preenchido: sem o cliente na lista daqui, só avisa
    if (usarNoEvento && !existente) return toast.erro(`${doc} já cadastrado`, motivo)
    const ok = await confirmar({
      titulo: `${doc} já cadastrado`,
      descricao: `${motivo} ${existente ? 'Deseja usar o cliente já cadastrado?' : 'Deseja abrir o cadastro existente?'}`,
      confirmar: existente ? 'Usar este cliente' : 'Abrir cadastro existente',
    })
    if (!ok) return
    if (existente) aoSalvar?.(existente)
    else navegar(`/clientes/${outro.id}`)
    aoFechar()
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erros.length) {
      // Erro de um campo que não aparece para este tipo de cliente: avisa em vez de não fazer nada
      const visiveis = ehAvulso ? [erroNome] : [erroDoc, erroNome, erroEmail, erroCep]
      const escondido = erros.find((x) => !visiveis.includes(x))
      if (escondido) toast.erro('Confira o cadastro', escondido)
      return
    }
    // A lista daqui já mostra o mesmo CNPJ/CPF em outro cliente: nem envia
    if (duplicado) return void oferecerExistente(duplicado)
    setSalvando(true)
    try {
      const alvo = cliente && versaoBase !== undefined ? { id: cliente.id, versao: versaoBase } : undefined
      const salvo = await salvarCliente(f, alvo)
      toast.sucesso(cliente ? 'Cliente atualizado' : 'Cliente cadastrado', salvo.nome)
      aoSalvar?.(salvo)
      aoFechar()
    } catch (err) {
      const outro = duplicadoDoErro(err)
      if (outro) {
        // Outro computador cadastrou o mesmo CNPJ/CPF antes (a lista daqui ainda não mostrava)
        await oferecerExistente(outro)
      } else if (err instanceof ErroApi && err.status === 409 && cliente && err.dados.atual) {
        // Conflito de versão: outra pessoa salvou este cliente enquanto você editava
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

  const cnpjOk = ehPJ && cnpjValido(docChave)
  // O painel só mostra a consulta do CNPJ que está no campo agora
  const painel = ehPJ && consulta.estado !== 'ocioso' && consulta.cnpj === docChave ? consulta : null
  const consultando = painel?.estado === 'carregando'

  const dicaDocumento: ReactNode = duplicado ? (
    <span className="inline-flex items-center gap-1 font-medium text-warning">
      <CircleAlert className="h-3.5 w-3.5 shrink-0" />
      Já cadastrado: {duplicado.nome}
    </span>
  ) : ehPJ ? (
    f.consultadoEm && f.situacaoCadastral && !painel ? (
      `Receita: ${rotuloSituacao(f.situacaoCadastral)} · consultado em ${dataCurta(f.consultadoEm)}`
    ) : (
      'Ao completar o CNPJ, os dados da empresa são buscados sozinhos.'
    )
  ) : (
    'Opcional'
  )

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
                  <span>
                    Empresa<span className="max-sm:hidden"> (CNPJ)</span>
                  </span>
                </span>
              ),
            },
            {
              valor: 'PF',
              label: (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  <span className="max-sm:hidden">Pessoa física (CPF)</span>
                  <span className="sm:hidden">Pessoa</span>
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

      {ehAvulso && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-ink-2 sm:col-span-6"
        >
          <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
          Para clientes eventuais, sem CPF ou CNPJ: só o essencial para lançar o evento. Dá para completar o cadastro depois.
        </motion.p>
      )}

      {!ehAvulso && (
        <Field
          label={ehPJ ? 'CNPJ' : 'CPF'}
          htmlFor="cli-doc"
          className={ehPJ ? 'sm:col-span-3' : 'sm:col-span-2'}
          erro={tentou || docChave.length >= (ehPJ ? 14 : 11) ? erroDoc : null}
          hint={dicaDocumento}
        >
          <div className="relative">
            <Input
              id="cli-doc"
              // CNPJ alfanumérico tem letras: teclado completo, já em maiúsculas
              inputMode={ehPJ ? 'text' : 'numeric'}
              autoCapitalize={ehPJ ? 'characters' : undefined}
              autoComplete="off"
              autoFocus
              value={f.documento}
              onChange={(e) => mudarDocumento(e.target.value)}
              onKeyDown={(e) => {
                // Enter no CNPJ consulta em vez de salvar o formulário
                if (e.key === 'Enter' && cnpjOk) {
                  e.preventDefault()
                  void buscarCnpj(docChave, true)
                }
              }}
              placeholder={ehPJ ? '00.000.000/0000-00' : '000.000.000-00'}
              className={cn(ehPJ && 'pr-[7.25rem]', erroDoc && docChave.length >= (ehPJ ? 14 : 11) && 'border-danger')}
            />
            {ehPJ && (
              <div className="absolute inset-y-0 right-1 flex items-center">
                <Button
                  variante="soft"
                  tamanho="sm"
                  onClick={() => void buscarCnpj(docChave, true)}
                  disabled={!cnpjOk || consultando}
                  title="Buscar os dados da empresa na Receita Federal"
                  icone={consultando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                >
                  Consultar
                </Button>
              </div>
            )}
          </div>
        </Field>
      )}

      {ehPJ && (
        <Field label="Razão social" htmlFor="cli-razao" className="sm:col-span-3">
          <Input
            id="cli-razao"
            value={f.razaoSocial}
            onChange={(e) => set('razaoSocial', e.target.value)}
            placeholder="Como consta na Receita Federal"
          />
        </Field>
      )}

      <AnimatePresence initial={false} mode="wait">
        {painel && (
          <motion.div
            key={painel.estado}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden sm:col-span-6"
          >
            {painel.estado === 'carregando' && <ConsultandoCnpj />}
            {painel.estado === 'ok' && (
              <ResultadoCnpj dados={painel.dados} mantidos={painel.mantidos} aoFechar={() => setConsulta({ estado: 'ocioso' })} />
            )}
            {painel.estado === 'erro' && (
              <ErroCnpj
                tipo={painel.tipo}
                mensagem={painel.mensagem}
                // Repete no mesmo modo: a automática que falhou não sobrescreve o que foi digitado depois
                aoTentar={() => void buscarCnpj(docChave, painel.manual)}
                aoFechar={() => setConsulta({ estado: 'ocioso' })}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Field
        label={ehPJ ? 'Nome fantasia' : ehAvulso ? 'Nome ou apelido' : 'Nome completo'}
        htmlFor="cli-nome"
        className={ehPJ ? 'sm:col-span-3' : ehAvulso ? 'sm:col-span-6' : 'sm:col-span-4'}
        erro={tentou ? erroNome : null}
        hint={
          ehAvulso
            ? 'Se ficar em branco, será salvo como “Cliente avulso”.'
            : ehPJ
              ? 'Nome usado no sistema e nos recibos.'
              : undefined
        }
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
          <Field
            label="CEP"
            htmlFor="cli-cep"
            className="sm:col-span-2"
            erro={tentou ? erroCep : null}
            hint={
              cepEstado.estado === 'ok' ? (
                <span className="text-success">{cepEstado.mensagem}</span>
              ) : cepEstado.estado === 'erro' ? (
                <span className="text-warning">{cepEstado.mensagem}</span>
              ) : (
                'O endereço é preenchido pelo CEP.'
              )
            }
          >
            <div className="relative">
              <Input
                id="cli-cep"
                inputMode="numeric"
                autoComplete="off"
                value={f.cep}
                onChange={(e) => mudarCep(e.target.value)}
                placeholder="00000-000"
                className="pr-9"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2">
                <AnimatePresence mode="wait" initial={false}>
                  {cepEstado.estado === 'carregando' ? (
                    <motion.span key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <Loader2 className="h-4 w-4 animate-spin text-muted" />
                    </motion.span>
                  ) : cepEstado.estado === 'ok' ? (
                    <motion.span
                      key="ok"
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      <Check className="h-4 w-4 text-success" />
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </span>
            </div>
          </Field>
          <Field label="Endereço" htmlFor="cli-log" className="sm:col-span-3">
            <Input
              ref={logradouroRef}
              id="cli-log"
              value={f.logradouro}
              onChange={(e) => set('logradouro', e.target.value)}
              placeholder="Rua, avenida…"
            />
          </Field>
          <Field label="Número" htmlFor="cli-num" className="sm:col-span-1">
            <Input ref={numeroRef} id="cli-num" value={f.numero} onChange={(e) => set('numero', e.target.value)} />
          </Field>
          <Field label="Complemento" htmlFor="cli-comp" className="sm:col-span-2">
            <Input id="cli-comp" value={f.complemento} onChange={(e) => set('complemento', e.target.value)} />
          </Field>
          <Field label="Bairro" htmlFor="cli-bairro" className="sm:col-span-4">
            <Input id="cli-bairro" value={f.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </Field>
        </>
      )}

      <Field label="Cidade" htmlFor="cli-cid" className={ehAvulso ? 'sm:col-span-3' : 'sm:col-span-4'}>
        <Input id="cli-cid" value={f.cidade} onChange={(e) => set('cidade', e.target.value)} placeholder="Rio Claro" />
      </Field>
      {!ehAvulso && (
        <Field label="UF" htmlFor="cli-uf" className="sm:col-span-2">
          <Select id="cli-uf" value={f.uf} onChange={(e) => set('uf', e.target.value)}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
      )}

      <Field label="Observações" htmlFor="cli-obs" className="sm:col-span-6">
        <Textarea
          id="cli-obs"
          value={f.observacoes}
          onChange={(e) => set('observacoes', e.target.value)}
          placeholder={ehAvulso ? 'Ex.: barraca na festa junina da escola' : 'Informações internas sobre o cliente'}
        />
      </Field>
    </form>
  )
}

// ---- Painel da consulta de CNPJ ----------------------------------------------------

function ConsultandoCnpj() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-ink">Consultando a Receita Federal…</p>
        <div className="h-2 w-2/3 animate-pulse rounded-full bg-surface-3" />
      </div>
    </div>
  )
}

function ResultadoCnpj({ dados, mantidos, aoFechar }: { dados: DadosCnpj; mantidos: boolean; aoFechar: () => void }) {
  const aviso = avisoSituacao(dados.situacaoCadastral)
  const tom = tomSituacao(dados.situacaoCadastral)
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate font-semibold text-ink">{dados.nomeSugerido}</p>
            {dados.situacaoCadastral && <Badge tom={tom}>{rotuloSituacao(dados.situacaoCadastral)}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {dados.razaoSocial} · {dados.cnpj}
          </p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Ocultar resultado"
          className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {aviso && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={cn(
            'mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium',
            tom === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning',
          )}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {aviso}
        </motion.div>
      )}

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2.5 text-[13px] sm:grid-cols-4">
        <Info rotulo="Atividade principal" className="sm:col-span-2">
          {dados.atividadePrincipal}
        </Info>
        <Info rotulo="Aberta em">{dados.dataAbertura ? dataCurta(dados.dataAbertura) : ''}</Info>
        <Info rotulo="Fonte">{dados.fonte}</Info>
      </dl>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand" />
        {mantidos
          ? 'Campos vazios preenchidos com os dados da Receita; o que já estava preenchido foi mantido. Use “Consultar” para trocar tudo.'
          : 'Campos preenchidos com os dados da Receita. Confira e ajuste se precisar.'}
      </p>
    </div>
  )
}

function ErroCnpj({
  tipo,
  mensagem,
  aoTentar,
  aoFechar,
}: {
  tipo: TipoErroConsulta
  mensagem: string
  aoTentar: () => void
  aoFechar: () => void
}) {
  const naoSuportado = tipo === 'naoSuportado'
  // Os dois avisos pedem para preencher à mão; repetir a consulta não adianta
  const naoEncontrado = tipo === 'naoEncontrado' || naoSuportado
  const semRede = tipo === 'semInternet' || tipo === 'semServidor'
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-4',
        naoEncontrado ? 'border-warning/30 bg-warning-soft' : 'border-line bg-surface-2/60',
      )}
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
          naoEncontrado ? 'bg-surface text-warning' : 'bg-surface-3 text-ink-2',
        )}
      >
        {naoEncontrado ? (
          <SearchX className="h-4 w-4" />
        ) : semRede ? (
          <WifiOff className="h-4 w-4" />
        ) : (
          <CircleAlert className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {naoSuportado
            ? 'Consulta indisponível para este CNPJ'
            : naoEncontrado
              ? 'CNPJ não encontrado'
              : semRede
                ? 'Consulta indisponível agora'
                : 'Não foi possível consultar'}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {tipo === 'naoEncontrado' ? `${mensagem} Confira os números ou preencha os dados à mão.` : mensagem}
        </p>
        {!naoEncontrado && (
          <Button
            variante="ghost"
            tamanho="sm"
            className="mt-2 -ml-2"
            icone={<RotateCw className="h-3.5 w-3.5" />}
            onClick={aoTentar}
          >
            Tentar de novo
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={aoFechar}
        aria-label="Fechar aviso"
        className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function Info({ rotulo, children, className }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="mt-0.5 text-ink-2">{children || <span className="text-muted">—</span>}</dd>
    </div>
  )
}
