import { baixarArquivo } from './storage'

/** Gera CSV no padrão brasileiro (separador ";") com BOM para abrir certo no Excel. */
export function exportarCSV(nome: string, cabecalho: string[], linhas: Array<Array<string | number>>) {
  const esc = (v: string | number) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const corpo = [cabecalho, ...linhas].map((l) => l.map(esc).join(';')).join('\r\n')
  baixarArquivo(nome, '\ufeff' + corpo, 'text/csv;charset=utf-8')
}
