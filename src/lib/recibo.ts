// Recibo do pagamento de um evento (PIX ou dinheiro). O texto é montado aqui, sem o jsPDF,
// para poder ser testado; o desenho no papel timbrado fica em pdfRecibo.ts.

import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { valorPorExtenso } from '#shared/extenso.ts'
import type { Cliente, Configuracoes, Evento, FormaPagamento } from '#shared/tipos.ts'
import { dataCurta, hojeISO, moeda, numero } from './format'
import { nomeArquivoSeguro } from './storage'

/** Formas de pagamento que pedem recibo (as outras já têm comprovante próprio). */
export const FORMAS_COM_RECIBO: FormaPagamento[] = ['PIX', 'DINHEIRO']

/** O evento pode ter recibo: pago em PIX ou dinheiro e não cancelado. */
export const podeGerarRecibo = (e: Pick<Evento, 'formaPagamento' | 'status'>) =>
  e.status !== 'CANCELADO' && FORMAS_COM_RECIBO.includes(e.formaPagamento)

/** "R$ 480,00" com espaço comum (o Intl usa espaço especial). */
const reais = (v: number) => moeda(v).replace(/\s/g, ' ')

/** "2 de outubro de 2026" (o dia 1 sai como "1º", como se escreve em documentos). */
export function dataPorExtenso(iso: string) {
  const d = parseISO(iso)
  const dia = d.getDate() === 1 ? '1º' : String(d.getDate())
  return `${dia} de ${format(d, "MMMM 'de' yyyy", { locale: ptBR })}`
}

/** Junta com vírgulas e "e" no fim: "a, b e c". */
const juntar = (itens: string[]) => (itens.length <= 1 ? itens.join('') : `${itens.slice(0, -1).join(', ')} e ${itens.at(-1)}`)

/**
 * Datas do evento para o texto do recibo: "em 11/10/2026", "de 11 a 13/10/2026",
 * "nos dias 11, 12 e 18/10/2026"; com muitos dias soltos, "entre 11/10 e 25/11/2026 (6 dias)".
 */
export function periodoRecibo(datasEvento: string[]): string {
  const datas = [...new Set(datasEvento.filter(Boolean))].sort()
  if (!datas.length) return ''
  if (datas.length === 1) return `em ${dataCurta(datas[0])}`
  const ini = parseISO(datas[0])
  const fim = parseISO(datas[datas.length - 1])
  const mesmoAno = ini.getFullYear() === fim.getFullYear()
  const mesmoMes = mesmoAno && ini.getMonth() === fim.getMonth()
  // Começo encurtado quando o fim já diz o mês e o ano
  const curta = (d: Date) => format(d, mesmoMes ? 'dd' : mesmoAno ? 'dd/MM' : 'dd/MM/yyyy')
  const seguidos = differenceInCalendarDays(fim, ini) === datas.length - 1
  if (seguidos) return `de ${curta(ini)} a ${dataCurta(datas[datas.length - 1])}`
  if (datas.length > 5) return `entre ${curta(ini)} e ${dataCurta(datas[datas.length - 1])} (${datas.length} dias)`
  return `nos dias ${juntar([...datas.slice(0, -1).map((d) => curta(parseISO(d))), dataCurta(datas[datas.length - 1])])}`
}

export interface LinhaDetalhe {
  rotulo: string
  /** Conta que explica o valor ("6 diárias × R$ 80,00"); vazio no desconto. */
  conta: string
  valor: string
}

export interface Recibo {
  /** "Nº 0031" */
  numero: string
  valor: number
  /** "R$ 480,00" */
  valorTexto: string
  /** "Recebemos de … ." */
  texto: string
  detalhes: LinhaDetalhe[]
  /** Total depois do desconto, quando há mais de uma linha no detalhamento. */
  total: string | null
  /** "PIX, em 02/10/2026" */
  pagamento: string
  fecho: string
  /** "Rio Claro - SP, 2 de outubro de 2026." */
  localData: string
  /** Linhas abaixo da assinatura: razão social, nome fantasia e CNPJ da empresa. */
  assinatura: string[]
  nomeArquivo: string
}

