import { create } from 'zustand'

/** Janela "Trocar minha senha": abre pelo menu do usuário, pela busca (Ctrl+K) e pela página Usuários. */
export const useMinhaSenha = create<{ aberta: boolean }>(() => ({ aberta: false }))

export const abrirMinhaSenha = () => useMinhaSenha.setState({ aberta: true })
export const fecharMinhaSenha = () => useMinhaSenha.setState({ aberta: false })
