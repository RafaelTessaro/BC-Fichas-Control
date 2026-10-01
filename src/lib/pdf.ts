import { jsPDF } from 'jspdf'
import timbradoUrl from '../assets/timbrado.jpg'
import { calcularEvento, FORMAS_PAGAMENTO } from './calc'
import { codigoEvento, dataCurta, dataExtensa, hojeISO, moeda, numero, periodo } from './format'
import { nomeArquivoSeguro } from './storage'
import type { Cliente, Configuracoes, Evento } from './types'

const VERDE: [number, number, number] = [11, 158, 79]
const TINTA: [number, number, number] = [50, 52, 56]
const SECUNDARIO: [number, number, number] = [110, 112, 118]
const LINHA: [number, number, number] = [226, 228, 232]

let timbradoCache: Promise<HTMLImageElement> | null = null
function carregarTimbrado() {
  timbradoCache ??= new Promise((ok, erro) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => {
      timbradoCache = null
      erro(new Error('Não foi possível carregar o papel timbrado.'))
    }
    img.src = timbradoUrl
  })
  return timbradoCache
}

/** Fontes padrão do PDF usam WinAnsi: normaliza espaços especiais do Intl. */
const txt = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-')

export async function gerarResumoPDF(evento: Evento, cliente: Cliente | undefined, config: Configuracoes) {
  const img = await carregarTimbrado()
  const r = calcularEvento(evento)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const L = 22 // margem esquerda
  const R = 188 // margem direita
  const W = R - L

  doc.setProperties({
    title: `Resumo de locação - ${cliente?.nome ?? ''} - ${evento.nome}`,
    creator: 'BC Fichas Control',
  })
  doc.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')

  // Cabeçalho do documento
  let y = 60
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(19)
    .setTextColor(...TINTA)
  doc.text('RESUMO DE LOCAÇÃO', L, y)
  doc.setFillColor(...VERDE).roundedRect(L, y + 3, 18, 1.2, 0.6, 0.6, 'F')
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9)
    .setTextColor(...SECUNDARIO)
  doc.text(`Evento ${codigoEvento(evento.codigo)}`, R, y - 5, { align: 'right' })
  doc.text(`Emitido em ${dataCurta(hojeISO())}`, R, y, { align: 'right' })

  // Dados do cliente e do evento
  y += 14
  const campo = (rotulo: string, valor: string, x: number, largura: number) => {
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(7.5)
      .setTextColor(...SECUNDARIO)
    doc.text(rotulo.toUpperCase(), x, y)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(11)
      .setTextColor(...TINTA)
    const linhas = doc.splitTextToSize(txt(valor || '—'), largura)
    doc.text(linhas.slice(0, 2), x, y + 5.5)
    return linhas.length > 1 ? 11 : 0
  }
  const meio = L + W / 2 + 4
  let extra = Math.max(campo('Cliente', cliente?.nome ?? '—', L, W / 2 - 6), campo('Evento', evento.nome, meio, W / 2 - 4))
  y += 15 + extra
  const local = [evento.local, evento.cidade].filter(Boolean).join(' • ')
  extra = Math.max(campo('Período', periodo(r.dataInicio, r.dataFim), L, W / 2 - 6), campo('Local', local, meio, W / 2 - 4))
  y += 15 + extra

  // Datas de utilização
  y += 2
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  doc.text('DATAS DE UTILIZAÇÃO', L, y)
  y += 4
  const colunas = 3
  const larguraCol = W / colunas
  const MAX_DIAS = 18
  const dias = evento.dias.slice(0, MAX_DIAS)
  dias.forEach((d, i) => {
    const cx = L + (i % colunas) * larguraCol
    const cy = y + Math.floor(i / colunas) * 9
    doc.setFillColor(244, 246, 245).roundedRect(cx, cy, larguraCol - 3, 7, 1.5, 1.5, 'F')
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(...TINTA)
    doc.text(dataCurta(d.data), cx + 3, cy + 4.7)
    doc.setFont('helvetica', 'normal').setTextColor(...SECUNDARIO)
    const dia = dataExtensa(d.data, 'EEE')
    doc.text(txt(`${dia} • ${d.maquinas} ${d.maquinas === 1 ? 'máquina' : 'máquinas'}`), cx + larguraCol - 6, cy + 4.7, {
      align: 'right',
    })
  })
  y += Math.ceil(dias.length / colunas) * 9
  if (evento.dias.length > MAX_DIAS) {
    doc.setFontSize(8.5).setTextColor(...SECUNDARIO)
    doc.text(`+ ${evento.dias.length - MAX_DIAS} datas não exibidas`, L, y + 2)
    y += 5
  }

  // Resumo financeiro
  y += 6
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  doc.text('RESUMO FINANCEIRO', L, y)
  y += 3
  const linhas: Array<[string, string]> = [
    ['Quantidade de diárias utilizadas', numero(r.totalDiarias)],
    ['Valor unitário da diária', moeda(evento.valorDiaria)],
    ['Valor total das diárias', moeda(r.valorDiarias)],
    ['Quantidade de bobinas utilizadas', r.bobinasUtilizadas === null ? 'A conferir' : numero(r.bobinasUtilizadas)],
    ['Valor unitário da bobina', moeda(evento.valorBobina)],
    ['Valor total das bobinas', moeda(r.valorBobinas)],
  ]
  if (r.desconto > 0) linhas.push(['Desconto', `- ${moeda(r.desconto)}`])
  for (const [rot, val] of linhas) {
    y += 7.5
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(10.5)
      .setTextColor(...SECUNDARIO)
    doc.text(rot, L, y)
    doc.setFont('helvetica', 'bold').setTextColor(...TINTA)
    doc.text(txt(val), R, y, { align: 'right' })
    doc
      .setDrawColor(...LINHA)
      .setLineWidth(0.2)
      .line(L, y + 2.6, R, y + 2.6)
  }

  // Valor total em destaque
  y += 8
  doc.setFillColor(...VERDE).roundedRect(L, y, W, 15, 2.5, 2.5, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(255, 255, 255)
  doc.text('VALOR TOTAL', L + 6, y + 9.6)
  doc.setFontSize(17)
  doc.text(txt(moeda(r.total)), R - 6, y + 10, { align: 'right' })

  // Pagamento
  y += 24
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(7.5)
    .setTextColor(...SECUNDARIO)
  doc.text('FORMA DE PAGAMENTO', L, y)
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(11)
    .setTextColor(...TINTA)
  const pagamento = r.pago
    ? `${FORMAS_PAGAMENTO[evento.formaPagamento].label}${evento.dataPagamento ? ` • pago em ${dataCurta(evento.dataPagamento)}` : ''}`
    : 'Pagamento pendente'
  doc.text(txt(pagamento), L, y + 5.5)

  if (evento.observacoes.trim()) {
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(7.5)
      .setTextColor(...SECUNDARIO)
    doc.text('OBSERVAÇÕES', meio, y)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(9.5)
      .setTextColor(...TINTA)
    doc.text(doc.splitTextToSize(txt(evento.observacoes), R - meio).slice(0, 4), meio, y + 5.5)
  }

  // Mensagem de rodapé (campo "RODAPÉ" da planilha)
  const rodape = (evento.rodape || config.rodapePadrao).trim()
  const yRodape = Math.max(y + 26, 248)
  if (rodape) {
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(13)
      .setTextColor(...VERDE)
    doc.text(txt(rodape), 105, yRodape, { align: 'center', maxWidth: W })
  }
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(7.5)
    .setTextColor(...SECUNDARIO)
  doc.text('Resumo gerado automaticamente a partir do controle interno de locação.', 105, yRodape + 6, {
    align: 'center',
  })

  const nome = nomeArquivoSeguro(`Resumo - ${cliente?.nome ?? 'Cliente'} - ${evento.nome}`) + '.pdf'
  return { doc, nome }
}

export async function baixarResumoPDF(evento: Evento, cliente: Cliente | undefined, config: Configuracoes) {
  const { doc, nome } = await gerarResumoPDF(evento, cliente, config)
  doc.save(nome)
  return nome
}
