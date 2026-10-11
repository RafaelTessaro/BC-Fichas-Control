// Limite de tentativas de entrada (e da senha atual na troca da própria senha), em memória.
// Reiniciar o serviço zera os contadores, o que é aceitável: o objetivo é tornar inviável testar
// senhas em série pela rede, não guardar histórico (o histórico fica no registro de atividades).
//
//   par:<login>|<ip>   5 falhas seguidas → espera de 30 s, que dobra a cada nova falha (até 15 min); zera no acerto
//   ip:<ip>            20 falhas em 15 min → 15 min sem entrar a partir desse IP; não zera no acerto
//   login:<login>      50 falhas em 1 h, de qualquer IP → 15 min sem entrar; não vale para o próprio servidor
//   senha:<usuarioId>  senha atual errada na troca da própria senha: mesma regra do par

const SEGUNDO = 1000
const MINUTO = 60 * SEGUNDO
const HORA = 60 * MINUTO

type Tipo = 'par' | 'ip' | 'login' | 'senha'

interface RegraSeguidas {
  modo: 'seguidas'
  /** Falhas seguidas antes da primeira espera. */
  livres: number
  esperaInicialMs: number
  esperaMaximaMs: number
  /** Sem falhar por este tempo (e sem bloqueio em curso), o contador recomeça. */
  esquecerMs: number
}
interface RegraJanela {
  modo: 'janela'
  falhas: number
  janelaMs: number
  bloqueioMs: number
}

export const REGRAS_TENTATIVAS: Record<Tipo, RegraSeguidas | RegraJanela> = {
  par: { modo: 'seguidas', livres: 5, esperaInicialMs: 30 * SEGUNDO, esperaMaximaMs: 15 * MINUTO, esquecerMs: HORA },
  senha: { modo: 'seguidas', livres: 5, esperaInicialMs: 30 * SEGUNDO, esperaMaximaMs: 15 * MINUTO, esquecerMs: HORA },
  ip: { modo: 'janela', falhas: 20, janelaMs: 15 * MINUTO, bloqueioMs: 15 * MINUTO },
  login: { modo: 'janela', falhas: 50, janelaMs: HORA, bloqueioMs: 15 * MINUTO },
}

/** Tipos que a redefinição da senha destrava (o bloqueio por IP continua). */
const DESTRAVA_COM_SENHA_NOVA: ReadonlySet<Tipo> = new Set(['par', 'login', 'senha'])

/** Entrada: login já normalizado (exista ou não) e IP. Troca da própria senha: o id do usuário. */
export type ChavesTentativa = { login: string; ip: string; loopback: boolean } | { trocaSenhaDe: string }

interface Registro {
  tipo: Tipo
  /** Falhas seguidas (modo "seguidas"). */
  falhas: number
  /** Horários das falhas dentro da janela (modo "janela"). */
  horarios: number[]
  /** Primeira falha registrada (ou início do bloqueio em curso). */
  inicio: number
  ultima: number
  bloqueadoDesde: number
  bloqueadoAte: number
}

export class LimiteTentativas {
  private registros = new Map<string, Registro>()
  private agora: () => number

  constructor(agora: () => number = Date.now) {
    this.agora = agora
  }

  /**
   * Segundos que ainda faltam para poder tentar de novo, ou `null` se está liberado.
   * `desbloqueadoEm` (epoch ms): quando a senha da conta foi trocada ou redefinida; bloqueios e
   * falhas anteriores a isso (nas chaves do par, do login e da troca de senha) são esquecidos.
   */
  espera(chaves: ChavesTentativa, desbloqueadoEm?: number): number | null {
    return this.bloqueio(chaves, desbloqueadoEm)?.segundos ?? null
  }

