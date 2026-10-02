// Valor em reais por extenso, para o recibo ("quatrocentos e oitenta reais").

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const DEZ_A_DEZENOVE = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
const CENTENAS = [
  '',
  'cento',
  'duzentos',
  'trezentos',
  'quatrocentos',
  'quinhentos',
  'seiscentos',
  'setecentos',
  'oitocentos',
  'novecentos',
]

/** 1 a 999 por extenso ("cento e vinte e um"). */
function ate999(n: number): string {
  if (n === 100) return 'cem'
  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []
  if (c) partes.push(CENTENAS[c])
  if (resto >= 10 && resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10])
  else {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    if (d) partes.push(DEZENAS[d])
    if (u) partes.push(UNIDADES[u])
  }
  return partes.join(' e ')
}

const ESCALAS: Array<[string, string]> = [
  ['', ''],
  ['mil', 'mil'],
  ['milhão', 'milhões'],
  ['bilhão', 'bilhões'],
]

/** Número inteiro (0 a 999.999.999.999) por extenso, no masculino. */
export function inteiroPorExtenso(valor: number): string {
  const n = Math.trunc(Math.abs(valor))
  if (n === 0) return 'zero'
  const grupos: number[] = []
  for (let x = n; x > 0; x = Math.floor(x / 1000)) grupos.push(x % 1000)
  const partes: Array<{ texto: string; grupo: number }> = []
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i]
    if (!g) continue
    const [um, varios] = ESCALAS[i]
    let texto: string
    if (i === 1)
      texto = g === 1 ? 'mil' : `${ate999(g)} mil` // "mil", não "um mil"
    else if (i > 1) texto = `${ate999(g)} ${g === 1 ? um : varios}`
    else texto = ate999(g)
    partes.push({ texto, grupo: g })
  }
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda
  // (mil e cem, mil e vinte; mas mil duzentos e trinta)
  return partes
    .map((p, i) => {
      if (i === 0) return p.texto
      const ultimo = i === partes.length - 1
      return ultimo && (p.grupo < 100 || p.grupo % 100 === 0) ? `e ${p.texto}` : p.texto
    })
    .join(' ')
}

/** Valor em reais por extenso: 1234.5 → "mil duzentos e trinta e quatro reais e cinquenta centavos". */
export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100)
  const reais = Math.floor(centavosTotais / 100)
  const centavos = centavosTotais % 100
  const partes: string[] = []
  if (reais) {
    // "um milhão de reais", mas "um milhão e quinhentos mil reais"
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? 'de ' : ''
    partes.push(`${inteiroPorExtenso(reais)} ${de}${reais === 1 ? 'real' : 'reais'}`)
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`)
  return partes.length ? partes.join(' e ') : 'zero real'
}
