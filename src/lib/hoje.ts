import { useEffect, useState } from 'react'
import { hojeISO } from './format'

/**
 * Data de hoje (`yyyy-MM-dd`) que vira sozinha à meia-noite: o computador da empresa costuma
 * ficar com a tela aberta de um dia para o outro, e a situação das máquinas depende do dia.
 */
export function useHoje() {
  const [hoje, setHoje] = useState(hojeISO)
  useEffect(() => {
    const agora = new Date()
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1, 0, 0, 5)
    const timer = setTimeout(() => setHoje(hojeISO()), amanha.getTime() - agora.getTime())
    // Computador que dormiu durante a noite: confere ao voltar para a tela
    const conferir = () => setHoje(hojeISO())
    document.addEventListener('visibilitychange', conferir)
    window.addEventListener('focus', conferir)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', conferir)
      window.removeEventListener('focus', conferir)
    }
  }, [hoje])
  return hoje
}
