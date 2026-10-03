// Contrato de locação das máquinas de fichas: os dados congelados no momento em que é gerado e o
// texto das cláusulas. Usado pelo servidor (para gravar o contrato) e pela tela (para o PDF).
//
// As regras foram escolhidas pelo dono dentro do Código de Defesa do Consumidor (Lei 8.078/1990):
// - cancelamento grátis até 7 dias antes do 1º dia (e direito de arrependimento do art. 49 quando a
//   contratação foi por telefone/WhatsApp/internet); depois, retenção de no máximo 10% das diárias
//   (20% se o cliente não aparecer para retirar), com reciprocidade se a empresa cancelar;
// - danos por mau uso: conserto com orçamento; perda ou furto por descuido: valor de reposição
//   informado; desgaste natural e roubo/força maior comprovados não são cobrados;
// - sem caução; bobinas lacradas voltam sem custo, abertas ou não devolvidas são cobradas;
// - atraso no pagamento: multa de 2%, juros pela taxa legal e IPCA; atraso na devolução não é cobrado;
// - retirada e devolução na sede da empresa; sem testemunhas.
// Texto em corpo 12 e cláusulas que limitam direitos em destaque (art. 54, §§ 3º e 4º).

import { valorPorExtenso } from './extenso.ts'
import {
  datasOcupadas,
  diasEntre,
  ordenarMaquinas,
  quantidadePorExtenso,
  reservasDia,
  somarDias,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
  vaiComoReserva,
} from './maquinas.ts'
import type {
  Cliente,
  Configuracoes,
  Contrato,
  DadosContrato,
  DataHora,
  DiaEvento,
  Evento,
  Maquina,
  NovoContrato,
  TipoMaquina,
} from './tipos.ts'

// ---- Formatos --------------------------------------------------------------------

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
/** "R$ 480,00" (com espaço comum: o Intl usa um espaço especial que a fonte do PDF não tem). */
export const reais = (v: number) => brl.format(v).replace(/\s/g, ' ')

/** "11/10/2026". */
export const dataBR = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '')

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

const diaDaSemana = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number)
  return SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
}

/** "3 de outubro de 2026" (o dia 1 sai "1º"). */
export function dataExtenso(iso: string) {
  const [a, m, d] = iso.split('-').map(Number)
  return `${d === 1 ? '1º' : d} de ${MESES[m - 1]} de ${a}`
}

/** Linha para preencher à mão quando o dado não foi informado. */
const LINHA = '____________________'

/** "11/10/2026, às 14h30" ou "11/10/2026, às ____h____" (hora para preencher). */
export function textoDataHora(d: DataHora) {
  const hora = /^\d{2}:\d{2}$/.test(d.hora) ? `${d.hora.slice(0, 2)}h${d.hora.slice(3)}` : '____h____'
  return `${d.data ? dataBR(d.data) : '____/____/________'}, às ${hora}`
}

/** Endereço em uma linha: "Rua 13, 650 - sala 2 - Boa Morte - Rio Claro/SP - CEP 13500-000". */
function endereco(c: Pick<Cliente, 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cidade' | 'uf' | 'cep'>) {
  const rua = [c.logradouro, c.numero]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(', ')
  const cidade = c.cidade.trim() ? [c.cidade.trim(), c.uf.trim()].filter(Boolean).join('/') : ''
  return [rua, c.complemento.trim(), c.bairro.trim(), cidade, c.cep.trim() ? `CEP ${c.cep.trim()}` : '']
    .filter(Boolean)
    .join(' - ')
}

/** "CPF 123..." ou "CNPJ 12..." conforme o cliente; vazio sem documento. */
function documentoCliente(c: Pick<Cliente, 'tipo' | 'documento'>) {
  const doc = c.documento.trim()
  if (!doc) return ''
  const cpf = c.tipo === 'PF' || (c.tipo === 'AVULSO' && doc.replace(/\D/g, '').length === 11)
  return `${cpf ? 'CPF' : 'CNPJ'} ${doc}`
}

/** Avulso cadastrado sem nome (o sistema grava "Cliente avulso"): o contrato deixa o nome em branco. */
const semNome = (c: Pick<Cliente, 'tipo' | 'nome'>) =>
  !c.nome.trim() || (c.tipo === 'AVULSO' && /^cliente avulso$/i.test(c.nome.trim()))

// ---- Valores sugeridos na tela -------------------------------------------------------

/** Retirada sugerida: o primeiro dia do evento (a hora fica para preencher). */
export function retiradaPadrao(e: Pick<Evento, 'dias'>): DataHora {
  const datas = e.dias
    .map((d) => d.data)
    .filter(Boolean)
    .sort()
  return { data: datas[0] ?? '', hora: '' }
}

/** Devolução sugerida: o dia seguinte ao último dia com as máquinas (com período corrido, o fim dele). */
export function devolucaoPadrao(e: Pick<Evento, 'dias' | 'periodoCorrido'>): DataHora {
  const datas = datasOcupadas(e)
  return { data: datas.length ? somarDias(datas[datas.length - 1], 1) : '', hora: '' }
}

