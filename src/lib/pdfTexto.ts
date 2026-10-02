// As fontes padrão do PDF (Helvetica, Courier) só têm os caracteres do Windows-1252: acentos,
// aspas curvas, travessão e "•" saem certos, mas ★, ♪ e emojis viram lixo. Aqui o texto é
// adaptado antes de ir para o PDF.

const EXTRAS_1252 = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

const TROCAS: Record<string, string> = {
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  '−': '-',
  '★': '*',
  '☆': '*',
  '✦': '*',
  '✧': '*',
  '✓': 'v',
  '✔': 'v',
  '→': '->',
  '←': '<-',
}

/** Texto seguro para as fontes padrão do jsPDF (símbolos sem equivalente são retirados). */
export function txt(s: string): string {
  let saida = ''
  for (const c of s) {
    const troca = TROCAS[c]
    if (troca !== undefined) saida += troca
    else {
      const cp = c.codePointAt(0)!
      // Latin-1 sem os caracteres de controle C1 (0x80–0x9F), mais os extras do Windows-1252
      if (cp === 0x0a || (cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff) || EXTRAS_1252.has(c)) saida += c
    }
  }
  // Símbolos retirados podem deixar espaços sobrando
  return saida.replace(/ {2,}/g, ' ').replace(/ +\n/g, '\n').replace(/\n +/g, '\n')
}
