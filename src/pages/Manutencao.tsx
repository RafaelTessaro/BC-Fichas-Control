// Aba Manutenção: as máquinas P e G, onde cada uma está hoje e as manutenções em aberto.

import {
  CalendarClock,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  ListChecks,
  MapPin,
  MessageSquareWarning,
  Pencil,
  Plus,
  Settings,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  codigoOS,
  ESTADO_MAQUINA,
  localDaLocacao,
  osEmAberto,
  periodoEvento,
  TIPO_MAQUINA,
  TIPO_OS,
  type EstadoMaquina,
  type SituacaoMaquina,
  vaiComoReserva,
} from '#shared/maquinas.ts'
import type { Maquina, OrdemServico, TipoMaquina } from '#shared/tipos.ts'
import { IconeMaquinaFichas } from '../components/IconeMaquinaFichas'
import { MaquinaChip, SeloReserva, SituacaoBadge, StatusOSBadge, TipoMaquinaBadge, useSituacoes } from '../components/Maquinas'
import { MaquinaFormModal } from '../components/MaquinaFormModal'
import { OrdemServicoModal } from '../components/OrdemServicoModal'
import { ServicosManutencaoModal } from '../components/ServicosManutencaoModal'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Select } from '../components/ui/Form'
import { EmptyState, PageHeader, SearchInput, Segmented, StatCard } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { dataCurta, numero, periodo } from '../lib/format'
import {
  DICA_RESERVA,
  haQuantoTempo,
  indicesOrdens,
  maquinaCombina,
  ordenarOrdens,
  reclamacoesPorMaquina,
  USO_RESERVA_CURTO,
  usoDaReserva,
} from '../lib/manutencao'
import { useDados } from '../store/dados'
import { useHoje } from '../lib/hoje'

type FiltroSituacao = 'todas' | EstadoMaquina

const ORDEM_ESTADOS: EstadoMaquina[] = ['DISPONIVEL', 'LOCADA', 'MANUTENCAO', 'DESATIVADA']

/** Estado do formulário de manutenção: nova, edição ou conclusão. */
type ModalOS = { ordem?: OrdemServico; concluir?: boolean }

