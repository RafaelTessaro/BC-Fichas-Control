// Ordem de serviço (O.S.) interna de manutenção: abrir, editar e concluir.

import {
  Check,
  ClipboardCheck,
  ClipboardPen,
  ClipboardPlus,
  Loader2,
  Plus,
  Printer,
  ShieldCheck,
  TriangleAlert,
  Wrench,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { normalizarOS } from '#shared/dominio.ts'
import {
  codigoOS,
  ESTADO_MAQUINA,
  localDaLocacao,
  osEmAberto,
  SERVICOS_PADRAO,
  STATUS_OS,
  STATUS_OS_LISTA,
  TIPO_MAQUINA,
  TIPO_OS,
  TIPOS_MAQUINA,
  TIPOS_OS,
} from '#shared/maquinas.ts'
import type { Maquina, OrdemServico, OrdemServicoInput, StatusMaquina, StatusOS, TipoOS } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { hojeISO, periodo } from '../lib/format'
import { locacoesDeHojeEmDiante, sugestaoMaquina, sugestaoMarcada } from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { MaquinaChip, SituacaoBadge, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { CurrencyInput, Field, Input, Textarea } from './ui/Form'
import { Modal } from './ui/Modal'

export function OrdemServicoModal({
  aberto,
  aoFechar,
  ordem,
  maquinaId,
  fixarMaquina,
  concluir,
  aoSalvar,
}: {
  aberto: boolean
  aoFechar: () => void
  /** O.S. a editar; sem ela, abre uma nova. */
  ordem?: OrdemServico
  /** Máquina já escolhida (ex.: vindo da ficha da máquina). */
  maquinaId?: string
  /** Não deixa trocar a máquina. */
  fixarMaquina?: boolean
  /** Abre a O.S. já como "Concluída", com a data de hoje. */
  concluir?: boolean
  aoSalvar?: (o: OrdemServico) => void
}) {
  const [salvando, setSalvando] = useState(false)
  const titulo = ordem ? `${concluir ? 'Concluir' : 'Editar'} ${codigoOS(ordem.numero)}` : 'Nova ordem de serviço'
  const Icone = ordem ? (concluir ? ClipboardCheck : ClipboardPen) : ClipboardPlus
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-2xl"
      icone={<Icone className="h-5 w-5" />}
      titulo={titulo}
      descricao={
        concluir
          ? 'Registre o que foi feito, as peças e o custo.'
          : 'Manutenção interna da máquina: o que foi pedido, o que foi feito e quanto custou.'
      }
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-os" disabled={salvando}>
            {salvando ? 'Salvando…' : concluir ? 'Concluir O.S.' : ordem ? 'Salvar alterações' : 'Abrir O.S.'}
          </Button>
        </>
      }
    >
      {/* O formulário só existe com o modal aberto, então sempre começa com os dados atuais */}
      <FormularioOS
        key={ordem?.id ?? 'nova'}
        ordem={ordem}
        maquinaId={maquinaId}
        fixarMaquina={fixarMaquina}
        concluir={concluir}
        aoSalvar={aoSalvar}
        aoFechar={aoFechar}
        setSalvando={setSalvando}
      />
    </Modal>
  )
}

const chaveServico = (s: string) => s.trim().toLocaleLowerCase('pt-BR')

function estadoInicial(ordem: OrdemServico | undefined, maquinaId: string | undefined, concluir: boolean | undefined) {
  if (ordem) {
    const { id: _i, versao: _v, numero: _n, criadoEm: _c, atualizadoEm: _a, ...resto } = ordem
    return concluir && resto.status !== 'CONCLUIDA'
      ? { ...resto, status: 'CONCLUIDA' as StatusOS, conclusao: resto.conclusao || hojeISO() }
      : resto
  }
  const nova: OrdemServicoInput = {
    maquinaId: maquinaId ?? '',
    tipo: 'PREVENTIVA',
    status: concluir ? 'CONCLUIDA' : 'ABERTA',
    abertura: hojeISO(),
    conclusao: concluir ? hojeISO() : '',
    servicos: [],
    problema: '',
    solucao: '',
    pecas: '',
    responsavel: '',
    custo: 0,
  }
  return nova
}

