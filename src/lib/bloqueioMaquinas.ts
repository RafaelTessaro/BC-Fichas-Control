// Máquinas que não podem ir para um evento (em manutenção ou já em outro evento nas mesmas
// datas), com o motivo em texto. Usado no cartão "Máquinas enviadas" e na conferência antes de
// salvar. Segue as regras do servidor (verificarMaquinasLivres em server/repositorio.ts).

import { datasOcupadas, maquinasOcupadas, type EventoOcupacao } from '#shared/maquinas.ts'
import type { Cliente, DiaEvento, Evento, Maquina } from '#shared/tipos.ts'
import { codigoEvento } from './format'

export type MotivoBloqueio = 'DESATIVADA' | 'MANUTENCAO' | 'OCUPADA'

export interface Bloqueio {
  motivo: MotivoBloqueio
  /** Outros eventos com a máquina em alguma das mesmas datas (só no motivo OCUPADA). */
  eventos: Evento[]
  /** Motivo curto, para o balão do chip: "Em manutenção", "No evento #0012 Festa — Cliente, em 11/10". */
  texto: string
}

/** "11/10" a partir de "2026-10-11". */
const dataCurtinha = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

/** "11/10", "11/10 e 12/10", "11/10, 12/10 e 13/10", "11/10, 12/10, 13/10 e mais 2 dias". */
export function listaDatas(datas: string[]): string {
  const curtas = [...new Set(datas)].sort().map(dataCurtinha)
  if (curtas.length <= 1) return curtas.join('')
  if (curtas.length > 4) return `${curtas.slice(0, 3).join(', ')} e mais ${curtas.length - 3} dias`
  return `${curtas.slice(0, -1).join(', ')} e ${curtas[curtas.length - 1]}`
}

/** Datas ocupadas pelo outro evento (com período corrido, também as do meio) que também estão em `datas`. */
export const datasEmComum = (outro: EventoOcupacao, datas: Set<string>) => datasOcupadas(outro).filter((d) => datas.has(d))

/** "#0012 Festa X — Cliente Y" (sem o cliente se ele foi removido). */
export function nomeEvento(e: Pick<Evento, 'codigo' | 'nome' | 'clienteId'>, clientes: Map<string, Pick<Cliente, 'nome'>>) {
  const cliente = clientes.get(e.clienteId)?.nome
  return `${codigoEvento(e.codigo)} ${e.nome}${cliente ? ` — ${cliente}` : ''}`
}

/**
 * Motivo de cada máquina que não pode ser marcada no evento, considerando as datas do formulário:
 * desativada; em manutenção (se o evento tem algum dia de hoje em diante); ou em outro evento
 * não cancelado em alguma das mesmas datas. Evento cancelado não bloqueia nada.
 */
export function bloqueiosMaquinas({
  maquinas,
  eventos,
  clientes,
  dias,
  periodoCorrido,
  eventoId,
  cancelado,
  hoje,
}: {
  maquinas: Maquina[]
  eventos: Evento[]
  clientes: Cliente[]
  dias: EventoOcupacao['dias']
  /** As máquinas ficam com o cliente entre os dias (contam todos os dias do período). */
  periodoCorrido?: boolean
  /** Evento em edição (não conta como conflito com ele mesmo). */
  eventoId?: string
  cancelado?: boolean
  hoje: string
}): Map<string, Bloqueio> {
  const mapa = new Map<string, Bloqueio>()
  if (cancelado) return mapa
  const datas = new Set(datasOcupadas({ dias, periodoCorrido }))
  const temFuturo = [...datas].some((d) => d >= hoje)
  const ocupadas = maquinasOcupadas([...datas], eventos, eventoId)
  const porId = new Map(clientes.map((c) => [c.id, c]))
  for (const m of maquinas) {
    if (m.status === 'DESATIVADA') {
      mapa.set(m.id, { motivo: 'DESATIVADA', eventos: [], texto: 'Desativada' })
    } else if (m.status === 'MANUTENCAO' && temFuturo) {
      mapa.set(m.id, { motivo: 'MANUTENCAO', eventos: [], texto: 'Em manutenção' })
    } else {
      const outros = ocupadas.get(m.id)
      if (outros?.length) mapa.set(m.id, bloqueioOcupada(outros, datas, porId))
    }
  }
  return mapa
}