  /**
   * Como `espera`, dizendo também de qual regra é a espera mais longa (`ip`: o computador errou muitas
   * vezes, com qualquer usuário; esse bloqueio não acaba com a senha redefinida).
   */
  bloqueio(chaves: ChavesTentativa, desbloqueadoEm?: number): { segundos: number; tipo: Tipo } | null {
    const agora = this.agora()
    let maior = 0
    let tipoMaior: Tipo = 'par'
    for (const [chave, tipo] of this.chaves(chaves)) {
      const r = this.vigente(chave, agora)
      if (!r) continue
      if (desbloqueadoEm !== undefined && DESTRAVA_COM_SENHA_NOVA.has(tipo) && desbloqueadoEm > r.inicio) {
        this.registros.delete(chave)
        continue
      }
      if (r.bloqueadoAte - agora > maior) {
        maior = r.bloqueadoAte - agora
        tipoMaior = tipo
      }
    }
    return maior > 0 ? { segundos: Math.ceil(maior / SEGUNDO), tipo: tipoMaior } : null
  }

  /** Registra uma falha. `bloqueouAgora`: um bloqueio começou com esta falha (para registrar uma vez só). */
  falhou(chaves: ChavesTentativa): { bloqueouAgora: boolean; motivos: Tipo[] } {
    const agora = this.agora()
    const motivos: Tipo[] = []
    if (this.registros.size > 10_000) this.limpar()
    for (const [chave, tipo] of this.chaves(chaves)) {
      const regra = REGRAS_TENTATIVAS[tipo]
      let r = this.vigente(chave, agora)
      if (!r) {
        r = { tipo, falhas: 0, horarios: [], inicio: agora, ultima: agora, bloqueadoDesde: 0, bloqueadoAte: 0 }
        this.registros.set(chave, r)
      }
      const jaBloqueado = r.bloqueadoAte > agora
      r.ultima = agora
      if (regra.modo === 'seguidas') {
        r.falhas++
        if (r.falhas >= regra.livres) {
          const espera = Math.min(regra.esperaInicialMs * 2 ** (r.falhas - regra.livres), regra.esperaMaximaMs)
          r.bloqueadoAte = Math.max(r.bloqueadoAte, agora + espera)
          if (!jaBloqueado) {
            r.bloqueadoDesde = agora
            motivos.push(tipo)
          }
        }
      } else {
        r.horarios = r.horarios.filter((t) => agora - t < regra.janelaMs)
        r.horarios.push(agora)
        if (r.horarios.length >= regra.falhas && !jaBloqueado) {
          r.bloqueadoDesde = agora
          r.bloqueadoAte = agora + regra.bloqueioMs
          r.horarios = []
          motivos.push(tipo)
        }
      }
    }
    return { bloqueouAgora: motivos.length > 0, motivos }
  }

  /** Acerto: zera as falhas seguidas (par e troca de senha). Os tetos por IP e por login continuam. */
  acertou(chaves: ChavesTentativa) {
    for (const [chave, tipo] of this.chaves(chaves)) if (REGRAS_TENTATIVAS[tipo].modo === 'seguidas') this.registros.delete(chave)
  }

  /** Esquece o que já venceu (chamado pela varredura a cada minuto). */
  limpar() {
    const agora = this.agora()
    for (const [chave] of this.registros) this.vigente(chave, agora)
  }

  /** Quantos registros estão em memória (para os testes). */
  get tamanho() {
    return this.registros.size
  }

  /** O registro, se ainda conta; um vencido é apagado. */
  private vigente(chave: string, agora: number): Registro | undefined {
    const r = this.registros.get(chave)
    if (!r) return undefined
    if (r.bloqueadoAte > agora) return r
    const regra = REGRAS_TENTATIVAS[r.tipo]
    const vencido =
      regra.modo === 'seguidas'
        ? agora - r.ultima >= regra.esquecerMs
        : r.horarios.every((t) => agora - t >= regra.janelaMs) && agora - r.ultima >= regra.janelaMs
    if (vencido) {
      this.registros.delete(chave)
      return undefined
    }
    return r
  }

  private chaves(c: ChavesTentativa): Array<[string, Tipo]> {
    if ('trocaSenhaDe' in c) return [[`senha:${c.trocaSenhaDe}`, 'senha']]
    const lista: Array<[string, Tipo]> = [
      [`par:${c.login}|${c.ip}`, 'par'],
      [`ip:${c.ip}`, 'ip'],
    ]
    // O teto por login não vale para quem entra pelo próprio servidor: um ataque pela rede não
    // impede o dono de entrar no computador do servidor
    if (!c.loopback) lista.push([`login:${c.login}`, 'login'])
    return lista
  }
}