function FormularioOS({
  ordem,
  maquinaId,
  fixarMaquina,
  concluir,
  aoSalvar,
  aoFechar,
  setSalvando,
}: {
  ordem?: OrdemServico
  maquinaId?: string
  fixarMaquina?: boolean
  concluir?: boolean
  aoSalvar?: (o: OrdemServico) => void
  aoFechar: () => void
  setSalvando: (v: boolean) => void
}) {
  const maquinas = useDados((s) => s.maquinas)
  const ordens = useDados((s) => s.ordens)
  const eventos = useDados((s) => s.eventos)
  const salvarOrdem = useDados((s) => s.salvarOrdem)
  const situacoes = useSituacoes()
  const [f, setF] = useState<OrdemServicoInput>(() => estadoInicial(ordem, maquinaId, concluir))
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(ordem?.versao)
  const [tentou, setTentou] = useState(false)
  const [outroServico, setOutroServico] = useState('')
  /** Escolha da caixa "colocar em manutenção / liberar", por máquina e sugestão. */
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({})

  const set = <K extends keyof OrdemServicoInput>(k: K, v: OrdemServicoInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const maquina = maquinas.find((m) => m.id === f.maquinaId)
  const maquinaFixa = !!fixarMaquina && !!maquina

  // Serviços sugeridos: os padrão, os já usados em outras O.S. e os desta
  const opcoesServico = useMemo(() => {
    const lista: string[] = []
    const vistos = new Set<string>()
    const incluir = (s: string) => {
      const chave = chaveServico(s)
      if (!chave || vistos.has(chave)) return
      vistos.add(chave)
      lista.push(s.trim())
    }
    SERVICOS_PADRAO.forEach(incluir)
    ordens.flatMap((o) => o.servicos).forEach(incluir)
    return lista
  }, [ordens])
  const marcados = new Set(f.servicos.map(chaveServico))
  const extras = f.servicos.filter((s) => !opcoesServico.some((o) => chaveServico(o) === chaveServico(s)))
  const responsaveis = useMemo(() => [...new Set(ordens.map((o) => o.responsavel.trim()).filter(Boolean))].slice(0, 12), [ordens])

  const alternarServico = (s: string) =>
    setF((x) => ({
      ...x,
      servicos: x.servicos.some((y) => chaveServico(y) === chaveServico(s))
        ? x.servicos.filter((y) => chaveServico(y) !== chaveServico(s))
        : [...x.servicos, s],
    }))

  const adicionarServico = () => {
    const s = outroServico.trim().replace(/\s+/g, ' ')
    if (!s) return
    if (!marcados.has(chaveServico(s))) set('servicos', [...f.servicos, s.charAt(0).toUpperCase() + s.slice(1)])
    setOutroServico('')
  }

  const mudarStatus = (status: StatusOS) =>
    setF((x) => ({ ...x, status, conclusao: status === 'CONCLUIDA' ? x.conclusao || hojeISO() : x.conclusao }))

  // Mudança sugerida na situação da máquina ao salvar
  const sugestao = maquina ? sugestaoMaquina(f.status, maquina.status) : null
  const outrasEmAberto = ordens.filter((o) => o.maquinaId === f.maquinaId && o.id !== ordem?.id && osEmAberto(o)).length
  const chaveEscolha = `${f.maquinaId}:${sugestao}`
  const locadaAgora = situacoes.get(f.maquinaId)?.estado === 'LOCADA'
  const marcado =
    escolhas[chaveEscolha] ??
    sugestaoMarcada(sugestao, {
      nova: !ordem,
      situacaoMudou: !!ordem && f.status !== ordem.status,
      outrasEmAberto,
      locadaAgora,
    })
  const statusMaquina: StatusMaquina | undefined =
    sugestao && marcado ? (sugestao === 'MANUTENCAO' ? 'MANUTENCAO' : 'DISPONIVEL') : undefined
  const locacoes = maquina && sugestao === 'MANUTENCAO' ? locacoesDeHojeEmDiante(maquina.id, eventos, hojeISO()) : []

  const { valor, erros } = normalizarOS(f)
  const erroMaquina = erros.find((e) => /máquina/i.test(e))
  const erroAbertura = erros.find((e) => /abertura inválida/i.test(e))
  const erroConclusao = erros.find((e) => /conclusão/i.test(e))
  const erroServicos = erros.find((e) => /serviço/i.test(e))

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erros.length) return void toast.erro('Confira a ordem de serviço', erros[0])
    setSalvando(true)
    try {
      const alvo = ordem && versaoBase !== undefined ? { id: ordem.id, versao: versaoBase } : undefined
      const salva = await salvarOrdem(valor, alvo, statusMaquina)
      const codigo = codigoOS(salva.numero)
      const ident = maquina?.identificacao ?? ''
      const titulo = !ordem
        ? salva.status === 'CONCLUIDA'
          ? `${codigo} registrada`
          : `${codigo} aberta`
        : salva.status === 'CONCLUIDA' && ordem.status !== 'CONCLUIDA'
          ? `${codigo} concluída`
          : `${codigo} atualizada`
      const detalhe =
        statusMaquina === 'MANUTENCAO'
          ? `A máquina ${ident} agora está em manutenção.`
          : statusMaquina === 'DISPONIVEL'
            ? `A máquina ${ident} voltou para Disponível.`
            : `Máquina ${ident}`
      toast.sucesso(titulo, detalhe)
      aoSalvar?.(salva)
      aoFechar()
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409 && ordem && err.dados.atual) {
        // Conflito de versão: outra pessoa salvou esta O.S. enquanto você editava
        const atual = err.dados.atual as OrdemServico | undefined
        const sobrescrever = await confirmar({
          titulo: 'O.S. alterada por outra pessoa',
          descricao:
            'Alguém salvou esta ordem de serviço enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em salvar novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar a O.S.', err)
    } finally {
      setSalvando(false)
    }
  }

  // Máquinas que podem receber O.S.: as não desativadas (e a já escolhida, mesmo desativada)
  const escolhiveis = maquinas.filter((m) => m.status !== 'DESATIVADA' || m.id === f.maquinaId)

  return (
    <form id="form-os" onSubmit={enviar} className="grid grid-cols-1 gap-5 sm:grid-cols-6" noValidate>
      <Field label="Máquina" className="sm:col-span-6" erro={tentou ? erroMaquina : null}>
        {maquinaFixa ? (
          <MaquinaEscolhida maquina={maquina} />
        ) : escolhiveis.length ? (
          <div role="group" aria-label="Máquina" className="flex flex-col gap-2.5">
            {TIPOS_MAQUINA.map((tipo) => {
              const doTipo = escolhiveis.filter((m) => m.tipo === tipo)
              if (!doTipo.length) return null
              return (
                <div key={tipo} className="flex items-start gap-3">
                  <span className="mt-2 w-[74px] shrink-0 text-xs font-medium text-muted">{TIPO_MAQUINA[tipo].plural}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {doTipo.map((m) => {
                      const estado = situacoes.get(m.id)?.estado ?? 'DISPONIVEL'
                      return (
                        <MaquinaChip
                          key={m.id}
                          maquina={m}
                          estado={estado}
                          selecionada={m.id === f.maquinaId}
                          aoClicar={() => set('maquinaId', m.id)}
                          titulo={`${m.identificacao} · ${ESTADO_MAQUINA[estado].label}`}
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {maquina && (
              <p className="text-xs text-muted">
                Escolhida: <b className="font-semibold text-ink-2">{maquina.identificacao}</b> ·{' '}
                {ESTADO_MAQUINA[situacoes.get(maquina.id)?.estado ?? maquina.status].label}
                {maquina.modelo && ` · ${maquina.modelo}`}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Nenhuma máquina cadastrada.</p>
        )}
      </Field>

      <Field label="Tipo de manutenção" className="sm:col-span-6">
        <div role="radiogroup" aria-label="Tipo de manutenção" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TIPOS_OS.map((t) => (
            <OpcaoTipo key={t} tipo={t} ativo={f.tipo === t} aoEscolher={() => set('tipo', t)} />
          ))}
        </div>
      </Field>

      <Field label="Situação da O.S." className="sm:col-span-6">
        <div role="radiogroup" aria-label="Situação da O.S." className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATUS_OS_LISTA.map((s) => (
            <OpcaoStatus key={s} status={s} ativo={f.status === s} aoEscolher={() => mudarStatus(s)} />
          ))}
        </div>
      </Field>

      <Field label="Aberta em" htmlFor="os-abertura" className="sm:col-span-3" erro={tentou ? erroAbertura : null}>
        <Input id="os-abertura" type="date" value={f.abertura} onChange={(e) => set('abertura', e.target.value)} required />
      </Field>
      {f.status === 'CONCLUIDA' ? (
        <Field label="Concluída em" htmlFor="os-conclusao" className="sm:col-span-3" erro={erroConclusao}>
          <Input
            id="os-conclusao"
            type="date"
            value={f.conclusao}
            min={f.abertura || undefined}
            onChange={(e) => set('conclusao', e.target.value)}
          />
        </Field>
      ) : (
        <div className="max-sm:hidden sm:col-span-3" />
      )}

      <Field
        label="Serviços"
        className="sm:col-span-6"
        erro={tentou ? erroServicos : null}
        hint="Marque o que foi pedido ou feito. Os serviços que você adicionar ficam disponíveis nas próximas O.S."
      >
        <div className="flex flex-wrap gap-1.5">
          {[...opcoesServico, ...extras].map((s) => (
            <ChipServico
              key={chaveServico(s)}
              ativo={marcados.has(chaveServico(s))}
              aoClicar={() => alternarServico(s)}
              removivel={extras.includes(s)}
            >
              {s}
            </ChipServico>
          ))}
        </div>
        <div className="mt-1 flex gap-2">
          <Input
            aria-label="Outro serviço"
            value={outroServico}
            onChange={(e) => setOutroServico(e.target.value)}
            onKeyDown={(e) => {
              // Enter adiciona o serviço em vez de salvar a O.S.
              if (e.key === 'Enter') {
                e.preventDefault()
                adicionarServico()
              }
            }}
            placeholder="Outro serviço (ex.: Troca do cabo de força)"
            maxLength={60}
            className="flex-1"
          />
          <Button icone={<Plus className="h-4 w-4" />} onClick={adicionarServico} disabled={!outroServico.trim()}>
            <span className="max-sm:hidden">Adicionar</span>
          </Button>
        </div>
      </Field>

      <Field label="Problema relatado ou motivo" htmlFor="os-problema" className="sm:col-span-6">
        <Textarea
          id="os-problema"
          value={f.problema}
          onChange={(e) => set('problema', e.target.value)}
          placeholder={
            f.tipo === 'CORRETIVA'
              ? 'Ex.: a impressora está cortando a ficha torta'
              : 'Ex.: revisão depois da temporada de festas'
          }
          className="min-h-[72px]"
        />
      </Field>
      <Field label="Serviço realizado" htmlFor="os-solucao" className="sm:col-span-6">
        <Textarea
          id="os-solucao"
          value={f.solucao}
          onChange={(e) => set('solucao', e.target.value)}
          placeholder="O que foi feito na máquina"
          autoFocus={concluir}
          className="min-h-[72px]"
        />
      </Field>
      <Field label="Peças trocadas" htmlFor="os-pecas" className="sm:col-span-6">
        <Input
          id="os-pecas"
          value={f.pecas}
          onChange={(e) => set('pecas', e.target.value)}
          placeholder="Ex.: rolete de tração, fusível"
        />
      </Field>
      <Field label="Responsável" htmlFor="os-responsavel" className="sm:col-span-3">
        <Input
          id="os-responsavel"
          value={f.responsavel}
          onChange={(e) => set('responsavel', e.target.value)}
          list="os-responsaveis"
          placeholder="Quem fez ou vai fazer"
        />
        <datalist id="os-responsaveis">
          {responsaveis.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </Field>
      <Field label="Custo" htmlFor="os-custo" className="sm:col-span-3" hint="Peças e mão de obra">
        <CurrencyInput id="os-custo" valor={f.custo} aoMudar={(v) => set('custo', v)} />
      </Field>

      {maquina && sugestao && (
        <motion.label
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 sm:col-span-6',
            sugestao === 'MANUTENCAO' ? 'border-warning/30 bg-warning-soft' : 'border-success/30 bg-success-soft',
          )}
        >
          <input
            type="checkbox"
            checked={marcado}
            onChange={(e) => setEscolhas((x) => ({ ...x, [chaveEscolha]: e.target.checked }))}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--brand)]"
          />
          <span className="min-w-0 text-sm">
            <span className="block font-medium text-ink">
              {sugestao === 'MANUTENCAO'
                ? `Colocar a máquina ${maquina.identificacao} em manutenção`
                : `Liberar a máquina ${maquina.identificacao} (voltar para Disponível)`}
            </span>
            <span className="mt-0.5 block text-[13px] text-ink-2">
              {sugestao === 'MANUTENCAO'
                ? locadaAgora
                  ? 'Ela está locada agora: marque quando ela voltar do evento.'
                  : 'Ela fica indisponível para eventos até ser liberada.'
                : outrasEmAberto
                  ? `Atenção: ela ainda tem ${outrasEmAberto === 1 ? 'outra O.S. em aberto' : `${outrasEmAberto} outras O.S. em aberto`}.`
                  : 'Ela volta a ficar disponível para os eventos.'}
            </span>
            {locacoes.length > 0 && (
              <span className="mt-1 flex items-start gap-1.5 text-[13px] font-medium text-warning">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Está marcada para {localDaLocacao(locacoes[0].evento)} ({periodo(locacoes[0].inicio, locacoes[0].fim)})
                  {locacoes.length > 1 && ` e mais ${locacoes.length - 1}`}.
                </span>
              </span>
            )}
          </span>
        </motion.label>
      )}
    </form>
  )
}

/** Máquina fixa da O.S. (aberta pela ficha da máquina). */
function MaquinaEscolhida({ maquina }: { maquina: Maquina }) {
  const situacao = useSituacoes().get(maquina.id)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <span className="text-lg font-semibold tracking-[-0.01em] text-ink">{maquina.identificacao}</span>
      <TipoMaquinaBadge tipo={maquina.tipo} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{maquina.modelo || TIPO_MAQUINA[maquina.tipo].label}</span>
      <SituacaoBadge estado={situacao?.estado ?? maquina.status} />
    </div>
  )
}

function OpcaoTipo({ tipo, ativo, aoEscolher }: { tipo: TipoOS; ativo: boolean; aoEscolher: () => void }) {
  const Icone = tipo === 'PREVENTIVA' ? ShieldCheck : Wrench
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoEscolher}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo
          ? 'border-brand bg-brand-soft shadow-xs'
          : 'border-line-strong/80 bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          ativo ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2',
        )}
      >
        <Icone className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className={cn('block text-sm font-semibold', ativo ? 'text-brand-ink' : 'text-ink')}>{TIPO_OS[tipo].label}</span>
        <span className="block text-xs text-muted">{TIPO_OS[tipo].descricao}</span>
      </span>
    </button>
  )
}

