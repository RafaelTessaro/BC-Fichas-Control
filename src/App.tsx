import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useEffect, useRef } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/layout/Layout'
import { MinhaSenhaModal } from './components/sessao/MinhaSenhaModal'
import { RotaPermitida } from './components/sessao/RotaPermitida'
import { SessaoEncerradaModal } from './components/sessao/SessaoEncerradaModal'
import { ConfirmHost, Toaster } from './components/ui/Feedback'
import { definirAoErroSessao } from './lib/api'
import { Agenda } from './pages/Agenda'
import { ClienteDetalhe } from './pages/ClienteDetalhe'
import { Clientes } from './pages/Clientes'
import { Configuracoes } from './pages/Configuracoes'
import { Contratos } from './pages/Contratos'
import { Entrar, SemAdministrador, TrocarSenhaObrigatoria } from './pages/Entrar'
import { EventoDetalhe } from './pages/EventoDetalhe'
import { EventoForm } from './pages/EventoForm'
import { Eventos } from './pages/Eventos'
import { Manutencao } from './pages/Manutencao'
import { MaquinaDetalhe } from './pages/MaquinaDetalhe'
import { Painel } from './pages/Painel'
import { Relatorios } from './pages/Relatorios'
import { TelaConexao } from './components/layout/TelaConexao'
import { useDados } from './store/dados'
import { useSessao } from './store/sessao'
import { aplicarTema, useUI } from './store/ui'

// Só o administrador abre a página Usuários: ela é baixada na primeira visita
const Usuarios = lazy(() => import('./pages/Usuarios').then((m) => ({ default: m.Usuarios })))

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
        <Route path="/contratos" element={<Contratos />} />
        <Route path="/manutencao" element={<Manutencao />} />
        <Route path="/manutencao/:id" element={<MaquinaDetalhe />} />
        <Route
          path="/relatorios"
          element={
            <RotaPermitida permissao="verFaturamento">
              <Relatorios />
            </RotaPermitida>
          }
        />
        <Route
          path="/configuracoes"
          element={
            <RotaPermitida permissao="configuracoes">
              <Configuracoes />
            </RotaPermitida>
          }
        />
        <Route
          path="/usuarios"
          element={
            <RotaPermitida permissao="usuarios">
              <Suspense fallback={null}>
                <Usuarios />
              </Suspense>
            </RotaPermitida>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

/** Já entrou (e a senha não é mais a temporária): os dados e as telas do sistema. */
function Sistema() {
  const status = useDados((s) => s.status)
  const erro = useDados((s) => s.erro)

  // Conecta ao servidor (dados + atualizações em tempo real) só depois de entrar
  useEffect(() => useDados.getState().iniciar(), [])

  if (status !== 'pronto') {
    return (
      <TelaConexao
        modo={status === 'erro' ? 'erro' : 'carregando'}
        erro={erro}
        aoTentar={() => void useDados.getState().recarregar()}
      />
    )
  }
  return (
    <HashRouter>
      <Rotas />
      <MinhaSenhaModal />
    </HashRouter>
  )
}

export default function App() {
  const tema = useUI((s) => s.tema)
  const estado = useSessao((s) => s.estado)
  const usuario = useSessao((s) => s.usuario)
  const semUsuarios = useSessao((s) => s.semUsuarios)
  const erroSessao = useSessao((s) => s.erro)
  const expirou = useSessao((s) => s.expirou)

  // Quem está usando este navegador; 401 e "crie sua senha" vindos de qualquer requisição
  useEffect(() => {
    const sessao = useSessao.getState()
    definirAoErroSessao((codigo) =>
      codigo === 'SEM_SESSAO' ? useSessao.getState().sessaoEncerrada() : useSessao.getState().exigirTrocaSenha(),
    )
    void sessao.verificar()
    const pararBatimento = sessao.iniciarBatimento()
    return () => {
      pararBatimento()
      definirAoErroSessao(null)
    }
  }, [])

  // Entrou de novo depois do "Sua sessão terminou": volta o tempo real e busca o que mudou
  const expirouAntes = useRef(expirou)
  useEffect(() => {
    const voltou = expirouAntes.current && !expirou
    expirouAntes.current = expirou
    const { estado: e, usuario: u } = useSessao.getState()
    // Com a troca de senha pendente os dados não estão na tela (voltam ao criar a senha)
    if (voltou && e === 'logado' && u && !u.trocarSenha) useDados.getState().reconectar()
  }, [expirou])

  useEffect(() => {
    aplicarTema(tema)
    if (tema !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const ouvir = () => aplicarTema('system')
    mq.addEventListener('change', ouvir)
    return () => mq.removeEventListener('change', ouvir)
  }, [tema])

  let tela
  if (estado === 'verificando') tela = <TelaConexao modo="carregando" />
  else if (estado === 'erro')
    tela = <TelaConexao modo="erro" erro={erroSessao} aoTentar={() => void useSessao.getState().verificar()} />
  else if (estado === 'anonimo' || !usuario) tela = semUsuarios ? <SemAdministrador /> : <Entrar />
  else if (usuario.trocarSenha) tela = <TrocarSenhaObrigatoria />
  else tela = <Sistema />

  return (
    <MotionConfig reducedMotion="user">
      {tela}
      {/* Por cima de tudo, sem desmontar a tela de baixo (o que estava sendo digitado continua) */}
      <SessaoEncerradaModal />
      <Toaster />
      <ConfirmHost />
    </MotionConfig>
  )
}
