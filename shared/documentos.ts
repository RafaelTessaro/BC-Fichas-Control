// CPF, CNPJ, CEP e telefone: validação e máscaras (usado no servidor e na interface).

export const somenteDigitos = (s: string) => (s ?? '').replace(/\D/g, '')

function digitoVerificador(numeros: string, pesos: number[]) {
  const soma = pesos.reduce((s, p, i) => s + Number(numeros[i]) * p, 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

/** Calcula os dois dígitos verificadores de um CNPJ a partir dos 12 primeiros dígitos. */
export function completarCnpj(base12: string) {
  const b = somenteDigitos(base12).slice(0, 12).padStart(12, '0')
  const d1 = digitoVerificador(b, PESOS_CNPJ_1)
  const d2 = digitoVerificador(b + d1, PESOS_CNPJ_2)
  return b + d1 + d2
}

export function cnpjValido(valor: string) {
  const d = somenteDigitos(valor)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  return completarCnpj(d.slice(0, 12)) === d
}

/** Calcula os dois dígitos verificadores de um CPF a partir dos 9 primeiros dígitos. */
export function completarCpf(base9: string) {
  const b = somenteDigitos(base9).slice(0, 9).padStart(9, '0')
  const d1 = digitoVerificador(b, [10, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digitoVerificador(b + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  return b + d1 + d2
}

export function cpfValido(valor: string) {
  const d = somenteDigitos(valor)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  return completarCpf(d.slice(0, 9)) === d
}

export function mascaraCnpj(valor: string) {
  return somenteDigitos(valor)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function mascaraCpf(valor: string) {
  return somenteDigitos(valor)
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export function mascaraDocumento(valor: string, tipo: 'PF' | 'PJ') {
  return tipo === 'PF' ? mascaraCpf(valor) : mascaraCnpj(valor)
}

export function mascaraCep(valor: string) {
  return somenteDigitos(valor)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, '$1-$2')
}

export function mascaraTelefone(valor: string) {
  const d = somenteDigitos(valor).slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}
