import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Banco } from './db.ts'

const PREFIXO = 'bc-fichas_'

function carimbo(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

export interface InfoBackup {
  arquivo: string
  tamanho: number
  criadoEm: string
}

/**
 * Cópias de segurança automáticas do banco (arquivos .db completos e consistentes).
 * Para voltar uma cópia use deploy/windows/restaurar-copia.ps1 (ou, com o servidor parado,
 * apague bc-fichas.db-wal e bc-fichas.db-shm antes de copiar o arquivo por cima de bc-fichas.db).
 */
export class BackupsAutomaticos {
  private db: Banco
  private pasta: string
  private manter: number
  private timer?: ReturnType<typeof setInterval>

  constructor(db: Banco, pasta: string, manter = 30) {
    this.db = db
    this.pasta = pasta
    this.manter = manter
  }

  /** Faz uma cópia se a última diária tiver mais de 24 h e agenda a verificação a cada hora. */
  iniciar() {
    this.verificarDiario()
    this.timer = setInterval(() => this.verificarDiario(), 60 * 60 * 1000)
    this.timer.unref?.()
  }

  parar() {
    if (this.timer) clearInterval(this.timer)
  }

  listar(): InfoBackup[] {
    if (!existsSync(this.pasta)) return []
    return readdirSync(this.pasta)
      .filter((f) => f.startsWith(PREFIXO) && f.endsWith('.db'))
      .map((arquivo) => {
        const st = statSync(join(this.pasta, arquivo))
        return { arquivo, tamanho: st.size, criadoEm: st.mtime.toISOString() }
      })
      .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  }

  /** Grava uma cópia consistente do banco (mesmo com usuários usando o sistema). */
  copiar(motivo: 'diario' | 'antes-restaurar' | 'antes-limpar' | 'manual'): string {
    mkdirSync(this.pasta, { recursive: true })
    // Duas cópias no mesmo segundo não podem colidir (o VACUUM INTO falha se o arquivo existir)
    let arquivo = join(this.pasta, `${PREFIXO}${carimbo()}_${motivo}.db`)
    for (let n = 2; existsSync(arquivo); n++) arquivo = join(this.pasta, `${PREFIXO}${carimbo()}-${n}_${motivo}.db`)
    const sql = arquivo.replace(/'/g, "''")
    this.db.exec(`VACUUM INTO '${sql}'`)
    this.limparAntigos()
    return arquivo
  }

  private verificarDiario() {
    try {
      const ultimo = this.listar().find((b) => b.arquivo.endsWith('_diario.db'))
      if (!ultimo || Date.now() - Date.parse(ultimo.criadoEm) > 24 * 60 * 60 * 1000) this.copiar('diario')
    } catch (e) {
      console.error('[backup] falha ao gerar cópia automática:', e)
    }
  }

  private limparAntigos() {
    const todos = this.listar()
    // Mantém as N mais recentes de cada motivo
    const porMotivo = new Map<string, InfoBackup[]>()
    for (const b of todos) {
      const motivo = b.arquivo.replace(/^.*_([a-z-]+)\.db$/, '$1')
      porMotivo.set(motivo, [...(porMotivo.get(motivo) ?? []), b])
    }
    for (const lista of porMotivo.values()) {
      for (const velho of lista.slice(this.manter)) rmSync(join(this.pasta, velho.arquivo), { force: true })
    }
  }
}
