// Máquinas que não podem ir para um evento (em manutenção ou já em outro evento nas mesmas
// datas), com o motivo em texto. Usado no cartão "Máquinas enviadas" e na conferência antes de
// salvar. Segue as regras do servidor (verificarMaquinasLivres em server/repositorio.ts).

import { maquinasOcupadas } from '#shared/maquinas.ts'
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

/** Datas do outro evento que também estão em `datas`. */
export const datasEmComum = (outro: Pick<Evento, 'dias'>, datas: Set<string>) =>
  outro.dias.map((d) => d.data).filter((d) => datas.has(d))

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
  eventoId,
  cancelado,
  hoje,
}: {
  maquinas: Maquina[]
  eventos: Evento[]
  clientes: Cliente[]
  dias: Pick<DiaEvento, 'data'>[]
  /** Evento em edição (não conta como conflito com ele mesmo). */
  eventoId?: string
  cancelado?: boolean
  hoje: string
}): Map<string, Bloqueio> {
  const mapa = new Map<string, Bloqueio>()
  if (cancelado) return mapa
  const datas = new Set(dias.map((d) => d.data).filter(Boolean))
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
      if (!outros?.length) continue
      const partes = outros.map((e) => `${nomeEvento(e, porId)}, em ${listaDatas(datasEmComum(e, datas))}`)
      mapa.set(m.id, {
        motivo: 'OCUPADA',
        eventos: outros,
        texto: `${outros.length > 1 ? 'Nos eventos' : 'No evento'} ${partes.join('; ')}`,
      })
    }
  }
  return mapa
}

/**
 * Máquinas marcadas que precisam ser trocadas antes de salvar. Sempre as acrescentadas agora e as
 * que estariam em outro evento num dia acrescentado (o servidor recusaria). As que já estavam
 * gravadas só se o evento ainda vai acontecer: num evento que já passou, o histórico não trava a edição.
 */
export function maquinasParaTrocar({
  selecionadas,
  bloqueios,
  dias,
  salvo,
  hoje,
}: {
  selecionadas: string[]
  bloqueios: Map<string, Bloqueio>
  dias: Pick<DiaEvento, 'data'>[]
  /** Versão gravada do evento em edição (nada num evento novo). */
  salvo?: Pick<Evento, 'maquinasIds' | 'dias' | 'status'>
  hoje: string
}): string[] {
  const valeSalvo = salvo && salvo.status !== 'CANCELADO'
  const antes = new Set(valeSalvo ? salvo.maquinasIds : [])
  const diasAntes = new Set(valeSalvo ? salvo.dias.map((d) => d.data) : [])
  const diasNovos = new Set(dias.map((d) => d.data).filter((d) => d && !diasAntes.has(d)))
  const temFuturo = dias.some((d) => d.data && d.data >= hoje)
  return selecionadas.filter((id) => {
    const b = bloqueios.get(id)
    if (!b) return false
    if (!antes.has(id) || temFuturo) return true
    return b.motivo === 'OCUPADA' && b.eventos.some((e) => e.dias.some((d) => diasNovos.has(d.data)))
  })
}

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
