// Cartão "Disponibilidade de máquinas" (Configurações): quantas máquinas P e G a empresa tem.

import { ArrowRight, Info, LoaderCircle, Plus, PowerOff, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LIMITES } from '#shared/dominio.ts'
import {
  capacidade,
  ESTADO_MAQUINA,
  localDaLocacao,
  planoAjuste,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
  ordenarMaquinas,
  type EstadoMaquina,
  type PlanoAjuste,
  type SituacaoMaquina,
} from '#shared/maquinas.ts'
import type { Maquina, TipoMaquina } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import { dataCurta, numero } from '../lib/format'
import { ehReserva } from '../lib/bloqueioMaquinas'
import { USO_RESERVA_CURTO, usoDaReserva } from '../lib/manutencao'
import { useDados } from '../store/dados'
import { toast } from '../store/ui'
import { IconeMaquinaFichas } from './IconeMaquinaFichas'
import { MaquinaChip, SeloReserva, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { Button } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { confirmar } from './ui/Feedback'
import { NumberInput } from './ui/Form'
import { AnimatedNumber } from './ui/Misc'
import { useHoje } from '../lib/hoje'

/** Cor da bolinha da legenda, igual à do chip de cada situação. */
const COR_LEGENDA: Record<EstadoMaquina, string> = {
  DISPONIVEL: 'bg-success',
  LOCADA: 'bg-info',
  MANUTENCAO: 'bg-warning-dot',
  DESATIVADA: 'bg-neutral/60',
}

const ORDEM_LEGENDA: EstadoMaquina[] = ['DISPONIVEL', 'LOCADA', 'MANUTENCAO', 'DESATIVADA']

/** "P-01", "P-01 e P-02", "P-01, P-02 e P-03"; acima de `max`, "… e mais N". */
function listar(ids: string[], max = 6) {
  if (ids.length > max) return `${ids.slice(0, max).join(', ')} e mais ${ids.length - max}`
  if (ids.length <= 1) return ids[0] ?? ''
  return `${ids.slice(0, -1).join(', ')} e ${ids[ids.length - 1]}`
}

/** "1 máquina P", "3 máquinas G". */
const qtdTipo = (n: number, tipo: TipoMaquina) => `${numero(n)} ${n === 1 ? 'máquina' : 'máquinas'} ${tipo}`

type TipoLinha = 'criar' | 'excluir' | 'desativar' | 'erro'

/** O que vai acontecer com um tipo de máquina, em frases para o usuário. */
function linhasDoPlano(p: PlanoAjuste): Array<{ tipo: TipoLinha; texto: string }> {
  if (p.criar.length > LIMITES.lote) {
    return [{ tipo: 'erro', texto: `Dá para cadastrar no máximo ${LIMITES.lote} máquinas de uma vez.` }]
  }
  if (p.faltam) {
    const { manutencao, eventos } = p.presas
    const motivo = [
      manutencao.length &&
        `${listar(manutencao.map((m) => m.identificacao))} ${manutencao.length === 1 ? 'está' : 'estão'} em manutenção`,
      eventos.length &&
        `${listar(eventos.map((m) => m.identificacao))} ${eventos.length === 1 ? 'tem' : 'têm'} eventos de hoje em diante`,
    ]
      .filter(Boolean)
      .join(' e ')
    return [
      {
        tipo: 'erro',
        texto: `Não dá para ficar com ${qtdTipo(p.alvo, p.tipo)}: ${motivo}. O mínimo agora é ${p.alvo + p.faltam}.`,
      },
    ]
  }
  const linhas: Array<{ tipo: TipoLinha; texto: string }> = []
  const n = p.criar.length
  if (n === 1) linhas.push({ tipo: 'criar', texto: `Será cadastrada a máquina ${p.criar[0]}.` })
  else if (n > 6)
    linhas.push({ tipo: 'criar', texto: `Serão cadastradas ${n} máquinas novas, de ${p.criar[0]} a ${p.criar[n - 1]}.` })
  else if (n) linhas.push({ tipo: 'criar', texto: `Serão cadastradas as máquinas ${listar(p.criar)}.` })
  if (p.excluir.length) {
    const ids = listar(ordenarMaquinas(p.excluir).map((m) => m.identificacao))
    linhas.push({
      tipo: 'excluir',
      texto: p.excluir.length === 1 ? `${ids} será excluída (nunca foi usada).` : `${ids} serão excluídas (nunca foram usadas).`,
    })
  }
  if (p.desativar.length) {
    const ids = listar(ordenarMaquinas(p.desativar).map((m) => m.identificacao))
    linhas.push({
      tipo: 'desativar',
      texto:
        p.desativar.length === 1
          ? `${ids} será desativada. Ela já tem histórico, que continua guardado.`
          : `${ids} serão desativadas. Elas já têm histórico, que continua guardado.`,
    })
  }
  return linhas
}

/** Locada hoje como reserva (com o cliente, só cobrada se ele usar). */
const locadaComoReserva = (s: SituacaoMaquina) => s.estado === 'LOCADA' && !!s.reserva

/** Texto do balão de cada chip: situação, onde está (e se é reserva, parada ou usada) e o próximo evento. */
function tituloChip(m: Maquina, s: SituacaoMaquina, hoje: string) {
  let texto = `${m.identificacao} · ${ESTADO_MAQUINA[s.estado].label}`
  if (s.estado === 'LOCADA' && s.evento) {
    texto = locadaComoReserva(s)
      ? `${m.identificacao} · Reserva em ${localDaLocacao(s.evento)} (${USO_RESERVA_CURTO[usoDaReserva(s.evento, hoje)]})`
      : `${texto} em ${localDaLocacao(s.evento)}`
  }
  if (s.proxima && s.dataProxima) {
    texto += ` · Próximo evento: ${s.proxima.nome}, ${dataCurta(s.dataProxima)}`
    if (ehReserva(s.proxima, m.id)) texto += ' (como reserva)'
  }
  return texto
}

export function DisponibilidadeMaquinas() {
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const ordens = useDados((s) => s.ordens)
  const reclamacoes = useDados((s) => s.reclamacoes)
  const config = useDados((s) => s.config)
  const ajustarQuantidade = useDados((s) => s.ajustarQuantidade)
  const situacoes = useSituacoes()

  // Quantidade digitada por tipo; `null` = sem alteração (acompanha o servidor)
  const [rascunho, setRascunho] = useState<Record<TipoMaquina, number | null>>({ P: null, G: null })
  const [aplicando, setAplicando] = useState(false)

  const cap = useMemo(() => capacidade(maquinas, config), [maquinas, config])
  const alvo = (t: TipoMaquina) => rascunho[t] ?? cap[t]
  const mudou = (t: TipoMaquina) => rascunho[t] !== null && rascunho[t] !== cap[t]
  const total = alvo('P') + alvo('G')

  const hoje = useHoje()
  const planos = useMemo(() => {
    return TIPOS_MAQUINA.filter((t) => rascunho[t] !== null && rascunho[t] !== cap[t]).map((t) =>
      planoAjuste(maquinas, eventos, ordens, t, rascunho[t]!, hoje, reclamacoes),
    )
  }, [rascunho, cap, maquinas, eventos, ordens, hoje, reclamacoes])
  const alterado = planos.length > 0
  const bloqueado = planos.some((p) => p.faltam > 0 || p.criar.length > LIMITES.lote)

  const contagem = useMemo(() => {
    const c: Record<EstadoMaquina | 'RESERVA', number> = { DISPONIVEL: 0, LOCADA: 0, MANUTENCAO: 0, DESATIVADA: 0, RESERVA: 0 }
    for (const m of maquinas) {
      const s = situacoes.get(m.id)
      c[s?.estado ?? 'DISPONIVEL']++
      // As reservas também estão entre as locadas: só mostra quantas delas
      if (s && locadaComoReserva(s)) c.RESERVA++
    }
    return c
  }, [maquinas, situacoes])

  const desfazer = () => setRascunho({ P: null, G: null })

  const aplicar = async () => {
    if (!alterado || bloqueado || aplicando) return
    const resumo = planos
      .map((p) => {
        const frases = linhasDoPlano(p)
          .map((l) => l.texto)
          .join(' ')
        return `${TIPO_MAQUINA[p.tipo].plural}: de ${p.atual} para ${p.alvo}. ${frases}`
      })
      .join(' ')
    const ok = await confirmar({ titulo: 'Aplicar a nova quantidade de máquinas?', descricao: resumo, confirmar: 'Aplicar' })
    if (!ok) return
    setAplicando(true)
    const feitos: TipoMaquina[] = []
    try {
      for (const p of planos) {
        await ajustarQuantidade(p.tipo, p.alvo)
        feitos.push(p.tipo)
      }
      toast.sucesso(
        'Quantidade de máquinas atualizada',
        `Agora são ${alvo('P')} máquinas P e ${alvo('G')} G (${total} no total).`,
      )
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'Erro inesperado.'
      if (feitos.length) {
        toast.erro(
          'O ajuste foi feito só em parte',
          `${TIPO_MAQUINA[feitos[0]].plural} foram ajustadas, as outras não. ${motivo}`,
        )
      } else toast.erro('Não foi possível ajustar as máquinas', motivo)
    } finally {
      // O que foi gravado já aparece pelo servidor; o que falhou continua no campo para corrigir
      setRascunho((r) => {
        const n = { ...r }
        for (const t of feitos) n[t] = null
        return n
      })
      setAplicando(false)
    }
  }

  return (
    <Card>
      <CardHeader
        icone={<IconeMaquinaFichas className="h-4 w-4" />}
        titulo="Disponibilidade de máquinas"
        descricao="Quantas máquinas de cada tipo a empresa tem. Vale para a agenda e para os eventos."
      />
      <div className="grid grid-cols-1 gap-6 px-5 pb-5 xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        {/* ---- Quantidades ---- */}
        <div className="flex w-full max-w-xl flex-col gap-3 xl:max-w-none">
          <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
            {TIPOS_MAQUINA.map((t) => (
              <div key={t} className="flex items-center gap-3 px-4 py-3">
                <TipoMaquinaBadge tipo={t} className="h-7 min-w-7 rounded-lg text-[13px]" />
                <label htmlFor={`qtd-${t}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-sm font-medium text-ink">{TIPO_MAQUINA[t].plural}</span>
                  <span className={cn('block text-xs', mudou(t) ? 'text-brand-ink' : 'text-muted')}>
                    {t === 'P' ? 'Pequenas' : 'Grandes'}
                    {mudou(t) && <span className="whitespace-nowrap"> · eram {numero(cap[t])}</span>}
                  </span>
                </label>
                <NumberInput
                  id={`qtd-${t}`}
                  valor={alvo(t)}
                  min={0}
                  max={LIMITES.maquinas}
                  aoMudar={(v) => setRascunho((r) => ({ ...r, [t]: v ?? 0 }))}
                  disabled={aplicando}
                  className="w-28 shrink-0 sm:w-32"
                />
              </div>
            ))}
            <div className="flex items-center gap-3 bg-surface-2/70 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">Total</p>
                <p className="text-xs text-muted">
                  {!cap.cadastradas ? (
                    'Nenhuma cadastrada ainda'
                  ) : alterado ? (
                    <>Hoje são {numero(cap.P + cap.G)}</>
                  ) : cap.manutencao > 0 ? (
                    <span className="text-warning">
                      {cap.manutencao === 1 ? '1 está em manutenção agora' : `${cap.manutencao} estão em manutenção agora`}
                    </span>
                  ) : (
                    'Soma das máquinas P e G'
                  )}
                </p>
              </div>
              <p className="flex items-baseline gap-1.5 text-ink">
                <span className="tnum text-[26px] leading-none font-semibold tracking-[-0.025em]">
                  <AnimatedNumber valor={total} formatar={(v) => numero(Math.round(v))} />
                </span>
                <span className="text-[13px] text-muted">{total === 1 ? 'máquina' : 'máquinas'}</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-muted">
            Contam as máquinas disponíveis, locadas e em manutenção. As desativadas ficam de fora.
          </p>

          <AnimatePresence initial={false}>
            {alterado && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-3.5" role="status">
                  <p className="text-[13px] font-medium text-ink">Ao aplicar:</p>
                  <ul className="mt-2 flex flex-col gap-2.5">
                    {planos.map((p) => (
                      <li key={p.tipo} className="flex flex-col gap-1.5">
                        <p className="flex items-center gap-2 text-xs font-medium text-ink-2">
                          <TipoMaquinaBadge tipo={p.tipo} />
                          {TIPO_MAQUINA[p.tipo].plural}: de {p.atual} para {p.alvo}
                        </p>
                        {linhasDoPlano(p).map((l) => (
                          <LinhaPlano key={l.tipo} tipo={l.tipo} texto={l.texto} />
                        ))}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3.5 flex flex-wrap justify-end gap-2">
                    <Button
                      tamanho="sm"
                      variante="ghost"
                      icone={<RotateCcw className="h-3.5 w-3.5" />}
                      onClick={desfazer}
                      disabled={aplicando}
                    >
                      Desfazer
                    </Button>
                    <Button
                      tamanho="sm"
                      variante="primary"
                      icone={aplicando ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : undefined}
                      onClick={() => void aplicar()}
                      disabled={bloqueado || aplicando}
                    >
                      {aplicando ? 'Aplicando…' : 'Aplicar'}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---- Máquinas cadastradas ---- */}
        <div className="flex min-w-0 flex-col gap-4">
          {!cap.cadastradas ? (
            <div className="flex items-start gap-3 rounded-xl bg-surface-2 px-4 py-3.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="text-[13px] leading-relaxed text-ink-2">
                <p className="font-medium text-ink">Nenhuma máquina cadastrada ainda</p>
                <p className="mt-0.5">
                  Enquanto isso, a agenda e os eventos consideram{' '}
                  <b className="font-semibold text-ink">{numero(config.frotaMaquinas)} máquinas</b>. Informe quantas máquinas P e
                  G a empresa tem e clique em “Aplicar”: elas são numeradas sozinhas (
                  <span className="whitespace-nowrap">P-01, P-02…</span> e <span className="whitespace-nowrap">G-01, G-02…</span>
                  ). Depois, cada uma pode ser acompanhada na Manutenção.
                </p>
              </div>
            </div>
          ) : (
            <>
              {TIPOS_MAQUINA.map((t) => {
                const lista = maquinas
                  .filter((m) => m.tipo === t)
                  // Desativadas por último
                  .sort((a, b) => Number(a.status === 'DESATIVADA') - Number(b.status === 'DESATIVADA'))
                if (!lista.length) return null
                return (
                  <div key={t} className="min-w-0">
                    <p className="mb-2 flex items-center gap-2 text-[13px] font-medium text-ink-2">
                      {TIPO_MAQUINA[t].plural}
                      <span className="text-xs font-normal text-muted">
                        {t === 'P' ? 'pequenas' : 'grandes'} · {numero(cap[t])} {cap[t] === 1 ? 'ativa' : 'ativas'}
                      </span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {lista.map((m, i) => {
                        const s = situacoes.get(m.id) ?? { estado: 'DISPONIVEL' as const }
                        return (
                          <motion.span
                            key={m.id}
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: Math.min(i, 30) * 0.012 }}
                          >
                            <MaquinaChip
                              maquina={m}
                              estado={s.estado}
                              reserva={locadaComoReserva(s)}
                              titulo={tituloChip(m, s, hoje)}
                            />
                          </motion.span>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legenda das cores">
                  {ORDEM_LEGENDA.map((e) => (
                    <li key={e} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className={cn('h-2 w-2 rounded-full', COR_LEGENDA[e])} />
                      {ESTADO_MAQUINA[e].label}
                      <b className="tnum font-semibold text-ink-2">{contagem[e]}</b>
                      {e === 'LOCADA' && contagem.RESERVA > 0 && (
                        <span title="As reservas ficam com o cliente sem uso, a não ser que ele use: dá para buscar uma delas se faltar máquina.">
                          (<SeloReserva pequeno className="mr-1 align-[-2px]" />
                          <span className="tnum">{contagem.RESERVA}</span> como reserva)
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <Link
                  to="/manutencao"
                  className="inline-flex items-center gap-1 text-[13px] font-medium whitespace-nowrap text-brand-ink hover:underline"
                >
                  Ver na Manutenção <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

function LinhaPlano({ tipo, texto }: { tipo: TipoLinha; texto: string }) {
  const icone = {
    criar: <Plus className="h-3.5 w-3.5 text-success" />,
    excluir: <Trash2 className="h-3.5 w-3.5 text-muted" />,
    desativar: <PowerOff className="h-3.5 w-3.5 text-muted" />,
    erro: <TriangleAlert className="h-3.5 w-3.5 text-danger" />,
  }[tipo]
  // Identificações com hífen ("G-02") não quebram no meio da linha
  const partes = texto.split(/(\S+-\S+)/)
  return (
    <p className={cn('flex items-start gap-2 text-[13px] leading-snug', tipo === 'erro' ? 'text-danger' : 'text-ink-2')}>
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span className="min-w-0">
        {partes.map((p, i) =>
          i % 2 ? (
            <span key={i} className="whitespace-nowrap">
              {p}
            </span>
          ) : (
            p
          ),
        )}
      </span>
    </p>
  )
}
