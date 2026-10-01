import type { StateStorage } from 'zustand/middleware'

/**
 * localStorage pode lançar exceção (modo privado, cota cheia, site bloqueado).
 * Este adaptador nunca quebra a aplicação: se não conseguir gravar, mantém
 * os dados apenas em memória durante a sessão.
 */
const memoria = new Map<string, string>()

export const armazenamentoSeguro: StateStorage = {
  getItem(nome) {
    try {
      return localStorage.getItem(nome) ?? memoria.get(nome) ?? null
    } catch {
      return memoria.get(nome) ?? null
    }
  },
  setItem(nome, valor) {
    memoria.set(nome, valor)
    try {
      localStorage.setItem(nome, valor)
    } catch {
      /* mantém só em memória */
    }
  },
  removeItem(nome) {
    memoria.delete(nome)
    try {
      localStorage.removeItem(nome)
    } catch {
      /* ignorado */
    }
  },
}

export const novoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export function baixarArquivo(nome: string, conteudo: BlobPart, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }))
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function nomeArquivoSeguro(s: string) {
  return s.replace(/[\\/:*?"<>|]/g, '-').trim() || 'arquivo'
}
