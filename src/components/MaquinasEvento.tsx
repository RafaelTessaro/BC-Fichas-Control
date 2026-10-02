// Máquinas enviadas para um evento: seleção no formulário e resumo no detalhe.

import { Eraser, Info, Printer, Sparkles, TriangleAlert, Wrench } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  conflitosMaquinas,
  ESTADO_MAQUINA,
  ordenarMaquinas,
  osEmAberto,
  periodoEvento,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
  type EstadoMaquina,
} from '#shared/maquinas.ts'
import type { DiaEvento, Evento, Maquina } from '#shared/tipos.ts'
import {
  agruparBloqueios,
  agruparTrocas,
  bloqueiosMaquinas,
  juntarNomes,
  maquinasParaTrocar,
  trocasMaquinas,
} from '../lib/bloqueioMaquinas'
import { cn } from '../lib/cn'
import { codigoEvento } from '../lib/format'
import { useDados } from '../store/dados'
import { toast } from '../store/ui'
import { MaquinaChip, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { useHoje } from '../lib/hoje'

// ---- Textos e contas ---------------------------------------------------------

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "2 P, 1 G" (só os tipos presentes). */
function contagemTipos(lista: Pick<Maquina, 'tipo'>[]) {
  const p = lista.filter((m) => m.tipo === 'P').length
  const g = lista.length - p
  return [p ? `${p} P` : '', g ? `${g} G` : ''].filter(Boolean).join(', ')
}

/** Maior quantidade de máquinas pedida num mesmo dia. */
const maiorUso = (dias: Pick<DiaEvento, 'maquinas'>[]) => dias.reduce((m, d) => Math.max(m, d.maquinas || 0), 0)

/** Datas que o outro evento tem em comum com `datas`: "12/10, 13/10" (até 3, depois "+N"). */
function datasEmComum(datas: Set<string>, outro: Evento) {
  const comuns = [...new Set(outro.dias.map((d) => d.data).filter((d) => datas.has(d)))].sort()
  const curtas = comuns.slice(0, 3).map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`)
  return comuns.length > 3 ? `${curtas.join(', ')} +${comuns.length - 3}` : curtas.join(', ')
}

/** "também está no evento #0012 Festa X (12/10)" — com link para o outro evento quando `comLink`. */
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
      {outros.length > 1 ? 'nos eventos' : 'no evento'}{' '}
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
          <span className="tnum">({datasEmComum(datas, e)})</span>
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
const COR_LEGENDA: Record<EstadoMaquina | 'SELECIONADA', string> = {
  DISPONIVEL: 'border-success/40 bg-success-soft',
  LOCADA: 'border-info/40 bg-info-soft',
  MANUTENCAO: 'border-warning/50 bg-warning-soft',
  DESATIVADA: 'border-line-strong bg-surface-2',
  SELECIONADA: 'border-brand bg-brand',
}

function ItemLegenda({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('h-3 w-3 shrink-0 rounded-[4px] border', cor)} />
      {children}
    </span>
  )
}

function PontoAtencao() {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-surface bg-warning-dot" />
}

// ---- Formulário do evento ------------------------------------------------------

/**
 * Cartão "Máquinas enviadas" do formulário: as máquinas P e G como chips que se marcam com um toque.
 * A situação de cada uma considera as datas do evento (não o dia de hoje). Máquina em manutenção ou
 * já em outro evento nas mesmas datas não pode ser marcada; se já estava marcada, só pode ser desmarcada.
 */
export function SeletorMaquinas({
  maquinasIds,
  aoMudar,
  dias,
  eventoId,
  cancelado,
  id,
}: {
  maquinasIds: string[]
  aoMudar: (ids: string[]) => void
  dias: DiaEvento[]
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

  const ordenadas = useMemo(() => ordenarMaquinas(maquinas), [maquinas])
  // Máquinas com O.S. em aberto (às vezes ainda marcadas como disponíveis, enquanto voltam de um evento)
  const comOS = useMemo(() => new Set(ordens.filter(osEmAberto).map((o) => o.maquinaId)), [ordens])
  const selecionadas = useMemo(() => new Set(maquinasIds), [maquinasIds])
  const bloqueios = useMemo(
    () => bloqueiosMaquinas({ maquinas, eventos, clientes, dias, eventoId, cancelado, hoje }),
    [maquinas, eventos, clientes, dias, eventoId, cancelado, hoje],
  )
  // Versão gravada do evento em edição: o que já estava nele não é cobrado de novo
  const salvo = useMemo(() => (eventoId ? eventos.find((e) => e.id === eventoId) : undefined), [eventos, eventoId])
  // Marcadas que não podem ir, com o motivo (o salvar não deixa passar enquanto não forem trocadas)
  const trocar = useMemo(
    () => trocasMaquinas({ selecionadas: maquinasIds, maquinas, eventos, clientes, dias, eventoId, salvo, cancelado, hoje }),
    [maquinasIds, maquinas, eventos, clientes, dias, eventoId, salvo, cancelado, hoje],
  )
  /** Máquina indisponível que já estava gravada no evento e pode voltar (desmarcada por engano, por exemplo). */
  const podeVoltar = (id: string) =>
    !!salvo?.maquinasIds.includes(id) &&
    !maquinasParaTrocar({ selecionadas: [id], maquinas, eventos, dias, eventoId, salvo, cancelado, hoje }).length
  const precisa = maiorUso(dias)

  const escolhidas = ordenadas.filter((m) => selecionadas.has(m.id))
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

  /** Grava sempre na ordem natural (P-01, P-02… G-01) e só com máquinas que ainda existem. */
  const gravar = (ids: Set<string>) => aoMudar(ordenadas.filter((m) => ids.has(m.id)).map((m) => m.id))

  const alternar = (m: Maquina) => {
    const novos = new Set(selecionadas)
    if (novos.has(m.id)) novos.delete(m.id)
    else if (bloqueios.has(m.id) && !podeVoltar(m.id))
      return // indisponível: só pode ser desmarcada
    else novos.add(m.id)
    gravar(novos)
  }

  const escolherAutomaticamente = () => {
    // Mantém as já marcadas que estão livres e completa com as livres, pequenas primeiro
    const manter = escolhidas.filter(livre).slice(0, precisa)
    const completar = ordenadas.filter((m) => livre(m) && !manter.includes(m)).slice(0, precisa - manter.length)
    const final = [...manter, ...completar]
    gravar(new Set(final.map((m) => m.id)))
    const nomes = ordenarMaquinas(final)
      .map((m) => m.identificacao)
      .join(', ')
    if (!final.length)
      toast.erro('Nenhuma máquina livre nessas datas', 'Todas estão em outros eventos, em manutenção ou com O.S. em aberto.')
    else if (final.length < precisa)
      toast.info(`Só ${plural(final.length, 'máquina livre', 'máquinas livres')} nessas datas`, nomes)
    else toast.sucesso(`${plural(final.length, 'máquina escolhida', 'máquinas escolhidas')}`, nomes)
  }

  const n = escolhidas.length
  const resumo = n ? `${plural(n, 'selecionada', 'selecionadas')} (${contagemTipos(escolhidas)})` : 'Nenhuma selecionada'
  const situacao = trocar.size ? (
    <Badge tom="danger">Trocar {trocar.size}</Badge>
  ) : !precisa || !visiveis.length ? null : n < precisa ? (
    <Badge tom="warning">Faltam {precisa - n}</Badge>
  ) : n > precisa ? (
    <Badge tom="info">{n - precisa} a mais</Badge>
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
        texto: <TextoConflito maquina={m} outros={b.eventos} datas={new Set(dias.map((d) => d.data))} />,
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
            <b className="font-semibold text-ink">{m.identificacao}</b> tem uma O.S. em aberto. Confira se ela já está pronta para
            o evento.
          </>
        ),
      })
    }
  }
  if (precisa && n && n < precisa) {
    const livresRestantes = visiveis.filter((m) => !selecionadas.has(m.id) && livre(m)).length
    const faltam = precisa - n
    avisos.push({
      chave: 'faltam',
      tom: 'warning',
      texto: (
        <>
          {faltam === 1 ? 'Falta 1 máquina' : `Faltam ${faltam} máquinas`}: o dia de maior uso tem {precisa}.
          {livresRestantes < faltam &&
            (livresRestantes
              ? ` Só ${plural(livresRestantes, 'outra está livre', 'outras estão livres')} nestas datas.`
              : ' Nenhuma outra está livre nestas datas.')}
        </>
      ),
    })
  }
  if (precisa && n > precisa) {
    avisos.push({
      chave: 'sobram',
      tom: 'info',
      texto: `${plural(n - precisa, 'máquina', 'máquinas')} a mais do que o dia de maior uso (${precisa}). Se for reserva, tudo bem.`,
    })
  }

  // Por que as apagadas não podem ser marcadas (agrupado por evento, e as em manutenção)
  const grupos = agruparBloqueios(
    visiveis.filter((m) => !selecionadas.has(m.id)),
    bloqueios,
    clientes,
    dias,
  )
  const gruposEventos = grupos.filter((g) => g.motivo === 'OCUPADA')
  const emManutencao = grupos.find((g) => g.motivo === 'MANUTENCAO')

  const titulo = (m: Maquina) => {
    const nome = `${m.identificacao} (${TIPO_MAQUINA[m.tipo].descricao.toLowerCase()})`
    const t = trocar.get(m.id)
    if (t) return `${nome} · ${t.texto}. Clique para desmarcar e escolha outra.`
    const b = bloqueios.get(m.id)
    if (b && !selecionadas.has(m.id)) return `${nome} · Indisponível: ${b.texto}`
    if (b) return `${nome} · ${b.texto}`
    if (comOS.has(m.id)) return `${nome} · Com O.S. em aberto: confira se já está pronta`
    return `${nome} · Livre nestas datas`
  }

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icone={<Printer className="h-4 w-4" />}
        titulo="Máquinas enviadas"
        descricao={
          visiveis.length ? (
            <span className="tnum">
              {resumo}
              {precisa > 0 && ` · precisa de ${precisa}`}
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
            <Printer className="h-5 w-5" />
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
          {!n && (
            <p className="mb-3 text-[13px] text-muted">
              Toque nas máquinas que vão para este evento, ou use “Escolher automaticamente” para marcar as livres.
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
                      return (
                        <MaquinaChip
                          key={m.id}
                          maquina={m}
                          estado={estadoNasDatas(m)}
                          selecionada={marcada}
                          desabilitado={bloqueada && !marcada && !podeVoltar(m.id)}
                          aviso={marcada ? bloqueada || comOS.has(m.id) : !bloqueada && comOS.has(m.id)}
                          titulo={titulo(m)}
                          aoClicar={() => alternar(m)}
                          className={cn(
                            'min-w-[60px] justify-center',
                            trocar.has(m.id) && 'ring-2 ring-danger ring-offset-2 ring-offset-surface',
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
            <ItemLegenda cor={COR_LEGENDA.SELECIONADA}>Selecionada</ItemLegenda>
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
                          <b className="tnum font-semibold text-ink">{g.maquinas.map((m) => m.identificacao).join(', ')}</b>{' '}
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
              title="Marca as máquinas livres nestas datas (sem outro evento, fora de manutenção e sem O.S. em aberto), pequenas primeiro"
            >
              Escolher automaticamente
            </Button>
            <Button
              tamanho="sm"
              icone={<Eraser className="h-4 w-4" />}
              onClick={() => aoMudar([])}
              disabled={!maquinasIds.length}
            >
              Limpar
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---- Detalhe do evento -----------------------------------------------------------

/** Cartão "Máquinas enviadas" do detalhe: a situação de hoje de cada uma, com link para o cadastro. */
export function MaquinasEnviadas({ evento }: { evento: Evento }) {
  const navegar = useNavigate()
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const situacoes = useSituacoes()

  const lista = useMemo(() => {
    const ids = new Set(evento.maquinasIds)
    return ordenarMaquinas(maquinas.filter((m) => ids.has(m.id)))
  }, [maquinas, evento.maquinasIds])
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
  const datas = useMemo(() => new Set(evento.dias.map((d) => d.data)), [evento.dias])
  const precisa = maiorUso(evento.dias)

  const avisos: ItemAviso[] = []
  if (!cancelado && lista.length && lista.length < precisa) {
    const faltam = precisa - lista.length
    avisos.push({
      chave: 'faltam',
      tom: 'warning',
      texto: `${faltam === 1 ? 'Falta 1 máquina' : `Faltam ${faltam} máquinas`}: o dia de maior uso tem ${precisa}.`,
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
    const s = situacoes.get(m.id)
    if (!s) return m.identificacao
    const rotulo = ESTADO_MAQUINA[s.estado].label
    if (s.estado === 'LOCADA' && s.evento)
      return s.evento.id === evento.id
        ? `${m.identificacao} · Locada neste evento`
        : `${m.identificacao} · Locada hoje em outro evento: ${s.evento.nome}`
    return `${m.identificacao} · ${rotulo} hoje — abrir o cadastro`
  }

  return (
    <Card>
      <CardHeader
        icone={<Printer className="h-4 w-4" />}
        titulo="Máquinas enviadas"
        descricao={
          lista.length ? (
            <span className="tnum">
              {plural(lista.length, 'máquina', 'máquinas')} ({contagemTipos(lista)})
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
                      aviso={conflitos.has(m.id) || (pendente && m.status !== 'DISPONIVEL')}
                      className="min-w-[60px] cursor-pointer justify-center"
                    />
                  </Link>
                </motion.div>
              ))}
            </div>
            {presentes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                <span>Hoje:</span>
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
                icone={maquinas.length ? <Printer className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
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
