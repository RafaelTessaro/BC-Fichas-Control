// Reclamação de um cliente sobre uma máquina (ex.: "estava travando"), registrada quando a
// máquina volta do evento. Fica no histórico da máquina. Usado na ficha da máquina e no evento.

import { ChevronDown, MessageSquareWarning, Ticket } from 'lucide-react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { normalizarReclamacao } from '#shared/dominio.ts'
import { ESTADO_MAQUINA, periodoEvento, TIPO_MAQUINA, TIPOS_MAQUINA, type EstadoMaquina } from '#shared/maquinas.ts'
import type { Evento, Maquina, Reclamacao, ReclamacaoInput } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { codigoEvento, hojeISO, periodo } from '../lib/format'
import { eventosDaMaquina, eventoSugerido } from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { MaquinaChip, SituacaoBadge, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Field, Input, Textarea } from './ui/Form'
import { Modal } from './ui/Modal'

export interface ReclamacaoModalProps {
  aberto: boolean
  aoFechar: () => void
  /** Edição de uma reclamação existente. */
  reclamacao?: Reclamacao
  /** Máquina já escolhida (ex.: na ficha da máquina). */
  maquinaId?: string
  /** Máquinas para escolher quando a reclamação vem de um evento (as enviadas para ele). */
  maquinasIds?: string[]
  /** Evento em que o cliente reclamou (já escolhido quando vem do evento). */
  eventoId?: string
}

export function ReclamacaoModal({ aberto, aoFechar, reclamacao, maquinaId, maquinasIds, eventoId }: ReclamacaoModalProps) {
  const [salvando, setSalvando] = useState(false)
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-xl"
      icone={<MessageSquareWarning className="h-5 w-5" />}
      titulo={reclamacao ? 'Editar reclamação' : 'Registrar reclamação'}
      descricao="O que o cliente relatou sobre a máquina. Fica guardado no histórico dela."
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-reclamacao" disabled={salvando}>
            {salvando ? 'Salvando…' : reclamacao ? 'Salvar alterações' : 'Registrar reclamação'}
          </Button>
        </>
      }
    >
      {/* O formulário só existe com o modal aberto, então sempre começa com os dados atuais */}
      <FormularioReclamacao
        key={reclamacao?.id ?? 'nova'}
        reclamacao={reclamacao}
        maquinaId={maquinaId}
        maquinasIds={maquinasIds}
        eventoId={eventoId}
        aoFechar={aoFechar}
        setSalvando={setSalvando}
      />
    </Modal>
  )
}

