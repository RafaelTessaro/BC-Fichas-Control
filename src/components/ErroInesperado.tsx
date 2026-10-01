import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Se alguma tela quebrar por um erro inesperado, mostra uma mensagem com opção de
 * recarregar em vez de deixar a página em branco.
 */
export class ErroInesperado extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null }

  static getDerivedStateFromError(erro: Error) {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('[erro na tela]', erro, info.componentStack)
  }

  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-8 text-center shadow-card">
          <h1 className="text-lg font-semibold text-ink">Algo deu errado nesta tela</h1>
          <p className="mt-2 text-sm text-muted">
            Os dados salvos no servidor não foram afetados. Recarregue a página para continuar.
          </p>
          <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-left font-mono text-xs break-words text-muted">
            {this.state.erro.message}
          </p>
          <button
            type="button"
            onClick={() => location.reload()}
            className="mt-6 h-10 w-full cursor-pointer rounded-xl bg-brand text-sm font-medium text-white hover:bg-brand-hover"
          >
            Recarregar
          </button>
        </div>
      </div>
    )
  }
}
