// Regras de entrada de dados: normalização, validação e migração de versões antigas.
// Usado pelo servidor (fonte da verdade) e pela interface (validação imediata nos formulários).

import { cnpjValido, cpfValido, mascaraCep, mascaraCnpj, mascaraCpf, normalizarCnpj, somenteDigitos } from './documentos.ts'
import { chaveIdentificacao, STATUS_MAQUINA_LISTA, STATUS_OS_LISTA, TIPOS_MAQUINA, TIPOS_OS } from './maquinas.ts'
import type {
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  DiaEvento,
  Evento,
  EventoInput,
  EventoPatch,
  FormaPagamento,
  Maquina,
  MaquinaInput,
  OrdemServico,
  OrdemServicoInput,
  StatusEvento,
  TipoCliente,
} from './tipos.ts'

export const CONFIG_PADRAO: Configuracoes = {
  valorDiariaPadrao: 80,
  valorBobinaPadrao: 6,
  frotaMaquinas: 10,
  rodapePadrao: 'AGRADECEMOS SUA PRESENÇA!',
}

export const CLIENTE_VAZIO: ClienteInput = {
  tipo: 'PJ',
  nome: '',
  razaoSocial: '',
  documento: '',
  responsavel: '',
  telefone: '',
  email: '',
  cep: '',
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  situacaoCadastral: '',
  consultadoEm: '',
  observacoes: '',
}

export const TIPOS_CLIENTE: TipoCliente[] = ['PJ', 'PF', 'AVULSO']
export const STATUS: StatusEvento[] = ['EM_ABERTO', 'PENDENTE', 'FINALIZADO', 'CANCELADO']
export const FORMAS: FormaPagamento[] = ['NAO_PAGO', 'DINHEIRO', 'BOLETO', 'CREDITO', 'DEBITO', 'PIX']
export const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ')

/** Limites de segurança contra dados corrompidos ou absurdos. */
export const LIMITES = {
  texto: 300,
  textoLongo: 5000,
  dias: 400,
  maquinas: 9999,
  valor: 1_000_000_000,
  bobinas: 10_000_000,
  /** Máquinas enviadas num mesmo evento. */
  maquinasEvento: 500,
  identificacao: 30,
  servicos: 20,
  /** Cadastro de várias máquinas de uma vez. */
  lote: 200,
}

export interface Resultado<T> {
  valor: T
  erros: string[]
}

type Bruto = Record<string, unknown>
const obj = (v: unknown): Bruto => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Bruto) : {})
const texto = (v: unknown, max = LIMITES.texto) =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : ''
const numero = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : NaN
}
const dinheiro = (v: unknown) => {
  const n = numero(v)
  return Number.isNaN(n) ? 0 : Math.round(Math.min(Math.max(n, 0), LIMITES.valor) * 100) / 100
}
const inteiro = (v: unknown, max: number, min = 0) => {
  const n = numero(v)
  return Number.isNaN(n) ? min : Math.min(Math.max(Math.trunc(n), min), max)
}
const umDe = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T => (opcoes.includes(v as T) ? (v as T) : padrao)
/** Texto de várias linhas (cabeçalho e rodapé das fichas): quebras de linha padronizadas, sem linhas vazias nas pontas. */
const multilinha = (v: unknown, max = LIMITES.texto) => texto(typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : v, max)
/** Lista de ids sem repetição. */
const ids = (v: unknown, max: number) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => texto(x, 100)).filter(Boolean))].slice(0, max)

/** `true` para datas ISO `yyyy-MM-dd` que existem no calendário. */
export function dataIsoValida(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [a, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(a, m - 1, d))
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && a >= 2000 && a <= 2100
}

