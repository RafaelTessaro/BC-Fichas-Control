import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams, type NavigateOptions } from 'react-router-dom'
import { PainelDia } from '../components/agenda/PainelDia'
import { ResumoAgenda } from '../components/agenda/ResumoAgenda'
import { SeletorPeriodo } from '../components/agenda/SeletorPeriodo'
import { VisaoAno } from '../components/agenda/VisaoAno'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { PageHeader, Segmented } from '../components/ui/Misc'
import { STATUS_EVENTO } from '#shared/calc.ts'
import { capacidade, quantidadeCurta, quantidadePorExtenso } from '#shared/maquinas.ts'
import type { StatusEvento } from '#shared/tipos.ts'
import {
  acaoDaTecla,
  compararResumos,
  contagemEventos,
  corBarra,
  dicaDia,
  fimDoMes,
  foraNoDia,
  inicioDoMes,
  lerDia,
  lerMes,
  mesCurto,
  mesNoIntervalo,
  ocorrenciasPorDia,
  resumoDosMeses,
  resumoPeriodo,
  semanasDoMes,
  soComClienteNoDia,
  somarMeses,
  type Ocorrencia,
} from '../lib/agenda'
import { cn } from '../lib/cn'
import { numero } from '../lib/format'
import { useHoje } from '../lib/hoje'
import { useEventosCompletos, type EventoCompleto } from '../lib/hooks'
import { useDados } from '../store/dados'

const COR_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: 'bg-info',
  PENDENTE: 'bg-warning-dot',
  FINALIZADO: 'bg-success',
  CANCELADO: 'bg-neutral',
}

/** Bolinha vazada, nos dias em que as máquinas só ficam com o cliente. */
const ANEL_STATUS: Record<StatusEvento, string> = {
  EM_ABERTO: 'border-info',
  PENDENTE: 'border-warning-dot',
  FINALIZADO: 'border-success',
  CANCELADO: 'border-neutral',
}

type Visao = 'mes' | 'ano'

/** Bolinha com a cor do status: cheia nos dias de uso, vazada nos dias só com o cliente. */
function PontoStatus({ status, uso, className }: { status: StatusEvento; uso: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('shrink-0 rounded-full', uso ? COR_STATUS[status] : cn('border-[1.5px]', ANEL_STATUS[status]), className)}
    />
  )
}

/** "4 máquinas + 1 reserva (1 usada)", e "com o cliente, sem uso" nos dias do meio do período corrido. */
function tituloQuantidade(o: Ocorrencia<EventoCompleto>) {
  const usadas = o.reservasUsadas ? ` (${o.reservasUsadas} ${o.reservasUsadas === 1 ? 'usada' : 'usadas'})` : ''
  return `${quantidadePorExtenso(o.maquinas, o.reservas)}${usadas}${o.uso ? '' : ' com o cliente, sem uso neste dia'}`
}

/**
 * Agenda das máquinas: o mês (com o dia aberto no painel lateral) ou o ano inteiro como mapa de
 * calor. Mês, visão, comparação e dia ficam na URL (#/agenda?mes=2025-10&dia=2025-10-11), para o
 * voltar/atualizar do navegador funcionarem e para dar para guardar o endereço.
 */
