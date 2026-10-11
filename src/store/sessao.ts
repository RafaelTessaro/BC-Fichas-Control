import { create } from 'zustand'
import { pode, type Permissao } from '#shared/permissoes.ts'
import type { EntradaLogin, EstadoSessao, TrocaSenha, UsuarioSessao } from '#shared/tipos.ts'
import { api } from '../lib/api'

export type EstadoTela = 'verificando' | 'anonimo' | 'logado' | 'erro'

interface SessaoState {
  estado: EstadoTela
  usuario: UsuarioSessao | null
  semUsuarios: boolean
  /** Build visto ao abrir a página; vira o buildInicial dos dados. */
  build: string
  /** 401 no meio do uso: a tela continua montada e o login aparece por cima. */
  expirou: boolean
  /**
   * A sessão foi aberta com "Manter conectado neste computador" (vem do servidor). Continua com o valor
   * de antes quando a sessão termina: a janela "Sua sessão terminou" repete a escolha.
   */
  manterConectado: boolean
  erro: string
  /** Senha temporária digitada em Entrar (só em memória), reaproveitada na troca obrigatória. */
  senhaTemporaria: string
  verificar(): Promise<void>
  entrar(e: EntradaLogin): Promise<void>
  trocarSenha(e: TrocaSenha): Promise<void>
  sair(): Promise<void>
  sessaoEncerrada(): void
  exigirTrocaSenha(): void
  conferir(): Promise<boolean>
  iniciarBatimento(): () => void
}

/** Abas deste navegador combinam por aqui: quem entra, sai ou troca a senha avisa as outras. */
type AvisoAbas = 'entrou' | 'saiu' | 'senha'

const NOME_CANAL = 'bc-fichas-sessao'
let canal: BroadcastChannel | null | undefined

function canalAbas(): BroadcastChannel | null {
  if (canal === undefined) {
    try {
      canal = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NOME_CANAL)
    } catch {
      canal = null
    }
  }
  return canal
}

function avisarAbas(aviso: AvisoAbas) {
  try {
    canalAbas()?.postMessage(aviso)
  } catch {
    /* sem o canal, as outras abas percebem no foco ou no batimento */
  }
}

/** Interação conta como uso: o batimento renova a sessão só de quem está mexendo na tela. */
const BATIMENTO_MS = 5 * 60_000
/** Conferência ao voltar para a janela, no máximo uma a cada 30 s. */
const FOCO_MS = 30_000

/**
 * Recarrega a página. Quando o motivo é a versão da interface, no máximo uma vez a cada 30 s
 * (se o servidor insistir em entregar a versão antiga, não fica num laço).
 */
function recarregarPagina(motivo: 'build' | 'usuario') {
  if (motivo === 'build') {
    try {
      const ultima = Number(sessionStorage.getItem('bc-fichas:recarregou') ?? 0)
      if (Date.now() - ultima < 30_000) return
      sessionStorage.setItem('bc-fichas:recarregou', String(Date.now()))
    } catch {
      /* sem sessionStorage: recarrega mesmo assim */
    }
  }
  location.reload()
}

