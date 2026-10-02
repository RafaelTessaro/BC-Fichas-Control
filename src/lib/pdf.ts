import { jsPDF } from 'jspdf'
import timbradoUrl from '../assets/timbrado.jpg'
import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { datasOcupadas, ordenarMaquinas } from '#shared/maquinas.ts'
import { parseISO } from 'date-fns'
import { codigoEvento, dataCurta, hojeISO, moeda, numero, periodo } from './format'
import { nomeArquivoSeguro } from './storage'
import type { Cliente, Configuracoes, Evento, Maquina } from '#shared/tipos.ts'
import { txt } from './pdfTexto'

// Cores do timbrado (também usadas no recibo, em pdfRecibo.ts)
export const VERDE: [number, number, number] = [11, 158, 79]
export const TINTA: [number, number, number] = [50, 52, 56]
export const SECUNDARIO: [number, number, number] = [110, 112, 118]
export const LINHA: [number, number, number] = [226, 228, 232]

let timbradoCache: Promise<HTMLImageElement> | null = null
/** Papel timbrado da empresa (carregado uma vez). */
export function carregarTimbrado() {
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
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export async function gerarResumoPDF(
  evento: Evento,
  cliente: Cliente | undefined,
  config: Configuracoes,
  /** Máquinas cadastradas, para escrever a identificação das enviadas. */
  maquinas: Maquina[] = [],
) {
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

  // O conteúdo nunca pode invadir a curva verde (~268 mm) nem a faixa cinza do rodapé (~278 mm)
  // do timbrado: quando não couber, continua numa nova página com o mesmo papel.
  const LIMITE = 262
  let y = 60
  const garantirEspaco = (altura: number) => {
    if (y + altura <= LIMITE) return
    doc.addPage()
    doc.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    y = 52
  }

  // Cabeçalho do documento
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
    // Segunda linha (entrelinha de 11 pt ≈ 4,5 mm)
    return linhas.length > 1 ? 4.5 : 0
  }
  /** Distância entre uma linha de campos e a próxima (sem quebra de linha nos valores). */
  const PASSO = 13.5
  const meio = L + W / 2 + 4
  let extra = Math.max(campo('Cliente', cliente?.nome ?? '—', L, W / 2 - 6), campo('Evento', evento.nome, meio, W / 2 - 4))
  y += PASSO + extra
  // A cidade do evento (só os antigos têm uma própria) ou a do cadastro do cliente
  const cidade = evento.cidade.trim() || (cliente?.cidade ? [cliente.cidade, cliente.uf].filter(Boolean).join(' - ') : '')
  extra = Math.max(campo('Período', periodo(r.dataInicio, r.dataFim), L, W / 2 - 6), campo('Cidade', cidade, meio, W / 2 - 4))
  y += PASSO + extra

  // Máquinas enviadas e, com período corrido, de quando a quando ficam com o cliente (só o que
  // houver, lado a lado). O nome do evento, acima, é o que sai no topo das fichas.
  const blocos: Array<{ rotulo: string; linhas: string[] }> = []
  const larguraBloco = (i: number) => (i === 0 ? W / 2 - 6 : W / 2 - 4)
  doc.setFont('helvetica', 'normal').setFontSize(11)
  const porId = new Map(maquinas.map((m) => [m.id, m]))
  const enviadas = ordenarMaquinas(evento.maquinasIds.map((id) => porId.get(id)).filter((m): m is Maquina => !!m))
  if (enviadas.length) {
    // "P-01, P-02, G-03 (3 máquinas)"; se passar de 4 linhas, "… e mais N (total)"
    const total = `(${enviadas.length} ${enviadas.length === 1 ? 'máquina' : 'máquinas'})`
    const ids = enviadas.map((m) => m.identificacao)
    let linhas: string[] = []
    for (let n = ids.length; n >= 1; n--) {
      const texto =
        n === ids.length ? `${ids.join(', ')} ${total}` : `${ids.slice(0, n).join(', ')} e mais ${ids.length - n} ${total}`
      linhas = doc.splitTextToSize(txt(texto), larguraBloco(blocos.length)) as string[]
      if (linhas.length <= 4) break
    }
    blocos.push({ rotulo: 'Máquinas enviadas', linhas: linhas.slice(0, 4) })
  }
  // Período corrido: as máquinas ficam com o cliente também entre os dias de uso (as diárias, não)
  const ocupadas = evento.periodoCorrido ? datasOcupadas(evento) : []
  if (ocupadas.length > new Set(evento.dias.map((d) => d.data)).size) {
    const texto = `De ${dataCurta(ocupadas[0])} a ${dataCurta(ocupadas[ocupadas.length - 1])} (${ocupadas.length} dias)`
    blocos.push({
      rotulo: 'Máquinas com o cliente',
      linhas: (doc.splitTextToSize(txt(texto), larguraBloco(blocos.length)) as string[]).slice(0, 2),
    })
  }
  if (blocos.length) {
    const ENTRELINHA = 4.5
    const altura = Math.max(...blocos.map((b) => (b.linhas.length - 1) * ENTRELINHA))
    garantirEspaco(5.5 + altura + 3)
    blocos.forEach((b, i) => {
      const x = i === 0 ? L : meio
      doc
        .setFont('helvetica', 'bold')
        .setFontSize(7.5)
        .setTextColor(...SECUNDARIO)
      doc.text(b.rotulo.toUpperCase(), x, y)
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(11)
        .setTextColor(...TINTA)
      b.linhas.forEach((linha, j) => doc.text(linha, x, y + 5.5 + j * ENTRELINHA))
    })
    y += PASSO + altura
  }

  // Datas de utilização
  y += 2
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  garantirEspaco(4 + 9)
  doc.text('DATAS DE UTILIZAÇÃO', L, y)
  y += 4
  const colunas = 3
  const larguraCol = W / colunas
  const textoDia = (d: (typeof evento.dias)[number]) =>
    txt(`${DIAS_SEMANA[parseISO(d.data).getDay()]} • ${d.maquinas} ${d.maquinas === 1 ? 'máquina' : 'máquinas'}`)
  // Mesmo tamanho de letra em todas as caixinhas: reduz para todas se alguma não couber ao lado da data
  doc.setFont('helvetica', 'bold').setFontSize(9)
  const larguraData = doc.getTextWidth('00/00/0000')
  doc.setFont('helvetica', 'normal')
  const maiorTexto = Math.max(0, ...evento.dias.map((d) => doc.getTextWidth(textoDia(d))))
  const fonteDia = maiorTexto > larguraCol - 3 - 6 - larguraData - 3 ? 7.5 : 9
  evento.dias.forEach((d, i) => {
    if (i % colunas === 0) {
      if (i > 0) y += 9
      garantirEspaco(9)
    }
    const cx = L + (i % colunas) * larguraCol
    const cy = y
    doc.setFillColor(244, 246, 245).roundedRect(cx, cy, larguraCol - 3, 7, 1.5, 1.5, 'F')
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(9)
      .setTextColor(...TINTA)
    doc.text(dataCurta(d.data), cx + 3, cy + 4.7)
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(fonteDia)
      .setTextColor(...SECUNDARIO)
    doc.text(textoDia(d), cx + larguraCol - 6, cy + 4.7, { align: 'right' })
  })
  if (evento.dias.length) y += 9

  // Resumo financeiro (mantido inteiro na mesma página, junto com o total)
  const linhas: Array<[string, string]> = [
    ['Quantidade de diárias utilizadas', numero(r.totalDiarias)],
    ['Valor unitário da diária', moeda(evento.valorDiaria)],
    ['Valor total das diárias', moeda(r.valorDiarias)],
    ['Quantidade de bobinas utilizadas', r.bobinasUtilizadas === null ? 'A conferir' : numero(r.bobinasUtilizadas)],
    ['Valor unitário da bobina', moeda(evento.valorBobina)],
    ['Valor total das bobinas', moeda(r.valorBobinas)],
  ]
  if (r.desconto > 0) linhas.push(['Desconto', `- ${moeda(r.desconto)}`])
  y += 6
  garantirEspaco(3 + linhas.length * 7.5 + 8 + 15)
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  doc.text('RESUMO FINANCEIRO', L, y)
  y += 3
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

  // Pagamento e observações + mensagem final, sempre acima do rodapé do timbrado
  y += 15
  const linhasObs = evento.observacoes.trim()
    ? (doc.setFont('helvetica', 'normal').setFontSize(9.5),
      doc.splitTextToSize(txt(evento.observacoes), R - meio) as string[]).slice(0, 12)
    : []
  const alturaPagamento = 8 + 5.5 + Math.max(1, linhasObs.length) * 4.2
  // Mensagem final (campo "RODAPÉ" da planilha): texto livre, pode quebrar em até 4 linhas
  const rodape = (evento.rodape || config.rodapePadrao).trim()
  doc.setFont('helvetica', 'bold').setFontSize(13)
  // Até 4 linhas; o que passar disso termina em "…" (a ficha pode ter mais, o PDF resume)
  const todasRodape = rodape ? (doc.splitTextToSize(txt(rodape), W) as string[]) : []
  const linhasRodape =
    todasRodape.length > 4 ? [...todasRodape.slice(0, 3), `${todasRodape[3].replace(/\s+$/, '')}…`] : todasRodape
  const ENTRELINHA_RODAPE = 5.3
  const alturaRodape = 8 + Math.max(0, linhasRodape.length - 1) * ENTRELINHA_RODAPE + 6
  garantirEspaco(alturaPagamento + alturaRodape)
  y += 8
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
    doc.text(linhasObs, meio, y + 5.5)
  }

  // Fica perto do fim da página (como no modelo), mas nunca abaixo do limite do timbrado
  const fimPagamento = y + 5.5 + Math.max(1, linhasObs.length) * 4.2
  const extraLinhas = Math.max(0, linhasRodape.length - 1) * ENTRELINHA_RODAPE
  const yRodape = Math.max(fimPagamento + 8, Math.min(248, LIMITE - 6 - extraLinhas))
  if (linhasRodape.length) {
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(13)
      .setTextColor(...VERDE)
    linhasRodape.forEach((linha, i) => doc.text(linha, 105, yRodape + i * ENTRELINHA_RODAPE, { align: 'center' }))
  }
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(7.5)
    .setTextColor(...SECUNDARIO)
  doc.text('Resumo gerado automaticamente a partir do controle interno de locação.', 105, yRodape + extraLinhas + 6, {
    align: 'center',
  })

  const nome = nomeArquivoSeguro(`Resumo - ${cliente?.nome ?? 'Cliente'} - ${evento.nome}`) + '.pdf'
  return { doc, nome }
}

export async function baixarResumoPDF(
  evento: Evento,
  cliente: Cliente | undefined,
  config: Configuracoes,
  maquinas: Maquina[] = [],
) {
  const { doc, nome } = await gerarResumoPDF(evento, cliente, config, maquinas)
  doc.save(nome)
  return nome
}