/** Quem assina pelo cliente: a própria pessoa física (com o CPF) ou o responsável pela empresa. */
export function assinantePadrao(c: Cliente | undefined): { nome: string; cpf: string } {
  if (!c) return { nome: '', cpf: '' }
  if (c.tipo === 'PF') return { nome: c.nome.trim(), cpf: c.documento.trim() }
  if (c.tipo === 'AVULSO') {
    const cpf = c.documento.replace(/\D/g, '').length === 11 ? c.documento.trim() : ''
    return { nome: c.responsavel.trim() || (semNome(c) ? '' : c.nome.trim()), cpf }
  }
  return { nome: c.responsavel.trim(), cpf: '' }
}

/** Modelo (versão) do texto das cláusulas gerado hoje. Mudou uma cláusula? Novo modelo, sem mexer nos antigos. */
export const MODELO_CONTRATO = 1

const soDigitos = (s: string) => s.replace(/\D/g, '')
const mesmoNome = (a: string, b: string) => a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'base' }) === 0

/**
 * Quem assina é o próprio cliente (pessoa física, ou avulso que é uma pessoa): não há "representado
 * por". Com CPF dos dois lados, compara o CPF; senão, o nome.
 */
export function assinaOProprio(d: Pick<DadosContrato, 'cliente' | 'assinante'>) {
  const { cliente: c, assinante: a } = d
  if (c.tipo === 'PJ') return false
  if (!a.nome && !a.cpf) return c.tipo === 'PF'
  const docCliente = soDigitos(c.documento)
  if (docCliente.length === 11 && soDigitos(a.cpf).length === 11) return docCliente === soDigitos(a.cpf)
  return !!a.nome && !!c.nome && mesmoNome(a.nome, c.nome)
}

/** O dia de maior uso de verdade: o de mais máquinas no total; no empate, o de menos reservas. */
export function diaDeMaiorUso(dias: Array<Pick<DiaEvento, 'maquinas' | 'reservas'>>) {
  return dias.reduce<Pick<DiaEvento, 'maquinas' | 'reservas'> | null>((maior, d) => {
    if (!maior) return d
    const t = d.maquinas + d.reservas
    const tm = maior.maquinas + maior.reservas
    return t > tm || (t === tm && d.reservas < maior.reservas) ? d : maior
  }, null)
}

/** Retirada e devolução de cada período em que as máquinas ficam com o cliente. */
export interface PeriodoRetirada {
  retirada: DataHora
  devolucao: DataHora
}

/**
 * Sem período corrido e com datas separadas (ex.: 03/10 e 10/10), as máquinas voltam à empresa
 * entre um uso e outro: uma retirada e uma devolução por bloco de datas seguidas. A retirada
 * informada é a do primeiro bloco e a devolução, a do último; os outros blocos usam a mesma
 * distância (em dias) e os mesmos horários. Se a devolução de um bloco cair no dia da retirada do
 * seguinte (ou depois), as máquinas ficam com o cliente e os dois viram um período só. Com período
 * corrido (ou datas seguidas), um período só.
 */
export function periodosRetirada(d: Pick<DadosContrato, 'evento' | 'retirada' | 'devolucao'>): PeriodoRetirada[] {
  const datas = [...new Set(d.evento.dias.map((x) => x.data).filter(Boolean))].sort()
  const blocos: Array<{ inicio: string; fim: string }> = []
  for (const data of datas) {
    const ultimo = blocos[blocos.length - 1]
    if (ultimo && somarDias(ultimo.fim, 1) === data) ultimo.fim = data
    else blocos.push({ inicio: data, fim: data })
  }
  if (d.evento.periodoCorrido || blocos.length <= 1) return [{ retirada: d.retirada, devolucao: d.devolucao }]
  const antes = d.retirada.data ? diasEntre(blocos[0].inicio, d.retirada.data) : 0
  const depois = d.devolucao.data ? diasEntre(blocos[blocos.length - 1].fim, d.devolucao.data) : 1
  const periodos: PeriodoRetirada[] = []
  for (const bloco of blocos) {
    const retirada = { data: d.retirada.data ? somarDias(bloco.inicio, antes) : '', hora: d.retirada.hora }
    const devolucao = { data: d.devolucao.data ? somarDias(bloco.fim, depois) : '', hora: d.devolucao.hora }
    const anterior = periodos[periodos.length - 1]
    if (anterior && retirada.data && anterior.devolucao.data && retirada.data <= anterior.devolucao.data)
      anterior.devolucao = devolucao
    else periodos.push({ retirada, devolucao })
  }
  return periodos
}

/** Anos que o contrato fica guardado depois do fim da locação (cláusula dos dados pessoais). */
export const ANOS_GUARDA_CONTRATO = 5

/** Último dia da locação: a devolução ou, sem ela, a última data de uso (`''` sem nenhuma). */
export function fimDaLocacao(d: Pick<DadosContrato, 'evento' | 'devolucao'>) {
  return [d.devolucao.data, ...d.evento.dias.map((x) => x.data)].filter(Boolean).sort().pop() ?? ''
}