/** Bloqueio por outros eventos, citando só as datas de `datas` que cada um ocupa. */
function bloqueioOcupada(outros: Evento[], datas: Set<string>, clientes: Map<string, Pick<Cliente, 'nome'>>): Bloqueio {
  const partes = outros.map((e) => `${nomeEvento(e, clientes)}, em ${listaDatas(datasEmComum(e, datas))}`)
  return {
    motivo: 'OCUPADA',
    eventos: outros,
    texto: `${outros.length > 1 ? 'Nos eventos' : 'No evento'} ${partes.join('; ')}`,
  }
}

/**
 * Máquinas marcadas que precisam ser trocadas antes de salvar, com o motivo — a MESMA regra do
 * servidor (verificarMaquinasLivres em server/repositorio.ts):
 * - máquina acrescentada agora: não pode estar desativada, nem em manutenção (se o evento tem algum
 *   dia de hoje em diante), nem em outro evento em alguma das datas;
 * - máquina que já estava gravada: só é cobrada nos dias acrescentados (conflito nesses dias, ou
 *   manutenção/desativação se algum desses dias é de hoje em diante). O que já foi gravado — por
 *   exemplo, uma máquina que entrou em manutenção durante o evento — não trava a edição.
 * Desativada que já estava no evento continua aceita num evento que já passou (é histórico).
 */
export function trocasMaquinas({
  selecionadas,
  maquinas,
  eventos,
  clientes = [],
  dias,
  periodoCorrido,
  eventoId,
  salvo,
  cancelado,
  hoje,
}: {
  selecionadas: string[]
  maquinas: Pick<Maquina, 'id' | 'status'>[]
  eventos: Evento[]
  /** Para o nome do cliente no texto do motivo. */
  clientes?: Cliente[]
  dias: EventoOcupacao['dias']
  /** As máquinas ficam com o cliente entre os dias (contam todos os dias do período). */
  periodoCorrido?: boolean
  /** Evento em edição (não conta como conflito com ele mesmo). */
  eventoId?: string
  /** Versão gravada do evento em edição (nada num evento novo). */
  salvo?: Pick<Evento, 'maquinasIds' | 'status'> & EventoOcupacao
  /** Evento que vai ser salvo como cancelado: nada é cobrado. */
  cancelado?: boolean
  hoje: string
}): Map<string, Bloqueio> {
  const mapa = new Map<string, Bloqueio>()
  if (cancelado) return mapa
  const valeSalvo = salvo && salvo.status !== 'CANCELADO'
  const antes = new Set(valeSalvo ? salvo.maquinasIds : [])
  const gravadas = new Set(salvo?.maquinasIds ?? [])
  // Dias ocupados (com período corrido, também os do meio), dos dois lados
  const diasAntes = new Set(valeSalvo ? datasOcupadas(salvo) : [])
  const datas = new Set(datasOcupadas({ dias, periodoCorrido }))
  const diasNovos = new Set([...datas].filter((d) => !diasAntes.has(d)))
  const temFuturo = [...datas].some((d) => d >= hoje)
  const novoFuturo = [...diasNovos].some((d) => d >= hoje)
  const status = new Map(maquinas.map((m) => [m.id, m.status]))
  const ocupadas = maquinasOcupadas([...datas], eventos, eventoId)
  const porId = new Map(clientes.map((c) => [c.id, c]))
  for (const id of selecionadas) {
    const nova = !antes.has(id)
    if (!nova && !diasNovos.size) continue
    const futuro = nova ? temFuturo : novoFuturo
    const st = status.get(id)
    if (st === 'DESATIVADA' && (futuro || !gravadas.has(id))) {
      mapa.set(id, { motivo: 'DESATIVADA', eventos: [], texto: 'Desativada' })
    } else if (st === 'MANUTENCAO' && futuro) {
      mapa.set(id, { motivo: 'MANUTENCAO', eventos: [], texto: 'Em manutenção' })
    } else {
      // A que já estava gravada só conta nos dias acrescentados (e o texto cita só esses dias)
      const alvo = nova ? datas : diasNovos
      const outros = (ocupadas.get(id) ?? []).filter((e) => e.dias.some((d) => alvo.has(d.data)))
      if (outros.length) mapa.set(id, bloqueioOcupada(outros, alvo, porId))
    }
  }
  return mapa
}

