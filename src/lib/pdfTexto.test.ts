import { describe, expect, it } from 'vitest'
import { txt } from './pdfTexto'

describe('texto para o PDF', () => {
  it('mantém acentos, aspas e travessão; adapta ou tira símbolos que a fonte não tem', () => {
    expect(txt('Festa “São João” — Ação • 1º')).toBe('Festa “São João” — Ação • 1º')
    expect(txt('★ FESTA JUNINA ★')).toBe('* FESTA JUNINA *')
    expect(txt('Música ♪ e 🎉 alegria')).toBe('Música e alegria')
    expect(txt('R$ 10,00 − desconto')).toBe('R$ 10,00 - desconto')
    expect(txt('LINHA 1 🎈\nLINHA 2')).toBe('LINHA 1\nLINHA 2')
  })
})