export function Agenda() {
  const [params] = useSearchParams()
  const location = useLocation()
  const navegar = useNavigate()
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const eventosBrutos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const eventos = useEventosCompletos()
  const hojeIso = useHoje()
  const mesAtual = hojeIso.slice(0, 7)
  const idComparar = useId()

  // Estado da tela vindo da URL (valores inválidos caem no mês do dia aberto ou no mês atual)
  const { mes, visao, comparar, diaAberto } = useMemo(() => {
    const v: Visao = params.get('visao') === 'ano' ? 'ano' : 'mes'
    const dia = v === 'mes' ? lerDia(params.get('dia')) : null
    return {
      mes: lerMes(params.get('mes'), dia ? dia.slice(0, 7) : mesAtual),
      visao: v,
      comparar: params.get('comparar') === '1',
      diaAberto: dia,
    }
  }, [params, mesAtual])
  const ano = Number(mes.slice(0, 4))

  // Capacidade: máquinas P e G cadastradas (não desativadas) ou, sem cadastro, o número das configurações
  const capac = useMemo(() => capacidade(maquinas, config), [maquinas, config])
  const total = capac.total
  // De hoje em diante, as máquinas em manutenção não estão livres
  const capacidadeDoDia = useCallback(
    (iso: string) => (iso >= hojeIso ? total - capac.manutencao : total),
    [hojeIso, total, capac.manutencao],
  )
  const porId = useMemo(() => new Map(maquinas.map((m) => [m.id, m])), [maquinas])
  const mapaClientes = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])

  // Eventos de cada dia (titulares + reservas), com os dias em que as máquinas só ficam com o cliente
  const porDia = useMemo(() => ocorrenciasPorDia(eventos), [eventos])
  const contagem = useMemo(() => contagemEventos(porDia), [porDia])

  // Totais do mês (ou do ano) e do mesmo período do ano anterior
  const resumo = useMemo(() => {
    if (visao === 'ano') {
      return {
        atual: resumoPeriodo(porDia, `${ano}-01-01`, `${ano}-12-31`, capacidadeDoDia),
        anterior: resumoPeriodo(porDia, `${ano - 1}-01-01`, `${ano - 1}-12-31`, capacidadeDoDia),
        rotulo: String(ano - 1),
      }
    }
    const antes = somarMeses(mes, -12)
    return {
      atual: resumoPeriodo(porDia, inicioDoMes(mes), fimDoMes(mes), capacidadeDoDia),
      anterior: resumoPeriodo(porDia, inicioDoMes(antes), fimDoMes(antes), capacidadeDoDia),
      rotulo: mesCurto(antes),
    }
  }, [visao, ano, mes, porDia, capacidadeDoDia])

  const meses = useMemo(
    () => (visao === 'ano' ? resumoDosMeses(porDia, ano, capacidadeDoDia) : []),
    [visao, porDia, ano, capacidadeDoDia],
  )
  const mesesAnteriores = useMemo(
    () => (visao === 'ano' && comparar ? resumoDosMeses(porDia, ano - 1, capacidadeDoDia) : null),
    [visao, comparar, porDia, ano, capacidadeDoDia],
  )

  const dias = useMemo(() => semanasDoMes(mes), [mes])

  // ---- Navegação (sempre pela URL) ----------------------------------------------------
  const endereco = (mudancas: Record<string, string | null>) => {
    const p = new URLSearchParams(params)
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null) p.delete(chave)
      else p.set(chave, valor)
    }
    const busca = p.toString()
    return { pathname: location.pathname, search: busca ? `?${busca}` : '' }
  }
  const ir = (mudancas: Record<string, string | null>, opcoes?: NavigateOptions) => {
    const destino = endereco(mudancas)
    // Mesmo endereço (ex.: "Hoje" já no mês atual): não empilha um passo igual no "voltar"
    if (destino.search === location.search) return
    navegar(destino, opcoes)
  }

  // Mês para onde a agenda já foi mandada: com a tecla segura, as setas chegam antes de a tela
  // atualizar, e cada uma precisa andar um mês a partir da anterior
  const mesPedido = useRef(mes)
  useEffect(() => {
    mesPedido.current = mes
  }, [mes])
  /** Mês (ou ano, na visão do ano) anterior/seguinte. */
  const mudarPeriodo = (delta: number) => {
    const novo = somarMeses(mesPedido.current, visao === 'ano' ? delta * 12 : delta)
    if (!mesNoIntervalo(novo)) return
    mesPedido.current = novo
    ir({ mes: novo, dia: null })
  }
  const irHoje = () => {
    mesPedido.current = mesAtual
    ir({ mes: null, dia: null })
  }
  const mudarVisao = (v: Visao) => ir({ visao: v === 'ano' ? 'ano' : null, dia: null })
  // A comparação não cria um passo no "voltar"
  const alternarComparar = () => ir({ comparar: comparar ? null : '1' }, { replace: true })
  const abrirMes = (m: string) => {
    mesPedido.current = m
    ir({ mes: m, visao: null, dia: null })
  }
  const abrirDia = (data: string) => {
    // Na visão do mês, o mês fica (mesmo num dia do mês vizinho, nas pontas da grade). Vindo do
    // ano, abre o mês do dia, e o "voltar" (e o fechar do painel) passa primeiro pela visão do mês
    const mesDoDia = visao === 'ano' ? data.slice(0, 7) : mes
    if (visao === 'ano') ir({ mes: mesDoDia, visao: null, dia: null })
    navegar(endereco({ mes: mesDoDia, visao: null, dia: data }), { state: { diaAberto: true } })
  }
  const fecharDia = () => {
    // Aberto por um clique: fechar é o mesmo que voltar; vindo de um endereço guardado, só tira o dia
    if ((location.state as { diaAberto?: boolean } | null)?.diaAberto) navegar(-1)
    else ir({ dia: null }, { replace: true })
  }

  // Teclas: ← / → (mês ou ano), T (hoje). Não atrapalham a digitação nem as janelas abertas
  const acoes = useRef({ mudarPeriodo, irHoje })
  useEffect(() => {
    acoes.current = { mudarPeriodo, irHoje }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const acao = acaoDaTecla(
        {
          key: e.key,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          isComposing: e.isComposing,
          defaultPrevented: e.defaultPrevented,
          alvo: e.target instanceof HTMLElement ? e.target : null,
        },
        !!document.querySelector('[role="dialog"]'),
      )
      if (!acao) return
      e.preventDefault()
      if (acao === 'hoje') acoes.current.irHoje()
      else acoes.current.mudarPeriodo(acao === 'anterior' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Direção da animação: para a esquerda ao avançar, para a direita ao voltar
  const vista = visao === 'ano' ? `ano:${ano}` : `mes:${mes}`
  const [vistaAnterior, setVistaAnterior] = useState(vista)
  const [direcao, setDirecao] = useState(0)
  if (vista !== vistaAnterior) {
    setVistaAnterior(vista)
    setDirecao(vista.slice(0, 4) !== vistaAnterior.slice(0, 4) ? 0 : vista > vistaAnterior ? 1 : -1)
  }

  const comparacao = comparar ? compararResumos(resumo.atual, resumo.anterior) : null
  const unidade = visao === 'ano' ? 'Ano' : 'Mês'
  const itensDiaAberto = diaAberto ? (porDia.get(diaAberto) ?? []) : []

  return (
    <>
      <PageHeader
        titulo="Agenda"
        descricao={
          capac.cadastradas ? (
            <>
              Ocupação diária das {numero(total)} máquinas ({numero(capac.P)} P e {numero(capac.G)} G), com as reservas.
              {capac.manutencao > 0 &&
                (capac.manutencao === 1 ? ' 1 está em manutenção agora.' : ` ${capac.manutencao} estão em manutenção agora.`)}
            </>
          ) : (
            <>
              Ocupação diária considerando {numero(total)} máquinas.{' '}
              <Link to="/configuracoes" className="font-medium text-brand-ink hover:underline">
                Informe quantas máquinas P e G a empresa tem
              </Link>
            </>
          )
        }
        acoes={
          <Button variante="primary" icone={<CalendarPlus className="h-4 w-4" />} onClick={() => navegar('/eventos/novo')}>
            Novo evento
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              tamanho="icon-sm"
              onClick={() => mudarPeriodo(-1)}
              aria-label={`${unidade} anterior`}
              title={`${unidade} anterior (←)`}
              disabled={!mesNoIntervalo(somarMeses(mes, visao === 'ano' ? -12 : -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <SeletorPeriodo
              visao={visao}
              mes={mes}
              mesAtual={mesAtual}
              porMes={contagem.porMes}
              porAno={contagem.porAno}
              aoEscolherMes={abrirMes}
              aoEscolherAno={(a) => ir({ mes: `${a}${mes.slice(4)}`, dia: null })}
            />
            <Button
              tamanho="icon-sm"
              onClick={() => mudarPeriodo(1)}
              aria-label={visao === 'ano' ? 'Próximo ano' : 'Próximo mês'}
              title={`${visao === 'ano' ? 'Próximo ano' : 'Próximo mês'} (→)`}
              disabled={!mesNoIntervalo(somarMeses(mes, visao === 'ano' ? 12 : 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button tamanho="sm" variante="ghost" className="ml-1" onClick={irHoje} title="Voltar para hoje (T)">
              Hoje
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 lg:ml-auto">
            <Segmented
              tamanho="sm"
              valor={visao}
              aoMudar={mudarVisao}
              opcoes={[
                { valor: 'mes', label: 'Mês' },
                { valor: 'ano', label: 'Ano' },
              ]}
            />
            <div className="inline-flex items-center gap-2">
              <button
                id={idComparar}
                type="button"
                role="switch"
                aria-checked={comparar}
                onClick={alternarComparar}
                className={cn(
                  'relative inline-flex h-5 w-8 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200',
                  'focus-visible:ring-4 focus-visible:ring-[var(--ring)] focus-visible:outline-none',
                  comparar ? 'justify-end bg-brand' : 'justify-start bg-surface-3 ring-1 ring-line-strong ring-inset',
                )}
              >
                <motion.span
                  layout
                  transition={{ type: 'spring', stiffness: 700, damping: 35 }}
                  className="h-4 w-4 rounded-full bg-white shadow-xs"
                />
              </button>
              <label htmlFor={idComparar} className="cursor-pointer text-[13px] font-medium whitespace-nowrap text-ink-2">
                Comparar com {ano - 1}
              </label>
            </div>
          </div>
        </div>

        <ResumoAgenda
          resumo={resumo.atual}
          comparacao={comparacao}
          rotuloAnterior={resumo.rotulo}
          total={total}
          periodo={visao}
        />

        <div className="relative overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={direcao}>
            <motion.div
              key={vista}
              custom={direcao}
              initial={{ opacity: 0, x: direcao * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direcao * -40 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {visao === 'ano' ? (
                <VisaoAno
                  ano={ano}
                  porDia={porDia}
                  frota={total}
                  capacidadeDoDia={capacidadeDoDia}
                  hoje={hojeIso}
                  resumos={meses}
                  anteriores={mesesAnteriores}
                  aoAbrirDia={abrirDia}
                  aoAbrirMes={abrirMes}
                />
              ) : (
                <GradeMes
                  mes={mes}
                  dias={dias}
                  porDia={porDia}
                  hoje={hojeIso}
                  total={total}
                  capacidadeDoDia={capacidadeDoDia}
                  aoAbrirDia={abrirDia}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {visao === 'mes' && <LegendaMes />}
      </Card>

      <PainelDia
        data={diaAberto}
        itens={itensDiaAberto}
        eventos={eventosBrutos}
        clientes={mapaClientes}
        porId={porId}
        total={total}
        capacidadeDoDia={diaAberto ? capacidadeDoDia(diaAberto) : total}
        manutencao={diaAberto && diaAberto >= hojeIso ? capac.manutencao : 0}
        avisarVazio={capac.cadastradas}
        aoFechar={fecharDia}
        aoNovoEvento={(d) => navegar(`/eventos/novo?data=${d}`)}
      />
    </>
  )
}

/** Visão do mês: semanas inteiras, cada dia com os eventos ("4+1") e a barra de ocupação. */
function GradeMes({
  mes,
  dias,
  porDia,
  hoje,
  total,
  capacidadeDoDia,
  aoAbrirDia,
}: {
  mes: string
  dias: string[]
  porDia: Map<string, Array<Ocorrencia<EventoCompleto>>>
  hoje: string
  total: number
  capacidadeDoDia: (iso: string) => number
  aoAbrirDia: (iso: string) => void
}) {
  return (
    <>
      <div className="grid grid-cols-7 border-b border-line bg-surface-2/60">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[12px] font-medium text-muted sm:px-3 sm:text-left">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((iso) => {
          const itens = porDia.get(iso) ?? []
          // Titulares + reservas dos eventos não cancelados
          const fora = foraNoDia(itens)
          // Parte das máquinas que só está com o cliente (traço mais claro na barra)
          const comCliente = soComClienteNoDia(itens)
          const capDia = capacidadeDoDia(iso)
          const pct = capDia > 0 ? fora / capDia : fora > 0 ? 2 : 0
          const doMes = iso.startsWith(mes)
          const ehHoje = iso === hoje
          return (
            <button
              type="button"
              key={iso}
              onClick={() => aoAbrirDia(iso)}
              aria-label={`${dicaDia(iso, itens)}${fora ? ` (${fora} de ${total} máquinas fora)` : ''}${ehHoje ? ', hoje' : ''}`}
              className={cn(
                'group relative flex min-h-[78px] min-w-0 cursor-pointer flex-col gap-1 border-r border-b border-line p-1.5 text-left transition-colors sm:min-h-[118px] sm:p-2 [&:nth-child(7n)]:border-r-0',
                doMes ? 'bg-surface hover:bg-surface-2/70' : 'bg-surface-2/40 hover:bg-surface-2/80',
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'tnum flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-medium',
                    ehHoje ? 'bg-brand text-white' : doMes ? 'text-ink' : 'text-muted/70',
                  )}
                >
                  {Number(iso.slice(8))}
                </span>
                {fora > 0 && (
                  <span
                    className={cn(
                      'tnum hidden text-[11px] font-medium sm:block',
                      pct > 1 ? 'text-danger' : pct >= 0.8 ? 'text-warning' : 'text-muted',
                    )}
                    title={`${fora} de ${total} máquinas fora (titulares + reservas)${comCliente ? `, ${comCliente} só com o cliente` : ''}`}
                  >
                    {fora}/{total}
                  </span>
                )}
              </div>

              <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                {itens.slice(0, 2).map((o) => (
                  <span
                    key={o.item.evento.id}
                    title={
                      o.uso
                        ? undefined
                        : `${o.item.evento.nome}: as máquinas ficam com o cliente entre os dias de uso (sem uso neste dia)`
                    }
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[11.5px] leading-tight',
                      o.uso
                        ? 'bg-surface-2 py-[3px] text-ink-2 ring-1 ring-line/60'
                        : 'border border-dashed border-line-strong py-[2px] text-muted',
                      o.item.evento.status === 'CANCELADO' && 'line-through opacity-60',
                    )}
                  >
                    <PontoStatus status={o.item.evento.status} uso={o.uso} className="h-1.5 w-1.5" />
                    <span className="truncate">{o.item.evento.nome}</span>
                    <span className="tnum ml-auto shrink-0 font-medium text-muted" title={tituloQuantidade(o)}>
                      {quantidadeCurta(o.maquinas, o.reservas)}
                    </span>
                  </span>
                ))}
                {itens.length > 2 && <span className="px-1 text-[11px] font-medium text-muted">+{itens.length - 2} mais</span>}
              </div>

              {/* Versão compacta (celular): pontos por evento */}
              {itens.length > 0 && (
                <div className="flex flex-wrap gap-1 sm:hidden">
                  {itens.slice(0, 4).map((o) => (
                    <PontoStatus key={o.item.evento.id} status={o.item.evento.status} uso={o.uso} className="h-1.5 w-1.5" />
                  ))}
                </div>
              )}

              {fora > 0 && (
                <div className="mt-auto h-1 w-full overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, pct * 100)}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                    className="flex h-full overflow-hidden rounded-full"
                  >
                    {/* Dias de uso em traço cheio; só com o cliente, mais claro (mas contando igual) */}
                    <span className={cn('h-full', corBarra(pct))} style={{ width: `${((fora - comCliente) / fora) * 100}%` }} />
                    <span className={cn('h-full flex-1 opacity-45', corBarra(pct))} />
                  </motion.div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

function LegendaMes() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs text-muted">
      {(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2 w-2 rounded-full', COR_STATUS[s])} />
          {STATUS_EVENTO[s].label}
        </span>
      ))}
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        title="Período corrido: as máquinas ficam com o cliente entre um dia de uso e outro. Contam como ocupadas, sem diária."
      >
        <span className="inline-flex h-3.5 w-5 items-center justify-center rounded-[4px] border border-dashed border-line-strong">
          <span className="h-1.5 w-1.5 rounded-full border-[1.5px] border-muted" />
        </span>
        Com o cliente, sem uso
      </span>
      <span
        className="inline-flex items-center gap-1.5 whitespace-nowrap"
        title="Máquinas titulares + reservas que vão para o cliente"
      >
        <b className="tnum font-semibold text-ink-2">4+1</b> titulares + reserva
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto">
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="flex h-1 w-5 overflow-hidden rounded-full">
            <span className="h-full w-3 bg-brand" />
            <span className="h-full flex-1 bg-brand opacity-45" />
          </span>{' '}
          Ocupação das máquinas
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1 w-5 rounded-full bg-warning-dot" /> 80% ou mais
        </span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1 w-5 rounded-full bg-danger" /> Acima do total
        </span>
      </span>
    </div>
  )
}
