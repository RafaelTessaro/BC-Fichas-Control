import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Permissao } from '#shared/permissoes.ts'
import { usePode } from '../../store/sessao'

/** Página só para quem tem a permissão; os outros voltam ao Painel (o servidor também recusa as rotas). */
export function RotaPermitida({ permissao, children }: { permissao: Permissao; children: ReactNode }) {
  const permitido = usePode(permissao)
  return permitido ? children : <Navigate to="/" replace />
}
