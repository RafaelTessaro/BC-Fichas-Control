import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { CalendarPlus, ChevronLeft, ChevronRight, Clock, Repeat, TriangleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ocupacaoPorDia } from '#shared/calc.ts'
import { LIMITES } from '#shared/dominio.ts'
import { capacidade, dataCurtinha, diasOcupados, listaDatas, periodoEvento, somarDias } from '#shared/maquinas.ts'
import type { Evento } from '#shared/tipos.ts'
import { cn } from '../lib/cn'
import { cap, codigoEvento, dataExtensa, periodo } from '../lib/format'
import { useHoje } from '../lib/hoje'
import {
  DIAS_DA_SEMANA,
  descreverRegra,
  diaDaSemana,
  diasDaCopia,
  faltasDaCopia,
  gradeDoMes,
  regrasDaData,
  repetirTodoMes,
  rotuloCopia,
  somarMeses,
  somarOcupacao,
  type FaltaMaquinas,
} from '../lib/repeticao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { Select } from './ui/Form'
import { Modal } from './ui/Modal'

type Mes = { ano: number; mes: number }

const mesDe = (data: string): Mes => ({ ano: Number(data.slice(0, 4)), mes: Number(data.slice(5, 7)) })

/** "14/11/2026". */
const dataComAno = (data: string) => `${dataCurtinha(data)}/${data.slice(0, 4)}`

/** "Falta 1 máquina em 11/07", "Faltam máquinas em 10/07 e 11/07 (até 2)". */
function textoFalta(faltas: FaltaMaquinas[]) {
  const pior = Math.max(...faltas.map((f) => f.faltam))
  if (faltas.length === 1) {
    return `${pior === 1 ? 'Falta 1 máquina' : `Faltam ${pior} máquinas`} em ${dataCurtinha(faltas[0].data)}`
  }
  return `Faltam máquinas em ${listaDatas(faltas.map((f) => f.data))} (até ${pior})`
}

/**
 * "Repetir em outras datas": o usuário escolhe no calendário a data de início de cada repetição
 * (ex.: as festas do ano que o cliente já passou) e o servidor cria um evento para cada uma, com o
 * mesmo desenho de dias, valores e reservas (ver Repositorio.repetirEvento).
 */