function FormularioReclamacao({
  reclamacao,
  maquinaId,
  maquinasIds,
  eventoId,
  aoFechar,
  setSalvando,
}: Omit<ReclamacaoModalProps, 'aberto'> & { setSalvando: (v: boolean) => void }) {
  const maquinas = useDados((s) => s.maquinas)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const salvarReclamacao = useDados((s) => s.salvarReclamacao)
  const situacoes = useSituacoes()
  const hoje = hojeISO()

  /** Evento que já vem escolhido numa reclamação nova da máquina (o de onde ela acabou de voltar). */
  const sugeridoPara = (id: string) => (id ? (eventoSugerido(eventosDaMaquina(id, eventos, hoje), hoje)?.id ?? '') : '')

  const [f, setF] = useState<ReclamacaoInput>(() => {
    if (reclamacao) {
      const { maquinaId: m, eventoId: e, data, descricao } = reclamacao
      return { maquinaId: m, eventoId: e, data, descricao }
    }
    // Vindo de um evento com uma máquina só, ela já vem escolhida
    const maquina = maquinaId ?? (maquinasIds?.length === 1 ? maquinasIds[0] : '')
    return { maquinaId: maquina, eventoId: eventoId ?? sugeridoPara(maquina), data: hoje, descricao: '' }
  })
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(reclamacao?.versao)
  const [tentou, setTentou] = useState(false)

  const maquina = maquinas.find((m) => m.id === f.maquinaId)
  const maquinaFixa = !!maquinaId && !!maquina
  const eventoFixo = eventoId !== undefined && eventoId !== ''
  const evento = f.eventoId ? eventos.find((e) => e.id === f.eventoId) : undefined
  const nomeCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.nome])), [clientes])

  // Máquinas para escolher: as do evento; sem evento, as que não estão desativadas (e a já escolhida)
  const escolhiveis = maquinasIds?.length
    ? maquinas.filter((m) => maquinasIds.includes(m.id) || m.id === f.maquinaId)
    : maquinas.filter((m) => m.status !== 'DESATIVADA' || m.id === f.maquinaId)

  const escolherMaquina = (id: string) =>
    setF((x) => {
      if (eventoFixo || x.maquinaId === id) return { ...x, maquinaId: id }
      // O evento escolhido continua só se a nova máquina também esteve nele
      const atual = x.eventoId ? eventos.find((e) => e.id === x.eventoId) : undefined
      const manter = !!atual?.maquinasIds.includes(id)
      return { ...x, maquinaId: id, eventoId: manter ? x.eventoId : reclamacao ? '' : sugeridoPara(id) }
    })

  // Eventos em que a máquina esteve, do mais recente ao mais antigo
  const opcoesEvento = useMemo<OpcaoEvento[]>(() => {
    const lista: OpcaoEvento[] = f.maquinaId
      ? eventosDaMaquina(f.maquinaId, eventos, hoje).map((l) => ({ id: l.evento.id, ...l }))
      : []
    // O evento já gravado continua na lista, mesmo que a máquina tenha saído dele depois (ou ele
    // tenha sido excluído)
    if (f.eventoId && !lista.some((o) => o.id === f.eventoId)) {
      const gravado = eventos.find((e) => e.id === f.eventoId)
      const p = gravado && periodoEvento(gravado)
      lista.unshift({ id: f.eventoId, evento: gravado, inicio: p?.inicio, fim: p?.fim })
    }
    return lista
  }, [f.maquinaId, f.eventoId, eventos, hoje])

  const { valor, erros } = normalizarReclamacao(f)
  const erroMaquina = erros.find((e) => /máquina/i.test(e))
  const erroData = erros.find((e) => /data/i.test(e))
  const erroDescricao = erros.find((e) => /relatou/i.test(e))

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erros.length) return
    setSalvando(true)
    try {
      const alvo = reclamacao && versaoBase !== undefined ? { id: reclamacao.id, versao: versaoBase } : undefined
      await salvarReclamacao(valor, alvo)
      toast.sucesso(
        reclamacao ? 'Reclamação atualizada' : 'Reclamação registrada',
        [maquina && `Máquina ${maquina.identificacao}`, evento && `${codigoEvento(evento.codigo)} ${evento.nome}`]
          .filter(Boolean)
          .join(' · '),
      )
      aoFechar()
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409 && reclamacao && err.dados.atual) {
        // Conflito de versão: outra pessoa salvou esta reclamação enquanto você editava
        const atual = err.dados.atual as Reclamacao | undefined
        const sobrescrever = await confirmar({
          titulo: 'Reclamação alterada por outra pessoa',
          descricao: 'Alguém salvou esta reclamação enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em “Salvar alterações” novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar a reclamação', err)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <form id="form-reclamacao" onSubmit={enviar} className="grid grid-cols-1 gap-5 sm:grid-cols-6" noValidate>
      <Field label="Máquina" className="sm:col-span-6" erro={tentou ? erroMaquina : null}>
        {maquinaFixa ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
            <span className="text-lg font-semibold tracking-[-0.01em] text-ink">{maquina.identificacao}</span>
            <TipoMaquinaBadge tipo={maquina.tipo} />
            <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{TIPO_MAQUINA[maquina.tipo].label}</span>
            <SituacaoBadge estado={situacoes.get(maquina.id)?.estado ?? maquina.status} />
          </div>
        ) : escolhiveis.length ? (
          <EscolhaMaquina
            maquinas={escolhiveis}
            selecionada={f.maquinaId}
            aoEscolher={escolherMaquina}
            estado={(m) => situacoes.get(m.id)?.estado ?? m.status}
            doEvento={!!maquinasIds?.length}
          />
        ) : (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">
            {maquinasIds ? 'Nenhuma máquina foi enviada para este evento.' : 'Nenhuma máquina cadastrada.'}
          </p>
        )}
      </Field>

      <Field
        label="Evento"
        className="sm:col-span-6"
        hint={
          eventoFixo || !f.maquinaId
            ? undefined
            : opcoesEvento.length
              ? 'Em qual locação o cliente reclamou: os eventos em que esta máquina esteve, do mais recente para o mais antigo.'
              : 'Esta máquina ainda não foi para nenhum evento.'
        }
      >
        {eventoFixo ? (
          <EventoEscolhido evento={evento} cliente={evento && nomeCliente.get(evento.clienteId)} />
        ) : f.maquinaId ? (
          // A chave zera o "mostrar mais" ao trocar de máquina
          <EscolhaEvento
            key={f.maquinaId}
            opcoes={opcoesEvento}
            valor={f.eventoId}
            aoEscolher={(id) => setF((x) => ({ ...x, eventoId: id }))}
            nomeCliente={nomeCliente}
          />
        ) : (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Escolha a máquina primeiro.</p>
        )}
      </Field>

      <Field label="Data da reclamação" htmlFor="rec-data" className="sm:col-span-3" erro={tentou ? erroData : null}>
        <Input
          id="rec-data"
          type="date"
          value={f.data}
          max={hoje}
          onChange={(e) => setF((x) => ({ ...x, data: e.target.value }))}
          required
        />
      </Field>
      <div className="max-sm:hidden sm:col-span-3" />

      <Field
        label="O que o cliente relatou"
        htmlFor="rec-descricao"
        className="sm:col-span-6"
        erro={tentou ? erroDescricao : null}
      >
        <Textarea
          id="rec-descricao"
          value={f.descricao}
          onChange={(e) => setF((x) => ({ ...x, descricao: e.target.value }))}
          placeholder="Ex.: a máquina estava travando no meio da festa"
          // Vindo do evento com a máquina já escolhida, só falta o relato (com a lista de eventos à
          // vista, o foco rolaria a janela para baixo e esconderia a escolha do evento)
          autoFocus={!!maquina && eventoFixo}
          aria-invalid={tentou && !!erroDescricao}
          className="min-h-[96px]"
        />
      </Field>
    </form>
  )
}

