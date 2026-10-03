// Máquinas enviadas para um evento: seleção no formulário e resumo no detalhe.

import { Eraser, Info, Sparkles, TriangleAlert, Wrench, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import {
  conflitosMaquinas,
  datasOcupadas,
  ESTADO_MAQUINA,
  ordenarMaquinas,
  osEmAberto,
  periodoEvento,
  quantidadeCurta,
  quantidadePorExtenso,
  reservasDia,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
  totalDia,
  type EstadoMaquina,
} from '#shared/maquinas.ts'
import type { DiaEvento, Evento, Maquina } from '#shared/tipos.ts'
import {
  agruparBloqueios,
  agruparTrocas,
  bloqueiosMaquinas,
  datasEmComum,
  ehReserva,
  juntarNomes,
  maquinasParaTrocar,
  trocasMaquinas,
} from '../lib/bloqueioMaquinas'
import { cn } from '../lib/cn'
import { codigoEvento } from '../lib/format'
import { useDados } from '../store/dados'
import { toast } from '../store/ui'
import { MaquinaChip, SeloReserva, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { Segmented } from './ui/Misc'
import { useHoje } from '../lib/hoje'
import { IconeMaquinaFichas } from './IconeMaquinaFichas'

// ---- Textos e contas ---------------------------------------------------------

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "2 P, 1 G" (só os tipos presentes). */
function contagemTipos(lista: Pick<Maquina, 'tipo'>[]) {
  const p = lista.filter((m) => m.tipo === 'P').length
  const g = lista.length - p
  return [p ? `${p} P` : '', g ? `${g} G` : ''].filter(Boolean).join(', ')
}

type QuantidadesDia = Pick<DiaEvento, 'maquinas'> & Partial<Pick<DiaEvento, 'reservas'>>

/** Maior quantidade de máquinas fora da empresa num mesmo dia: titulares + reservas. */
const maiorTotal = (dias: QuantidadesDia[]) => dias.reduce((m, d) => Math.max(m, totalDia(d)), 0)

/** Maior quantidade de reservas pedida num mesmo dia. */
const maiorReserva = (dias: QuantidadesDia[]) => dias.reduce((m, d) => Math.max(m, reservasDia(d)), 0)

/**
 * O que os dias pedem, por extenso: "3 máquinas + 1 reserva" (a reserva entra no total: a maior
 * soma do dia, das quais as maiores reservas vão como reserva).
 */
const pedidoPorExtenso = (total: number, reservas: number) => quantidadePorExtenso(Math.max(0, total - reservas), reservas)

/**
 * Datas que o outro evento ocupa em comum com `datas` (com período corrido, também os dias do meio):
 * "12/10, 13/10" (até 3, depois "+N").
 */
function datasCurtasEmComum(datas: Set<string>, outro: Evento) {
  const comuns = [...new Set(datasEmComum(outro, datas))].sort()
  const curtas = comuns.slice(0, 3).map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`)
  return comuns.length > 3 ? `${curtas.join(', ')} +${comuns.length - 3}` : curtas.join(', ')
}

/**
 * "também está no evento #0012 Festa X (12/10)" — ou "também está como reserva no evento …" — com
 * link para o outro evento quando `comLink`.
 */
function TextoConflito({
  maquina,
  outros,
  datas,
  comLink,
}: {
  maquina: Maquina
  outros: Evento[]
  datas: Set<string>
  comLink?: boolean
}) {
  return (
    <>
      <b className="font-semibold text-ink">{maquina.identificacao}</b> também está{' '}
      {outros.length > 1 ? 'nos eventos' : ehReserva(outros[0], maquina.id) ? 'como reserva no evento' : 'no evento'}{' '}
      {outros.map((e, i) => (
        <span key={e.id}>
          {i > 0 && (i === outros.length - 1 ? ' e ' : ', ')}
          {comLink ? (
            <Link
              to={`/eventos/${e.id}`}
              className="font-medium text-ink underline-offset-2 hover:text-brand-ink hover:underline"
            >
              {codigoEvento(e.codigo)} {e.nome}
            </Link>
          ) : (
            <span className="font-medium text-ink">
              {codigoEvento(e.codigo)} {e.nome}
            </span>
          )}{' '}
          <span className="tnum">
            ({datasCurtasEmComum(datas, e)}
            {outros.length > 1 && ehReserva(e, maquina.id) ? ', como reserva' : ''})
          </span>
        </span>
      ))}
    </>
  )
}

// ---- Peças visuais -----------------------------------------------------------

type TomAviso = 'warning' | 'info' | 'danger'

interface ItemAviso {
  chave: string
  tom: TomAviso
  texto: ReactNode
}

const ICONE_AVISO: Record<TomAviso, ReactNode> = {
  warning: <TriangleAlert className="h-4 w-4 text-warning" />,
  info: <Info className="h-4 w-4 text-info" />,
  danger: <TriangleAlert className="h-4 w-4 text-danger" />,
}

const FUNDO_AVISO: Record<TomAviso, string> = {
  warning: 'bg-warning-soft',
  info: 'bg-info-soft',
  danger: 'bg-danger-soft',
}

function Avisos({ itens, className }: { itens: ItemAviso[]; className?: string }) {
  return (
    <ul className={cn('flex flex-col', className)} aria-live="polite">
      <AnimatePresence initial={false}>
        {itens.map((a) => (
          <motion.li
            key={a.chave}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <div className={cn('flex items-start gap-2 rounded-xl px-3 py-2 text-[13px] text-ink-2', FUNDO_AVISO[a.tom])}>
                <span className="mt-px shrink-0">{ICONE_AVISO[a.tom]}</span>
                <span className="min-w-0">{a.texto}</span>
              </div>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

/** Quadradinho com as mesmas cores do chip de máquina, para a legenda. */
const COR_LEGENDA: Record<EstadoMaquina | 'SELECIONADA' | 'RESERVA', string> = {
  DISPONIVEL: 'border-success/40 bg-success-soft',
  LOCADA: 'border-info/40 bg-info-soft',
  MANUTENCAO: 'border-warning/50 bg-warning-soft',
  DESATIVADA: 'border-line-strong bg-surface-2',
  SELECIONADA: 'border-brand bg-brand',
  RESERVA: 'border-dashed border-warning-dot bg-warning-soft',
}

function ItemLegenda({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('h-3 w-3 shrink-0 rounded-[4px] border', cor)} />
      {children}
    </span>
  )
}

/** Item "Reserva" da legenda: o quadradinho tracejado âmbar com o "R", como no chip. */
function LegendaReserva() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-flex items-center gap-0.5">
        <span className={cn('h-3 w-3 shrink-0 rounded-[4px] border', COR_LEGENDA.RESERVA)} />
        <SeloReserva pequeno />
      </span>
      Reserva
    </span>
  )
}

function PontoAtencao() {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface bg-warning-dot" />
}

// ---- Menu da máquina (botão direito / toque longo) ---------------------------------

interface OpcaoMenu {
  chave: string
  label: string
  icone: ReactNode
  perigo?: boolean
  aoEscolher: () => void
}

interface MenuAberto {
  maquinaId: string
  /** O chip que abriu o menu: recebe o foco de volta ao fechar pelo teclado. */
  alvo: HTMLElement
  /** Onde abrir (o ponteiro); `null` pelo teclado: embaixo do chip. */
  ponto: { x: number; y: number } | null
}

/**
 * Menu pequeno da máquina, aberto no ponto do clique com o botão direito (ou do toque longo):
 * foco no primeiro item, setas para navegar, Esc fecha e devolve o foco ao chip.
 */
function MenuMaquina({
  aberto,
  titulo,
  opcoes,
  aoFechar,
}: {
  aberto: MenuAberto | null
  titulo: ReactNode
  opcoes: OpcaoMenu[]
  aoFechar: (devolverFoco: boolean) => void
}) {
  const painel = useRef<HTMLDivElement>(null)

  // Posiciona antes de pintar, sem sair da tela (para cima/esquerda quando não cabe)
  useLayoutEffect(() => {
    const el = painel.current
    if (!aberto || !el) return
    const r = aberto.alvo.getBoundingClientRect()
    const { width: w, height: h } = el.getBoundingClientRect()
    const x = aberto.ponto?.x ?? r.left
    const y = aberto.ponto?.y ?? r.bottom + 6
    const cabeEmbaixo = y + h + 8 <= window.innerHeight
    const acima = (aberto.ponto ? y : r.top - 6) - h
    el.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`
    el.style.top = `${cabeEmbaixo ? y : Math.max(8, acima)}px`
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    painel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const fora = (e: Event) => {
      if (!painel.current?.contains(e.target as Node)) aoFechar(false)
    }
    const fechar = () => aoFechar(false)
    document.addEventListener('pointerdown', fora, true)
    window.addEventListener('resize', fechar)
    document.addEventListener('scroll', fechar, true)
    return () => {
      document.removeEventListener('pointerdown', fora, true)
      window.removeEventListener('resize', fechar)
      document.removeEventListener('scroll', fechar, true)
    }
  }, [aberto, aoFechar])

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const itens = [...(painel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const i = itens.indexOf(document.activeElement as HTMLElement)
    const ir = (n: number) => itens[(n + itens.length) % itens.length]?.focus()
    if (e.key === 'Escape') aoFechar(true)
    else if (e.key === 'Tab') aoFechar(false)
    else if (e.key === 'ArrowDown') ir(i + 1)
    else if (e.key === 'ArrowUp') ir(i - 1)
    else if (e.key === 'Home') ir(0)
    else if (e.key === 'End') ir(itens.length - 1)
    else return
    if (e.key !== 'Tab') e.preventDefault()
  }

  return createPortal(
    <AnimatePresence>
      {aberto && (
        <motion.div
          key="menu"
          ref={painel}
          role="menu"
          aria-label={typeof titulo === 'string' ? titulo : 'Opções da máquina'}
          onKeyDown={teclas}
          onContextMenu={(e) => e.preventDefault()}
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ duration: 0.14 }}
          style={{ position: 'fixed' }}
          className="z-[70] min-w-[210px] origin-top-left rounded-xl border border-line bg-surface p-1 shadow-float"
        >
          <p className="tnum truncate px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-muted">{titulo}</p>
          {opcoes.map((o) => (
            <button
              type="button"
              key={o.chave}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                aoFechar(true)
                o.aoEscolher()
              }}
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors outline-none',
                o.perigo
                  ? 'text-danger hover:bg-danger-soft focus-visible:bg-danger-soft'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:bg-surface-2 focus-visible:text-ink',
              )}
            >
              <span className="flex w-4 shrink-0 justify-center">{o.icone}</span>
              {o.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Quadradinho da máquina titular (a cor do chip marcado), para o menu e o seletor de modo. */
function QuadradoTitular({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-3 w-3 shrink-0 rounded-[4px] bg-brand', className)} />
}

// ---- Formulário do evento ------------------------------------------------------

type ComoEnviar = 'TITULAR' | 'RESERVA'

/**
 * Cartão "Máquinas enviadas" do formulário: as máquinas P e G como chips que se marcam com um toque.
 * A situação de cada uma considera as datas do evento (não o dia de hoje): os dias ocupados, que com
 * período corrido incluem os dias do meio. Máquina em manutenção ou já em outro evento nas mesmas
 * datas não pode ser marcada; se já estava marcada, só pode ser desmarcada.
 *
 * Cada máquina marcada vai como titular ou como reserva (`reservasIds`, sempre contido em
 * `maquinasIds`). O modo "Ao clicar, enviar como" decide o que o toque faz; o botão direito (ou o
 * toque longo, no celular) abre um menu com as opções da máquina.
 */
export function SeletorMaquinas({
  maquinasIds,
  aoMudar,
  reservasIds,
  aoMudarReservas,
  dias,
  periodoCorrido,
  eventoId,
  cancelado,
  id,
}: {
  maquinasIds: string[]
  aoMudar: (ids: string[]) => void
  /** Quais das marcadas vão como reserva. */
  reservasIds: string[]
  aoMudarReservas: (ids: string[]) => void
  dias: DiaEvento[]
  /** As máquinas ficam com o cliente entre os dias de uso (ocupadas o período todo). */
  periodoCorrido?: boolean
  /** Evento em edição (não conta como conflito com ele mesmo). */
  eventoId?: string
  /** Evento cancelado não prende máquina nenhuma (como no servidor). */
  cancelado?: boolean
  id?: string
}) {
  const navegar = useNavigate()
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const ordens = useDados((s) => s.ordens)
  const hoje = useHoje()
  const [modo, setModo] = useState<ComoEnviar>('TITULAR')
  const [menu, setMenu] = useState<MenuAberto | null>(null)

  const ordenadas = useMemo(() => ordenarMaquinas(maquinas), [maquinas])
  // Máquinas com manutenção em aberto (às vezes ainda marcadas como disponíveis, enquanto voltam de um evento)
  const comOS = useMemo(() => new Set(ordens.filter(osEmAberto).map((o) => o.maquinaId)), [ordens])
  const selecionadas = useMemo(() => new Set(maquinasIds), [maquinasIds])
  // Só vale como reserva o que está marcado (a reserva é uma das máquinas enviadas)
  const reservas = useMemo(() => new Set(reservasIds.filter((x) => selecionadas.has(x))), [reservasIds, selecionadas])
  // Dias em que as máquinas deste evento ficam fora (com período corrido, também os do meio)
  const ocupadas = useMemo(() => new Set(datasOcupadas({ dias, periodoCorrido })), [dias, periodoCorrido])
  const bloqueios = useMemo(
    () => bloqueiosMaquinas({ maquinas, eventos, clientes, dias, periodoCorrido, eventoId, cancelado, hoje }),
    [maquinas, eventos, clientes, dias, periodoCorrido, eventoId, cancelado, hoje],
  )
  // Versão gravada do evento em edição: o que já estava nele não é cobrado de novo
  const salvo = useMemo(() => (eventoId ? eventos.find((e) => e.id === eventoId) : undefined), [eventos, eventoId])
  // Marcadas que não podem ir, com o motivo (o salvar não deixa passar enquanto não forem trocadas)
  const trocar = useMemo(
    () =>
      trocasMaquinas({
        selecionadas: maquinasIds,
        maquinas,
        eventos,
        clientes,
        dias,
        periodoCorrido,
        eventoId,
        salvo,
        cancelado,
        hoje,
      }),
    [maquinasIds, maquinas, eventos, clientes, dias, periodoCorrido, eventoId, salvo, cancelado, hoje],
  )
  /** Máquina indisponível que já estava gravada no evento e pode voltar (desmarcada por engano, por exemplo). */
  const podeVoltar = (id: string) =>
    !!salvo?.maquinasIds.includes(id) &&
    !maquinasParaTrocar({ selecionadas: [id], maquinas, eventos, dias, periodoCorrido, eventoId, salvo, cancelado, hoje }).length
  // O total que sai da empresa no dia mais cheio (titulares + reservas) e as reservas pedidas
  const precisa = maiorTotal(dias)
  const precisaReservas = maiorReserva(dias)

  const escolhidas = ordenadas.filter((m) => selecionadas.has(m.id))
  const nReservas = escolhidas.filter((m) => reservas.has(m.id)).length
  // Desativadas só aparecem se estão marcadas ou já estavam gravadas (para poder desmarcar ou voltar)
  const visiveis = ordenadas.filter(
    (m) => m.status !== 'DESATIVADA' || selecionadas.has(m.id) || !!salvo?.maquinasIds.includes(m.id),
  )
  // A mesma regra da cor do chip: a manutenção só prende a máquina de hoje em diante (já está em `bloqueios`)
  const livre = (m: Maquina) => m.status !== 'DESATIVADA' && !bloqueios.has(m.id) && !comOS.has(m.id)
  /** Cor do chip: a do motivo da troca ou do bloqueio; sem bloqueio, livre (a manutenção só conta de hoje em diante). */
  const estadoNasDatas = (m: Maquina): EstadoMaquina => {
    const b = trocar.get(m.id) ?? bloqueios.get(m.id)
    if (b) return b.motivo === 'OCUPADA' ? 'LOCADA' : b.motivo
    return m.status === 'DESATIVADA' ? 'DESATIVADA' : 'DISPONIVEL'
  }

  /** Grava sempre na ordem natural (P-01, P-02… G-01), só com máquinas que ainda existem; reserva só entre as marcadas. */
  const gravar = (ids: Set<string>, comoReserva: Set<string>) => {
    const lista = ordenadas.filter((m) => ids.has(m.id)).map((m) => m.id)
    aoMudar(lista)
    aoMudarReservas(lista.filter((x) => comoReserva.has(x)))
  }

  /** Marca como titular ou reserva (`null` tira do evento). Indisponível só pode sair. */
  const enviar = (m: Maquina, como: ComoEnviar | null) => {
    const ids = new Set(selecionadas)
    const res = new Set(reservas)
    if (!como) {
      ids.delete(m.id)
      res.delete(m.id)
    } else {
      if (!ids.has(m.id)) {
        if (bloqueios.has(m.id) && !podeVoltar(m.id)) return
        ids.add(m.id)
      }
      if (como === 'RESERVA') res.add(m.id)
      else res.delete(m.id)
    }
    gravar(ids, res)
  }

  // O toque segue o modo: no mesmo papel desmarca; no outro, troca de papel; livre, marca nesse papel.
  // A que precisa ser trocada (não pode ir) sempre sai com o toque.
  const alternar = (m: Maquina) => {
    const papel: ComoEnviar | null = !selecionadas.has(m.id) ? null : reservas.has(m.id) ? 'RESERVA' : 'TITULAR'
    if (papel && trocar.has(m.id)) return enviar(m, null)
    enviar(m, papel === modo ? null : modo)
  }

  const escolherAutomaticamente = () => {
    // Mantém as já marcadas que estão livres e completa com as livres, pequenas primeiro
    const manter = escolhidas.filter(livre).slice(0, precisa)
    const completar = ordenadas.filter((m) => livre(m) && !manter.includes(m)).slice(0, precisa - manter.length)
    const final = ordenarMaquinas([...manter, ...completar])
    // Reservas: primeiro as titulares (só vira reserva o que passar delas); mantém as já marcadas
    // como reserva e completa com as últimas escolhidas
    const quantasReservas = Math.max(0, Math.min(precisaReservas, final.length - (precisa - precisaReservas)))
    const mantidas = final.filter((m) => reservas.has(m.id)).slice(0, quantasReservas)
    const outras = final.filter((m) => !mantidas.includes(m))
    const novas = quantasReservas > mantidas.length ? outras.slice(-(quantasReservas - mantidas.length)) : []
    const comoReserva = new Set([...mantidas, ...novas].map((m) => m.id))
    gravar(new Set(final.map((m) => m.id)), comoReserva)
    const nomes = final.map((m) => `${m.identificacao}${comoReserva.has(m.id) ? ' (reserva)' : ''}`).join(', ')
    if (!final.length) toast.erro('Nenhuma máquina livre nessas datas', 'Todas estão em outros eventos ou em manutenção.')
    else if (final.length < precisa)
      toast.info(`Só ${plural(final.length, 'máquina livre', 'máquinas livres')} nessas datas`, nomes)
    else toast.sucesso(`${plural(final.length, 'máquina escolhida', 'máquinas escolhidas')}`, nomes)
  }

  const n = escolhidas.length
  const resumo = n ? `${quantidadePorExtenso(n - nReservas, nReservas)} (${contagemTipos(escolhidas)})` : 'Nenhuma selecionada'
  // Falta marcar qual máquina vai como reserva: o modo "Reserva" fica em destaque
  const faltaReserva = n > 0 && nReservas < precisaReservas
  const situacao = trocar.size ? (
    <Badge tom="danger">Trocar {trocar.size}</Badge>
  ) : !precisa || !visiveis.length ? null : n < precisa ? (
    <Badge tom="warning">Faltam {precisa - n}</Badge>
  ) : n > precisa ? (
    <Badge tom="info">{n - precisa} a mais</Badge>
  ) : nReservas < precisaReservas ? (
    <Badge tom="warning">Marcar reserva</Badge>
  ) : nReservas > precisaReservas ? (
    <Badge tom="info">Revisar reserva</Badge>
  ) : (
    <Badge tom="success">Completo</Badge>
  )

  const avisos: ItemAviso[] = []
  // Marcadas que precisam ser trocadas: um aviso por motivo ("P-01 e P-02 já estão no evento …")
  const paraTrocar = escolhidas.filter((m) => trocar.has(m.id))
  for (const g of agruparTrocas(paraTrocar.map((m) => ({ identificacao: m.identificacao, bloqueio: trocar.get(m.id)! })))) {
    const varias = g.maquinas.length > 1
    avisos.push({
      chave: `t-${g.chave}`,
      tom: 'danger',
      texto: (
        <>
          <b className="font-semibold text-ink">{juntarNomes(g.maquinas)}</b> {g.frase}. Toque {varias ? 'nelas' : 'nela'} para
          desmarcar e escolha {varias ? 'outras' : 'outra'}
          {g.motivo === 'MANUTENCAO' ? ' (ou conclua a manutenção antes)' : ''}.
        </>
      ),
    })
  }
  for (const m of escolhidas) {
    const b = bloqueios.get(m.id)
    if (trocar.has(m.id)) continue
    if (b?.motivo === 'OCUPADA') {
      // Já estava gravada assim (ex.: evento que já passou): fica, só avisa
      avisos.push({
        chave: `c-${m.id}`,
        tom: 'warning',
        texto: <TextoConflito maquina={m} outros={b.eventos} datas={ocupadas} />,
      })
    } else if (b) {
      // Já estava gravada e depois entrou em manutenção ou foi desativada: o salvar aceita, só avisa
      avisos.push({
        chave: `s-${m.id}`,
        tom: 'warning',
        texto: (
          <>
            <b className="font-semibold text-ink">{m.identificacao}</b>{' '}
            {b.motivo === 'MANUTENCAO'
              ? 'entrou em manutenção depois de gravada neste evento. Confira se ela ainda vai (ou volta) para o evento.'
              : 'foi desativada depois de gravada neste evento. Ela fica só como registro.'}
          </>
        ),
      })
    } else if (comOS.has(m.id)) {
      avisos.push({
        chave: `os-${m.id}`,
        tom: 'warning',
        texto: (
          <>
            <b className="font-semibold text-ink">{m.identificacao}</b> tem uma manutenção em aberto. Confira se ela já está
            pronta para o evento.
          </>
        ),
      })
    }
  }
  // O total conta titulares + reservas: todas saem da empresa
  const comReserva =
    precisaReservas > 0
      ? ` (${quantidadeCurta(precisa - precisaReservas, precisaReservas)}, com ${precisaReservas === 1 ? 'a reserva' : 'as reservas'})`
      : ''
  if (precisa && n && n < precisa) {
    const livresRestantes = visiveis.filter((m) => !selecionadas.has(m.id) && livre(m)).length
    const faltam = precisa - n
    avisos.push({
      chave: 'faltam',
      tom: 'warning',
      texto: (
        <>
          {faltam === 1 ? 'Falta 1 máquina' : `Faltam ${faltam} máquinas`}: o dia de maior uso tem {precisa}
          {comReserva}.
          {livresRestantes < faltam &&
            (livresRestantes
              ? ` Só ${plural(livresRestantes, 'outra está livre', 'outras estão livres')} nestas datas.`
              : ' Nenhuma outra está livre nestas datas.')}
        </>
      ),
    })
  }
  if (precisa && n > precisa) {
    const sobra = n - precisa
    avisos.push({
      chave: 'sobram',
      tom: 'info',
      texto: `${plural(sobra, 'máquina', 'máquinas')} a mais do que o dia de maior uso, que tem ${precisa}${comReserva}. Se ${
        sobra === 1 ? 'ela também vai' : 'elas também vão'
      }, aumente as máquinas ou a reserva em “Dias de utilização”.`,
    })
  }
  // Quantas das marcadas vão como reserva, comparado ao que os dias pedem
  if (faltaReserva) {
    const faltam = precisaReservas - nReservas
    avisos.push({
      chave: 'reserva-falta',
      tom: 'warning',
      texto: (
        <>
          {nReservas === 0
            ? precisaReservas === 1
              ? 'Marque qual máquina vai como reserva: os dias pedem 1 reserva.'
              : `Marque quais máquinas vão como reserva: os dias pedem ${precisaReservas} reservas.`
            : `Marque mais ${faltam} como reserva: os dias pedem ${precisaReservas} e só ${plural(nReservas, 'está marcada', 'estão marcadas')}.`}{' '}
          <span className="text-muted">
            Escolha “Reserva” em “Ao clicar, enviar como” e toque na máquina, ou use o botão direito (toque longo no celular).
          </span>
        </>
      ),
    })
  } else if (nReservas > precisaReservas) {
    avisos.push({
      chave: 'reserva-sobra',
      tom: 'info',
      texto: `${plural(nReservas, 'máquina marcada', 'máquinas marcadas')} como reserva, mas ${
        precisaReservas ? `os dias pedem ${precisaReservas}` : 'os dias não pedem reserva'
      }. Ajuste a reserva em “Dias de utilização” ou envie ${nReservas - precisaReservas === 1 ? 'uma' : 'algumas'} como titular.`,
    })
  }

  // Por que as apagadas não podem ser marcadas (agrupado por evento, e as em manutenção)
  const grupos = agruparBloqueios(
    visiveis.filter((m) => !selecionadas.has(m.id)),
    bloqueios,
    clientes,
    dias,
    periodoCorrido,
  )
  const gruposEventos = grupos.filter((g) => g.motivo === 'OCUPADA')
  const emManutencao = grupos.find((g) => g.motivo === 'MANUTENCAO')

  const titulo = (m: Maquina) => {
    const nome = `${m.identificacao} (${TIPO_MAQUINA[m.tipo].descricao.toLowerCase()})`
    const t = trocar.get(m.id)
    if (t) return `${nome} · ${t.texto}. Clique para desmarcar e escolha outra.`
    const b = bloqueios.get(m.id)
    if (b && !selecionadas.has(m.id)) return `${nome} · Indisponível: ${b.texto}`
    const papel = reservas.has(m.id) ? `${m.identificacao} · reserva neste evento` : ''
    if (b) return papel ? `${papel} · ${b.texto}` : `${nome} · ${b.texto}`
    if (comOS.has(m.id)) return `${papel || nome} · Com manutenção em aberto: confira se já está pronta`
    if (papel) return papel
    return selecionadas.has(m.id) ? `${nome} · titular neste evento` : `${nome} · Livre nestas datas`
  }

  // Opções do menu da máquina, conforme o papel dela agora
  const maquinaMenu = menu ? ordenadas.find((m) => m.id === menu.maquinaId) : undefined
  const opcoesMenu: OpcaoMenu[] = []
  if (maquinaMenu) {
    const marcada = selecionadas.has(maquinaMenu.id)
    const reserva = reservas.has(maquinaMenu.id)
    if (!marcada || reserva)
      opcoesMenu.push({
        chave: 't',
        label: 'Enviar como titular',
        icone: <QuadradoTitular />,
        aoEscolher: () => enviar(maquinaMenu, 'TITULAR'),
      })
    if (!reserva)
      opcoesMenu.push({
        chave: 'r',
        label: 'Enviar como reserva',
        icone: <SeloReserva />,
        aoEscolher: () => enviar(maquinaMenu, 'RESERVA'),
      })
    if (marcada)
      opcoesMenu.push({
        chave: 'x',
        label: 'Tirar do evento',
        icone: <X className="h-4 w-4" />,
        perigo: true,
        aoEscolher: () => enviar(maquinaMenu, null),
      })
  }
  const tituloMenu = maquinaMenu
    ? `${maquinaMenu.identificacao} · ${
        reservas.has(maquinaMenu.id)
          ? 'reserva neste evento'
          : selecionadas.has(maquinaMenu.id)
            ? 'titular neste evento'
            : 'livre nestas datas'
      }`
    : ''
  const fecharMenu = useCallback(
    (devolverFoco: boolean) => {
      if (devolverFoco) menu?.alvo.focus({ preventScroll: true })
      setMenu(null)
    },
    [menu],
  )

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icone={<IconeMaquinaFichas className="h-4 w-4" />}
        titulo="Máquinas enviadas"
        descricao={
          visiveis.length ? (
            <span className="tnum">
              {resumo}
              {precisa > 0 && ` · precisa de ${quantidadeCurta(precisa - precisaReservas, precisaReservas)}`}
            </span>
          ) : (
            'Quais máquinas vão para o evento.'
          )
        }
        acoes={situacao}
      />
      {!visiveis.length ? (
        <div className="mx-5 mb-5 flex flex-col items-center rounded-xl border border-dashed border-line-strong px-5 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
            <IconeMaquinaFichas className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-ink">
            {maquinas.length ? 'Todas as máquinas estão desativadas' : 'Nenhuma máquina cadastrada'}
          </p>
          <p className="mt-1 max-w-sm text-[13px] text-muted">
            Informe quantas máquinas P e G você tem em Configurações, ou cadastre uma a uma na Manutenção. Depois é só marcar
            quais vão para cada evento.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button tamanho="sm" variante="soft" icone={<Wrench className="h-4 w-4" />} onClick={() => navegar('/manutencao')}>
              Abrir Manutenção
            </Button>
            <Button tamanho="sm" onClick={() => navegar('/configuracoes')}>
              Ir para Configurações
            </Button>
          </div>
        </div>
      ) : (
        <div className="px-5 pb-5">
          {/* O que o toque faz: marcar como titular ou como reserva (o botão direito não existe no celular) */}
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[13px] font-medium text-ink-2" id={id ? `${id}-modo` : undefined}>
              Ao clicar, enviar como:
            </span>
            <Segmented<ComoEnviar>
              tamanho="sm"
              valor={modo}
              aoMudar={setModo}
              opcoes={[
                {
                  valor: 'TITULAR',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <QuadradoTitular className="h-2.5 w-2.5 rounded-[3px]" />
                      Titular
                    </span>
                  ),
                },
                {
                  valor: 'RESERVA',
                  label: (
                    <span
                      className={cn('inline-flex items-center gap-1.5', faltaReserva && modo !== 'RESERVA' && 'text-warning')}
                      title={
                        faltaReserva ? 'Os dias pedem reserva: escolha aqui e toque na máquina que vai como reserva' : undefined
                      }
                    >
                      <SeloReserva pequeno />
                      Reserva
                      {faltaReserva && (
                        <span aria-hidden className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning-dot opacity-60" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-warning-dot" />
                        </span>
                      )}
                    </span>
                  ),
                },
              ]}
              className={cn(faltaReserva && modo !== 'RESERVA' && 'ring-1 ring-warning-dot/60')}
            />
            <span className="text-xs text-muted">
              <span className="pointer-coarse:hidden">ou clique com o botão direito na máquina</span>
              <span className="hidden pointer-coarse:inline">ou toque e segure a máquina</span>
            </span>
          </div>
          {!n && (
            <p className="mb-3 text-[13px] text-muted">
              Toque nas máquinas que vão para este evento, ou use “Escolher automaticamente” para marcar as livres
              {precisaReservas > 0 ? ' (a reserva também)' : ''}.
            </p>
          )}
          <div className="flex flex-col gap-4">
            {TIPOS_MAQUINA.map((tipo) => {
              const lista = visiveis.filter((m) => m.tipo === tipo)
              if (!lista.length) return null
              const marcadas = lista.filter((m) => selecionadas.has(m.id)).length
              return (
                <div key={tipo} role="group" aria-label={TIPO_MAQUINA[tipo].plural}>
                  <div className="mb-2 flex items-center gap-2">
                    <TipoMaquinaBadge tipo={tipo} />
                    <span className="text-[13px] font-medium text-ink-2">{TIPO_MAQUINA[tipo].plural}</span>
                    <span className="text-xs text-muted">{TIPO_MAQUINA[tipo].descricao.toLowerCase()}s</span>
                    <span className="tnum ml-auto text-xs text-muted">
                      {marcadas} de {lista.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {lista.map((m) => {
                      const marcada = selecionadas.has(m.id)
                      const bloqueada = bloqueios.has(m.id)
                      const desabilitado = bloqueada && !marcada && !podeVoltar(m.id)
                      return (
                        <MaquinaChip
                          key={m.id}
                          maquina={m}
                          estado={estadoNasDatas(m)}
                          selecionada={marcada}
                          reserva={marcada && reservas.has(m.id)}
                          desabilitado={desabilitado}
                          aviso={marcada ? bloqueada || comOS.has(m.id) : !bloqueada && comOS.has(m.id)}
                          titulo={titulo(m)}
                          aoClicar={() => alternar(m)}
                          aoAbrirMenu={desabilitado ? undefined : (alvo, ponto) => setMenu({ maquinaId: m.id, alvo, ponto })}
                          className={cn(
                            'min-w-[60px] justify-center',
                            trocar.has(m.id) && 'ring-2 ring-danger ring-offset-2 ring-offset-surface',
                            menu?.maquinaId === m.id && 'ring-2 ring-[var(--ring)] ring-offset-1 ring-offset-surface',
                          )}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
            <ItemLegenda cor={COR_LEGENDA.DISPONIVEL}>Livre nestas datas</ItemLegenda>
            <ItemLegenda cor={COR_LEGENDA.SELECIONADA}>Titular</ItemLegenda>
            <LegendaReserva />
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-flex gap-0.5 opacity-70 saturate-50">
                <span className={cn('h-3 w-3 shrink-0 rounded-[4px] border', COR_LEGENDA.LOCADA)} />
                <span className={cn('h-3 w-3 shrink-0 rounded-[4px] border', COR_LEGENDA.MANUTENCAO)} />
              </span>
              Indisponível
            </span>
            <span className="inline-flex items-center gap-1.5">
              <PontoAtencao />
              Atenção
            </span>
          </div>

          {/* Motivo das indisponíveis, de forma compacta */}
          <AnimatePresence initial={false}>
            {grupos.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="mt-3 flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
                  {gruposEventos.length > 0 && (
                    <p>
                      <span className="font-medium text-ink">Em outro evento nestas datas:</span>{' '}
                      {gruposEventos.map((g, i) => (
                        <span key={g.chave}>
                          {i > 0 && <span className="text-muted"> · </span>}
                          <b className="tnum font-semibold text-ink">
                            {g.maquinas.map((m, j) => (
                              <span key={m.id}>
                                {j > 0 && ', '}
                                {m.identificacao}
                                {g.reservas.includes(m.id) && (
                                  <>
                                    <SeloReserva pequeno className="ml-1 align-[-2px]" />
                                    <span className="sr-only"> (reserva)</span>
                                  </>
                                )}
                              </span>
                            ))}
                          </b>{' '}
                          <span className="tnum">({g.titulo})</span>
                        </span>
                      ))}
                    </p>
                  )}
                  {emManutencao && (
                    <p>
                      <span className="font-medium text-ink">Em manutenção:</span>{' '}
                      <b className="tnum font-semibold text-ink">
                        {emManutencao.maquinas.map((m) => m.identificacao).join(', ')}
                      </b>
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Avisos itens={avisos} className="mt-1" />

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variante="soft"
              tamanho="sm"
              icone={<Sparkles className="h-4 w-4" />}
              onClick={escolherAutomaticamente}
              disabled={!precisa}
              title={`Marca as máquinas livres nestas datas (sem outro evento e sem manutenção em aberto), pequenas primeiro${
                precisaReservas ? '; as últimas vão como reserva' : ''
              }`}
            >
              Escolher automaticamente
            </Button>
            <Button
              tamanho="sm"
              icone={<Eraser className="h-4 w-4" />}
              onClick={() => gravar(new Set(), new Set())}
              disabled={!maquinasIds.length}
            >
              Limpar
            </Button>
          </div>
        </div>
      )}
      <MenuMaquina aberto={maquinaMenu ? menu : null} titulo={tituloMenu} opcoes={opcoesMenu} aoFechar={fecharMenu} />
    </Card>
  )
}

// ---- Detalhe do evento -----------------------------------------------------------

/**
 * Cartão "Máquinas enviadas" do detalhe: a situação de hoje de cada uma, com link para o cadastro.
 * As que vão como reserva têm a borda tracejada âmbar e o "R".
 */
export function MaquinasEnviadas({ evento }: { evento: Evento }) {
  const navegar = useNavigate()
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const situacoes = useSituacoes()

  const lista = useMemo(() => {
    const ids = new Set(evento.maquinasIds)
    return ordenarMaquinas(maquinas.filter((m) => ids.has(m.id)))
  }, [maquinas, evento.maquinasIds])
  const reservas = useMemo(() => new Set(evento.reservasIds ?? []), [evento.reservasIds])
  const nReservas = lista.filter((m) => reservas.has(m.id)).length
  const cancelado = evento.status === 'CANCELADO'
  const conflitos = useMemo(
    () => (cancelado ? new Map<string, Evento[]>() : conflitosMaquinas(evento, eventos)),
    [cancelado, evento, eventos],
  )
  const hoje = useHoje()
  // Manutenção e desativação só importam enquanto o evento não terminou
  const pendente = useMemo(() => {
    const p = periodoEvento(evento)
    return !cancelado && evento.status !== 'FINALIZADO' && !!p && p.fim >= hoje
  }, [cancelado, evento, hoje])
  // Dias em que as máquinas ficam fora (com período corrido, também os do meio)
  const datas = useMemo(() => new Set(datasOcupadas(evento)), [evento])
  // Titulares + reservas: todas saem da empresa
  const precisa = maiorTotal(evento.dias)
  const precisaReservas = maiorReserva(evento.dias)

  const avisos: ItemAviso[] = []
  if (!cancelado && lista.length && lista.length < precisa) {
    const faltam = precisa - lista.length
    avisos.push({
      chave: 'faltam',
      tom: 'warning',
      texto: `${faltam === 1 ? 'Falta 1 máquina' : `Faltam ${faltam} máquinas`}: o dia de maior uso tem ${precisa}${
        precisaReservas ? ` (${pedidoPorExtenso(precisa, precisaReservas)})` : ''
      }.`,
    })
  }
  if (!cancelado && lista.length && nReservas < precisaReservas) {
    avisos.push({
      chave: 'reserva',
      tom: 'info',
      texto:
        nReservas === 0
          ? `Os dias pedem ${plural(precisaReservas, 'reserva', 'reservas')}: falta marcar qual máquina vai como reserva.`
          : `Os dias pedem ${plural(precisaReservas, 'reserva', 'reservas')} e só ${plural(nReservas, 'máquina está marcada', 'máquinas estão marcadas')} como reserva.`,
    })
  }
  for (const m of lista) {
    const outros = conflitos.get(m.id)
    if (outros?.length) {
      avisos.push({
        chave: `c-${m.id}`,
        tom: 'warning',
        texto: <TextoConflito maquina={m} outros={outros} datas={datas} comLink />,
      })
    }
    if (pendente && m.status !== 'DISPONIVEL') {
      avisos.push({
        chave: `s-${m.id}`,
        tom: m.status === 'DESATIVADA' ? 'danger' : 'warning',
        texto: (
          <>
            <b className="font-semibold text-ink">{m.identificacao}</b>{' '}
            {m.status === 'DESATIVADA' ? 'está desativada. Troque por outra máquina.' : 'está em manutenção.'}
          </>
        ),
      })
    }
  }

  const presentes = TIPOS_ESTADO.filter((e) => lista.some((m) => situacoes.get(m.id)?.estado === e))

  const tituloChip = (m: Maquina) => {
    const papel = reservas.has(m.id) ? ' · Reserva neste evento' : ''
    const s = situacoes.get(m.id)
    if (!s) return `${m.identificacao}${papel}`
    const rotulo = ESTADO_MAQUINA[s.estado].label
    if (s.estado === 'LOCADA' && s.evento)
      return s.evento.id === evento.id
        ? `${m.identificacao}${papel || ' · Locada neste evento'}`
        : `${m.identificacao}${papel} · Locada hoje em outro evento: ${s.evento.nome}`
    return `${m.identificacao}${papel} · ${rotulo} hoje — abrir o cadastro`
  }

  return (
    <Card>
      <CardHeader
        icone={<IconeMaquinaFichas className="h-4 w-4" />}
        titulo="Máquinas enviadas"
        descricao={
          lista.length ? (
            <span className="tnum">
              {quantidadePorExtenso(lista.length - nReservas, nReservas)} ({contagemTipos(lista)})
            </span>
          ) : (
            'Nenhuma máquina marcada'
          )
        }
      />
      <div className="px-5 pb-5">
        {lista.length ? (
          <>
            <div className="flex flex-wrap gap-2">
              {lista.map((m, i) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i, 20) * 0.02, duration: 0.2 }}
                >
                  <Link
                    to={`/manutencao/${m.id}`}
                    title={tituloChip(m)}
                    className="block rounded-lg transition-[filter] hover:brightness-95 dark:hover:brightness-125"
                  >
                    <MaquinaChip
                      maquina={m}
                      estado={situacoes.get(m.id)?.estado ?? 'DISPONIVEL'}
                      reserva={reservas.has(m.id)}
                      aviso={conflitos.has(m.id) || (pendente && m.status !== 'DISPONIVEL')}
                      className="min-w-[60px] cursor-pointer justify-center"
                    />
                  </Link>
                </motion.div>
              ))}
            </div>
            {(presentes.length > 0 || nReservas > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                {/* A reserva vem antes: não é uma situação de hoje */}
                {nReservas > 0 && <LegendaReserva />}
                {presentes.length > 0 && <span>Hoje:</span>}
                {presentes.map((e) => (
                  <ItemLegenda key={e} cor={COR_LEGENDA[e]}>
                    {ESTADO_MAQUINA[e].label}
                  </ItemLegenda>
                ))}
              </div>
            )}
            <Avisos itens={avisos} className="mt-1" />
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center">
            <p className="text-[13px] text-muted">
              {!maquinas.length
                ? 'Cadastre suas máquinas para registrar quais foram enviadas e saber onde cada uma está.'
                : cancelado
                  ? 'Este evento foi cancelado.'
                  : 'Marque quais máquinas vão para este evento para saber onde cada uma está.'}
            </p>
            {(!maquinas.length || !cancelado) && (
              <Button
                tamanho="sm"
                variante="soft"
                className="mt-3"
                icone={maquinas.length ? <IconeMaquinaFichas className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                onClick={() => navegar(maquinas.length ? `/eventos/${evento.id}/editar?secao=maquinas` : '/manutencao')}
              >
                {maquinas.length ? 'Marcar máquinas' : 'Abrir Manutenção'}
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

const TIPOS_ESTADO: EstadoMaquina[] = ['LOCADA', 'DISPONIVEL', 'MANUTENCAO', 'DESATIVADA']