/** Quem pagou: razão social (empresa) ou nome; sem cliente, um espaço para escrever à mão. */
function pagador(cliente: Cliente | undefined) {
  if (!cliente) return { nome: '______________________________', documento: '' }
  const nome = (cliente.tipo === 'PJ' && cliente.razaoSocial.trim()) || cliente.nome.trim() || 'Cliente avulso'
  const doc = cliente.documento.trim()
  if (!doc) return { nome, documento: '' }
  const tipoDoc = cliente.tipo === 'PF' || (cliente.tipo === 'AVULSO' && doc.replace(/\D/g, '').length === 11) ? 'CPF' : 'CNPJ'
  return { nome, documento: `${tipoDoc} ${doc}` }
}

export function montarRecibo(
  evento: Evento,
  cliente: Cliente | undefined,
  config: Pick<Configuracoes, 'empresaNome' | 'empresaRazaoSocial' | 'empresaCnpj' | 'empresaCidade'>,
  hoje = hojeISO(),
): Recibo {
  const r = calcularEvento(evento)
  const codigo = String(evento.codigo).padStart(4, '0')
  const quem = pagador(cliente)
  const periodo = periodoRecibo(evento.dias.map((d) => d.data))
  const cidade = evento.cidade.trim()

  const texto =
    `Recebemos de ${quem.nome}${quem.documento ? `, ${quem.documento}` : ''}, a importância de ${reais(r.total)} ` +
    `(${valorPorExtenso(r.total)}), referente à locação de máquinas de fichas para o evento “${evento.nome.trim()}”` +
    `${periodo ? `, ${periodo}` : ''}${cidade ? `, em ${cidade}` : ''}.`

  const detalhes: LinhaDetalhe[] = [
    {
      rotulo: 'Diárias',
      conta: `${numero(r.totalDiarias)} ${r.totalDiarias === 1 ? 'diária' : 'diárias'} × ${reais(evento.valorDiaria)}`,
      valor: reais(r.valorDiarias),
    },
  ]
  if (r.bobinasUtilizadas) {
    detalhes.push({
      rotulo: 'Bobinas',
      conta: `${numero(r.bobinasUtilizadas)} ${r.bobinasUtilizadas === 1 ? 'bobina' : 'bobinas'} × ${reais(evento.valorBobina)}`,
      valor: reais(r.valorBobinas),
    })
  }
  if (r.desconto > 0) detalhes.push({ rotulo: 'Desconto', conta: '', valor: `– ${reais(Math.min(r.desconto, r.subtotal))}` })

  const dataPagamento = evento.dataPagamento || hoje
  const empresa = config.empresaRazaoSocial.trim() || config.empresaNome.trim()
  const assinatura = [
    empresa,
    config.empresaNome.trim() !== empresa ? config.empresaNome.trim() : '',
    config.empresaCnpj.trim() ? `CNPJ ${config.empresaCnpj.trim()}` : '',
  ].filter(Boolean)
  const local = config.empresaCidade.trim()

  return {
    numero: `Nº ${codigo}`,
    valor: r.total,
    valorTexto: reais(r.total),
    texto,
    detalhes,
    total: detalhes.length > 1 ? reais(r.total) : null,
    pagamento: `${FORMAS_PAGAMENTO[evento.formaPagamento].label}${evento.dataPagamento ? `, em ${dataCurta(evento.dataPagamento)}` : ''}`,
    fecho: 'Para maior clareza, firmamos o presente recibo.',
    localData: `${local ? `${local}, ` : ''}${dataPorExtenso(dataPagamento)}.`,
    assinatura,
    nomeArquivo: `${nomeArquivoSeguro(`Recibo_${codigo}_${(cliente?.nome.trim() || 'Cliente').replace(/\s+/g, '_')}`)}.pdf`,
  }
}
