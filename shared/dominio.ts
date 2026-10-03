// Regras de entrada de dados: normalização, validação e migração de versões antigas.
// Usado pelo servidor (fonte da verdade) e pela interface (validação imediata nos formulários).

import { cnpjValido, cpfValido, mascaraCep, mascaraCnpj, mascaraCpf, normalizarCnpj, somenteDigitos } from './documentos.ts'
import {
  chaveIdentificacao,
  chaveServico,
  periodoEvento,
  STATUS_MAQUINA_LISTA,
  STATUS_OS_LISTA,
  STATUS_PROGRAMACAO_LISTA,
  TIPOS_MAQUINA,
  TIPOS_OS,
} from './maquinas.ts'
import type {
  Backup,
  Cliente,
  ClienteInput,
  Configuracoes,
  Contrato,
  DadosContrato,
  DataHora,
  DiaEvento,
  Evento,
  EventoInput,
  EventoPatch,
  FormaPagamento,
  Maquina,
  MaquinaInput,
  NovoContrato,
  OrdemServico,
  OrdemServicoInput,
  Reclamacao,
  ReclamacaoInput,
  StatusContrato,
  StatusEvento,
  StatusProgramacao,
  TipoCliente,
} from './tipos.ts'

export const CONFIG_PADRAO: Configuracoes = {
  valorDiariaPadrao: 80,
  valorBobinaPadrao: 6,
  frotaMaquinas: 10,
  rodapePadrao: 'AGRADECEMOS SUA PRESENÇA!',
  empresaNome: 'Balanças.com',
  empresaRazaoSocial: 'FABIO DE GODOY LIMA LTDA',
  empresaCnpj: '12.403.843/0001-18',
  empresaCidade: 'Rio Claro - SP',
  // Sem serviços prontos: o usuário cadastra os que costuma fazer
  servicosManutencao: [],
  // Dados do papel timbrado (o representante e os valores de reposição ficam para o dono informar)
  empresaEndereco: 'Rua 13, nº 650, entre as Avenidas 9 e 11, Bairro da Boa Morte, Rio Claro - SP',
  empresaTelefone: '(19) 3023-9050',
  empresaEmail: 'recepcao@balancass.com',
  empresaRepresentante: '',
  empresaRepresentanteCpf: '',
  contratoForo: '',
  valorReposicaoP: 0,
  valorReposicaoG: 0,
  contratoCondicoes: '',
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

/**
 * Versão do arquivo de backup: 4 trouxe as reclamações; 5, as máquinas reserva e as séries de
 * eventos; 6, os contratos de locação.
 */
export const VERSAO_BACKUP = 6

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
  /** Serviços de manutenção cadastrados (a lista para marcar). */
  catalogoServicos: 100,
  /** Cadastro de várias máquinas de uma vez. */
  lote: 200,
  /** Cópias criadas de uma vez por "Repetir em outras datas". */
  repeticoes: 60,
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
    const reservas = inteiro(r.reservas, LIMITES.maquinas, 0)
    return {
      id: texto(r.id, 100) || `dia-${i + 1}`,
      data: texto(r.data, 10),
      maquinas: inteiro(r.maquinas, LIMITES.maquinas, 0),
      reservas,
      // Não dá para usar mais reservas do que as que ficaram com o cliente
      reservasUsadas: Math.min(inteiro(r.reservasUsadas, LIMITES.maquinas, 0), reservas),
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

  const maquinasIds = ids(r.maquinasIds, LIMITES.maquinasEvento)
  const formaPagamento = umDe(r.formaPagamento, FORMAS, 'NAO_PAGO')
  let dataPagamento = texto(r.dataPagamento, 10)
  if (formaPagamento === 'NAO_PAGO') dataPagamento = ''
  else if (dataPagamento && !dataIsoValida(dataPagamento)) erros.push('Data de pagamento inválida.')

  return {
    valor: {
      clienteId,
      nome,
      cidade: texto(r.cidade),
      // O nome do evento é o topo das fichas: um cabeçalho que diga algo a mais vai para as observações
      cabecalho: '',
      dias,
      maquinasIds,
      // A reserva é uma das máquinas enviadas
      reservasIds: ids(r.reservasIds, LIMITES.maquinasEvento).filter((id) => maquinasIds.includes(id)),
      grupoId: texto(r.grupoId, 100),
      valorDiaria: dinheiro(r.valorDiaria),
      valorBobina: dinheiro(r.valorBobina),
      bobinasConsignadas,
      bobinasDevolvidas,
      desconto: dinheiro(r.desconto),
      formaPagamento,
      dataPagamento,
      status: umDe(r.status, STATUS, 'EM_ABERTO'),
      rodape: multilinha(r.rodape),
      observacoes: observacoesComCabecalhoAntigo(r.cabecalho, nome, texto(r.observacoes, LIMITES.textoLongo)),
      periodoCorrido: r.periodoCorrido === true,
      programacao: umDe(r.programacao, STATUS_PROGRAMACAO_LISTA, 'NAO_INICIADA'),
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
  if ('programacao' in r) patch.programacao = umDe(r.programacao, STATUS_PROGRAMACAO_LISTA, atual.programacao)
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

/**
 * Antes do cabeçalho das fichas, o evento tinha o campo "Local" (ex.: "Salão paroquial").
 * Para não perder o que foi digitado, ele passa para o início das observações.
 */
export function observacoesComLocalAntigo(local: unknown, observacoes: string) {
  const l = texto(local)
  if (!l || observacoes.includes(l)) return observacoes
  return texto([`Local: ${l}`, observacoes].filter(Boolean).join('\n'), LIMITES.textoLongo)
}

/**
 * Até a versão 2.2 o evento tinha um "cabeçalho das fichas" separado do nome. Agora o nome do
 * evento faz esse papel: quando o cabeçalho antigo diz algo além do nome, ele vai para o início
 * das observações (para não perder o que foi digitado).
 */
export function observacoesComCabecalhoAntigo(cabecalho: unknown, nome: string, observacoes: string) {
  const linhas = (typeof cabecalho === 'string' ? cabecalho : '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  if (!linhas.length) return observacoes
  const igual = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }) === 0
  if (linhas.length === 1 && igual(linhas[0], nome.trim())) return observacoes
  const linha = `Cabeçalho das fichas: ${linhas.join(' / ')}`
  if (observacoes.includes(linha)) return observacoes
  return texto([linha, observacoes].filter(Boolean).join('\n'), LIMITES.textoLongo)
}

/**
 * Programação de um evento gravado antes desse controle: concluída nos eventos finalizados ou que
 * já passaram; "não iniciada" nos que ainda vão acontecer — inclusive os cancelados, que podem ser
 * reativados (as listas de programação não mostram eventos cancelados).
 */
export function programacaoPadrao(e: Pick<Evento, 'dias' | 'status'>, hoje = hojeLocalIso()): StatusProgramacao {
  if (e.status === 'FINALIZADO') return 'CONCLUIDA'
  const p = periodoEvento(e)
  return p && p.fim < hoje ? 'CONCLUIDA' : 'NAO_INICIADA'
}

/** Reservas de um dia gravado antes da máquina reserva (2.4): nenhuma. */
function diaComReservas(d: DiaEvento): DiaEvento {
  const reservas = Number.isInteger(d.reservas) && d.reservas > 0 ? d.reservas : 0
  const usadas = Number.isInteger(d.reservasUsadas) && d.reservasUsadas > 0 ? Math.min(d.reservasUsadas, reservas) : 0
  return d.reservas === reservas && d.reservasUsadas === usadas ? d : { ...d, reservas, reservasUsadas: usadas }
}

/**
 * Ajustes de leitura de um evento gravado por versões anteriores (no banco ou num backup):
 * "local" e "cabeçalho" antigos vão para as observações; programação ausente ganha o padrão;
 * sem reservas nem grupo quando ainda não existiam.
 */
export function atualizarEventoAntigo<T extends Evento>(e: T, bruto: Record<string, unknown>): T {
  let observacoes = observacoesComLocalAntigo(bruto.local, e.observacoes)
  // (já aplicado por normalizarEvento nos backups; aqui, para o que está gravado no banco)
  observacoes = observacoesComCabecalhoAntigo(bruto.cabecalho, e.nome, observacoes)
  const programacao = STATUS_PROGRAMACAO_LISTA.includes(bruto.programacao as StatusProgramacao)
    ? (bruto.programacao as StatusProgramacao)
    : programacaoPadrao(e)
  const maquinasIds = Array.isArray(e.maquinasIds) ? e.maquinasIds : []
  return {
    ...e,
    observacoes,
    cabecalho: '',
    programacao,
    periodoCorrido: bruto.periodoCorrido === true,
    dias: (Array.isArray(e.dias) ? e.dias : []).map(diaComReservas),
    maquinasIds,
    reservasIds: (Array.isArray(e.reservasIds) ? e.reservasIds : []).filter((id) => maquinasIds.includes(id)),
    grupoId: typeof e.grupoId === 'string' ? e.grupoId : '',
  }
}

export function migrarEvento(entrada: unknown): Evento {
  const r = obj(entrada)
  const { valor } = normalizarEvento(r)
  const agora = new Date().toISOString()
  const evento: Evento = {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    codigo: inteiro(r.codigo, Number.MAX_SAFE_INTEGER, 0),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
  return atualizarEventoAntigo(evento, r)
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

  // Serviços sem repetição (sem diferenciar maiúsculas e acentos), na ordem em que foram marcados
  const servicos = listaServicos(r.servicos, LIMITES.servicos + 1)
  if (servicos.length > LIMITES.servicos) erros.push(`Uma manutenção pode ter no máximo ${LIMITES.servicos} serviços.`)
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

/** Lista de serviços sem repetição (sem diferenciar maiúsculas e acentos), na ordem dada. */
export function listaServicos(v: unknown, max: number): string[] {
  const vistos = new Set<string>()
  const lista: string[] = []
  for (const x of Array.isArray(v) ? v : []) {
    const t = texto(x, 60).replace(/\s+/g, ' ')
    const chave = chaveServico(t)
    if (!t || vistos.has(chave)) continue
    vistos.add(chave)
    lista.push(t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1))
    if (lista.length >= max) break
  }
  return lista
}

export function normalizarConfig(entrada: unknown): Resultado<Configuracoes> {
  const r = { ...CONFIG_PADRAO, ...obj(entrada) }
  const erros: string[] = []
  const cnpj = normalizarCnpj(texto(r.empresaCnpj))
  if (cnpj && !cnpjValido(cnpj)) erros.push('CNPJ da empresa inválido. Confira o número digitado.')
  const cpfRep = somenteDigitos(texto(r.empresaRepresentanteCpf, 20))
  if (cpfRep && !cpfValido(cpfRep)) erros.push('CPF de quem assina pela empresa inválido. Confira o número digitado.')
  const cpfDoRepresentante = cpfRep ? mascaraCpf(cpfRep) : ''
  return {
    valor: {
      valorDiariaPadrao: dinheiro(r.valorDiariaPadrao),
      valorBobinaPadrao: dinheiro(r.valorBobinaPadrao),
      frotaMaquinas: inteiro(r.frotaMaquinas, LIMITES.maquinas, 1),
      rodapePadrao: multilinha(r.rodapePadrao),
      empresaNome: texto(r.empresaNome),
      empresaRazaoSocial: texto(r.empresaRazaoSocial),
      empresaCnpj: cnpj ? mascaraCnpj(cnpj) : '',
      empresaCidade: texto(r.empresaCidade),
      servicosManutencao: listaServicos(r.servicosManutencao, LIMITES.catalogoServicos),
      empresaEndereco: texto(r.empresaEndereco),
      empresaTelefone: texto(r.empresaTelefone, 40),
      empresaEmail: texto(r.empresaEmail, 120),
      empresaRepresentante: texto(r.empresaRepresentante),
      empresaRepresentanteCpf: cpfDoRepresentante,
      contratoForo: texto(r.contratoForo),
      valorReposicaoP: dinheiro(r.valorReposicaoP),
      valorReposicaoG: dinheiro(r.valorReposicaoG),
      contratoCondicoes: texto(
        typeof r.contratoCondicoes === 'string' ? r.contratoCondicoes.replace(/\r\n?/g, '\n') : '',
        LIMITES.textoLongo,
      ),
    },
    erros,
  }
}

// ---- Contrato de locação -----------------------------------------------------------

const dataHora = (v: unknown): DataHora => {
  const r = obj(v)
  const data = texto(r.data, 10)
  const hora = texto(r.hora, 5)
  return { data: dataIsoValida(data) ? data : '', hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : '' }
}

/** O que a tela manda ao gerar o contrato de um evento. */
export function normalizarNovoContrato(entrada: unknown): Resultado<NovoContrato> {
  const r = obj(entrada)
  const erros: string[] = []
  const eventoId = texto(r.eventoId, 100)
  if (!eventoId) erros.push('Escolha o evento do contrato.')
  const assinante = obj(r.assinante)
  const cpf = somenteDigitos(texto(assinante.cpf, 20))
  if (cpf && !cpfValido(cpf)) erros.push('CPF de quem assina pelo cliente inválido. Confira o número digitado.')
  const retirada = dataHora(r.retirada)
  const devolucao = dataHora(r.devolucao)
  if (retirada.data && devolucao.data && devolucao.data < retirada.data) erros.push('A devolução não pode ser antes da retirada.')
  return {
    valor: {
      eventoId,
      local: texto(r.local),
      retirada,
      devolucao,
      assinante: { nome: texto(assinante.nome), cpf: cpf ? mascaraCpf(cpf) : '' },
      condicoes: texto(typeof r.condicoes === 'string' ? r.condicoes.replace(/\r\n?/g, '\n') : '', LIMITES.textoLongo),
    },
    erros,
  }
}

const numeroOuZero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Dados congelados de um contrato vindos de um backup: confere os tipos de cada campo (o texto é
 * o que foi gerado na época, então não é refeito).
 */
export function normalizarDadosContrato(v: unknown): DadosContrato {
  const r = obj(v)
  const e = obj(r.empresa)
  const c = obj(r.cliente)
  const a = obj(r.assinante)
  const ev = obj(r.evento)
  const val = obj(r.valores)
  const com = obj(ev.comCliente)
  const t = (x: unknown, max = LIMITES.texto) => texto(x, max)
  return {
    emitidoEm: dataIsoValida(r.emitidoEm) ? (r.emitidoEm as string) : '',
    empresa: {
      nome: t(e.nome),
      razaoSocial: t(e.razaoSocial),
      cnpj: t(e.cnpj, 30),
      endereco: t(e.endereco),
      telefone: t(e.telefone, 40),
      email: t(e.email, 120),
      cidade: t(e.cidade),
      representante: t(e.representante),
      representanteCpf: t(e.representanteCpf, 20),
    },
    cliente: {
      tipo: umDe(c.tipo, TIPOS_CLIENTE, 'AVULSO'),
      nome: t(c.nome),
      fantasia: t(c.fantasia),
      documento: t(c.documento, 40),
      endereco: t(c.endereco),
      telefone: t(c.telefone, 40),
      email: t(c.email, 120),
    },
    assinante: { nome: t(a.nome), cpf: t(a.cpf, 20) },
    evento: {
      id: t(ev.id, 100),
      codigo: inteiro(ev.codigo, Number.MAX_SAFE_INTEGER, 0),
      nome: t(ev.nome),
      local: t(ev.local),
      dias: (Array.isArray(ev.dias) ? ev.dias : [])
        .slice(0, LIMITES.dias)
        .map((d) => {
          const x = obj(d)
          return {
            data: dataIsoValida(x.data) ? (x.data as string) : '',
            maquinas: inteiro(x.maquinas, LIMITES.maquinas, 0),
            reservas: inteiro(x.reservas, LIMITES.maquinas, 0),
          }
        })
        .filter((d) => d.data),
      periodoCorrido: ev.periodoCorrido === true,
      comCliente:
        dataIsoValida(com.inicio) && dataIsoValida(com.fim) ? { inicio: com.inicio as string, fim: com.fim as string } : null,
      maquinas: (Array.isArray(ev.maquinas) ? ev.maquinas : []).slice(0, LIMITES.maquinasEvento).map((m) => {
        const x = obj(m)
        return {
          identificacao: t(x.identificacao, 40),
          tipo: x.tipo === 'G' ? ('G' as const) : ('P' as const),
          reserva: x.reserva === true,
        }
      }),
      rodape: multilinha(ev.rodape),
    },
    valores: {
      diaria: dinheiro(val.diaria),
      diarias: inteiro(val.diarias, Number.MAX_SAFE_INTEGER, 0),
      desconto: dinheiro(val.desconto),
      total: dinheiro(val.total),
      bobina: dinheiro(val.bobina),
      bobinasConsignadas: inteiro(val.bobinasConsignadas, LIMITES.bobinas, 0),
      formaPagamento: umDe(val.formaPagamento, FORMAS, 'NAO_PAGO'),
      reposicaoP: numeroOuZero(val.reposicaoP) > 0 ? dinheiro(val.reposicaoP) : 0,
      reposicaoG: numeroOuZero(val.reposicaoG) > 0 ? dinheiro(val.reposicaoG) : 0,
    },
    retirada: dataHora(r.retirada),
    devolucao: dataHora(r.devolucao),
    foro: t(r.foro),
    condicoes: texto(r.condicoes, LIMITES.textoLongo),
  }
}

const STATUS_CONTRATO: StatusContrato[] = ['AGUARDANDO', 'ASSINADO', 'CANCELADO']

/** Contrato de um backup: confere os campos e mantém os dados congelados. */
export function migrarContrato(entrada: unknown): Contrato {
  const r = obj(entrada)
  const agora = new Date().toISOString()
  const arq = obj(r.arquivo)
  const status = umDe(r.status, STATUS_CONTRATO, 'AGUARDANDO')
  return {
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    numero: inteiro(r.numero, Number.MAX_SAFE_INTEGER, 0),
    eventoId: texto(r.eventoId, 100),
    clienteId: texto(r.clienteId, 100),
    status,
    assinadoEm: status === 'ASSINADO' && dataIsoValida(r.assinadoEm) ? (r.assinadoEm as string) : '',
    motivoCancelamento: status === 'CANCELADO' ? texto(r.motivoCancelamento) : '',
    dados: normalizarDadosContrato(r.dados),
    arquivo:
      r.arquivo && texto(arq.nome)
        ? {
            nome: texto(arq.nome, 200),
            tipo: texto(arq.tipo, 100) || 'application/octet-stream',
            tamanho: inteiro(arq.tamanho, Number.MAX_SAFE_INTEGER, 0),
            enviadoEm: texto(arq.enviadoEm, 40),
          }
        : null,
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
  }
}

// ---- Reclamações de clientes ----------------------------------------------------

export function normalizarReclamacao(entrada: unknown): Resultado<ReclamacaoInput> {
  const r = obj(entrada)
  const erros: string[] = []
  const maquinaId = texto(r.maquinaId, 100)
  if (!maquinaId) erros.push('Selecione a máquina.')
  const descricao = texto(r.descricao, LIMITES.textoLongo)
  if (!descricao) erros.push('Descreva o que o cliente relatou.')
  const data = texto(r.data, 10) || hojeLocalIso()
  if (!dataIsoValida(data)) erros.push('Data da reclamação inválida.')
  return { valor: { maquinaId, eventoId: texto(r.eventoId, 100), data, descricao }, erros }
}

export function migrarReclamacao(entrada: unknown): Reclamacao {
  const r = obj(entrada)
  const { valor } = normalizarReclamacao(r)
  const agora = new Date().toISOString()
  return {
    ...valor,
    id: texto(r.id, 100),
    versao: Math.max(1, inteiro(r.versao, Number.MAX_SAFE_INTEGER, 1)),
    criadoEm: texto(r.criadoEm, 40) || agora,
    atualizadoEm: texto(r.atualizadoEm, 40) || agora,
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
    for (let n = 2; identificacoes.has(chaveIdentificacao(ident)); n++) ident = `${m.identificacao} (duplicada ${n})`
    m.identificacao = ident
    identificacoes.add(chaveIdentificacao(ident))
  }

  const eventos = b.eventos.map(migrarEvento).filter((e) => e.id)
  if (new Set(eventos.map((e) => e.id)).size !== eventos.length) throw new Error('Backup inválido: eventos repetidos.')
  const orfaos = eventos.filter((e) => !idsClientes.has(e.clienteId))
  if (orfaos.length) throw new Error(`Backup inválido: ${orfaos.length} evento(s) sem cliente correspondente.`)
  for (const e of eventos) {
    e.maquinasIds = e.maquinasIds.filter((id) => idsMaquinas.has(id))
    e.reservasIds = e.reservasIds.filter((id) => idsMaquinas.has(id))
  }

  const ordens = (Array.isArray(b.ordens) ? b.ordens : []).map(migrarOS).filter((o) => o.id)
  if (new Set(ordens.map((o) => o.id)).size !== ordens.length) throw new Error('Backup inválido: manutenções repetidas.')
  const semMaquina = ordens.filter((o) => !idsMaquinas.has(o.maquinaId))
  if (semMaquina.length) throw new Error(`Backup inválido: ${semMaquina.length} manutenção(ões) sem máquina correspondente.`)

  // Reclamações (backup versão 4): sem a máquina não há onde guardar; evento que não veio fica em branco
  const idsEventos = new Set(eventos.map((e) => e.id))
  const reclamacoes = (Array.isArray(b.reclamacoes) ? b.reclamacoes : [])
    .map(migrarReclamacao)
    .filter((r) => r.id && r.descricao && idsMaquinas.has(r.maquinaId))
    .map((r) => (r.eventoId && !idsEventos.has(r.eventoId) ? { ...r, eventoId: '' } : r))
  if (new Set(reclamacoes.map((r) => r.id)).size !== reclamacoes.length)
    throw new Error('Backup inválido: reclamações repetidas.')

  // Contratos (backup versão 6): são documentos já emitidos, com os dados congelados; ficam mesmo
  // que o evento ou o cliente não estejam no backup
  const contratos = (Array.isArray(b.contratos) ? b.contratos : []).map(migrarContrato).filter((c) => c.id)
  if (new Set(contratos.map((c) => c.id)).size !== contratos.length) throw new Error('Backup inválido: contratos repetidos.')

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
  const maiorContrato = numerosUnicos(
    contratos,
    (c) => c.numero,
    (c, n) => (c.numero = n),
  )

  return {
    app: 'bc-fichas-control',
    versao: VERSAO_BACKUP,
    exportadoEm: texto(b.exportadoEm, 40),
    clientes,
    eventos,
    maquinas,
    ordens,
    reclamacoes,
    contratos,
    config: normalizarConfig(b.config).valor,
    proximoCodigo: Math.max(inteiro(b.proximoCodigo, Number.MAX_SAFE_INTEGER, 1), maiorCodigo + 1),
    proximaOS: Math.max(inteiro(b.proximaOS, Number.MAX_SAFE_INTEGER, 1), maiorOS + 1),
    proximoContrato: Math.max(inteiro(b.proximoContrato, Number.MAX_SAFE_INTEGER, 1), maiorContrato + 1),
  }
}
