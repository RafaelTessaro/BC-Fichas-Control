/** Erro com código HTTP e mensagem pronta para exibir ao usuário. */
export class ErroApi extends Error {
  readonly status: number
  readonly dados?: unknown

  constructor(status: number, mensagem: string, dados?: unknown) {
    super(mensagem)
    this.status = status
    this.dados = dados
  }
}

export const naoEncontrado = (oQue: string, genero: 'o' | 'a' = 'o') => new ErroApi(404, `${oQue} não encontrad${genero}.`)