export function RepetirEventoModal({ aberto, aoFechar, evento }: { aberto: boolean; aoFechar: () => void; evento: Evento }) {
  const eventos = useDados((s) => s.eventos)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const repetirEvento = useDados((s) => s.repetirEvento)
  const hoje = useHoje()
  const inicio = periodoEvento(evento)?.inicio ?? ''
  const diaSemana = inicio ? DIAS_DA_SEMANA[diaDaSemana(inicio)] : null
  // O calendário abre no mês seguinte ao do evento
  const mesInicial = (): Mes => {
    const base = mesDe(inicio || hoje)
    return somarMeses(base.ano, base.mes, 1)
  }

  const [datas, setDatas] = useState<string[]>([])
  const [mes, setMes] = useState<Mes>(mesInicial)
  const [direcao, setDirecao] = useState(1)
  const [regraSel, setRegraSel] = useState(0)
  const [meses, setMeses] = useState(6)
  const [criando, setCriando] = useState(false)
  const grade = useRef<HTMLDivElement>(null)
  // Data que as setas do teclado pediram num outro mês: recebe o foco depois de virar a página
  const focoPendente = useRef<string | null>(null)

  // Cada abertura começa do zero
  const [abertoAntes, setAbertoAntes] = useState(aberto)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      setDatas([])
      setMes(mesInicial())
      setRegraSel(0)
    }
  }

  const focar = (data: string) => grade.current?.querySelector<HTMLButtonElement>(`[data-data="${data}"]`)?.focus()
  useEffect(() => {
    if (!focoPendente.current) return
    focar(focoPendente.current)
    focoPendente.current = null
  }, [mes])

  // Os outros eventos da série (não cancelados): as datas de início deles não podem ser escolhidas
  // de novo, e o "todo mês" continua depois da última
  const serie = useMemo(() => {
    const inicios = new Set<string>()
    const dias = new Set(evento.dias.map((d) => d.data))
    if (evento.grupoId) {
      for (const e of eventos) {
        if (e.grupoId !== evento.grupoId || e.id === evento.id || e.status === 'CANCELADO') continue
        const p = periodoEvento(e)
        if (p) inicios.add(p.inicio)
        for (const d of e.dias) dias.add(d.data)
      }
    }
    return { inicios, dias, ultimo: [...inicios].sort().pop() ?? '' }
  }, [eventos, evento.id, evento.grupoId, evento.dias])
  const bloqueada = useCallback((data: string) => data === inicio || serie.inicios.has(data), [inicio, serie])

  const regras = useMemo(() => (inicio ? regrasDaData(inicio) : []), [inicio])
  const regra = regras[Math.min(regraSel, regras.length - 1)]
  // "Todo mês" conta a partir do evento — ou de hoje, se ele já passou, ou da última data da série
  const baseTodoMes = [inicio, hoje, serie.ultimo].sort().pop() ?? hoje
  const previa = useMemo(
    () => (regra ? repetirTodoMes(regra, baseTodoMes, meses).filter((d) => !bloqueada(d)) : []),
    [regra, baseTodoMes, meses, bloqueada],
  )

  const total = capacidade(maquinas, config).total
  const copiaEm = useCallback(
    (data: string) => ({ dias: diasDaCopia(evento.dias, data), periodoCorrido: evento.periodoCorrido }),
    [evento.dias, evento.periodoCorrido],
  )
  const copias = useMemo(() => datas.map((data) => ({ data, ...copiaEm(data) })), [datas, copiaEm])
  // Ocupação de cada dia com as cópias escolhidas (elas também disputam as máquinas entre si)
  // (fechada, a janela continua montada no detalhe do evento: não calcula nada)
  const ocupacao = useMemo(
    () => (aberto ? somarOcupacao(ocupacaoPorDia(eventos), copias) : new Map<string, number>()),
    [aberto, eventos, copias],
  )
  const itens = useMemo(
    () =>
      copias.map((c) => {
        const ocupados = diasOcupados(c)
        return {
          ...c,
          usos: ocupados.filter((d) => d.uso).length,
          ocupados: ocupados.length,
          faltas: faltasDaCopia(c, ocupacao, total, true),
        }
      }),
    [copias, ocupacao, total],
  )
  // Dias de uso das cópias escolhidas (além do início), para mostrar o desenho no calendário
  const diasDasCopias = useMemo(() => new Set(copias.flatMap((c) => c.dias.map((d) => d.data))), [copias])

  const casas = useMemo(() => gradeDoMes(mes.ano, mes.mes), [mes])
  // Datas do mês em que uma nova cópia faria faltar máquina
  const faltaria = useMemo(() => {
    const s = new Set<string>()
    if (!aberto) return s
    for (const data of casas) {
      if (data && !datas.includes(data) && faltasDaCopia(copiaEm(data), ocupacao, total).length) s.add(data)
    }
    return s
  }, [aberto, casas, datas, copiaEm, ocupacao, total])

  const irPara = (m: Mes) => {
    if (m.ano === mes.ano && m.mes === mes.mes) return
    setDirecao(m.ano * 12 + m.mes > mes.ano * 12 + mes.mes ? 1 : -1)
    setMes(m)
  }

  const alternar = (data: string) => {
    if (bloqueada(data) || criando) return
    setDatas((l) => (l.includes(data) ? l.filter((d) => d !== data) : [...l, data].sort()))
  }

  const marcarTodoMes = () => {
    if (!previa.length) return
    setDatas((l) => [...new Set([...l, ...previa])].sort())
    // Mostra no calendário o mês da primeira data marcada
    irPara(mesDe(previa[0]))
  }

  const teclado = (e: KeyboardEvent<HTMLButtonElement>, data: string) => {
    const delta = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key]
    if (!delta) return
    e.preventDefault()
    const alvo = somarDias(data, delta)
    const m = mesDe(alvo)
    if (m.ano === mes.ano && m.mes === mes.mes) return focar(alvo)
    focoPendente.current = alvo
    irPara(m)
  }

  const excesso = datas.length - LIMITES.repeticoes
  const criar = async () => {
    if (!datas.length || excesso > 0) return
    setCriando(true)
    try {
      const criados = await repetirEvento(evento.id, datas)
      toast.sucesso(
        criados.length === 1 ? '1 evento criado' : `${criados.length} eventos criados`,
        criados.length === 1
          ? '“Em aberto”, na mesma série deste evento. Escolha as máquinas enviadas perto da data.'
          : 'Todos “Em aberto”, na mesma série deste evento. Escolha as máquinas enviadas perto de cada data.',
      )
      aoFechar()
    } catch (e) {
      avisarErro('Não foi possível repetir o evento', e)
    } finally {
      setCriando(false)
    }
  }

  const r = periodoEvento(evento)
  const tituloMes = cap(format(new Date(mes.ano, mes.mes - 1, 1), "MMMM 'de' yyyy", { locale: ptBR }))
  const anoAtual = hoje.slice(0, 4)

  return (
    <Modal
      aberto={aberto}
      aoFechar={() => !criando && aoFechar()}
      icone={<Repeat className="h-5 w-5" />}
      titulo="Repetir em outras datas"
      descricao={
        <span className="tnum">
          {evento.nome} · {codigoEvento(evento.codigo)} · {periodo(r?.inicio ?? null, r?.fim ?? null)}
        </span>
      }
      largura="max-w-4xl"
      rodape={
        <>
          <Button onClick={aoFechar} disabled={criando}>
            Cancelar
          </Button>
          <Button
            variante="primary"
            icone={<CalendarPlus className="h-4 w-4" />}
            onClick={() => void criar()}
            disabled={!datas.length || excesso > 0 || criando}
          >
            {criando
              ? 'Criando…'
              : datas.length === 0
                ? 'Criar eventos'
                : datas.length === 1
                  ? 'Criar 1 evento'
                  : `Criar ${datas.length} eventos`}
          </Button>
        </>
      }
    >
      {!inicio ? (
        <p className="text-sm text-muted">Este evento ainda não tem dias de utilização. Use “Editar” para informar as datas.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            Escolha a data de início de cada repetição. Cada data vira um evento separado — com pagamento, recibo e status
            próprios —, com os mesmos valores, máquinas por dia e reservas. As máquinas enviadas são escolhidas depois, perto de
            cada data.
          </p>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            {/* Calendário de seleção múltipla */}
            <div className="flex min-w-0 flex-col gap-2">
              <div className="rounded-2xl border border-line p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <Button
                    variante="ghost"
                    tamanho="icon-sm"
                    onClick={() => irPara(somarMeses(mes.ano, mes.mes, -1))}
                    aria-label="Mês anterior"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <h3 className="text-sm font-semibold text-ink" aria-live="polite">
                    {tituloMes}
                  </h3>
                  <Button
                    variante="ghost"
                    tamanho="icon-sm"
                    onClick={() => irPara(somarMeses(mes.ano, mes.mes, 1))}
                    aria-label="Próximo mês"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-7 gap-1 pb-1" aria-hidden>
                  {DIAS_DA_SEMANA.map((d, i) => (
                    <span
                      key={d.curto}
                      className={cn(
                        'text-center text-[11px] font-medium capitalize',
                        i === diaDaSemana(inicio) ? 'font-semibold text-brand-ink' : 'text-muted',
                      )}
                    >
                      {d.curto}
                    </span>
                  ))}
                </div>
                <div ref={grade} className="relative overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false} custom={direcao}>
                    <motion.div
                      key={`${mes.ano}-${mes.mes}`}
                      initial={{ opacity: 0, x: direcao * 24 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: direcao * -24 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="grid grid-cols-7 gap-1"
                    >
                      {casas.map((data, i) =>
                        data ? (
                          <CasaDia
                            key={data}
                            data={data}
                            escolhida={datas.includes(data)}
                            daCopia={diasDasCopias.has(data)}
                            bloqueada={bloqueada(data)}
                            inicioEvento={data === inicio}
                            daSerie={serie.dias.has(data)}
                            mesmoDia={diaDaSemana(data) === diaDaSemana(inicio)}
                            passou={data < hoje}
                            hoje={data === hoje}
                            faltaria={faltaria.has(data)}
                            aoClicar={() => alternar(data)}
                            aoTeclar={(e) => teclado(e, data)}
                          />
                        ) : (
                          <span key={`vazio-${i}`} />
                        ),
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <Legenda serie={serie.inicios.size > 0} />
              </div>
              {diaSemana && (
                <p className="text-xs text-muted">
                  O evento começa {diaSemana.feminino ? 'numa' : 'num'} {diaSemana.nome}: escolha {diaSemana.plural} para manter o
                  mesmo desenho.
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              {/* Atalho: a mesma ocorrência do dia da semana nos próximos meses */}
              {regra && (
                <div className="rounded-2xl border border-line bg-surface-2/50 p-3">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <Repeat className="h-4 w-4 text-brand-ink" />
                    Repetir todo mês
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13px] text-ink-2">
                    {regras.length > 1 ? (
                      <Select
                        value={regraSel}
                        onChange={(e) => setRegraSel(Number(e.target.value))}
                        aria-label="Qual dia do mês"
                        className="h-8! w-auto! rounded-lg! text-[13px]!"
                      >
                        {regras.map((rg, i) => (
                          <option key={i} value={i}>
                            {cap(descreverRegra(rg))}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <b className="font-semibold text-ink">{cap(descreverRegra(regra))}</b>
                    )}
                    <span>de cada mês, por</span>
                    <Select
                      value={meses}
                      onChange={(e) => setMeses(Number(e.target.value))}
                      aria-label="Quantos meses"
                      className="h-8! w-auto! rounded-lg! text-[13px]!"
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? 'mês' : 'meses'}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="tnum min-w-0 text-xs text-muted">
                      {!previa.length
                        ? 'Essas datas já estão na série.'
                        : `${baseTodoMes === serie.ultimo ? 'Depois da última data da série: ' : ''}${
                            previa.length === 1
                              ? dataComAno(previa[0])
                              : `de ${dataComAno(previa[0])} a ${dataComAno(previa[previa.length - 1])}`
                          }`}
                    </p>
                    <Button tamanho="sm" variante="soft" onClick={marcarTodoMes} disabled={criando || !previa.length}>
                      Marcar datas
                    </Button>
                  </div>
                </div>
              )}

              {/* Datas escolhidas, com o resultado e os avisos de cada uma */}
              <div className="flex min-w-0 flex-col">
                <div className="mb-2 flex h-8 items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-ink">
                    Datas escolhidas
                    <span className="tnum ml-1.5 rounded-md bg-surface-3 px-1.5 text-[11px] leading-5 font-medium text-muted">
                      {datas.length}
                    </span>
                  </p>
                  {datas.length > 0 && (
                    <Button variante="ghost" tamanho="sm" onClick={() => setDatas([])} disabled={criando} className="-mr-2">
                      Limpar
                    </Button>
                  )}
                </div>
                {excesso > 0 && (
                  <p className="mb-2 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                    Dá para criar no máximo {LIMITES.repeticoes} eventos de uma vez: tire {excesso}{' '}
                    {excesso === 1 ? 'data' : 'datas'}.
                  </p>
                )}
                {datas.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-muted">
                    Clique nas datas do calendário ou use “Repetir todo mês”.
                  </p>
                ) : (
                  <ul className="scroll-fino flex flex-col gap-2 md:max-h-[300px] md:overflow-y-auto md:pr-1">
                    <AnimatePresence initial={false}>
                      {itens.map((it) => {
                        const rotulo = rotuloCopia(it.dias.map((d) => d.data))
                        const ano = it.data.slice(0, 4)
                        return (
                          <motion.li
                            key={it.data}
                            layout="position"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, height: 0, marginTop: -8 }}
                            transition={{ duration: 0.18 }}
                            className="shrink-0 overflow-hidden"
                          >
                            <div
                              className={cn(
                                'flex items-start gap-2 rounded-xl border px-3 py-2.5',
                                it.faltas.length ? 'border-danger/30' : 'border-line',
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="tnum text-sm font-medium text-ink">{rotulo}</p>
                                <p className="tnum text-xs text-muted">
                                  {it.usos} {it.usos === 1 ? 'dia' : 'dias'}
                                  {it.ocupados > it.usos && ` · ${it.ocupados} com o cliente`}
                                  {ano !== anoAtual && ` · ${ano}`}
                                </p>
                                {it.faltas.length > 0 && (
                                  <p className="tnum mt-1 flex items-start gap-1.5 text-xs font-medium text-danger">
                                    <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
                                    {textoFalta(it.faltas)}
                                  </p>
                                )}
                                {it.data < hoje && (
                                  <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-warning">
                                    <Clock className="mt-px h-3.5 w-3.5 shrink-0" />
                                    Esta data já passou
                                  </p>
                                )}
                              </div>
                              <Button
                                variante="ghost"
                                tamanho="icon-sm"
                                onClick={() => alternar(it.data)}
                                disabled={criando}
                                aria-label={`Remover ${rotulo}`}
                                title="Remover esta data"
                                className="-mt-0.5 -mr-1.5 h-7 w-7"
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </motion.li>
                        )
                      })}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function CasaDia({
  data,
  escolhida,
  daCopia,
  bloqueada,
  inicioEvento,
  daSerie,
  mesmoDia,
  passou,
  hoje,
  faltaria,
  aoClicar,
  aoTeclar,
}: {
  data: string
  escolhida: boolean
  /** Um dos dias (além do início) de uma repetição escolhida. */
  daCopia: boolean
  /** Início deste evento ou de outro da série: não pode ser escolhida. */
  bloqueada: boolean
  inicioEvento: boolean
  /** Um dos dias deste evento ou de outro da série. */
  daSerie: boolean
  mesmoDia: boolean
  passou: boolean
  hoje: boolean
  faltaria: boolean
  aoClicar: () => void
  aoTeclar: (e: KeyboardEvent<HTMLButtonElement>) => void
}) {
  const extenso = dataExtensa(data, "EEEE, d 'de' MMMM 'de' yyyy")
  const motivo = inicioEvento ? 'início deste evento' : 'já tem um evento desta série'
  const notas = [
    bloqueada && `${motivo}, não pode ser escolhida`,
    !bloqueada && daSerie && 'dia de um evento desta série',
    !escolhida && daCopia && 'dia de uma repetição escolhida',
    faltaria && !bloqueada && 'faltariam máquinas',
    passou && 'já passou',
  ].filter(Boolean)
  return (
    <button
      type="button"
      data-data={data}
      aria-pressed={escolhida}
      aria-disabled={bloqueada || undefined}
      aria-label={[extenso, ...notas].join(', ')}
      title={bloqueada ? cap(motivo) : faltaria ? 'Faltariam máquinas para uma repetição nesta data' : undefined}
      onClick={aoClicar}
      onKeyDown={aoTeclar}
      className={cn(
        'tnum relative flex h-10 items-center justify-center rounded-lg text-[13px] font-medium transition-colors duration-150',
        'focus-visible:ring-4 focus-visible:ring-[var(--ring)] focus-visible:outline-none',
        bloqueada
          ? 'cursor-not-allowed bg-surface-3 text-muted ring-1 ring-line-strong ring-inset'
          : escolhida
            ? 'cursor-pointer bg-brand text-white shadow-xs hover:bg-brand-hover'
            : daCopia
              ? 'cursor-pointer bg-brand-soft text-brand-ink hover:brightness-[0.97] dark:hover:brightness-125'
              : cn(
                  'cursor-pointer hover:bg-surface-3',
                  mesmoDia && 'bg-brand-soft/45',
                  daSerie && 'ring-1 ring-line-strong ring-inset',
                  passou ? 'text-muted' : 'text-ink',
                ),
      )}
    >
      {Number(data.slice(8, 10))}
      {hoje && (
        <span aria-hidden className={cn('absolute bottom-1 h-0.5 w-3 rounded-full', escolhida ? 'bg-white/80' : 'bg-brand')} />
      )}
      {faltaria && !bloqueada && <span aria-hidden className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-danger" />}
    </button>
  )
}

function Legenda({ serie }: { serie: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-[11.5px] text-muted">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[4px] bg-brand" />
        Escolhida
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[4px] bg-brand-soft ring-1 ring-brand/30" />
        Dias da repetição
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[4px] bg-surface-3 ring-1 ring-line-strong" />
        {serie ? 'Esta série' : 'Este evento'}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        Faltariam máquinas
      </span>
    </div>
  )
}
