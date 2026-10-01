// Ajustes de texto para os dados que vêm da Receita Federal (tudo em MAIÚSCULAS).

import { mascaraCep, mascaraTelefone, somenteDigitos } from '#shared/documentos.ts'

/** Preposições e conjunções que ficam minúsculas no meio do nome. */
const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e'])

/** Siglas que continuam em maiúsculas (comparadas sem pontuação nas pontas). */
const SIGLAS = new Set(['LTDA', 'ME', 'EPP', 'EIRELI', 'S/A', 'SA', 'S.A', 'CIA', 'MEI', 'S/N', 'SN'])

/** Algarismos romanos com 2+ letras (ex.: "XV de Novembro", "Pio XII"). */
const ROMANO = /^(?=[IVX]{2,}$)X{0,3}(IX|IV|V?I{0,3})$/

/**
 * "BAIRRO DA BOA MORTE" → "Bairro da Boa Morte".
 * Mantém siglas (LTDA, ME, EPP, EIRELI, S/A, CIA, MEI), números e romanos;
 * preposições ficam minúsculas, exceto na primeira palavra.
 */
export function formatoTitulo(texto: string | null | undefined) {
  const palavras = (texto ?? '').trim().split(/\s+/).filter(Boolean)
  return palavras
    .map((palavra, i) => {
      const maiuscula = palavra.toLocaleUpperCase('pt-BR')
      const nucleo = maiuscula.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')
      if (SIGLAS.has(nucleo) || /\d/.test(palavra) || ROMANO.test(nucleo)) return maiuscula
      const minuscula = palavra.toLocaleLowerCase('pt-BR')
      if (i > 0 && PREPOSICOES.has(minuscula)) return minuscula
      // Maiúscula no início e depois de hífen, apóstrofo, barra ou parêntese ("D'Oeste", "Sul-Americana")
      return minuscula.replace(
        /(^|[-'’/(])(\p{L})/gu,
        (_, antes: string, letra: string) => antes + letra.toLocaleUpperCase('pt-BR'),
      )
    })
    .join(' ')
}

/** Texto aparado; `null`, números e outros tipos viram texto ou ''. */
export function textoLimpo(v: unknown): string {
  if (typeof v === 'string') return v.trim().replace(/\s+/g, ' ')
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

/** Junta o tipo ("RUA") ao nome ("13") sem repetir quando o nome já vem com o tipo. */
export function juntarLogradouro(tipo: unknown, nome: unknown) {
  const t = textoLimpo(tipo)
  const n = textoLimpo(nome)
  if (!n) return ''
  if (!t || n.toLocaleUpperCase('pt-BR').startsWith(`${t.toLocaleUpperCase('pt-BR')} `)) return formatoTitulo(n)
  return formatoTitulo(`${t} ${n}`)
}

/** "1981182225" → "(19) 8118-2225"; vazio quando não há DDD + número. */
export function formatarTelefone(...partes: unknown[]) {
  const d = somenteDigitos(partes.map(textoLimpo).join(''))
  return d.length === 10 || d.length === 11 ? mascaraTelefone(d) : ''
}

/** "13500120" → "13500-120"; vazio se não tiver 8 dígitos. */
export function formatarCep(v: unknown) {
  const d = somenteDigitos(textoLimpo(v))
  return d.length === 8 ? mascaraCep(d) : ''
}

/** Mantém apenas datas no formato `yyyy-MM-dd`. */
export function formatarData(v: unknown) {
  const s = textoLimpo(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''
}

export function formatarEmail(v: unknown) {
  const s = textoLimpo(v).toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : ''
}

export function formatarUf(v: unknown) {
  const s = textoLimpo(v).toUpperCase()
  return /^[A-Z]{2}$/.test(s) ? s : ''
}
