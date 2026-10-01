import { baixarArquivo } from './storage'

/** Gera CSV no padrão brasileiro (separador ";") com BOM para abrir certo no Excel. */
export function exportarCSV(nome: string, cabecalho: string[], linhas: Array<Array<string | number>>) {
  const corpo = [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\r\n')
  baixarArquivo(nome, '\ufeff' + corpo, 'text/csv;charset=utf-8')
}

/**
 * Formata uma célula. Textos que começam com = + - @ (ex.: um nome digitado como "=HIPERLINK(...)")
 * ganham um apóstrofo na frente para o Excel não executá-los como fórmula.
 */
export function celulaCsv(v: string | number) {
  let s = typeof v === 'number' ? String(v).replace('.', ',') : v
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
