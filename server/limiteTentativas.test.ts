import { describe, expect, it } from 'vitest'
import { LimiteTentativas } from './limiteTentativas.ts'

const MINUTO = 60_000

function relogio(inicio = 1_700_000_000_000) {
  let agora = inicio
  return { agora: () => agora, avancar: (ms: number) => (agora += ms) }
}

describe('limite de tentativas', () => {
  it('par login+IP: 5 falhas seguidas → 30 s, dobrando a cada nova falha até 15 min', () => {
    const r = relogio()
    const l = new LimiteTentativas(r.agora)
    const c = { login: 'maria', ip: '192.168.0.20', loopback: false }
    for (let i = 1; i <= 4; i++) {
      expect(l.falhou(c).bloqueouAgora).toBe(false)
      expect(l.espera(c)).toBeNull()
    }
    expect(l.falhou(c)).toEqual({ bloqueouAgora: true, motivos: ['par'] })
    expect(l.espera(c)).toBe(30)
    r.avancar(30_000)
    expect(l.espera(c)).toBeNull()
    expect(l.falhou(c).bloqueouAgora).toBe(true)
    expect(l.espera(c)).toBe(60)
    for (let i = 0; i < 10; i++) {
      r.avancar(16 * MINUTO)
      l.falhou(c)
    }
    expect(l.espera(c)).toBe(15 * 60) // teto
    // Outro IP e outro login não são afetados pelo par
    expect(l.espera({ ...c, ip: '192.168.0.21' })).toBeNull()
  })

  it('o acerto zera o par, mas não o teto por IP', () => {
    const l = new LimiteTentativas(relogio().agora)
    const c = { login: 'maria', ip: '10.0.0.5', loopback: false }
    for (let i = 0; i < 4; i++) l.falhou(c)
    l.acertou(c)
    for (let i = 0; i < 4; i++) l.falhou(c)
    expect(l.espera(c)).toBeNull()
    // 20 falhas do mesmo IP em 15 min (logins diferentes) bloqueiam o IP
    for (let i = 0; i < 12; i++) l.falhou({ login: `outro${i % 4}`, ip: '10.0.0.5', loopback: false })
    expect(l.espera({ login: 'qualquer', ip: '10.0.0.5', loopback: false })).toBe(15 * 60)
    l.acertou(c)
    expect(l.espera({ login: 'qualquer', ip: '10.0.0.5', loopback: false })).toBe(15 * 60)
  })

  it('teto por login: 50 falhas em 1 h de vários IPs; não vale pelo próprio servidor', () => {
    const l = new LimiteTentativas(relogio().agora)
    let ultimo = { bloqueouAgora: false }
    for (let i = 0; i < 50; i++) ultimo = l.falhou({ login: 'admin', ip: `10.0.${Math.floor(i / 4)}.1`, loopback: false })
    expect(ultimo.bloqueouAgora).toBe(true)
    expect(l.espera({ login: 'admin', ip: '10.9.9.9', loopback: false })).toBe(15 * 60)
    expect(l.espera({ login: 'admin', ip: '127.0.0.1', loopback: true })).toBeNull()
    // Falhas pelo próprio servidor não contam no teto por login
    const l2 = new LimiteTentativas(relogio().agora)
    for (let i = 0; i < 60; i++) l2.falhou({ login: 'admin', ip: '127.0.0.1', loopback: true })
    expect(l2.espera({ login: 'admin', ip: '10.0.0.1', loopback: false })).toBeNull()
  })

  it('senha redefinida depois do início destrava par e login (o IP continua)', () => {
    const r = relogio()
    const l = new LimiteTentativas(r.agora)
    const c = { login: 'maria', ip: '10.0.0.7', loopback: false }
    for (let i = 0; i < 5; i++) l.falhou(c)
    expect(l.espera(c)).toBe(30)
    const inicio = r.agora()
    r.avancar(1000)
    expect(l.espera(c, inicio - 5000)).toBe(29) // senha trocada antes: continua bloqueado
    expect(l.espera(c, r.agora())).toBeNull() // senha redefinida agora: destrava e zera
    l.falhou(c)
    expect(l.espera(c)).toBeNull() // contagem recomeçou
  })

  it('bloqueio diz de qual regra é a espera mais longa', () => {
    const r = relogio()
    const l = new LimiteTentativas(r.agora)
    const c = { login: 'maria', ip: '10.0.0.8', loopback: false }
    for (let i = 0; i < 5; i++) l.falhou(c)
    expect(l.bloqueio(c)).toEqual({ segundos: 30, tipo: 'par' })
    for (let i = 0; i < 15; i++) l.falhou({ login: `outro${i % 3}`, ip: '10.0.0.8', loopback: false })
    expect(l.bloqueio(c)).toEqual({ segundos: 15 * 60, tipo: 'ip' })
    // Senha redefinida: o par sai, o computador continua
    expect(l.bloqueio(c, r.agora() + 1)).toEqual({ segundos: 15 * 60, tipo: 'ip' })
    expect(l.bloqueio({ ...c, ip: '10.0.0.9' })).toBeNull()
  })

  it('troca da própria senha: mesma regra do par, por usuário', () => {
    const l = new LimiteTentativas(relogio().agora)
    for (let i = 0; i < 4; i++) l.falhou({ trocaSenhaDe: 'u1' })
    expect(l.espera({ trocaSenhaDe: 'u1' })).toBeNull()
    expect(l.falhou({ trocaSenhaDe: 'u1' })).toEqual({ bloqueouAgora: true, motivos: ['senha'] })
    expect(l.espera({ trocaSenhaDe: 'u1' })).toBe(30)
    expect(l.espera({ trocaSenhaDe: 'u2' })).toBeNull()
  })

  it('a limpeza esquece o que venceu; o bloqueio começa uma vez só', () => {
    const r = relogio()
    const l = new LimiteTentativas(r.agora)
    for (let i = 0; i < 19; i++) expect(l.falhou({ login: `x${i}`, ip: '10.1.1.1', loopback: false }).bloqueouAgora).toBe(false)
    expect(l.falhou({ login: 'x', ip: '10.1.1.1', loopback: false }).motivos).toEqual(['ip'])
    expect(l.tamanho).toBeGreaterThan(0)
    r.avancar(2 * 60 * MINUTO)
    l.limpar()
    expect(l.tamanho).toBe(0)
  })
})
