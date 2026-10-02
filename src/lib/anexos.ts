// Arquivos anexados aos eventos: classificação para mostrar na tela, tamanhos e envio em fila.

import type { Anexo } from '#shared/tipos.ts'

export type ClasseAnexo = 'imagem' | 'pdf' | 'texto' | 'outro'

/** Como o arquivo pode ser visto: imagem e PDF abrem na tela; texto também; o resto só baixando. */
export function classeAnexo(a: Pick<Anexo, 'tipo' | 'nome'>): ClasseAnexo {
  const tipo = a.tipo.toLowerCase()
  if (/^image\/(png|jpeg|gif|webp|bmp)$/.test(tipo)) return 'imagem'
  if (tipo === 'application/pdf') return 'pdf'
  if (tipo === 'text/plain') return 'texto'
  return 'outro'
}

/** "850 KB", "1,2 MB" */
export function tamanhoLegivel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

/** Arquivos do evento, na ordem em que foram enviados. */
export const anexosDoEvento = (anexos: Anexo[], eventoId: string) =>
  anexos.filter((a) => a.eventoId === eventoId).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))

/**
 * Envia, um de cada vez, os arquivos escolhidos antes de o evento existir (formulário de evento
 * novo). Devolve os que falharam, com o motivo, para avisar o usuário.
 */
export async function enviarPendentes(
  eventoId: string,
  arquivos: File[],
  enviar: (eventoId: string, arquivo: File, nome: string) => Promise<unknown>,
): Promise<Array<{ nome: string; motivo: string }>> {
  const falhas: Array<{ nome: string; motivo: string }> = []
  for (const arquivo of arquivos) {
    try {
      await enviar(eventoId, arquivo, arquivo.name)
    } catch (e) {
      falhas.push({ nome: arquivo.name, motivo: (e as Error).message })
    }
  }
  return falhas
}
