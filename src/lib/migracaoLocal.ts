// A primeira versão do sistema guardava tudo no navegador (localStorage).
// Aqui detectamos esses dados para oferecer o envio ao servidor.

const CHAVE_ANTIGA = 'bc-fichas:dados'
const CHAVE_MIGRADA = 'bc-fichas:dados-enviados-ao-servidor'

export interface DadosLocaisAntigos {
  clientes: unknown[]
  eventos: unknown[]
  config?: unknown
  proximoCodigo?: number
}

export function lerDadosLocaisAntigos(): DadosLocaisAntigos | null {
  try {
    const bruto = localStorage.getItem(CHAVE_ANTIGA)
    if (!bruto) return null
    const estado = JSON.parse(bruto)?.state
    if (!estado || !Array.isArray(estado.clientes) || !Array.isArray(estado.eventos)) return null
    if (estado.clientes.length + estado.eventos.length === 0) return null
    return estado
  } catch {
    return null
  }
}

/** Monta um backup no formato aceito pelo servidor (ele converte para o formato novo). */
export function comoBackup(d: DadosLocaisAntigos) {
  return {
    app: 'bc-fichas-control',
    versao: 1,
    exportadoEm: new Date().toISOString(),
    clientes: d.clientes,
    eventos: d.eventos,
    config: d.config,
    proximoCodigo: d.proximoCodigo ?? 1,
  }
}

/** Guarda os dados antigos com outro nome (não apaga, por segurança). */
export function marcarDadosLocaisComoEnviados() {
  try {
    const bruto = localStorage.getItem(CHAVE_ANTIGA)
    if (bruto) localStorage.setItem(CHAVE_MIGRADA, bruto)
    localStorage.removeItem(CHAVE_ANTIGA)
  } catch {
    /* sem armazenamento disponível */
  }
}
