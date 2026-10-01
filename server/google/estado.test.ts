import { describe, expect, it } from 'vitest'
import { abrirBanco } from '../db.ts'
import { antigasDaLinha, EstadoGoogle, temCopias } from './estado.ts'

describe('estado da sincronização', () => {
  it('acrescenta as colunas novas a um banco antigo (ex.: cópia .db restaurada)', () => {
    const db = abrirBanco(':memory:')
    db.exec(`
      CREATE TABLE google_sync (
        evento_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pendente', calendar_id TEXT NOT NULL DEFAULT '',
        ids TEXT NOT NULL DEFAULT '[]', hash TEXT NOT NULL DEFAULT '', erro TEXT NOT NULL DEFAULT '',
        tentativas INTEGER NOT NULL DEFAULT 0, proxima_tentativa INTEGER NOT NULL DEFAULT 0,
        sincronizado_em TEXT NOT NULL DEFAULT '', excluido INTEGER NOT NULL DEFAULT 0, geracao INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO google_sync (evento_id, status, ids, hash) VALUES ('e1', 'ok', '["bcf1"]', 'abc');
    `)
    const estado = new EstadoGoogle(db)
    expect(estado.obter('e1')).toMatchObject({ status: 'ok', antigas: '[]', erro_geral: 0, hash: 'abc' })
    new EstadoGoogle(db) // abrir de novo não falha
    db.close()
  })

  it('progresso parcial invalida o hash; erros gerais podem ser antecipados', () => {
    const db = abrirBanco(':memory:')
    const estado = new EstadoGoogle(db)
    estado.marcarPendente('e1')
    const l = estado.obter('e1')!
    estado.concluir(l, { calendarId: 'ag', ids: ['bcf1'], hash: 'h1', em: '' })
    estado.marcarPendente('e1')
    estado.gravarProgresso('e1', 'nova', ['bcf1'], [{ calendarId: 'ag', ids: ['bcf1'] }])
    const parcial = estado.obter('e1')!
    expect(parcial).toMatchObject({ hash: '', calendar_id: 'nova' })
    expect(antigasDaLinha(parcial)).toEqual([{ calendarId: 'ag', ids: ['bcf1'] }])
    expect(temCopias({ ids: '[]', antigas: parcial.antigas })).toBe(true)

    estado.falhar(parcial, 'Sem internet', 10_000, true)
    estado.marcarPendente('e2')
    estado.falhar(estado.obter('e2')!, 'Recusado', 10_000, false)
    expect(estado.anteciparErrosGerais(0)).toBe(1)
    expect(estado.obter('e1')?.proxima_tentativa).toBe(0)
    expect(estado.obter('e2')?.proxima_tentativa).toBe(10_000)
    db.close()
  })
})