/** Evento para escolher, com o período dele (sem `evento`: um já gravado que foi excluído). */
type OpcaoEvento = { id: string; evento?: Evento; inicio?: string; fim?: string }

/** Quantos eventos aparecem antes de "Mostrar mais". */
const EVENTOS_VISIVEIS = 4

/** Escolha do evento da reclamação: os mais recentes à vista, os antigos sob demanda, e "Sem evento". */
function EscolhaEvento({
  opcoes,
  valor,
  aoEscolher,
  nomeCliente,
}: {
  opcoes: OpcaoEvento[]
  valor: string
  aoEscolher: (id: string) => void
  nomeCliente: Map<string, string>
}) {
  const [todos, setTodos] = useState(false)
  // O escolhido aparece mesmo quando está entre os mais antigos
  const visiveis = todos ? opcoes : opcoes.filter((o, i) => i < EVENTOS_VISIVEIS || o.id === valor)
  const ocultos = opcoes.length - visiveis.length
  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="radiogroup"
        aria-label="Evento"
        className="divide-y divide-line overflow-hidden rounded-xl border border-line-strong/80"
      >
        {visiveis.map((o) => (
          <LinhaEvento
            key={o.id}
            ativo={valor === o.id}
            aoEscolher={() => aoEscolher(o.id)}
            titulo={
              o.evento ? (
                <>
                  <span className="tnum font-normal text-muted">{codigoEvento(o.evento.codigo)}</span> {o.evento.nome}
                </>
              ) : (
                'Evento excluído'
              )
            }
            lado={o.inicio ? periodo(o.inicio, o.fim ?? o.inicio) : undefined}
            detalhe={o.evento ? nomeCliente.get(o.evento.clienteId) : 'O evento não existe mais'}
          />
        ))}
        <LinhaEvento
          ativo={valor === ''}
          aoEscolher={() => aoEscolher('')}
          titulo="Sem evento"
          detalhe="A reclamação não é de uma locação"
        />
      </div>
      {ocultos > 0 && (
        <button
          type="button"
          onClick={() => setTodos(true)}
          className="inline-flex cursor-pointer items-center gap-1 self-start rounded-md text-[13px] font-medium text-brand-ink hover:underline"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Mostrar {ocultos === 1 ? 'mais 1 evento antigo' : `mais ${ocultos} eventos antigos`}
        </button>
      )}
    </div>
  )
}

