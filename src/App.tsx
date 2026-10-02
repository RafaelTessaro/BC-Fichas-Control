import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { ConfirmHost, Toaster } from './components/ui/Feedback'
import { Agenda } from './pages/Agenda'
import { ClienteDetalhe } from './pages/ClienteDetalhe'
import { Clientes } from './pages/Clientes'
import { Configuracoes } from './pages/Configuracoes'
import { EventoDetalhe } from './pages/EventoDetalhe'
import { EventoForm } from './pages/EventoForm'
import { Eventos } from './pages/Eventos'
import { Manutencao } from './pages/Manutencao'
import { MaquinaDetalhe } from './pages/MaquinaDetalhe'
import { Painel } from './pages/Painel'
import { Relatorios } from './pages/Relatorios'
import { TelaConexao } from './components/layout/TelaConexao'
import { useDados } from './store/dados'
import { aplicarTema, useUI } from './store/ui'

function Rotas() {
  const location = useLocation()
  return (
    <Layout>
      <Routes location={location}>
        <Route path="/" element={<Painel />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/clientes/:id" element={<ClienteDetalhe />} />
        <Route path="/eventos" element={<Eventos />} />
        <Route path="/eventos/novo" element={<EventoForm />} />
        <Route path="/eventos/:id" element={<EventoDetalhe />} />
        <Route path="/eventos/:id/editar" element={<EventoForm />} />
        <Route path="/manutencao" element={<Manutencao />} />
        <Route path="/manutencao/:id" element={<MaquinaDetalhe />} />
        <Route path="/relatorios" element={<Relatorios />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  const tema = useUI((s) => s.tema)
  const status = useDados((s) => s.status)

  // Conecta ao servidor (dados + atualizações em tempo real)
  useEffect(() => useDados.getState().iniciar(), [])

  useEffect(() => {
    aplicarTema(tema)
    if (tema !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const ouvir = () => aplicarTema('system')
    mq.addEventListener('change', ouvir)
    return () => mq.removeEventListener('change', ouvir)
  }, [tema])

  return (
    <MotionConfig reducedMotion="user">
      {status === 'pronto' ? (
        <HashRouter>
          <Rotas />
          <Toaster />
          <ConfirmHost />
        </HashRouter>
      ) : (
        <TelaConexao />
      )}
    </MotionConfig>
  )
}
