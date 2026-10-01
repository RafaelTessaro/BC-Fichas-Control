import { api } from './api'

/** Situação da integração com o Google Agenda (GET /api/google/status). */
export interface StatusGoogle {
  /** Há uma chave de conta de serviço enviada. */
  configurado: boolean
  ativo: boolean
  /** E-mail da conta de serviço (com quem a agenda deve ser compartilhada). */
  contaServico: string
  projeto: string
  calendarId: string
  incluirValores: boolean
  resumo: { ok: number; pendentes: number; erros: number }
  /** ISO; vazio se nunca sincronizou. */
  ultimaSincronizacao: string
  ultimoErro: string
  ultimoErroEm: string
}

export interface ConfigGoogle {
  ativo: boolean
  calendarId: string
  incluirValores: boolean
}

export const googleAgenda = {
  status: () => api.get<StatusGoogle>('/api/google/status'),
  salvarConfig: (config: Partial<ConfigGoogle>) => api.enviar<StatusGoogle>('PUT', '/api/google/config', config),
  /** Envia o conteúdo do arquivo JSON da chave da conta de serviço. */
  enviarCredenciais: (json: string) => api.enviar<StatusGoogle>('POST', '/api/google/credenciais', { json }),
  removerCredenciais: () => api.enviar<StatusGoogle>('DELETE', '/api/google/credenciais'),
  testar: (calendarId?: string) =>
    api.enviar<{ ok: true; agenda: string; fusoHorario?: string }>('POST', '/api/google/testar', { calendarId }, 40_000),
  sincronizar: () => api.enviar<StatusGoogle & { marcados: number }>('POST', '/api/google/sincronizar'),
}