/** Pode ser excluído: cancelado ou, passado o prazo de guarda depois do fim da locação, qualquer um. */
export function podeExcluirContrato(c: Pick<Contrato, 'status' | 'dados'>, hoje: string) {
  if (c.status === 'CANCELADO') return true
  const fim = fimDaLocacao(c.dados)
  return !!fim && `${Number(fim.slice(0, 4)) + ANOS_GUARDA_CONTRATO}${fim.slice(4)}` < hoje
}

// ---- Dados congelados ------------------------------------------------------------------

export interface FontesContrato {
  evento: Evento
  cliente: Cliente | undefined
  maquinas: Maquina[]
  config: Configuracoes
  entrada: Omit<NovoContrato, 'eventoId'>
  /** Data de emissão `yyyy-MM-dd`. */
  hoje: string
}

/** Junta tudo o que sai no contrato (o servidor grava isto; o PDF sai só daqui). */
export function montarDadosContrato({ evento, cliente, maquinas, config, entrada, hoje }: FontesContrato): DadosContrato {
  const porId = new Map(maquinas.map((m) => [m.id, m]))
  // Marcada como reserva, mas sem nenhum dia com reserva, a máquina trabalha como titular
  const reservas = new Set((evento.reservasIds ?? []).filter((id) => vaiComoReserva(evento, id)))
  const enviadas = ordenarMaquinas(evento.maquinasIds.map((id) => porId.get(id)).filter((m): m is Maquina => !!m))
  const ocupadas = evento.periodoCorrido ? datasOcupadas(evento) : []
  const usos = new Set(evento.dias.map((d) => d.data))
  // As diárias do contrato são as das titulares: a reserva só é cobrada se for usada (acertada depois)
  const diarias = evento.dias.reduce((s, d) => s + (Number(d.maquinas) || 0), 0)
  const valorDiarias = Math.round(diarias * evento.valorDiaria * 100) / 100
  const desconto = Math.min(Math.max(0, evento.desconto || 0), valorDiarias)
  const condicoes = [config.contratoCondicoes.trim(), entrada.condicoes.trim()].filter(Boolean).join('\n')
  return {
    modelo: MODELO_CONTRATO,
    emitidoEm: hoje,
    empresa: {
      nome: config.empresaNome.trim(),
      razaoSocial: config.empresaRazaoSocial.trim() || config.empresaNome.trim(),
      cnpj: config.empresaCnpj.trim(),
      endereco: config.empresaEndereco.trim(),
      telefone: config.empresaTelefone.trim(),
      email: config.empresaEmail.trim(),
      cidade: config.empresaCidade.trim(),
      representante: config.empresaRepresentante.trim(),
      representanteCpf: config.empresaRepresentanteCpf.trim(),
    },
    cliente: {
      tipo: cliente?.tipo ?? 'AVULSO',
      nome: !cliente || semNome(cliente) ? '' : (cliente.tipo === 'PJ' && cliente.razaoSocial.trim()) || cliente.nome.trim(),
      fantasia:
        cliente?.tipo === 'PJ' && cliente.razaoSocial.trim() && cliente.nome.trim() !== cliente.razaoSocial.trim()
          ? cliente.nome.trim()
          : '',
      documento: cliente ? documentoCliente(cliente) : '',
      endereco: cliente ? endereco(cliente) : '',
      telefone: cliente?.telefone.trim() ?? '',
      email: cliente?.email.trim() ?? '',
    },
    assinante: { nome: entrada.assinante.nome.trim(), cpf: entrada.assinante.cpf.trim() },
    evento: {
      id: evento.id,
      codigo: evento.codigo,
      nome: evento.nome.trim(),
      local: entrada.local.trim(),
      dias: [...evento.dias]
        .filter((d) => d.data)
        .sort((a, b) => a.data.localeCompare(b.data))
        .map((d) => ({ data: d.data, maquinas: d.maquinas, reservas: reservasDia(d) })),
      periodoCorrido: evento.periodoCorrido,
      comCliente: ocupadas.length > usos.size ? { inicio: ocupadas[0], fim: ocupadas[ocupadas.length - 1] } : null,
      maquinas: enviadas.map((m) => ({ identificacao: m.identificacao, tipo: m.tipo, reserva: reservas.has(m.id) })),
      rodape: (evento.rodape || config.rodapePadrao).trim(),
    },
    valores: {
      diaria: evento.valorDiaria,
      diarias,
      desconto,
      total: Math.max(0, Math.round((valorDiarias - desconto) * 100) / 100),
      bobina: evento.valorBobina,
      bobinasConsignadas: evento.bobinasConsignadas,
      formaPagamento: evento.formaPagamento,
      reposicaoP: config.valorReposicaoP,
      reposicaoG: config.valorReposicaoG,
    },
    retirada: { ...entrada.retirada },
    devolucao: { ...entrada.devolucao },
    foro: config.contratoForo.trim() || config.empresaCidade.trim(),
    condicoes,
    condicoesContrato: entrada.condicoes.trim(),
  }
}