function LinhaEvento({
  ativo,
  aoEscolher,
  titulo,
  lado,
  detalhe,
}: {
  ativo: boolean
  aoEscolher: () => void
  titulo: ReactNode
  lado?: string
  detalhe?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoEscolher}
      className={cn(
        'flex w-full cursor-pointer items-start gap-3 px-3.5 py-2.5 text-left transition-colors',
        'focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        ativo ? 'bg-brand-soft' : 'bg-surface hover:bg-surface-2',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          ativo ? 'border-brand' : 'border-line-strong',
        )}
      >
        {ativo && <span className="h-2 w-2 rounded-full bg-brand" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn('min-w-0 truncate text-sm font-medium', ativo ? 'text-brand-ink' : 'text-ink')}>{titulo}</span>
          {lado && <span className="tnum shrink-0 text-xs text-muted">{lado}</span>}
        </span>
        {detalhe && <span className="block truncate text-xs text-muted">{detalhe}</span>}
      </span>
    </button>
  )
}

const periodoTexto = (e: Evento) => {
  const p = periodoEvento(e)
  return p ? periodo(p.inicio, p.fim) : null
}

/** Chips das máquinas, separados por tipo (do evento: todas numa linha só). */
function EscolhaMaquina({
  maquinas,
  selecionada,
  aoEscolher,
  estado,
  doEvento,
}: {
  maquinas: Maquina[]
  selecionada: string
  aoEscolher: (id: string) => void
  estado: (m: Maquina) => EstadoMaquina
  doEvento: boolean
}) {
  const chip = (m: Maquina) => (
    <MaquinaChip
      key={m.id}
      maquina={m}
      estado={estado(m)}
      selecionada={m.id === selecionada}
      aoClicar={() => aoEscolher(m.id)}
      titulo={`${m.identificacao} · ${ESTADO_MAQUINA[estado(m)].label}`}
    />
  )
  if (doEvento) {
    return (
      <div role="group" aria-label="Máquina" className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-1.5">{maquinas.map(chip)}</div>
        <p className="text-xs text-muted">Máquinas enviadas para este evento. Escolha a que deu problema.</p>
      </div>
    )
  }
  return (
    <div role="group" aria-label="Máquina" className="flex flex-col gap-2.5">
      {TIPOS_MAQUINA.map((tipo) => {
        const doTipo = maquinas.filter((m) => m.tipo === tipo)
        if (!doTipo.length) return null
        return (
          <div key={tipo} className="flex items-start gap-3">
            <span className="mt-2 w-[74px] shrink-0 text-xs font-medium text-muted">{TIPO_MAQUINA[tipo].plural}</span>
            <div className="flex flex-wrap gap-1.5">{doTipo.map(chip)}</div>
          </div>
        )
      })}
    </div>
  )
}

/** Evento fixo da reclamação (aberta pelo próprio evento). */
function EventoEscolhido({ evento, cliente }: { evento: Evento | undefined; cliente: string | undefined }) {
  if (!evento) {
    return <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Evento não encontrado.</p>
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info">
        <Ticket className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          <span className="tnum text-muted">{codigoEvento(evento.codigo)}</span> {evento.nome}
        </span>
        <span className="block truncate text-xs text-muted">{[cliente, periodoTexto(evento)].filter(Boolean).join(' · ')}</span>
      </span>
    </div>
  )
}
