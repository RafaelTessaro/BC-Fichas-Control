// Ordem de serviço em PDF, no papel timbrado da empresa (mesmo estilo do resumo do evento em pdf.ts).
// Carregado sob demanda com import(), junto com o jsPDF.

import { jsPDF } from 'jspdf'
import timbradoUrl from '../assets/timbrado.jpg'
import { codigoOS, STATUS_OS, TIPO_MAQUINA, TIPO_OS } from '#shared/maquinas.ts'
import type { Maquina, OrdemServico } from '#shared/tipos.ts'
import { dataCurta, hojeISO, moeda } from './format'
import { nomeArquivoSeguro } from './storage'
import { txt } from './pdfTexto'

// Mesmas cores do resumo do evento
const VERDE: [number, number, number] = [11, 158, 79]
const TINTA: [number, number, number] = [50, 52, 56]
const SECUNDARIO: [number, number, number] = [110, 112, 118]
const LINHA: [number, number, number] = [226, 228, 232]
const FUNDO: [number, number, number] = [244, 246, 245]

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

export async function gerarOSPDF(ordem: OrdemServico, maquina: Maquina | undefined) {
  const img = await carregarTimbrado()
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const L = 22 // margem esquerda
  const R = 188 // margem direita
  const W = R - L
  const meio = L + W / 2 + 4
  const codigo = codigoOS(ordem.numero)
  const ident = maquina?.identificacao ?? 'Máquina removida'

  doc.setProperties({ title: `${codigo} - ${ident}`, creator: 'BC Fichas Control' })
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

  // Título
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(19)
    .setTextColor(...TINTA)
  doc.text('ORDEM DE SERVIÇO', L, y)
  doc.setFillColor(...VERDE).roundedRect(L, y + 3, 18, 1.2, 0.6, 0.6, 'F')
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(12)
    .setTextColor(...VERDE)
  doc.text(codigo, R, y - 5, { align: 'right' })
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(9)
    .setTextColor(...SECUNDARIO)
  doc.text(`Emitida em ${dataCurta(hojeISO())}`, R, y, { align: 'right' })

  // Campos em duas colunas
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
    return linhas.length > 1 ? 5 : 0
  }
  const linhaDupla = (a: [string, string], b: [string, string]) => {
    const extra = Math.max(campo(a[0], a[1], L, W / 2 - 6), campo(b[0], b[1], meio, W / 2 - 4))
    y += 14 + extra
  }
  const tipoMaquina = maquina
    ? `${TIPO_MAQUINA[maquina.tipo].label} (${TIPO_MAQUINA[maquina.tipo].descricao.toLowerCase()})`
    : '—'
  linhaDupla(
    ['Máquina', `${ident}  •  ${tipoMaquina}`],
    ['Modelo / Nº de série', [maquina?.modelo, maquina?.numeroSerie].filter(Boolean).join('  •  ')],
  )
  linhaDupla(
    ['Tipo de manutenção', `${TIPO_OS[ordem.tipo].label} — ${TIPO_OS[ordem.tipo].descricao.toLowerCase()}`],
    ['Situação', STATUS_OS[ordem.status].label],
  )
  linhaDupla(
    ['Aberta em', dataCurta(ordem.abertura)],
    ['Concluída em', ordem.conclusao ? dataCurta(ordem.conclusao) : '____/____/________'],
  )
  linhaDupla(
    ['Responsável', ordem.responsavel || '______________________________'],
    ['Custo', ordem.custo ? moeda(ordem.custo) : 'R$ ____________'],
  )

  // Serviços em "etiquetas"
  y += 2
  garantirEspaco(4 + 9)
  doc
    .setFont('helvetica', 'bold')
    .setFontSize(10)
    .setTextColor(...TINTA)
  doc.text('SERVIÇOS', L, y)
  y += 4
  if (ordem.servicos.length) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5)
    let x = L
    garantirEspaco(8)
    for (const s of ordem.servicos) {
      const largura = Math.min(W, doc.getTextWidth(txt(s)) + 10)
      if (x + largura > R + 0.1) {
        x = L
        y += 9
        garantirEspaco(8)
      }
      doc.setFillColor(...FUNDO).roundedRect(x, y, largura, 7, 1.5, 1.5, 'F')
      doc.setFillColor(...VERDE).circle(x + 3.6, y + 3.5, 0.9, 'F')
      doc.setTextColor(...TINTA)
      doc.text(txt(s), x + 6.2, y + 4.7, { maxWidth: largura - 8 })
      x += largura + 2.5
    }
    y += 11
  } else {
    doc
      .setFont('helvetica', 'normal')
      .setFontSize(10)
      .setTextColor(...SECUNDARIO)
    doc.text('Nenhum serviço marcado.', L, y + 4.5)
    y += 8
  }

  // Blocos de texto; vazio vira linhas em branco para preencher à mão
  const bloco = (titulo: string, texto: string, linhasEmBranco: number) => {
    y += 5
    doc.setFont('helvetica', 'normal').setFontSize(10.5)
    const linhas = texto.trim() ? (doc.splitTextToSize(txt(texto.trim()), W) as string[]) : []
    const ENTRELINHA = 5
    const altura = 6 + (linhas.length ? linhas.length * ENTRELINHA : linhasEmBranco * 7.5)
    garantirEspaco(Math.min(altura, 40))
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(10)
      .setTextColor(...TINTA)
    doc.text(titulo, L, y)
    y += 6
    if (linhas.length) {
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(10.5)
        .setTextColor(...TINTA)
      for (const linha of linhas) {
        garantirEspaco(ENTRELINHA)
        doc.text(linha, L, y)
        y += ENTRELINHA
      }
    } else {
      doc.setDrawColor(...LINHA).setLineWidth(0.3)
      for (let i = 0; i < linhasEmBranco; i++) {
        garantirEspaco(7.5)
        y += 6.5
        doc.line(L, y, R, y)
        y += 1
      }
      y += 2
    }
  }
  bloco('PROBLEMA RELATADO OU MOTIVO', ordem.problema, 2)
  bloco('SERVIÇO REALIZADO', ordem.solucao, 3)
  bloco('PEÇAS TROCADAS', ordem.pecas, 1)

  // Assinaturas, perto do fim da página (como num formulário), sem passar do limite do timbrado
  const ALTURA_ASSINATURAS = 22
  garantirEspaco(ALTURA_ASSINATURAS + 8)
  const yAssinatura = Math.max(y + 20, Math.min(244, LIMITE - ALTURA_ASSINATURAS + 10))
  doc.setDrawColor(...TINTA).setLineWidth(0.3)
  const larguraAssinatura = W / 2 - 10
  const assinatura = (x: number, rotulo: string, nome: string) => {
    doc.line(x, yAssinatura, x + larguraAssinatura, yAssinatura)
    doc
      .setFont('helvetica', 'bold')
      .setFontSize(8)
      .setTextColor(...SECUNDARIO)
    doc.text(rotulo.toUpperCase(), x + larguraAssinatura / 2, yAssinatura + 4.5, { align: 'center' })
    if (nome) {
      doc
        .setFont('helvetica', 'normal')
        .setFontSize(9)
        .setTextColor(...TINTA)
      doc.text(txt(nome), x + larguraAssinatura / 2, yAssinatura + 9, { align: 'center', maxWidth: larguraAssinatura })
    }
  }
  assinatura(L, 'Responsável', ordem.responsavel)
  assinatura(R - larguraAssinatura, 'Conferido por', '')
  doc
    .setFont('helvetica', 'normal')
    .setFontSize(7.5)
    .setTextColor(...SECUNDARIO)
  doc.text('Ordem de serviço interna de manutenção, gerada pelo controle de locação.', 105, yAssinatura + 15, { align: 'center' })

  const nome = nomeArquivoSeguro(`${codigo.replaceAll('.', '')} - ${ident}`) + '.pdf'
  return { doc, nome }
}

export async function baixarOSPDF(ordem: OrdemServico, maquina: Maquina | undefined) {
  const { doc, nome } = await gerarOSPDF(ordem, maquina)
  doc.save(nome)
  return nome
}
