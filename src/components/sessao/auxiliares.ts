// Auxiliares das telas de sessão: erros ao entrar, a espera do bloqueio por tentativas (429) e a
// conferência da senha nova (a mesma política do servidor, em shared/usuarios.ts).

import { useEffect, useState } from 'react'
import { validarSenhaNova } from '#shared/usuarios.ts'
import { ErroApi } from '../../lib/api'

/** Dono da senha: a política não aceita o login nem palavras do nome dentro dela. */
export interface Dono {
  login: string
  nome: string
}

/** Problemas da senha nova (e da repetição), ou nada quando dá para salvar. */
export function problemasSenhaNova(nova: string, repetir: string, dono: Dono): { nova?: string; repetir?: string } {
  const erroNova = validarSenhaNova(nova, dono)
  if (erroNova) return { nova: erroNova }
  if (repetir !== nova) return { repetir: repetir ? 'As duas senhas não são iguais.' : 'Digite a nova senha mais uma vez.' }
  return {}
}

/** Mensagem de uma tentativa de entrar que não deu certo e, no bloqueio (429), quantos segundos esperar. */
export function erroAoEntrar(e: unknown): { mensagem: string; esperarSegundos: number } {
  if (e instanceof ErroApi && e.status === 429) {
    const s = Number(e.dados.esperarSegundos)
    return { mensagem: e.message, esperarSegundos: Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60 }
  }
  return { mensagem: e instanceof Error ? e.message : 'Erro inesperado.', esperarSegundos: 0 }
}

/** "1:05" ou "40 s". */
export function formatarEspera(segundos: number) {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s} s`
}

/**
 * Contagem regressiva do bloqueio por tentativas: os segundos que faltam (0 = pode tentar) e a
 * função que começa a contar.
 */
export function useEspera(): [number, (segundos: number) => void] {
  const [ate, setAte] = useState(0)
  const [agora, setAgora] = useState(0)
  useEffect(() => {
    if (!ate) return
    const t = setInterval(() => {
      const n = Date.now()
      setAgora(n)
      if (n >= ate) setAte(0)
    }, 1000)
    return () => clearInterval(t)
  }, [ate])
  const faltam = ate ? Math.max(0, Math.ceil((ate - agora) / 1000)) : 0
  const esperar = (segundos: number) => {
    const n = Date.now()
    setAgora(n)
    setAte(segundos > 0 ? n + segundos * 1000 : 0)
  }
  return [faltam, esperar]
}