/**
 * O que mudou no aluguel (ou no cadastro do cliente) depois que o contrato foi gerado: a tela avisa
 * para gerar de novo. Compara só o que sai no contrato.
 */
export function mudancasDesde(gerado: DadosContrato, atual: DadosContrato): string[] {
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const lista: string[] = []
  if (!igual(gerado.cliente, atual.cliente)) lista.push('dados do cliente')
  if (gerado.evento.nome !== atual.evento.nome) lista.push('nome do evento')
  if (!igual(gerado.evento.dias, atual.evento.dias) || gerado.evento.periodoCorrido !== atual.evento.periodoCorrido)
    lista.push('datas ou quantidade de máquinas')
  if (!igual(gerado.evento.maquinas, atual.evento.maquinas)) lista.push('máquinas enviadas')
  const { reposicaoP: _p, reposicaoG: _g, ...valoresGerado } = gerado.valores
  const { reposicaoP: _p2, reposicaoG: _g2, ...valoresAtual } = atual.valores
  if (!igual(valoresGerado, valoresAtual)) lista.push('valores')
  return lista
}

/** Avisos antes de gerar: dados que vão sair em branco no contrato (não impedem gerar). */
export function pendenciasContrato(d: DadosContrato): string[] {
  const p: string[] = []
  if (!d.cliente.nome) p.push('O cliente não tem nome: o contrato sai com o espaço para preencher à mão.')
  if (!d.cliente.documento) p.push('O cliente não tem CPF/CNPJ cadastrado.')
  if (!d.cliente.endereco) p.push('O cliente não tem endereço cadastrado.')
  if (!assinaOProprio(d) && (!d.assinante.nome || !d.assinante.cpf)) p.push('Falta o nome ou o CPF de quem assina pelo cliente.')
  if (assinaOProprio(d) && !d.cliente.documento && !d.assinante.cpf) p.push('Falta o CPF do cliente.')
  if (!d.evento.maquinas.length) p.push('As máquinas ainda não foram escolhidas: os números ficam para o Termo de Entrega.')
  if (!d.empresa.endereco) p.push('Falta o endereço da empresa (Configurações → Contrato de locação).')
  if (!d.empresa.representante || !d.empresa.representanteCpf)
    p.push('Falta o nome ou o CPF de quem assina pela empresa (Configurações → Contrato de locação).')
  // Valor de reposição dos tipos enviados (ou dos dois, enquanto as máquinas não foram escolhidas)
  const tipos = d.evento.maquinas.length ? new Set(d.evento.maquinas.map((m) => m.tipo)) : new Set(['P', 'G'])
  const semValor = [...tipos].filter((t) => !(t === 'P' ? d.valores.reposicaoP : d.valores.reposicaoG)).sort()
  if (semValor.length)
    p.push(
      `Sem valor de reposição da máquina ${semValor.join(' e da ')}: o contrato diz "valor de mercado, comprovado por orçamento".`,
    )
  return p
}

// ---- Texto ------------------------------------------------------------------------------