/** Data de hoje (fuso local do computador) no formato `yyyy-MM-dd`. */
export function hojeLocalIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function emailValido(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// ---- Cliente -----------------------------------------------------------------

export function normalizarCliente(entrada: unknown): Resultado<ClienteInput> {
  const r = obj(entrada)
  const tipo = umDe(r.tipo, TIPOS_CLIENTE, 'PJ')
  const erros: string[] = []

  let documento = ''
  const bruto = texto(r.documento)
  // CNPJ pode ter letras (formato alfanumérico da Receita, desde julho/2026); CPF só tem números
  const cnpj = tipo === 'PJ' ? normalizarCnpj(bruto) : ''
  const digitos = somenteDigitos(bruto)
  if (tipo === 'PJ' && cnpj) {
    documento = mascaraCnpj(cnpj)
    if (!cnpjValido(cnpj)) erros.push('CNPJ inválido. Confira o número digitado.')
  } else if (tipo === 'PF' && digitos) {
    documento = mascaraCpf(digitos)
    if (!cpfValido(digitos)) erros.push('CPF inválido. Confira os números digitados.')
  }

  const razaoSocial = tipo === 'PJ' ? texto(r.razaoSocial) : ''
  let nome = texto(r.nome)
  if (!nome && razaoSocial) nome = razaoSocial
  if (!nome && tipo === 'AVULSO') nome = 'Cliente avulso'
  if (!nome) erros.push(tipo === 'PJ' ? 'Informe o nome ou a razão social.' : 'Informe o nome do cliente.')

  const email = texto(r.email).toLowerCase()
  if (email && !emailValido(email)) erros.push('E-mail inválido.')

  const uf = texto(r.uf).toUpperCase()
  const cep = mascaraCep(texto(r.cep))
  if (cep && somenteDigitos(cep).length !== 8) erros.push('CEP deve ter 8 dígitos.')

  return {
    valor: {
      tipo,
      nome,
      razaoSocial,
      documento,
      responsavel: texto(r.responsavel),
      telefone: texto(r.telefone, 40),
      email,
      cep,
      logradouro: texto(r.logradouro),
      numero: texto(r.numero, 30),
      complemento: texto(r.complemento),
      bairro: texto(r.bairro),
      cidade: texto(r.cidade),
      uf: UFS.includes(uf) ? uf : '',
      situacaoCadastral: tipo === 'PJ' ? texto(r.situacaoCadastral, 60).toUpperCase() : '',
      consultadoEm: tipo === 'PJ' ? texto(r.consultadoEm, 40) : '',
      observacoes: texto(r.observacoes, LIMITES.textoLongo),
    },
    erros,
  }
}

/** Converte um cliente salvo por versões anteriores (campo único `endereco`, sem `versao`). */
export function migrarCliente(entrada: unknown): Cliente {
  const r = obj(entrada)
  const { valor } = normalizarCliente({ ...r, logradouro: r.logradouro ?? r.endereco })
  // Dado antigo com texto no lugar do CNPJ ("isento", "não informado"): as letras não viram um CNPJ
  // alfanumérico embaralhado; fica só com os números, como antes do formato com letras
  if (valor.tipo === 'PJ' && valor.documento && !cnpjValido(valor.documento)) {
    valor.documento = mascaraCnpj(somenteDigitos(texto(r.documento)))
  }
  const agora = new Date().toISOString()
  return {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
}

// ---- Evento ------------------------------------------------------------------

function normalizarDias(v: unknown, erros: string[]): DiaEvento[] {
  const lista = Array.isArray(v) ? v.slice(0, LIMITES.dias) : []
  if (Array.isArray(v) && v.length > LIMITES.dias) erros.push(`Um evento pode ter no máximo ${LIMITES.dias} dias.`)
  const dias = lista.map((d, i) => {
    const r = obj(d)
    return {
      id: texto(r.id, 100) || `dia-${i + 1}`,
      data: texto(r.data, 10),
      maquinas: inteiro(r.maquinas, LIMITES.maquinas, 0),
    }
  })
  if (!dias.length) erros.push('Adicione pelo menos um dia de utilização.')
  else if (dias.some((d) => !dataIsoValida(d.data))) erros.push('Preencha uma data válida em todos os dias.')
  else if (new Set(dias.map((d) => d.data)).size !== dias.length) erros.push('Existem datas repetidas nos dias de utilização.')
  else if (dias.some((d) => d.maquinas < 1)) erros.push('Cada dia precisa de pelo menos 1 máquina.')
  return dias.sort((a, b) => a.data.localeCompare(b.data))
}

export function normalizarEvento(entrada: unknown): Resultado<EventoInput> {
  const r = obj(entrada)
  const erros: string[] = []

  const clienteId = texto(r.clienteId, 100)
  if (!clienteId) erros.push('Selecione o cliente.')
  const nome = texto(r.nome)
  if (!nome) erros.push('Informe o nome do evento.')

  const dias = normalizarDias(r.dias, erros)
  const bobinasConsignadas = inteiro(r.bobinasConsignadas, LIMITES.bobinas)
  let bobinasDevolvidas: number | null = null
  if (r.bobinasDevolvidas !== null && r.bobinasDevolvidas !== undefined && r.bobinasDevolvidas !== '') {
    const n = numero(r.bobinasDevolvidas)
    if (Number.isNaN(n) || n < 0) erros.push('Bobinas devolvidas inválidas.')
    else {
      bobinasDevolvidas = Math.trunc(n)
      if (bobinasDevolvidas > bobinasConsignadas) erros.push('As bobinas devolvidas não podem passar das consignadas.')
    }
  }

  const formaPagamento = umDe(r.formaPagamento, FORMAS, 'NAO_PAGO')
  let dataPagamento = texto(r.dataPagamento, 10)
  if (formaPagamento === 'NAO_PAGO') dataPagamento = ''
  else if (dataPagamento && !dataIsoValida(dataPagamento)) erros.push('Data de pagamento inválida.')

  return {
    valor: {
      clienteId,
      nome,
      cidade: texto(r.cidade),
      cabecalho: multilinha(r.cabecalho),
      dias,
      maquinasIds: ids(r.maquinasIds, LIMITES.maquinasEvento),
      valorDiaria: dinheiro(r.valorDiaria),
      valorBobina: dinheiro(r.valorBobina),
      bobinasConsignadas,
      bobinasDevolvidas,
      desconto: dinheiro(r.desconto),
      formaPagamento,
      dataPagamento,
      status: umDe(r.status, STATUS, 'EM_ABERTO'),
      rodape: multilinha(r.rodape),
      observacoes: texto(r.observacoes, LIMITES.textoLongo),
    },
    erros,
  }
}

/** Valida uma alteração rápida aplicada sobre o evento atual. */
export function normalizarPatch(entrada: unknown, atual: Evento): Resultado<EventoPatch> {
  const r = obj(entrada)
  const patch: EventoPatch = {}
  if ('status' in r) patch.status = umDe(r.status, STATUS, atual.status)
  if ('formaPagamento' in r) patch.formaPagamento = umDe(r.formaPagamento, FORMAS, atual.formaPagamento)
  if ('dataPagamento' in r) patch.dataPagamento = texto(r.dataPagamento, 10)
  if ('bobinasDevolvidas' in r) patch.bobinasDevolvidas = r.bobinasDevolvidas as number | null
  if ('observacoes' in r) patch.observacoes = texto(r.observacoes, LIMITES.textoLongo)
  // Reaproveita a validação completa sobre o resultado da combinação
  const { valor, erros } = normalizarEvento({ ...atual, ...patch })
  const final: EventoPatch = {}
  for (const k of Object.keys(patch) as Array<keyof EventoPatch>) Object.assign(final, { [k]: valor[k] })
  if (final.formaPagamento && final.formaPagamento !== 'NAO_PAGO' && !valor.dataPagamento) {
    final.dataPagamento = hojeLocalIso()
  }
  if (final.formaPagamento === 'NAO_PAGO') final.dataPagamento = ''
  return { valor: final, erros }
}

export function migrarEvento(entrada: unknown): Evento {
  const r = obj(entrada)
  const { valor } = normalizarEvento(r)
  const agora = new Date().toISOString()
  return {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    codigo: inteiro(r.codigo, Number.MAX_SAFE_INTEGER, 0),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
}

// ---- Máquinas -----------------------------------------------------------------

export const MAQUINA_VAZIA: MaquinaInput = {
  tipo: 'P',
  identificacao: '',
  status: 'DISPONIVEL',
  modelo: '',
  numeroSerie: '',
  dataAquisicao: '',
  observacoes: '',
}

export function normalizarMaquina(entrada: unknown): Resultado<MaquinaInput> {
  const r = obj(entrada)
  const erros: string[] = []
  const identificacao = texto(r.identificacao, LIMITES.identificacao)
  if (!identificacao) erros.push('Informe a identificação da máquina (ex.: P-01).')
  const dataAquisicao = texto(r.dataAquisicao, 10)
  if (dataAquisicao && !dataIsoValida(dataAquisicao)) erros.push('Data de aquisição inválida.')
  return {
    valor: {
      tipo: umDe(r.tipo, TIPOS_MAQUINA, 'P'),
      identificacao,
      status: umDe(r.status, STATUS_MAQUINA_LISTA, 'DISPONIVEL'),
      modelo: texto(r.modelo),
      numeroSerie: texto(r.numeroSerie, 60),
      dataAquisicao: dataIsoValida(dataAquisicao) ? dataAquisicao : '',
      observacoes: texto(r.observacoes, LIMITES.textoLongo),
    },
    erros,
  }
}

export function migrarMaquina(entrada: unknown): Maquina {
  const r = obj(entrada)
  const { valor } = normalizarMaquina(r)
  const agora = new Date().toISOString()
  return {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
}

// ---- Ordens de serviço (manutenção) ---------------------------------------------

export function normalizarOS(entrada: unknown): Resultado<OrdemServicoInput> {
  const r = obj(entrada)
  const erros: string[] = []
  const maquinaId = texto(r.maquinaId, 100)
  if (!maquinaId) erros.push('Selecione a máquina.')
  const status = umDe(r.status, STATUS_OS_LISTA, 'ABERTA')

  const abertura = texto(r.abertura, 10) || hojeLocalIso()
  if (!dataIsoValida(abertura)) erros.push('Data de abertura inválida.')
  // Concluída sem data: hoje. Reaberta: a data de conclusão sai.
  let conclusao = status === 'CONCLUIDA' ? texto(r.conclusao, 10) || hojeLocalIso() : ''
  if (conclusao && !dataIsoValida(conclusao)) {
    erros.push('Data de conclusão inválida.')
    conclusao = ''
  } else if (conclusao && dataIsoValida(abertura) && conclusao < abertura) {
    erros.push('A conclusão não pode ser antes da abertura.')
  }

  // Serviços sem repetição (sem diferenciar maiúsculas), na ordem em que foram marcados
  const vistos = new Set<string>()
  const servicos: string[] = []
  for (const x of Array.isArray(r.servicos) ? r.servicos : []) {
    const t = texto(x, 60)
    const chave = t.toLocaleLowerCase('pt-BR')
    if (!t || vistos.has(chave)) continue
    vistos.add(chave)
    servicos.push(t)
  }
  if (servicos.length > LIMITES.servicos) erros.push(`Uma O.S. pode ter no máximo ${LIMITES.servicos} serviços.`)
  const problema = texto(r.problema, LIMITES.textoLongo)
  if (!servicos.length && !problema) erros.push('Marque pelo menos um serviço ou descreva o problema.')

  return {
    valor: {
      maquinaId,
      tipo: umDe(r.tipo, TIPOS_OS, 'PREVENTIVA'),
      status,
      abertura,
      conclusao,
      servicos: servicos.slice(0, LIMITES.servicos),
      problema,
      solucao: texto(r.solucao, LIMITES.textoLongo),
      pecas: texto(r.pecas, LIMITES.textoLongo),
      responsavel: texto(r.responsavel),
      custo: dinheiro(r.custo),
    },
    erros,
  }
}

export function migrarOS(entrada: unknown): OrdemServico {
  const r = obj(entrada)
  const { valor } = normalizarOS(r)
  const agora = new Date().toISOString()
  return {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    numero: inteiro(r.numero, Number.MAX_SAFE_INTEGER, 0),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
}

// ---- Configurações -----------------------------------------------------------

export function normalizarConfig(entrada: unknown): Resultado<Configuracoes> {
  const r = { ...CONFIG_PADRAO, ...obj(entrada) }
  return {
    valor: {
      valorDiariaPadrao: dinheiro(r.valorDiariaPadrao),
      valorBobinaPadrao: dinheiro(r.valorBobinaPadrao),
      frotaMaquinas: inteiro(r.frotaMaquinas, LIMITES.maquinas, 1),
      rodapePadrao: texto(r.rodapePadrao),
    },
    erros: [],
  }
}

// ---- Backup ------------------------------------------------------------------

/** Garante números únicos e positivos (códigos de evento, números de O.S.) e devolve o maior. */
function numerosUnicos<T>(lista: T[], ler: (x: T) => number, gravar: (x: T, n: number) => void) {
  const usados = new Set<number>()
  let maior = lista.reduce((m, x) => Math.max(m, ler(x)), 0)
  for (const x of [...lista].sort((a, b) => ler(a) - ler(b))) {
    if (ler(x) < 1 || usados.has(ler(x))) gravar(x, ++maior)
    usados.add(ler(x))
  }
  return maior
}

/**
 * Aceita backups desta versão e das anteriores (a primeira guardava tudo no navegador; antes
 * da versão 3 não havia máquinas) e devolve os dados já migrados para o formato atual.
 */
export function validarBackup(dados: unknown): Backup {
  const b = obj(dados)
  if (b.app !== 'bc-fichas-control' || !Array.isArray(b.clientes) || !Array.isArray(b.eventos)) {
    throw new Error('Arquivo de backup inválido ou de outro sistema.')
  }
  const clientes = b.clientes.map(migrarCliente).filter((c) => c.id)
  const idsClientes = new Set(clientes.map((c) => c.id))
  if (idsClientes.size !== clientes.length) throw new Error('Backup inválido: clientes com identificador repetido.')

  const maquinas = (Array.isArray(b.maquinas) ? b.maquinas : []).map(migrarMaquina).filter((m) => m.id)
  const idsMaquinas = new Set(maquinas.map((m) => m.id))
  if (idsMaquinas.size !== maquinas.length) throw new Error('Backup inválido: máquinas com identificador repetido.')
  // Identificação repetida (ex.: digitada à mão em outra versão) ganha um sufixo
  const identificacoes = new Set<string>()
  for (const m of maquinas) {
    let ident = m.identificacao
    for (let n = 2; identificacoes.has(chaveIdentificacao(ident)); n++) ident = `${m.identificacao} (${n})`
    m.identificacao = ident
    identificacoes.add(chaveIdentificacao(ident))
  }

  const eventos = b.eventos.map(migrarEvento).filter((e) => e.id)
  if (new Set(eventos.map((e) => e.id)).size !== eventos.length) throw new Error('Backup inválido: eventos repetidos.')
  const orfaos = eventos.filter((e) => !idsClientes.has(e.clienteId))
  if (orfaos.length) throw new Error(`Backup inválido: ${orfaos.length} evento(s) sem cliente correspondente.`)
  for (const e of eventos) e.maquinasIds = e.maquinasIds.filter((id) => idsMaquinas.has(id))

  const ordens = (Array.isArray(b.ordens) ? b.ordens : []).map(migrarOS).filter((o) => o.id)
  if (new Set(ordens.map((o) => o.id)).size !== ordens.length) throw new Error('Backup inválido: ordens de serviço repetidas.')
  const semMaquina = ordens.filter((o) => !idsMaquinas.has(o.maquinaId))
  if (semMaquina.length) throw new Error(`Backup inválido: ${semMaquina.length} ordem(ns) de serviço sem máquina correspondente.`)

  // Garante códigos de evento e números de O.S. únicos (versões antigas podiam repetir após importações)
  const maiorCodigo = numerosUnicos(
    eventos,
    (e) => e.codigo,
    (e, n) => (e.codigo = n),
  )
  const maiorOS = numerosUnicos(
    ordens,
    (o) => o.numero,
    (o, n) => (o.numero = n),
  )

  return {
    app: 'bc-fichas-control',
    versao: 3,
    exportadoEm: texto(b.exportadoEm, 40),
    clientes,
    eventos,
    maquinas,
    ordens,
    config: normalizarConfig(b.config).valor,
    proximoCodigo: Math.max(inteiro(b.proximoCodigo, Number.MAX_SAFE_INTEGER, 1), maiorCodigo + 1),
    proximaOS: Math.max(inteiro(b.proximaOS, Number.MAX_SAFE_INTEGER, 1), maiorOS + 1),
  }
}
