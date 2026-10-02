// Recibo do pagamento (PIX ou dinheiro) em PDF, no papel timbrado da empresa.
// Carregado sob demanda com import(), junto com o jsPDF. O texto vem de recibo.ts.

import { jsPDF } from 'jspdf'
import type { Cliente, Configuracoes, Evento } from '#shared/tipos.ts'
import { carregarTimbrado, LINHA, SECUNDARIO, TINTA, VERDE } from './pdf'
import { txt } from './pdfTexto'
import { montarRecibo } from './recibo'

export async function gerarReciboPDF(evento: Evento, cliente: Cliente | undefined, config: Configuracoes) {
  const img = await carregarTimbrado()
  const recibo = montarRecibo(evento, cliente, config)
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const L = 22 // margem esquerda
  const R = 188 // margem direita
  const W = R - L
  const CENTRO = 105

  doc.setProperties({ title: `Recibo ${recibo.numero} - ${cliente?.nome ?? ''} - ${evento.nome}`, creator: 'BC Fichas Control' })
  doc.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')

  // Nunca invade a curva verde nem a faixa cinza do rodapé do timbrado (como no resumo)
  const LIMITE = 262
  let y = 60
  const garantirEspaco = (altura: number) => {
    if (y + altura <= LIMITE) return
    doc.addPage()
    doc.addImage(img, 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    y = 52
  }

  // Título e número
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(19)
    .setTextColor(...TINTA)
  doc.text('RECIBO', L, y)
  doc.setFillColor(...VERDE).roundedRect(L, y + 3, 18, 1.2, 0.6, 0.6, 'F')
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(15)
    .setTextColor(...VERDE)
  doc.text(txt(recibo.numero), R, y, { align: 'right' })

  // Valor em destaque
  y += 11
  doc.setFillColor(...VERDE).roundedRect(L, y, W, 16, 2.5, 2.5, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(255, 255, 255)
  doc.text('VALOR RECEBIDO', L + 6, y + 10)
  doc.setFontSize(19)
  doc.text(txt(recibo.valorTexto), R - 6, y + 10.6, { align: 'right' })

  // Texto do recibo (justificado, como num documento)
  y += 16 + 13
  const ENTRELINHA = 6.4
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(12)
    .setTextColor(...TINTA)
  const texto = txt(recibo.texto)
  const linhas = doc.splitTextToSize(texto, W) as string[]
  garantirEspaco(linhas.length * ENTRELINHA)
  doc.text(texto, L, y, { maxWidth: W, align: 'justify', lineHeightFactor: ENTRELINHA / (12 * 0.3528) })
  y += (linhas.length - 1) * ENTRELINHA + 13

  // Detalhamento curto do valor
  const linhasDetalhe = recibo.detalhes.length + (recibo.total ? 1 : 0)
  garantirEspaco(3 + linhasDetalhe * 7.5 + 4)
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  doc.text('DETALHAMENTO', L, y)
  y += 3
  const linhaTabela = (rotulo: string, conta: string, valor: string, forte = false) => {
    y += 7.5
    doc
      .setFont('helvetica', forte ? 'bold' : 'normal')
      .setFontSize(10.5)
      .setTextColor(...(forte ? TINTA : SECUNDARIO))
    doc.text(txt(rotulo), L, y)
    if (conta) doc.setFont('helvetica', 'normal').text(txt(conta), L + 32, y)
    doc.setFont('helvetica', 'bold').setTextColor(...TINTA)
    doc.text(txt(valor), R, y, { align: 'right' })
    doc
      .setDrawColor(...LINHA)
      .setLineWidth(0.2)
      .line(L, y + 2.6, R, y + 2.6)
  }
  for (const d of recibo.detalhes) linhaTabela(d.rotulo, d.conta, d.valor)
  if (recibo.total) linhaTabela('Total', '', recibo.total, true)

  // Forma de pagamento
  y += 11
  garantirEspaco(12)
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(7.5)
    .setTextColor(...SECUNDARIO)
  doc.text('FORMA DE PAGAMENTO', L, y)
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(11)
    .setTextColor(...TINTA)
  doc.text(txt(recibo.pagamento), L, y + 5.5)

  // Fecho, local e data, e a assinatura (sempre juntos, perto do fim da página)
  const alturaAssinatura = 6 + recibo.assinatura.length * 5
  // Espaço para assinar acima da linha: 30 mm se couber; numa página cheia encolhe até 16 mm
  // antes de levar o fecho e a assinatura sozinhos para outra página
  const ESPACO_ASSINAR = 30
  const MINIMO_ASSINAR = 16
  y += 5.5 + 14
  garantirEspaco(8 + MINIMO_ASSINAR + alturaAssinatura)
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(11.5)
    .setTextColor(...TINTA)
  doc.text(txt(recibo.fecho), L, y)
  y += 8
  doc.text(txt(recibo.localData), R, y, { align: 'right' })

  const espaco = Math.min(ESPACO_ASSINAR, LIMITE - alturaAssinatura - y)
  const yLinha = Math.max(y + espaco, Math.min(236, LIMITE - alturaAssinatura))
  doc
    .setDrawColor(...TINTA)
    .setLineWidth(0.3)
    .line(CENTRO - 48, yLinha, CENTRO + 48, yLinha)
  recibo.assinatura.forEach((linha, i) => {
    doc
      .setFont('helvetica', i === 0 ? 'bold' : 'normal')
      .setFontSize(i === 0 ? 10.5 : 9.5)
      .setTextColor(...(i === 0 ? TINTA : SECUNDARIO))
    doc.text(txt(linha), CENTRO, yLinha + 5.5 + i * 5, { align: 'center' })
  })

  return { doc, nome: recibo.nomeArquivo }
}

export async function baixarReciboPDF(evento: Evento, cliente: Cliente | undefined, config: Configuracoes) {
  const { doc, nome } = await gerarReciboPDF(evento, cliente, config)
  doc.save(nome)
  return nome
}