/** Partes do contrato, na ordem: o PDF desenha cada uma. */
export type BlocoContrato =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'campos'; itens: Array<[rotulo: string, valor: string]> }
  | { tipo: 'clausula'; texto: string }
  | { tipo: 'paragrafo'; texto: string; destaque?: boolean }
  /** Declaração final, local e data: ficam na mesma página das assinaturas. */
  | { tipo: 'fecho'; texto: string }

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "P-01, P-02 e G-03". */
const juntar = (itens: string[]) =>
  itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`

/** "Contrato nº 0007". */
export const codigoContrato = (numero: number) => `nº ${String(numero).padStart(4, '0')}`

const FORMAS: Record<DadosContrato['valores']['formaPagamento'], string> = {
  NAO_PAGO: 'a combinar entre as partes até a retirada',
  DINHEIRO: 'em dinheiro',
  PIX: 'por PIX',
  BOLETO: 'por boleto bancário',
  CREDITO: 'no cartão de crédito',
  DEBITO: 'no cartão de débito',
}

/** "máquina P (pequena)". */
const nomeTipo = (t: TipoMaquina) => `máquina ${t} (${TIPO_MAQUINA[t].descricao.toLowerCase()})`

const MERCADO = 'o valor de mercado de uma máquina equivalente usada, comprovado por orçamento'

/** Valor de reposição de cada tipo enviado (dos dois, enquanto as máquinas não foram escolhidas). */
function textoReposicao({ evento: ev, valores: v }: DadosContrato) {
  const enviados = new Set(ev.maquinas.map((m) => m.tipo))
  const tipos = TIPOS_MAQUINA.filter((t) => !enviados.size || enviados.has(t))
  const valor = (t: TipoMaquina) => (t === 'P' ? v.reposicaoP : v.reposicaoG)
  const com = tipos.filter((t) => valor(t) > 0)
  const sem = tipos.filter((t) => !(valor(t) > 0))
  if (!com.length) return `, que é ${MERCADO}`
  const valores = juntar(com.map((t) => `${reais(valor(t))} por ${nomeTipo(t)}`))
  return sem.length ? `: ${valores}; para a ${juntar(sem.map(nomeTipo))}, ${MERCADO}` : `: ${valores}`
}

/** As datas de uso numa linha do quadro-resumo. */
function textoDatasUso(dias: DadosContrato['evento']['dias'], clausulaDatas: number) {
  if (!dias.length) return LINHA
  if (dias.length === 1) return dataBR(dias[0].data)
  const primeira = dias[0].data
  const ultima = dias[dias.length - 1].data
  if (diasEntre(primeira, ultima) === dias.length - 1)
    return `${plural(dias.length, 'dia', 'dias')}, de ${dataBR(primeira)} a ${dataBR(ultima)}`
  if (dias.length <= 4) return juntar(dias.map((x) => dataBR(x.data)))
  return `${dias.length} dias, entre ${dataBR(primeira)} e ${dataBR(ultima)} (cláusula ${clausulaDatas}ª)`
}

/** Texto do modelo 1 (o primeiro): do quadro-resumo às assinaturas. */
function textoModelo1(d: DadosContrato, numero: number): BlocoContrato[] {
  const b: BlocoContrato[] = []
  let n = 0
  const clausula = (titulo: string) => {
    b.push({ tipo: 'clausula', texto: `CLÁUSULA ${++n}ª – ${titulo}` })
    return n
  }
  const par = (texto: string, destaque = false) => b.push({ tipo: 'paragrafo', texto, destaque })

  const { empresa: e, cliente: c, evento: ev, valores: v } = d
  const proprio = assinaOProprio(d)
  const nomeCliente = c.nome || (proprio && d.assinante.nome) || LINHA
  const docCliente = c.documento || (proprio && d.assinante.cpf ? `CPF ${d.assinante.cpf}` : '')
  const temReserva = ev.dias.some((x) => x.reservas > 0)
  // Há datas com e sem reserva: nas sem reserva, a marcada como reserva pode trabalhar como titular
  const mista = temReserva && ev.dias.some((x) => x.reservas === 0)
  const titulares = ev.maquinas.filter((m) => !m.reserva).map((m) => m.identificacao)
  const deReserva = ev.maquinas.filter((m) => m.reserva).map((m) => m.identificacao)
  const pico = diaDeMaiorUso(ev.dias)
  const variasReservas = Math.max(deReserva.length, ...ev.dias.map((x) => x.reservas)) > 1
  const periodos = periodosRetirada(d)
  const sede = e.endereco ? `na sede da LOCADORA (${e.endereco})` : 'na sede da LOCADORA'
  const contato = [e.telefone ? `pelo telefone ${e.telefone}` : '', e.email ? `pelo e-mail ${e.email}` : '']
    .filter(Boolean)
    .join(' ou ')

  b.push({ tipo: 'titulo', texto: `CONTRATO DE LOCAÇÃO DE MÁQUINAS DE FICHAS ${codigoContrato(numero)}` })

  clausula('DAS PARTES')
  par(
    `LOCADORA: ${e.razaoSocial || LINHA}${e.nome && e.nome !== e.razaoSocial ? ` (${e.nome})` : ''}` +
      `, inscrita no CNPJ sob o nº ${e.cnpj || LINHA}${e.endereco ? `, com sede em ${e.endereco}` : ''}` +
      `${e.telefone ? `, telefone ${e.telefone}` : ''}${e.email ? `, e-mail ${e.email}` : ''}` +
      `, neste ato representada por ${e.representante || LINHA}, CPF ${e.representanteCpf || LINHA}.`,
  )
  par(
    `LOCATÁRIO: ${nomeCliente}${c.fantasia ? ` (${c.fantasia})` : ''}, ${docCliente || `CPF/CNPJ ${LINHA}`}` +
      `, endereço ${c.endereco || LINHA}, telefone ${c.telefone || LINHA}${c.email ? `, e-mail ${c.email}` : ''}` +
      `${proprio ? '' : `, neste ato representado por ${d.assinante.nome || LINHA}, CPF ${d.assinante.cpf || LINHA}`}.`,
  )

  clausula('DO OBJETO')
  const iguais = ev.dias.every((x) => x.maquinas === ev.dias[0].maquinas && x.reservas === ev.dias[0].reservas)
  const quantidade = !pico
    ? ''
    : ` (${quantidadePorExtenso(pico.maquinas, pico.reservas)}${ev.dias.length === 1 ? '' : iguais ? ' em cada data' : ' no dia de maior uso'})`
  par(
    '1. A LOCADORA aluga ao LOCATÁRIO máquinas impressoras de fichas para uso no evento' +
      ` "${ev.nome}"${ev.local ? `, em ${ev.local}` : ''}, na quantidade indicada para cada data de uso na cláusula` +
      ` seguinte${quantidade}.`,
  )
  par(
    titulares.length || deReserva.length
      ? `2. Máquinas enviadas: ${[
          titulares.length ? juntar(titulares) : '',
          deReserva.length ? `como reserva, ${juntar(deReserva)}` : '',
        ]
          .filter(Boolean)
          .join('; ')}.` +
          (mista && deReserva.length
            ? deReserva.length > 1
              ? ' Nas datas sem reserva, as máquinas marcadas como reserva podem ser usadas como titulares, dentro da' +
                ' quantidade indicada para a data.'
              : ' Nas datas sem reserva, a máquina marcada como reserva pode ser usada como titular, dentro da' +
                ' quantidade indicada para a data.'
            : '')
      : '2. Os números das máquinas enviadas são anotados no Termo de Entrega e Devolução, na retirada.',
  )
  par(
    `3. As máquinas são entregues revisadas, testadas e com o texto das fichas configurado: o nome do evento no topo` +
      `${ev.rodape ? ` e "${ev.rodape.replace(/\s*\n\s*/g, ' / ')}" no rodapé` : ''}.`,
  )

  const clausulaDatas = clausula('DAS DATAS DE USO, DA RETIRADA E DA DEVOLUÇÃO')
  par('1. Datas de uso e quantidade de máquinas em cada uma:')
  for (const x of ev.dias) {
    par(`• ${dataBR(x.data)} (${diaDaSemana(x.data)}): ${quantidadePorExtenso(x.maquinas, x.reservas)}`)
  }
  let item = 2
  if (ev.comCliente) {
    par(
      `${item++}. As máquinas ficam com o LOCATÁRIO de ${dataBR(ev.comCliente.inicio)} a ${dataBR(ev.comCliente.fim)},` +
        ' inclusive nos dias entre as datas de uso. São cobradas somente as diárias das datas de uso.',
    )
  }
  if (periodos.length === 1) {
    par(`${item++}. Retirada ${sede}, em ${textoDataHora(d.retirada)}.`)
    par(`${item++}. Devolução ${sede}, até ${textoDataHora(d.devolucao)}.`)
  } else {
    par(
      `${item++}. Entre um período de uso e outro, as máquinas voltam à LOCADORA. A retirada e a devolução de cada` +
        ` período são feitas ${sede}:`,
    )
    periodos.forEach((p, i) =>
      par(`• ${i + 1}º período: retirada em ${textoDataHora(p.retirada)}; devolução até ${textoDataHora(p.devolucao)}.`),
    )
  }

  clausula('DO PREÇO E DO PAGAMENTO')
  par(
    `1. A diária de cada máquina custa ${reais(v.diaria)}. As datas de uso somam ${plural(v.diarias, 'diária', 'diárias')}` +
      ` (uma por máquina titular em cada data), no valor de ${reais(Math.round(v.diarias * v.diaria * 100) / 100)}` +
      `${v.desconto > 0 ? `, com desconto de ${reais(v.desconto)}` : ''}, totalizando ${reais(v.total)} (${valorPorExtenso(v.total)}).`,
  )
  par(
    `2. As bobinas${temReserva ? ' e as máquinas reserva usadas' : ''} são acertadas na devolução, conforme as cláusulas seguintes.`,
  )
  par(`3. O pagamento é feito ${FORMAS[v.formaPagamento]}, e a LOCADORA emite recibo de todo valor recebido.`)
  par(
    '4. Em caso de atraso no pagamento, incidem multa de 2% (dois por cento) sobre o valor em atraso, juros de mora' +
      ' pela taxa legal (art. 406 do Código Civil) e correção monetária pelo IPCA.',
    true,
  )
  par('5. Os valores deste contrato não são alterados depois de assinado, salvo acordo por escrito entre as partes.')

  if (temReserva) {
    clausula('DA MÁQUINA RESERVA')
    par(
      `1. ${variasReservas ? 'As máquinas reserva ficam' : 'A máquina reserva fica'} com o LOCATÁRIO sem custo` +
        `${mista ? `, nas datas com reserva indicadas na cláusula ${clausulaDatas}ª,` : ''}` +
        ' para uso caso alguma máquina apresente defeito ou o movimento exija.',
      true,
    )
    par(
      `2. A reserva só é cobrada, pelo mesmo valor da diária (${reais(v.diaria)}), nas datas em que for usada. Não há cobrança` +
        ' quando a reserva apenas substituir uma máquina com defeito.',
      true,
    )
    par('3. O uso da reserva é informado pelo LOCATÁRIO ou constatado na conferência da devolução.', true)
  }

  clausula('DAS BOBINAS')
  par(
    v.bobinasConsignadas === 1
      ? `1. É entregue 1 (uma) bobina em consignação, ao preço de ${reais(v.bobina)}.`
      : v.bobinasConsignadas > 1
        ? `1. São entregues ${v.bobinasConsignadas} bobinas em consignação, ao preço de ${reais(v.bobina)} cada.`
        : `1. Não há bobinas consignadas neste contrato. As bobinas que forem fornecidas custam ${reais(v.bobina)} cada.`,
    true,
  )
  par(
    '2. Na devolução, as bobinas que voltarem lacradas não são cobradas. As bobinas abertas, usadas ou não devolvidas' +
      ' são cobradas pelo preço unitário acima.',
    true,
  )

  clausula('DAS OBRIGAÇÕES DA LOCADORA')
  par('a) entregar as máquinas limpas, revisadas e funcionando, com as instruções de uso;')
  par(`b) dar suporte durante o evento${e.telefone ? ` pelo telefone ${e.telefone}` : ''};`)
  par(
    'c) em caso de defeito não causado pelo LOCATÁRIO, orientar o uso, trocar a máquina por outra equivalente sem custo' +
      ' ou abater do preço as diárias da máquina parada;',
  )
  par('d) emitir recibo dos valores pagos.')

  clausula('DAS OBRIGAÇÕES DO LOCATÁRIO')
  par('a) usar as máquinas somente no evento e nas datas deste contrato, seguindo as instruções de uso;')
  par('b) guardar as máquinas em local coberto e seguro, protegidas de chuva, calor excessivo e líquidos;')
  par('c) não abrir, consertar ou modificar as máquinas;')
  par(
    'd) não sublocar, emprestar ou ceder as máquinas a terceiros sem autorização por escrito da LOCADORA' +
      ' (mensagem de WhatsApp ou e-mail vale como autorização);',
  )
  par('e) avisar a LOCADORA imediatamente em caso de defeito, perda, furto ou roubo;')
  par(
    'f) devolver as máquinas e os acessórios na data combinada, no estado em que os recebeu, salvo o desgaste natural' +
      ' do uso regular.',
  )

  clausula('DOS DANOS, DA PERDA, DO FURTO E DO ROUBO')
  par(
    '1. O LOCATÁRIO responde pelos danos causados por uso inadequado, queda, contato com líquidos ou falta de cuidado' +
      ' na guarda das máquinas, pagando o conserto, com orçamento apresentado antes da cobrança.',
    true,
  )
  par(
    '2. Em caso de perda ou furto por descuido, ou de dano que não tenha conserto, o LOCATÁRIO paga o valor de' +
      ` reposição da máquina${textoReposicao(d)}.`,
    true,
  )
  par(
    '3. O LOCATÁRIO não responde pelo desgaste natural do uso regular, nem por roubo, incêndio, enchente ou outro' +
      ' caso fortuito ou de força maior comprovado, sem culpa sua (no caso de roubo, com boletim de ocorrência).',
    true,
  )

  clausula('DA CONFERÊNCIA E DA DEVOLUÇÃO')
  par(
    '1. Na retirada e na devolução, as partes conferem as máquinas, os acessórios e as bobinas e anotam no Termo de' +
      ' Entrega e Devolução, que faz parte deste contrato.',
  )
  par(
    '2. A conferência da devolução é feita na presença do LOCATÁRIO. Se ele não puder estar presente, a LOCADORA envia,' +
      ' em até 2 (dois) dias úteis, as fotos e o relato do que foi constatado, e o LOCATÁRIO pode contestar em até 5' +
      ' (cinco) dias úteis.',
  )
  par(
    '3. O LOCATÁRIO deve devolver as máquinas até a data e o horário combinados e avisar a LOCADORA se houver qualquer' +
      ' imprevisto. Não há multa por atraso na devolução.',
  )

  clausula('DO CANCELAMENTO')
  par(
    '1. O LOCATÁRIO pode cancelar a locação sem nenhum custo até 7 (sete) dias antes da primeira data de uso, com' +
      ' devolução integral do que tiver pago em até 5 (cinco) dias úteis.',
    true,
  )
  par(
    '2. Se a contratação foi feita fora da sede da LOCADORA (por telefone, WhatsApp, e-mail ou internet), o LOCATÁRIO' +
      ' pode desistir em até 7 (sete) dias, contados da assinatura ou do recebimento deste contrato, com devolução' +
      ' imediata e integral dos valores pagos (art. 49 do Código de Defesa do Consumidor).',
    true,
  )
  par(
    '3. Fora desses casos, a LOCADORA pode reter no máximo 10% (dez por cento) do valor das diárias; se o LOCATÁRIO não' +
      ' comparecer para retirar as máquinas e não avisar, no máximo 20% (vinte por cento). O restante é devolvido em até' +
      ' 5 (cinco) dias úteis.',
    true,
  )
  par(
    '4. Se o evento for cancelado por caso fortuito ou força maior (por exemplo, determinação de autoridade), o' +
      ' LOCATÁRIO pode remarcar sem custo, conforme a disponibilidade de máquinas, ou receber de volta tudo o que pagou.',
    true,
  )
  par(
    '5. Se a LOCADORA cancelar ou não entregar as máquinas, devolve integralmente os valores pagos e paga ao LOCATÁRIO' +
      ' 10% (dez por cento) do valor das diárias.',
    true,
  )

  clausula('DA RESCISÃO')
  par(
    'Qualquer das partes pode rescindir este contrato se a outra descumprir uma obrigação importante e não corrigir' +
      ' depois de avisada. Os valores são acertados de forma proporcional ao período de uso.',
  )

  clausula('DOS DADOS PESSOAIS')
  par(
    '1. A LOCADORA é a controladora dos dados pessoais informados neste contrato e os usa somente para executá-lo,' +
      ' emitir recibos e cobranças e cumprir obrigações legais e fiscais (art. 7º, incisos II e V, da Lei 13.709/2018 –' +
      ' Lei Geral de Proteção de Dados).',
    true,
  )
  par(
    '2. Os dados só são compartilhados com prestadores de serviço que apoiam essas atividades (como serviços de e-mail,' +
      ' mensagens, agenda on-line e contabilidade), que não podem usá-los para outro fim, e com autoridades, quando a' +
      ' lei exigir. Não são vendidos nem cedidos a terceiros.',
    true,
  )
  par(
    '3. Os dados são guardados durante a locação e, depois, por até 5 (cinco) anos, para cumprir obrigações legais e' +
      ' para a defesa em eventual processo.',
    true,
  )
  par(
    '4. O titular pode pedir a confirmação de que seus dados são tratados, o acesso a eles, a correção de dados' +
      ' incompletos ou desatualizados, a anonimização, o bloqueio ou a eliminação de dados desnecessários, a' +
      ' portabilidade e a informação sobre com quem foram compartilhados (art. 18 da LGPD), fazendo o pedido' +
      ` ${contato || 'à LOCADORA'}. Também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).`,
    true,
  )

  clausula('DAS COMUNICAÇÕES E DA ASSINATURA')
  par('1. Os avisos entre as partes valem pelos telefones (inclusive WhatsApp) e e-mails informados neste contrato.')
  par(
    '2. As partes admitem como válida a assinatura deste contrato em papel ou por meio eletrônico (por exemplo,' +
      ' assinatura gov.br ou plataforma de assinatura eletrônica), nos termos do art. 10, § 2º, da Medida Provisória' +
      ' 2.200-2/2001.',
  )

  clausula('DAS DISPOSIÇÕES GERAIS')
  let geral = 1
  par(
    `${geral++}. Este contrato segue o Código de Defesa do Consumidor (Lei 8.078/1990) e o Código Civil. Em caso de dúvida,` +
      ' as cláusulas são interpretadas da forma mais favorável ao LOCATÁRIO.',
  )
  for (const linha of d.condicoes
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean))
    par(`${geral++}. ${linha}`)
  par(
    `${geral++}. Fica eleito o foro da comarca de ${d.foro || LINHA} para resolver questões deste contrato, sem prejuízo do` +
      ' direito do LOCATÁRIO consumidor de propor ação no foro do seu domicílio (art. 101, inciso I, do Código de' +
      ' Defesa do Consumidor).',
  )

  b.push({
    tipo: 'fecho',
    texto:
      'O LOCATÁRIO declara que recebeu este contrato antes da assinatura, leu e compreendeu todas as cláusulas, em' +
      ' especial as destacadas em negrito, e ficou com uma via.',
  })
  b.push({ tipo: 'fecho', texto: `${e.cidade || LINHA}, ${d.emitidoEm ? dataExtenso(d.emitidoEm) : LINHA}.` })

  // Quadro-resumo logo depois do título (montado no fim para citar o número da cláusula das datas)
  const [primeiro] = periodos
  const variosPeriodos =
    periodos.length > 1 ? ` (1º de ${periodos.length} períodos; os demais na cláusula ${clausulaDatas}ª)` : ''
  b.splice(1, 0, {
    tipo: 'campos',
    itens: [
      ['Locadora', [e.razaoSocial, e.cnpj ? `CNPJ ${e.cnpj}` : ''].filter(Boolean).join(' - ')],
      ['Locatário', [nomeCliente, docCliente].filter(Boolean).join(' - ')],
      ['Evento', `${ev.nome} (aluguel #${String(ev.codigo).padStart(4, '0')})${ev.local ? ` - ${ev.local}` : ''}`],
      ['Datas de uso', textoDatasUso(ev.dias, clausulaDatas)],
      ['Retirada', textoDataHora(primeiro.retirada) + variosPeriodos],
      ['Devolução', textoDataHora(primeiro.devolucao) + variosPeriodos],
      ['Valor das diárias', `${reais(v.total)} (${valorPorExtenso(v.total)})`],
    ],
  })
  return b
}

/** O texto de cada modelo: um contrato antigo continua saindo com as cláusulas de quando foi gerado. */
const MODELOS: Record<number, (d: DadosContrato, numero: number) => BlocoContrato[]> = { 1: textoModelo1 }

/** O contrato inteiro, do quadro-resumo às assinaturas (o termo de entrega é desenhado à parte). */
export function textoContrato(d: DadosContrato, numero: number): BlocoContrato[] {
  return (MODELOS[d.modelo] ?? MODELOS[MODELO_CONTRATO])(d, numero)
}