const PONTO_STATUS: Record<StatusOS, string> = {
  ABERTA: 'bg-warning-dot',
  EM_ANDAMENTO: 'bg-info',
  CONCLUIDA: 'bg-success',
  CANCELADA: 'bg-neutral',
}

function OpcaoStatus({ status, ativo, aoEscolher }: { status: StatusOS; ativo: boolean; aoEscolher: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoEscolher}
      className={cn(
        'flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 text-[13px] font-medium whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo
          ? 'border-brand bg-brand-soft text-brand-ink shadow-xs'
          : 'border-line-strong/80 bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2 hover:text-ink',
      )}
    >
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PONTO_STATUS[status])} />
      {STATUS_OS[status].label}
    </button>
  )
}

function ChipServico({
  ativo,
  aoClicar,
  removivel,
  children,
}: {
  ativo: boolean
  aoClicar: () => void
  removivel?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoClicar}
      title={removivel ? 'Remover este serviço' : undefined}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo
          ? 'border-brand/40 bg-brand-soft text-brand-ink'
          : 'border-line-strong/80 bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2 hover:text-ink',
      )}
    >
      {ativo ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 text-muted" />}
      {children}
      {removivel && <X aria-hidden className="h-3.5 w-3.5 opacity-70" />}
    </button>
  )
}

