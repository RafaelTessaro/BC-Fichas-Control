import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})
const inteiro = new Intl.NumberFormat('pt-BR')

export const moeda = (v: number) => brl.format(v || 0)
export const moedaCompacta = (v: number) => (Math.abs(v) < 10000 ? brl.format(v || 0) : brlCompact.format(v))
export const numero = (v: number) => inteiro.format(v || 0)

export const hojeISO = () => format(new Date(), 'yyyy-MM-dd')

export function dataCurta(iso: string | null | undefined) {
  if (!iso) return '—'
  return format(parseISO(iso), 'dd/MM/yyyy')
}

/** Primeira letra maiúscula, o resto como está ("quinta-feira, 1 de outubro" → "Quinta-feira, 1 de outubro"). */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function dataExtensa(iso: string, padrao = "EEEE, d 'de' MMMM") {
  return cap(format(parseISO(iso), padrao, { locale: ptBR }))
}

export function periodo(inicio: string | null, fim: string | null) {
  if (!inicio) return 'Sem datas'
  if (!fim || inicio === fim) return dataCurta(inicio)
  const a = parseISO(inicio)
  const b = parseISO(fim)
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) return `${format(a, 'dd')} a ${format(b, 'dd/MM/yyyy')}`
    return `${format(a, 'dd/MM')} a ${format(b, 'dd/MM/yyyy')}`
  }
  return `${dataCurta(inicio)} a ${dataCurta(fim)}`
}

export const codigoEvento = (n: number) => `#${String(n).padStart(4, '0')}`

const digitos = (s: string) => s.replace(/\D/g, '')

export function mascaraDocumento(valor: string, tipo: 'PF' | 'PJ') {
  const d = digitos(valor).slice(0, tipo === 'PF' ? 11 : 14)
  if (tipo === 'PF') {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function mascaraTelefone(valor: string) {
  const d = digitos(valor).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Remove acentos e caixa para buscas tolerantes ("joão" encontra "JOAO"). */
export function normalizar(s: string) {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return ((partes[0][0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase()
}

export const MAX_CENTAVOS = 99_999_999_999

/** Converte texto colado ("1.234,56", "R$ 80", "80.5") em reais. */
export function textoParaReais(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.-]/g, '')
  if (!/\d/.test(limpo)) return null
  // Vírgula é sempre decimal; sem vírgula, ponto seguido de 1–2 dígitos no fim também é decimal
  const normal = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : /\.\d{1,2}$/.test(limpo)
      ? limpo.replace(/\.(?=.*\.)/g, '')
      : limpo.replace(/\./g, '')
  const n = Number(normal)
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n * 100), MAX_CENTAVOS) / 100 : null
}