/** Só os ids de `trocasMaquinas`. */
export const maquinasParaTrocar = (...args: Parameters<typeof trocasMaquinas>) => [...trocasMaquinas(...args).keys()]

/** "P-01", "P-01 e P-02", "P-01, P-02 e G-06". */
export const juntarNomes = (nomes: string[]) =>
  nomes.length <= 1 ? nomes.join('') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`

export interface GrupoTroca {
  chave: string
  motivo: MotivoBloqueio
  /** Identificações das máquinas com o mesmo motivo. */
  maquinas: string[]
  /** O que vem depois dos nomes: "já estão no evento #0012 Festa — Cliente, em 11/10". */
  frase: string
}

/** Junta as máquinas com o mesmo motivo, para avisar uma vez só por evento (e uma pela manutenção). */
export function agruparTrocas(itens: Array<{ identificacao: string; bloqueio: Bloqueio }>): GrupoTroca[] {
  const grupos = new Map<string, { b: Bloqueio; maquinas: string[] }>()
  for (const { identificacao, bloqueio: b } of itens) {
    const chave = `${b.motivo}|${b.texto}`
    const g = grupos.get(chave) ?? { b, maquinas: [] }
    g.maquinas.push(identificacao)
    grupos.set(chave, g)
  }
  return [...grupos].map(([chave, { b, maquinas }]) => {
    const varias = maquinas.length > 1
    const frase =
      b.motivo === 'DESATIVADA'
        ? varias
          ? 'estão desativadas'
          : 'está desativada'
        : b.motivo === 'MANUTENCAO'
          ? `${varias ? 'estão' : 'está'} em manutenção`
          : `${varias ? 'já estão' : 'já está'} ${b.texto.charAt(0).toLowerCase()}${b.texto.slice(1)}`
    return { chave, motivo: b.motivo, maquinas, frase }
  })
}

/** Frase para avisos: "P-03 já está no evento #0012 Festa — Cliente, em 11/10". */
export function fraseBloqueio(identificacao: string, b: Bloqueio) {
  return `${identificacao} ${agruparTrocas([{ identificacao, bloqueio: b }])[0].frase}`
}

/** Texto para o aviso de salvar: "P-01 e P-02 já estão no evento …, em 02/10; G-04 está em manutenção". */
export const resumoTrocas = (itens: Array<{ identificacao: string; bloqueio: Bloqueio }>) =>
  agruparTrocas(itens)
    .map((g) => `${juntarNomes(g.maquinas)} ${g.frase}`)
    .join('; ')

export interface GrupoBloqueio {
  chave: string
  /** "Em manutenção" ou "#0012 Festa — Cliente, em 11/10". */
  titulo: string
  motivo: Exclude<MotivoBloqueio, 'DESATIVADA'>
  maquinas: Maquina[]
}

/**
 * Agrupa as máquinas bloqueadas para explicar o motivo de forma compacta: uma linha por evento
 * que as ocupa e uma para as que estão em manutenção (as desativadas ficam escondidas).
 */
export function agruparBloqueios(
  maquinas: Maquina[],
  bloqueios: Map<string, Bloqueio>,
  clientes: Cliente[],
  dias: Pick<DiaEvento, 'data'>[],
): GrupoBloqueio[] {
  const porId = new Map(clientes.map((c) => [c.id, c]))
  const datas = new Set(dias.map((d) => d.data))
  const grupos = new Map<string, GrupoBloqueio>()
  const manutencao: Maquina[] = []
  for (const m of maquinas) {
    const b = bloqueios.get(m.id)
    if (!b || b.motivo === 'DESATIVADA') continue
    if (b.motivo === 'MANUTENCAO') {
      manutencao.push(m)
      continue
    }
    for (const e of b.eventos) {
      const g = grupos.get(e.id) ?? {
        chave: e.id,
        titulo: `${nomeEvento(e, porId)}, em ${listaDatas(datasEmComum(e, datas))}`,
        motivo: 'OCUPADA' as const,
        maquinas: [],
      }
      g.maquinas.push(m)
      grupos.set(e.id, g)
    }
  }
  const lista = [...grupos.values()]
  if (manutencao.length) lista.push({ chave: 'manutencao', titulo: 'Em manutenção', motivo: 'MANUTENCAO', maquinas: manutencao })
  return lista
}