export const useSessao = create<SessaoState>()((set, get) => {
  /**
   * Aplica a resposta do servidor sobre quem está usando este navegador (conferência, foco,
   * batimento). Devolve `true` quando a sessão continua valendo e a tela pode seguir.
   */
  const aplicarConferencia = (r: EstadoSessao): boolean => {
    const s = get()
    if (deveRecarregar({ usuario: s.usuario, build: s.build }, r)) {
      recarregarPagina(s.build && r.build && s.build !== r.build ? 'build' : 'usuario')
      return false
    }
    if (!r.usuario) {
      if (s.estado === 'logado') set({ expirou: true })
      return false
    }
    const manterConectado = !!r.persistente
    if (r.usuario.trocarSenha) {
      // Outra aba ainda não trocou a senha, ou o administrador a redefiniu agora
      set({ usuario: r.usuario, expirou: false, manterConectado })
      return false
    }
    // Mesma pessoa e mesmo nível: atualiza o nome e fecha o "sessão terminou" (entrou de novo noutra aba)
    set({ usuario: r.usuario, expirou: false, manterConectado, ...(s.usuario?.trocarSenha ? { senhaTemporaria: '' } : {}) })
    return true
  }

  return {
    estado: 'verificando',
    usuario: null,
    semUsuarios: false,
    build: '',
    expirou: false,
    manterConectado: false,
    erro: '',
    senhaTemporaria: '',

    async verificar() {
      if (get().estado === 'erro') set({ estado: 'verificando', erro: '' })
      let r: EstadoSessao
      try {
        r = await api.sessao(true)
      } catch (e) {
        set({ estado: 'erro', erro: e instanceof Error ? e.message : 'Erro inesperado.' })
        return
      }
      const { build } = get()
      // A tela de entrada ficou aberta enquanto o servidor era atualizado
      if (build && r.build && build !== r.build) {
        recarregarPagina('build')
        return
      }
      set({
        usuario: r.usuario,
        semUsuarios: r.semUsuarios,
        build: build || r.build,
        estado: r.usuario ? 'logado' : 'anonimo',
        expirou: false,
        manterConectado: !!r.usuario && !!r.persistente,
        erro: '',
      })
    },

    async entrar(e) {
      const r = await api.entrar(e)
      const s = get()
      // O servidor ganhou uma interface nova: o cookie já está gravado, a página volta logada
      if (s.build && r.build && s.build !== r.build) {
        recarregarPagina('build')
        return
      }
      // "Sessão terminou" e entrou outra pessoa (ou o nível mudou): a tela de agora não serve mais
      if (s.estado === 'logado' && s.usuario && (s.usuario.id !== r.usuario.id || s.usuario.nivel !== r.usuario.nivel)) {
        avisarAbas('entrou')
        recarregarPagina('usuario')
        return
      }
      set({
        usuario: r.usuario,
        estado: 'logado',
        expirou: false,
        manterConectado: !!e.manterConectado,
        semUsuarios: false,
        build: s.build || r.build,
        erro: '',
        senhaTemporaria: r.usuario.trocarSenha ? e.senha : '',
      })
      avisarAbas('entrou')
    },

    async trocarSenha(e) {
      const r = await api.trocarMinhaSenha(e)
      set({ usuario: { ...r.usuario, trocarSenha: false }, senhaTemporaria: '' })
      avisarAbas('senha')
    },

    async sair() {
      try {
        await api.sair()
      } catch {
        /* sem conexão: o cookie vence sozinho; a tela recarrega do mesmo jeito */
      }
      avisarAbas('saiu')
      recarregarPagina('usuario')
    },

    sessaoEncerrada() {
      if (get().estado === 'logado') set({ expirou: true })
    },

    exigirTrocaSenha() {
      const u = get().usuario
      if (u && !u.trocarSenha) set({ usuario: { ...u, trocarSenha: true } })
    },

    async conferir() {
      let r: EstadoSessao
      try {
        r = await api.sessao()
      } catch {
        // Sem conexão não é sessão terminada: a faixa "Sem conexão" já avisa
        return true
      }
      return aplicarConferencia(r)
    },

    iniciarBatimento() {
      let interagiu = false
      let ultimoFoco = 0
      const marcar = () => {
        interagiu = true
      }
      /** Tela de entrada (ou de erro) confere de novo; com alguém logado, confere a sessão. */
      const reagir = () => {
        const { estado } = get()
        if (estado === 'logado') void get().conferir()
        else if (estado === 'anonimo' || estado === 'erro') void get().verificar()
      }
      const batida = setInterval(() => {
        if (!interagiu || document.visibilityState !== 'visible' || get().estado !== 'logado') return
        interagiu = false
        api.sessao(true).then(aplicarConferencia, () => {
          /* sem conexão: tenta na próxima batida */
        })
      }, BATIMENTO_MS)
      const aoFocar = () => {
        if (Date.now() - ultimoFoco < FOCO_MS) return
        ultimoFoco = Date.now()
        reagir()
      }
      // Sair noutra aba encerra esta também (o cookie é o mesmo): recarrega, e o usuário e os dados que
      // estavam na memória somem (sem isso, a tela de um administrador ficaria aberta por baixo do aviso)
      const aoAviso = (e: MessageEvent) => {
        if (e.data === 'saiu' && get().estado === 'logado') recarregarPagina('usuario')
        else reagir()
      }
      const ch = canalAbas()
      ch?.addEventListener('message', aoAviso)
      window.addEventListener('pointerdown', marcar, { passive: true })
      window.addEventListener('keydown', marcar, { passive: true })
      window.addEventListener('focus', aoFocar)
      return () => {
        clearInterval(batida)
        ch?.removeEventListener('message', aoAviso)
        window.removeEventListener('pointerdown', marcar)
        window.removeEventListener('keydown', marcar)
        window.removeEventListener('focus', aoFocar)
      }
    },
  }
})

/** Quem está usando este navegador (`null` enquanto ninguém entrou). */
export const useUsuarioAtual = () => useSessao((s) => s.usuario)
export const useEhAdmin = () => useSessao((s) => s.usuario?.nivel === 'ADMIN')
/** O que a tela mostra ou esconde; quem barra de fato é o servidor (mesma tabela, `shared/permissoes.ts`). */
export const usePode = (p: Permissao) => useSessao((s) => pode(s.usuario?.nivel, p))

interface Situacao {
  usuario: UsuarioSessao | null
  build: string
}

/**
 * Regra pura: recarregar a página quando muda o usuário, o nível ou o build (este só com os dois preenchidos).
 * Sessão que terminou (`novo.usuario` nulo) não recarrega: o login aparece por cima e o que foi digitado continua.
 * Mudanças de nome, login ou da troca obrigatória de senha também não recarregam.
 */
export function deveRecarregar(atual: Situacao, novo: Situacao): boolean {
  if (atual.build && novo.build && atual.build !== novo.build) return true
  if (!novo.usuario) return false
  // Alguém entrou noutra aba enquanto esta mostrava a tela de entrada
  if (!atual.usuario) return true
  return atual.usuario.id !== novo.usuario.id || atual.usuario.nivel !== novo.usuario.nivel
}