/** Gera o PDF da O.S. no papel timbrado (o jsPDF só é carregado no primeiro uso). */
export function BotaoImprimirOS({
  ordem,
  maquina,
  comTexto,
}: {
  ordem: OrdemServico
  maquina: Maquina | undefined
  /** Mostra "Imprimir" ao lado do ícone. */
  comTexto?: boolean
}) {
  const [gerando, setGerando] = useState(false)
  const imprimir = async () => {
    setGerando(true)
    try {
      const { baixarOSPDF } = await import('../lib/pdfOS')
      const nome = await baixarOSPDF(ordem, maquina)
      toast.sucesso('PDF da O.S. gerado', nome)
    } catch (e) {
      toast.erro('Não foi possível gerar o PDF', (e as Error).message)
    } finally {
      setGerando(false)
    }
  }
  const icone = gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />
  return comTexto ? (
    <Button tamanho="sm" icone={icone} onClick={imprimir} disabled={gerando}>
      Imprimir
    </Button>
  ) : (
    <Button
      variante="ghost"
      tamanho="icon-sm"
      onClick={imprimir}
      disabled={gerando}
      aria-label={`Imprimir ${codigoOS(ordem.numero)}`}
      title="Imprimir O.S. (PDF)"
    >
      {icone}
    </Button>
  )
}
