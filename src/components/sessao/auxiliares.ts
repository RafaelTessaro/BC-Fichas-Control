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

/**
 * Mensagem de uma tentativa de entrar que não deu certo e, no bloqueio (429), quantos segundos esperar.
 * `porComputador`: o bloqueio é do computador (muitas falhas, com qualquer usuário), não da conta.
 */
export function erroAoEntrar(e: unknown): { mensagem: string; esperarSegundos: number; porComputador: boolean } {
  if (e instanceof ErroApi && e.status === 429) {
    const s = Number(e.dados.esperarSegundos)
    return {
      mensagem: e.message,
      esperarSegundos: Number.isFinite(s) && s > 0 ? Math.ceil(s) : 60,
      porComputador: e.dados.motivo === 'computador',
    }
  }
  return { mensagem: e instanceof Error ? e.message : 'Erro inesperado.', esperarSegundos: 0, porComputador: false }
}

/** "14 min 57 s", "2 min" ou "40 s" (com a unidade: "14:57" se leria como horário). */
export function formatarEspera(segundos: number) {
  const m = Math.floor(segundos / 60)
  const s = segundos % 60
  if (!m) return `${s} s`
  return s ? `${m} min ${s} s` : `${m} min`
}

/** Aviso do bloqueio por tentativas, com o tempo que falta. */
export function avisoEspera(segundos: number, porComputador = false) {
  return porComputador
    ? `Muitas tentativas erradas neste computador. Aguarde ${formatarEspera(segundos)} ou entre por outro computador.`
    : `Muitas tentativas. Aguarde ${formatarEspera(segundos)} para tentar de novo.`
}

/**
 * Contagem regressiva do bloqueio por tentativas: os segundos que faltam (0 = pode tentar), a
 * função que começa a contar e o aviso para a tela ('' quando não há espera).
 */
export function useEspera(): [number, (segundos: number, porComputador?: boolean) => void, string] {
  const [ate, setAte] = useState(0)
  const [agora, setAgora] = useState(0)
  const [porComputador, setPorComputador] = useState(false)
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
  const esperar = (segundos: number, computador = false) => {
    const n = Date.now()
    setAgora(n)
    setAte(segundos > 0 ? n + segundos * 1000 : 0)
    setPorComputador(computador)
  }
  return [faltam, esperar, faltam > 0 ? avisoEspera(faltam, porComputador) : '']
}