export function Manutencao() {
  const maquinas = useDados((s) => s.maquinas)
  const ordens = useDados((s) => s.ordens)
  const reclamacoes = useDados((s) => s.reclamacoes)
  const servicosCadastrados = useDados((s) => s.config.servicosManutencao.length)
  const situacoes = useSituacoes()
  const navegar = useNavigate()
  const [params, setParams] = useSearchParams()
  const frotaAntiga = useDados((s) => s.config.frotaMaquinas)

  const [busca, setBusca] = useState('')
  const [tipo, setTipo] = useState<'todas' | TipoMaquina>('todas')
  const [situacao, setSituacao] = useState<FiltroSituacao>('todas')
  const [maquinaLocal, setMaquinaLocal] = useState(false)
  const [osLocal, setOsLocal] = useState<ModalOS | null>(null)
  const [servicosAberto, setServicosAberto] = useState(false)

  // `?nova=maquina` e `?nova=os` (vindos da busca global) abrem o cadastro da máquina ou da manutenção
  const pedido = params.get('nova')
  const modalMaquina = maquinaLocal || pedido === 'maquina'
  const modalOS: ModalOS | null = osLocal ?? (pedido === 'os' && maquinas.length ? {} : null)
  const limparPedido = () => {
    if (params.has('nova')) setParams({}, { replace: true })
  }
  const fecharMaquina = () => {
    setMaquinaLocal(false)
    limparPedido()
  }
  const fecharOS = () => {
    setOsLocal(null)
    limparPedido()
  }

  const estadoDe = (m: Maquina): EstadoMaquina => situacoes.get(m.id)?.estado ?? m.status

  const contagem = useMemo(() => {
    const n = { total: 0, P: 0, G: 0, DISPONIVEL: 0, LOCADA: 0, MANUTENCAO: 0, DESATIVADA: 0, RESERVA: 0 }
    for (const m of maquinas) {
      const s = situacoes.get(m.id)
      const e = s?.estado ?? m.status
      n[e]++
      // Locadas como reserva (também contam entre as locadas)
      if (e === 'LOCADA' && s?.reserva) n.RESERVA++
      if (e !== 'DESATIVADA') {
        n.total++
        n[m.tipo]++
      }
    }
    return n
  }, [maquinas, situacoes])

  const indices = useMemo(() => indicesOrdens(ordens), [ordens])
  const queixas = useMemo(() => reclamacoesPorMaquina(reclamacoes), [reclamacoes])
  const abertas = useMemo(() => ordenarOrdens(ordens.filter(osEmAberto)), [ordens])
  const porId = useMemo(() => new Map(maquinas.map((m) => [m.id, m])), [maquinas])

  const lista = useMemo(() => {
    const filtradas = maquinas.filter((m) => {
      const e = situacoes.get(m.id)?.estado ?? m.status
      return (tipo === 'todas' || m.tipo === tipo) && (situacao === 'todas' || e === situacao) && maquinaCombina(m, busca)
    })
    // Desativadas vão para o fim (a lista já vem em ordem natural: P-01, P-02… G-01…)
    return [...filtradas].sort((a, b) => Number(a.status === 'DESATIVADA') - Number(b.status === 'DESATIVADA'))
  }, [maquinas, situacoes, tipo, situacao, busca])

  const hoje = useHoje()
  const maisAntiga = abertas[0]
  const filtrando = !!busca || tipo !== 'todas' || situacao !== 'todas'
  const limparFiltros = () => {
    setBusca('')
    setTipo('todas')
    setSituacao('todas')
  }

  return (
    <>
      <PageHeader
        titulo="Manutenção"
        descricao="Suas máquinas, onde cada uma está hoje e as manutenções feitas nelas."
        acoes={
          <>
            <Button icone={<Plus className="h-4 w-4" />} onClick={() => setMaquinaLocal(true)}>
              Nova máquina
            </Button>
            <Button
              icone={<ListChecks className="h-4 w-4" />}
              onClick={() => setServicosAberto(true)}
              title="Os serviços que aparecem para marcar nas manutenções"
            >
              <span className="max-sm:hidden">Serviços cadastrados</span>
              <span className="sm:hidden">Serviços</span>
              {servicosCadastrados > 0 && (
                <span className="tnum rounded-md bg-surface-3 px-1.5 text-[11px] leading-5 text-muted">
                  {servicosCadastrados}
                </span>
              )}
            </Button>
            <Button
              variante="primary"
              icone={<ClipboardPlus className="h-4 w-4" />}
              onClick={() => setOsLocal({})}
              disabled={!maquinas.length}
              title={maquinas.length ? undefined : 'Cadastre uma máquina primeiro'}
            >
              Nova manutenção
            </Button>
          </>
        }
      />

      {!maquinas.length ? (
        <Card>
          <EmptyState
            icone={<IconeMaquinaFichas className="h-6 w-6" />}
            titulo="Nenhuma máquina cadastrada"
            descricao={`Cadastre suas máquinas uma a uma aqui, com a identificação de cada uma (ex.: P-01), ou informe quantas Máquinas P e G você tem em Configurações › Disponibilidade de máquinas: elas são criadas já numeradas. Hoje a agenda considera ${numero(frotaAntiga)} máquinas; a partir da primeira máquina cadastrada, passa a contar só as cadastradas.`}
            acao={
              <div className="flex flex-wrap justify-center gap-2">
                <Button icone={<Settings className="h-4 w-4" />} onClick={() => navegar('/configuracoes')}>
                  Ir para Configurações
                </Button>
                <Button variante="primary" icone={<Plus className="h-4 w-4" />} onClick={() => setMaquinaLocal(true)}>
                  Cadastrar máquina
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="col-span-2 lg:col-span-1">
              <StatCard
                rotulo="Máquinas"
                valor={contagem.total}
                formatar={(v) => numero(Math.round(v))}
                icone={<IconeMaquinaFichas className="h-4 w-4" />}
                destaque
                detalhe={`${numero(contagem.P)} P + ${numero(contagem.G)} G`}
              />
            </div>
            <StatCard
              rotulo="Disponíveis"
              valor={contagem.DISPONIVEL}
              formatar={(v) => numero(Math.round(v))}
              icone={<CircleCheck className="h-4 w-4" />}
              detalhe="Livres hoje"
              delay={0.04}
            />
            <StatCard
              rotulo="Locadas"
              valor={contagem.LOCADA}
              formatar={(v) => numero(Math.round(v))}
              icone={<MapPin className="h-4 w-4" />}
              detalhe={
                contagem.RESERVA ? (
                  <span title="As reservas ficam com o cliente sem uso, a não ser que ele use">
                    Inclui {numero(contagem.RESERVA)} como reserva
                  </span>
                ) : (
                  'Em eventos hoje'
                )
              }
              delay={0.08}
            />
            <StatCard
              rotulo="Em manutenção"
              valor={contagem.MANUTENCAO}
              formatar={(v) => numero(Math.round(v))}
              icone={<Wrench className="h-4 w-4" />}
              detalhe="Fora de uso agora"
              delay={0.12}
            />
            <StatCard
              // Rótulo curto para caber numa linha (o cartão logo abaixo diz "Manutenções em aberto")
              rotulo="Em aberto"
              valor={abertas.length}
              formatar={(v) => numero(Math.round(v))}
              icone={<ClipboardList className="h-4 w-4" />}
              detalhe={maisAntiga ? `Mais antiga: ${haQuantoTempo(maisAntiga.abertura, hoje)}` : 'Nenhuma pendente'}
              delay={0.16}
            />
          </div>

          <Card className="mb-6">
            <CardHeader
              icone={<ClipboardList className="h-4 w-4" />}
              titulo="Manutenções em aberto"
              descricao={
                abertas.length
                  ? `${abertas.length} ${abertas.length === 1 ? 'aguardando conclusão' : 'aguardando conclusão, da mais antiga para a mais nova'}`
                  : undefined
              }
            />
            {abertas.length ? (
              <ul className="divide-y divide-line border-t border-line">
                {abertas.map((o, i) => (
                  <LinhaOS
                    key={o.id}
                    ordem={o}
                    indice={i}
                    maquina={porId.get(o.maquinaId)}
                    estado={situacoes.get(o.maquinaId)?.estado ?? 'DISPONIVEL'}
                    hoje={hoje}
                    aoConcluir={() => setOsLocal({ ordem: o, concluir: true })}
                    aoEditar={() => setOsLocal({ ordem: o })}
                  />
                ))}
              </ul>
            ) : (
              <p className="mx-5 mb-5 flex items-center gap-2 rounded-xl bg-success-soft px-3.5 py-2.5 text-[13px] font-medium text-success">
                <CircleCheck className="h-4 w-4 shrink-0" />
                Nenhuma manutenção em aberto. Todas as máquinas estão em dia.
              </p>
            )}
          </Card>

          <section aria-labelledby="titulo-maquinas">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 id="titulo-maquinas" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
                Máquinas
              </h2>
              <p className="text-[13px] text-muted">
                {filtrando ? `${lista.length} de ${maquinas.length}` : `${maquinas.length} no total`}
              </p>
            </div>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <SearchInput
                valor={busca}
                aoMudar={setBusca}
                placeholder="Buscar máquina (ex.: P-01)…"
                className="sm:min-w-56 sm:flex-1"
              />
              <Segmented
                className="shrink-0"
                valor={tipo}
                aoMudar={setTipo}
                opcoes={[
                  { valor: 'todas', label: 'Todas', contagem: maquinas.length },
                  { valor: 'P', label: TIPO_MAQUINA.P.plural, contagem: maquinas.filter((m) => m.tipo === 'P').length },
                  { valor: 'G', label: TIPO_MAQUINA.G.plural, contagem: maquinas.filter((m) => m.tipo === 'G').length },
                ]}
              />
              <div className="sm:w-56">
                <Select
                  value={situacao}
                  onChange={(e) => setSituacao(e.target.value as FiltroSituacao)}
                  aria-label="Filtrar por situação"
                >
                  <option value="todas">Todas as situações</option>
                  {ORDEM_ESTADOS.map((e) => (
                    <option key={e} value={e}>
                      {ESTADO_MAQUINA[e].label} ({contagem[e]}
                      {e === 'LOCADA' && contagem.RESERVA > 0 && `, ${contagem.RESERVA} como reserva`})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {lista.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {lista.map((m, i) => (
                  <CartaoMaquina
                    key={m.id}
                    maquina={m}
                    indice={i}
                    situacao={situacoes.get(m.id) ?? { estado: estadoDe(m) }}
                    hoje={hoje}
                    ultimaManutencao={indices.ultima.get(m.id)}
                    emAberto={indices.abertas.get(m.id) ?? 0}
                    reclamacoes={queixas.get(m.id) ?? 0}
                  />
                ))}
              </div>
            ) : (
              <Card>
                <EmptyState
                  icone={<IconeMaquinaFichas className="h-6 w-6" />}
                  titulo="Nenhuma máquina encontrada"
                  descricao={filtrando ? 'Tente ajustar a busca ou os filtros.' : undefined}
                  acao={filtrando && <Button onClick={limparFiltros}>Limpar filtros</Button>}
                />
              </Card>
            )}
          </section>
        </>
      )}

      <MaquinaFormModal
        aberto={modalMaquina}
        aoFechar={fecharMaquina}
        tipoInicial={tipo === 'todas' ? undefined : tipo}
        aoSalvar={(m) => navegar(`/manutencao/${m.id}`)}
      />
      <OrdemServicoModal
        aberto={!!modalOS}
        aoFechar={fecharOS}
        ordem={modalOS?.ordem}
        maquinaId={modalOS?.ordem?.maquinaId}
        fixarMaquina={!!modalOS?.ordem}
        concluir={modalOS?.concluir}
      />
      <ServicosManutencaoModal aberto={servicosAberto} aoFechar={() => setServicosAberto(false)} />
    </>
  )
}

/** Uma manutenção em aberto, com acesso rápido para concluir. */
function LinhaOS({
  ordem,
  indice,
  maquina,
  estado,
  hoje,
  aoConcluir,
  aoEditar,
}: {
  ordem: OrdemServico
  indice: number
  maquina: Maquina | undefined
  estado: EstadoMaquina
  hoje: string
  aoConcluir: () => void
  aoEditar: () => void
}) {
  const resumo = ordem.servicos.join(', ') || ordem.problema
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice, 10) * 0.03, duration: 0.25, ease: 'easeOut' }}
      className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {maquina ? (
          <Link
            to={`/manutencao/${maquina.id}`}
            className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            title={`Abrir a ficha da máquina ${maquina.identificacao}`}
          >
            <MaquinaChip maquina={maquina} estado={estado} className="hover:brightness-95" />
          </Link>
        ) : (
          <span className="mt-1.5 text-xs text-muted">Máquina removida</span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tnum text-sm font-semibold text-ink">Manutenção {codigoOS(ordem.numero)}</span>
            <span className="text-[13px] text-muted">{TIPO_OS[ordem.tipo].label}</span>
            <StatusOSBadge status={ordem.status} />
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-2" title={resumo}>
            {resumo || 'Sem descrição'}
          </p>
          <p className="text-xs text-muted">
            Aberta {haQuantoTempo(ordem.abertura, hoje)}
            {ordem.abertura < hoje && ` (${dataCurta(ordem.abertura)})`}
            {ordem.responsavel && ` · ${ordem.responsavel}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:justify-end">
        <Button
          variante="ghost"
          tamanho="icon-sm"
          onClick={aoEditar}
          aria-label={`Editar a manutenção ${codigoOS(ordem.numero)}`}
          title="Editar"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variante="soft" tamanho="sm" icone={<ClipboardCheck className="h-4 w-4" />} onClick={aoConcluir} className="ml-1">
          Concluir
        </Button>
      </div>
    </motion.li>
  )
}

/** Cartão de uma máquina na grade: identificação, situação, onde está, manutenção e reclamações. */
function CartaoMaquina({
  maquina,
  indice,
  situacao,
  hoje,
  ultimaManutencao,
  emAberto,
  reclamacoes,
}: {
  maquina: Maquina
  indice: number
  situacao: SituacaoMaquina
  hoje: string
  ultimaManutencao: string | undefined
  emAberto: number
  /** Reclamações de clientes registradas para a máquina. */
  reclamacoes: number
}) {
  const desativada = situacao.estado === 'DESATIVADA'
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice, 12) * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'group relative flex flex-col rounded-2xl border border-line bg-surface p-4 shadow-xs transition-[translate,box-shadow,border-color]',
        'hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card',
        desativada && 'bg-surface-2/60',
      )}
    >
      {/* O cartão inteiro abre a ficha; os links internos ficam por cima */}
      <Link
        to={`/manutencao/${maquina.id}`}
        aria-label={`Abrir a ficha da máquina ${maquina.identificacao}`}
        className="absolute inset-0 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-xl font-semibold tracking-[-0.02em]', desativada ? 'text-muted' : 'text-ink')}>
              {maquina.identificacao}
            </span>
            <TipoMaquinaBadge tipo={maquina.tipo} />
          </div>
          <p className="truncate text-xs text-muted">
            {TIPO_MAQUINA[maquina.tipo].label} · {TIPO_MAQUINA[maquina.tipo].descricao.toLowerCase()}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {situacao.estado === 'LOCADA' && situacao.reserva && (
            <Badge tom="warning" ponto={false} className="gap-1 pl-1.5">
              <SeloReserva pequeno />
              Reserva
            </Badge>
          )}
          <SituacaoBadge estado={situacao.estado} />
        </div>
      </div>

      <div className="mt-3 flex-1 text-[13px]">
        <OndeEsta maquinaId={maquina.id} situacao={situacao} hoje={hoje} />
      </div>

      <div className="mt-3 flex min-h-6 items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {ultimaManutencao ? `Última manutenção: ${dataCurta(ultimaManutencao)}` : 'Nenhuma manutenção concluída'}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {reclamacoes > 0 && (
            <span
              className="tnum inline-flex items-center gap-1 text-muted"
              title={`${reclamacoes} ${reclamacoes === 1 ? 'reclamação de cliente' : 'reclamações de clientes'}`}
            >
              <MessageSquareWarning className="h-3.5 w-3.5" />
              {reclamacoes}
              <span className="sr-only">{reclamacoes === 1 ? 'reclamação' : 'reclamações'}</span>
            </span>
          )}
          {emAberto > 0 && (
            <Badge tom="warning" ponto={false} className="h-5 px-2 text-[11px]">
              {emAberto} em aberto
            </Badge>
          )}
        </span>
      </div>
    </motion.div>
  )
}

/** Onde a máquina está hoje (ou a próxima locação), em uma ou duas linhas. */
function OndeEsta({ maquinaId, situacao, hoje }: { maquinaId: string; situacao: SituacaoMaquina; hoje: string }) {
  const { estado, evento, reserva, proxima, dataProxima } = situacao
  if (estado === 'DESATIVADA') {
    return (
      <LinhaInfo icone={<IconeMaquinaFichas className="h-3.5 w-3.5" />}>Fora de uso. O histórico continua guardado.</LinhaInfo>
    )
  }
  if (evento) {
    const p = periodoEvento(evento)
    const emManutencao = estado === 'MANUTENCAO'
    // Como reserva: fica com o cliente e só é cobrada se ele usar (diz se hoje está parada ou foi usada)
    const uso = reserva ? usoDaReserva(evento, hoje) : null
    return (
      <LinhaInfo
        icone={emManutencao ? <TriangleAlert className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
        tom={emManutencao ? 'text-warning' : 'text-info'}
        titulo={uso ? DICA_RESERVA[uso] : undefined}
        detalhe={
          p &&
          [periodo(p.inicio, p.fim), uso && USO_RESERVA_CURTO[uso], evento.periodoCorrido && 'período todo com o cliente']
            .filter(Boolean)
            .join(' · ')
        }
      >
        {emManutencao
          ? `Em manutenção, mas marcada${reserva ? ' como reserva' : ''} em `
          : reserva
            ? 'Locada · reserva · '
            : 'Locada · '}
        <LinkEvento id={evento.id}>{localDaLocacao(evento)}</LinkEvento>
      </LinhaInfo>
    )
  }
  if (proxima) {
    return (
      <LinhaInfo icone={<CalendarClock className="h-3.5 w-3.5" />} tom={estado === 'MANUTENCAO' ? 'text-warning' : undefined}>
        Próxima locação: {dataProxima ? dataCurta(dataProxima).slice(0, 5) : '—'} ·{' '}
        <LinkEvento id={proxima.id}>{localDaLocacao(proxima)}</LinkEvento>
        {vaiComoReserva(proxima, maquinaId) && ' (como reserva)'}
      </LinhaInfo>
    )
  }
  return (
    <LinhaInfo icone={<CalendarClock className="h-3.5 w-3.5" />}>
      {estado === 'MANUTENCAO' ? 'Sem locações marcadas.' : 'Livre, sem locações marcadas.'}
    </LinhaInfo>
  )
}

function LinhaInfo({
  icone,
  tom,
  detalhe,
  titulo,
  children,
}: {
  icone: ReactNode
  tom?: string
  detalhe?: ReactNode
  /** Dica ao parar o mouse (ex.: o que significa estar como reserva). */
  titulo?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2" title={titulo}>
      <span className={cn('mt-[3px] shrink-0', tom ?? 'text-muted')}>{icone}</span>
      <div className="min-w-0">
        <p className={cn('line-clamp-2 break-words', tom ? `font-medium ${tom}` : 'text-ink-2')}>{children}</p>
        {detalhe && <p className="truncate text-xs text-muted">{detalhe}</p>}
      </div>
    </div>
  )
}

function LinkEvento({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link
      to={`/eventos/${id}`}
      className="relative z-10 underline decoration-current/30 underline-offset-2 hover:decoration-current"
      title="Abrir o evento"
    >
      {children}
    </Link>
  )
}
