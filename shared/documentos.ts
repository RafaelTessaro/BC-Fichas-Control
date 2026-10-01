// CPF, CNPJ, CEP e telefone: validação e máscaras (usado no servidor e na interface).

export const somenteDigitos = (s: string) => (s ?? '').replace(/\D/g, '')

/** Rótulo antes do número, comum ao copiar de nota, e-mail ou assinatura. */
const ROTULO_CNPJ = /^[^0-9A-Z]*(?:CNPJ(?:\s*\/\s*MF)?|N[º°]|NO?\.?(?=[\s:]))[^0-9A-Z]*/
/** CNPJ (numérico ou alfanumérico, com ou sem máscara) no meio de um texto. */
const CNPJ_NO_TEXTO = /(?<![0-9A-Z])[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}(?![0-9A-Z])/

/**
 * CNPJ só com números e letras maiúsculas, sem pontuação.
 * Desde julho de 2026 a Receita emite CNPJ alfanumérico (IN RFB 2.229/2024): as 12 primeiras
 * posições podem ter letras A-Z; os 2 dígitos verificadores continuam numéricos.
 * Rótulo ou texto colado junto ("CNPJ: 12.403.843/0001-18") é descartado, como era antes das letras.
 */
export function normalizarCnpj(s: string) {
  let t = (s ?? '').toUpperCase().trim()
  // Rótulo colado junto ("CNPJ:", "CNPJ/MF nº", "Nº", "No."): as letras dele não fazem parte do número
  for (let sem = t.replace(ROTULO_CNPJ, ''); sem !== t; sem = t.replace(ROTULO_CNPJ, '')) t = sem
  const tudo = t.replace(/[^0-9A-Z]/g, '')
  if (/^[0-9A-Z]{0,12}\d{0,2}$/.test(tudo)) return tudo
  // Texto em volta do número ("12.403.843/0001-18 (matriz)"): fica com o CNPJ que aparece no meio
  const achado = t.match(CNPJ_NO_TEXTO)
  if (achado) return achado[0].replace(/[^0-9A-Z]/g, '')
  // Como antes do formato alfanumérico: com 14 algarismos no texto, o resto é descartado
  const digitos = somenteDigitos(t)
  return digitos.length === 14 ? digitos : tudo
}

/** `true` quando o CNPJ (já normalizado ou não) tem letras, isto é, está no formato alfanumérico. */
export const cnpjAlfanumerico = (s: string) => /[A-Z]/.test(normalizarCnpj(s))

/** Módulo 11; cada caractere vale o código ASCII − 48 (algarismos valem eles mesmos, "A" vale 17). */
function digitoVerificador(numeros: string, pesos: number[]) {
  const soma = pesos.reduce((s, p, i) => s + (numeros.charCodeAt(i) - 48) * p, 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

const PESOS_CNPJ_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
const PESOS_CNPJ_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

/** Calcula os dois dígitos verificadores de um CNPJ (numérico ou alfanumérico) a partir dos 12 primeiros caracteres. */
export function completarCnpj(base12: string) {
  const b = normalizarCnpj(base12).slice(0, 12).padStart(12, '0')
  const d1 = digitoVerificador(b, PESOS_CNPJ_1)
  const d2 = digitoVerificador(b + d1, PESOS_CNPJ_2)
  return b + d1 + d2
}

export function cnpjValido(valor: string) {
  const c = normalizarCnpj(valor)
  if (!/^[0-9A-Z]{12}\d{2}$/.test(c) || /^(.)\1{13}$/.test(c)) return false
  return completarCnpj(c.slice(0, 12)) === c
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

/** "12ABC34501DE35" → "12.ABC.345/01DE-35". Letras só nas 12 primeiras posições; os verificadores são números. */
export function mascaraCnpj(valor: string) {
  const n = normalizarCnpj(valor)
  const c = n.slice(0, 12) + somenteDigitos(n.slice(12)).slice(0, 2)
  let s = c.slice(0, 2)
  if (c.length > 2) s += `.${c.slice(2, 5)}`
  if (c.length > 5) s += `.${c.slice(5, 8)}`
  if (c.length > 8) s += `/${c.slice(8, 12)}`
  if (c.length > 12) s += `-${c.slice(12, 14)}`
  return s
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
