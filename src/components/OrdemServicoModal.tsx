// Formulário de manutenção: o registro interno de um serviço feito (ou a fazer) numa máquina.
// No código continua com o nome antigo, "ordem de serviço" (O.S.); na tela é só "manutenção".

import {
  Check,
  ClipboardCheck,
  ClipboardPen,
  ClipboardPlus,
  ListChecks,
  Plus,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { normalizarOS } from '#shared/dominio.ts'
import {
  chaveServico,
  codigoOS,
  ESTADO_MAQUINA,
  localDaLocacao,
  osEmAberto,
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
import {
  adicionarServico,
  locacoesDeHojeEmDiante,
  opcoesServico,
  servicoIgual,
  sugestaoMaquina,
  sugestaoMarcada,
} from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { MaquinaChip, SituacaoBadge, TipoMaquinaBadge, useSituacoes } from './Maquinas'
import { ServicosManutencaoModal } from './ServicosManutencaoModal'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Field, Input, Textarea } from './ui/Form'
import { Modal } from './ui/Modal'

export function OrdemServicoModal({
  aberto,
  aoFechar,
  ordem,
  maquinaId,
  fixarMaquina,
  concluir,
  inicial,
  aoSalvar,
}: {
  aberto: boolean
  aoFechar: () => void
  /** Manutenção a editar; sem ela, registra uma nova. */
  ordem?: OrdemServico
  /** Máquina já escolhida (ex.: vindo da ficha da máquina). */
  maquinaId?: string
  /** Não deixa trocar a máquina. */
  fixarMaquina?: boolean
  /** Abre a manutenção já como "Concluída", com a data de hoje. */
  concluir?: boolean
  /** Campos já preenchidos numa manutenção nova (ex.: aberta a partir de uma reclamação). */
  inicial?: Partial<OrdemServicoInput>
  aoSalvar?: (o: OrdemServico) => void
}) {
  const [salvando, setSalvando] = useState(false)
  // A lista de serviços abre por cima do formulário, mas fica fora do <form> (os eventos do
  // React sobem pela árvore de componentes, mesmo com a janela num portal)
  const [gerenciando, setGerenciando] = useState(false)
  const fechar = () => {
    setGerenciando(false)
    aoFechar()
  }
  const titulo = ordem ? `${concluir ? 'Concluir' : 'Editar'} manutenção ${codigoOS(ordem.numero)}` : 'Nova manutenção'
  const Icone = ordem ? (concluir ? ClipboardCheck : ClipboardPen) : ClipboardPlus
  return (
    <>
      <Modal
        aberto={aberto}
        aoFechar={fechar}
        largura="max-w-2xl"
        icone={<Icone className="h-5 w-5" />}
        titulo={titulo}
        descricao={
          concluir
            ? 'Confira os serviços feitos e a data de conclusão.'
            : 'Registro interno do serviço feito na máquina. Fica guardado no histórico dela.'
        }
        rodape={
          <>
            <Button onClick={fechar}>Cancelar</Button>
            <Button variante="primary" type="submit" form="form-os" disabled={salvando}>
              {salvando ? 'Salvando…' : concluir ? 'Concluir manutenção' : ordem ? 'Salvar alterações' : 'Registrar manutenção'}
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
          inicial={inicial}
          aoSalvar={aoSalvar}
          aoFechar={fechar}
          aoGerenciarServicos={() => setGerenciando(true)}
          setSalvando={setSalvando}
        />
      </Modal>
      <ServicosManutencaoModal aberto={gerenciando} aoFechar={() => setGerenciando(false)} />
    </>
  )
}

function estadoInicial(
  ordem: OrdemServico | undefined,
  maquinaId: string | undefined,
  concluir: boolean | undefined,
  inicial: Partial<OrdemServicoInput> | undefined,
): OrdemServicoInput {
  if (ordem) {
    // Leva junto os campos que saíram da tela (serviço realizado, peças, custo): salvar não os apaga
    const { id: _i, versao: _v, numero: _n, criadoEm: _c, atualizadoEm: _a, ...resto } = ordem
    return concluir && resto.status !== 'CONCLUIDA'
      ? { ...resto, status: 'CONCLUIDA', conclusao: resto.conclusao || hojeISO() }
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
    ...inicial,
  }
  return nova
}

function FormularioOS({
  ordem,
  maquinaId,
  fixarMaquina,
  concluir,
  inicial,
  aoSalvar,
  aoFechar,
  aoGerenciarServicos,
  setSalvando,
}: {
  ordem?: OrdemServico
  maquinaId?: string
  fixarMaquina?: boolean
  concluir?: boolean
  inicial?: Partial<OrdemServicoInput>
  aoSalvar?: (o: OrdemServico) => void
  aoFechar: () => void
  aoGerenciarServicos: () => void
  setSalvando: (v: boolean) => void
}) {
  const maquinas = useDados((s) => s.maquinas)
  const ordens = useDados((s) => s.ordens)
  const eventos = useDados((s) => s.eventos)
  const cadastrados = useDados((s) => s.config.servicosManutencao)
  const salvarOrdem = useDados((s) => s.salvarOrdem)
  const salvarServicos = useDados((s) => s.salvarServicos)
  const situacoes = useSituacoes()
  const [f, setF] = useState<OrdemServicoInput>(() => estadoInicial(ordem, maquinaId, concluir, inicial))
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(ordem?.versao)
  const [tentou, setTentou] = useState(false)
  const [novoServico, setNovoServico] = useState('')
  const [erroNovo, setErroNovo] = useState<string | null>(null)
  const [cadastrando, setCadastrando] = useState(false)
  /** Escolha da caixa "colocar em manutenção / liberar", por máquina e sugestão. */
  const [escolhas, setEscolhas] = useState<Record<string, boolean>>({})

  const set = <K extends keyof OrdemServicoInput>(k: K, v: OrdemServicoInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const maquina = maquinas.find((m) => m.id === f.maquinaId)
  const maquinaFixa = !!fixarMaquina && !!maquina

  // Serviços para marcar: os cadastrados e, depois, os que este registro já tinha (mesmo que
  // tenham saído da lista) e os marcados agora. Desmarcar um antigo não o tira da tela.
  const servicosOriginais = ordem?.servicos ?? inicial?.servicos
  const opcoes = useMemo(
    () => opcoesServico(cadastrados, [...(servicosOriginais ?? []), ...f.servicos]),
    [cadastrados, servicosOriginais, f.servicos],
  )
  const naLista = new Set(cadastrados.map(chaveServico))
  const marcados = new Set(f.servicos.map(chaveServico))
  const responsaveis = useMemo(() => [...new Set(ordens.map((o) => o.responsavel.trim()).filter(Boolean))].slice(0, 12), [ordens])

  const marcar = (s: string) =>
    setF((x) => (x.servicos.some((y) => chaveServico(y) === chaveServico(s)) ? x : { ...x, servicos: [...x.servicos, s] }))

  const alternarServico = (s: string) =>
    setF((x) => ({
      ...x,
      servicos: x.servicos.some((y) => chaveServico(y) === chaveServico(s))
        ? x.servicos.filter((y) => chaveServico(y) !== chaveServico(s))
        : [...x.servicos, s],
    }))

  /** Cadastra o serviço digitado na lista (para as próximas manutenções) e já o marca nesta. */
  const cadastrarServico = async () => {
    if (cadastrando) return
    const lista = useDados.getState().config.servicosManutencao
    // Já cadastrado: só marca
    const cadastrado = servicoIgual(lista, novoServico)
    if (cadastrado) {
      marcar(cadastrado)
      setNovoServico('')
      setErroNovo(null)
      return
    }
    const r = adicionarServico(lista, novoServico)
    if ('erro' in r) return void setErroNovo(r.erro)
    marcar(r.nome)
    setNovoServico('')
    setErroNovo(null)
    setCadastrando(true)
    try {
      await salvarServicos(r.lista)
      toast.sucesso('Serviço cadastrado', `“${r.nome}” fica na lista para as próximas manutenções.`)
    } catch (e) {
      // Continua marcado nesta manutenção; só não entrou na lista
      avisarErro('Não foi possível cadastrar o serviço na lista', e)
    } finally {
      setCadastrando(false)
    }
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
    if (erros.length) return void toast.erro('Confira a manutenção', erros[0])
    setSalvando(true)
    try {
      const alvo = ordem && versaoBase !== undefined ? { id: ordem.id, versao: versaoBase } : undefined
      const salva = await salvarOrdem(valor, alvo, statusMaquina)
      const codigo = codigoOS(salva.numero)
      const ident = maquina?.identificacao ?? ''
      const titulo = !ordem
        ? `Manutenção ${codigo} registrada`
        : salva.status === 'CONCLUIDA' && ordem.status !== 'CONCLUIDA'
          ? `Manutenção ${codigo} concluída`
          : `Manutenção ${codigo} atualizada`
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
        // Conflito de versão: outra pessoa salvou esta manutenção enquanto você editava
        const atual = err.dados.atual as OrdemServico | undefined
        const sobrescrever = await confirmar({
          titulo: 'Manutenção alterada por outra pessoa',
          descricao: 'Alguém salvou esta manutenção enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em salvar novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar a manutenção', err)
    } finally {
      setSalvando(false)
    }
  }

  // Máquinas que podem receber manutenção: as não desativadas (e a já escolhida, mesmo desativada)
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

      <Field label="Situação da manutenção" className="sm:col-span-6">
        <div role="radiogroup" aria-label="Situação da manutenção" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STATUS_OS_LISTA.map((s) => (
            <OpcaoStatus key={s} status={s} ativo={f.status === s} aoEscolher={() => mudarStatus(s)} />
          ))}
        </div>
      </Field>

      <Field label="Data de abertura" htmlFor="os-abertura" className="sm:col-span-3" erro={tentou ? erroAbertura : null}>
        <Input id="os-abertura" type="date" value={f.abertura} onChange={(e) => set('abertura', e.target.value)} required />
      </Field>
      {f.status === 'CONCLUIDA' ? (
        <Field label="Data de conclusão" htmlFor="os-conclusao" className="sm:col-span-3" erro={erroConclusao}>
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
        extra={
          <button
            type="button"
            onClick={aoGerenciarServicos}
            className="-my-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-brand-ink transition-colors hover:bg-brand-soft"
          >
            <ListChecks className="h-3.5 w-3.5" />
            Serviços cadastrados
          </button>
        }
        hint="Marque o que foi feito ou o que precisa ser feito. Um serviço novo entra na lista para as próximas manutenções."
      >
        {opcoes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {opcoes.map((s) => (
              <ChipServico
                key={chaveServico(s)}
                ativo={marcados.has(chaveServico(s))}
                aoClicar={() => alternarServico(s)}
                foraDaLista={!naLista.has(chaveServico(s))}
              >
                {s}
              </ChipServico>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-[13px] text-ink-2">
            Nenhum serviço cadastrado ainda. Cadastre abaixo os serviços que você costuma fazer, ex.: Troca de cabeçote,
            Higienização, Revisão.
          </p>
        )}
        <div className="mt-1 flex gap-2">
          <Input
            aria-label="Cadastrar outro serviço"
            value={novoServico}
            onChange={(e) => {
              setNovoServico(e.target.value)
              setErroNovo(null)
            }}
            onKeyDown={(e) => {
              // Enter cadastra o serviço em vez de salvar a manutenção
              if (e.key === 'Enter') {
                e.preventDefault()
                void cadastrarServico()
              }
            }}
            placeholder={opcoes.length ? 'Outro serviço (ex.: Troca do cabo de força)' : 'Ex.: Troca de cabeçote'}
            maxLength={60}
            aria-invalid={!!erroNovo}
            className={cn('flex-1', erroNovo && 'border-danger! focus:ring-danger/20!')}
          />
          <Button
            icone={<Plus className="h-4 w-4" />}
            onClick={() => void cadastrarServico()}
            disabled={!novoServico.trim() || cadastrando}
          >
            <span className="max-sm:hidden">{cadastrando ? 'Cadastrando…' : 'Cadastrar'}</span>
          </Button>
        </div>
        {erroNovo && (
          <p className="text-xs font-medium text-danger" role="alert">
            {erroNovo}
          </p>
        )}
      </Field>

      <Field label="Problema relatado" htmlFor="os-problema" className="sm:col-span-6">
        <Textarea
          id="os-problema"
          value={f.problema}
          onChange={(e) => set('problema', e.target.value)}
          placeholder={
            f.tipo === 'CORRETIVA' ? 'Ex.: a máquina está travando ao imprimir' : 'Ex.: revisão depois da temporada de festas'
          }
          className="min-h-[72px]"
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
                  ? `Atenção: ela ainda tem ${outrasEmAberto === 1 ? 'outra manutenção em aberto' : `${outrasEmAberto} outras manutenções em aberto`}.`
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

/** Máquina fixa da manutenção (aberta pela ficha da máquina). */
function MaquinaEscolhida({ maquina }: { maquina: Maquina }) {
  const situacao = useSituacoes().get(maquina.id)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
      <span className="text-lg font-semibold tracking-[-0.01em] text-ink">{maquina.identificacao}</span>
      <TipoMaquinaBadge tipo={maquina.tipo} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{TIPO_MAQUINA[maquina.tipo].label}</span>
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

/** Uma situação da manutenção, com o que ela quer dizer. */
function OpcaoStatus({ status, ativo, aoEscolher }: { status: StatusOS; ativo: boolean; aoEscolher: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={ativo}
      onClick={aoEscolher}
      className={cn(
        'flex h-full cursor-pointer flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo
          ? 'border-brand bg-brand-soft shadow-xs'
          : 'border-line-strong/80 bg-surface hover:border-line-strong hover:bg-surface-2',
      )}
    >
      <span className={cn('flex items-center gap-2 text-[13px] font-semibold', ativo ? 'text-brand-ink' : 'text-ink')}>
        <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PONTO_STATUS[status])} />
        {STATUS_OS[status].label}
      </span>
      <span className="text-[11.5px] leading-snug text-muted">{STATUS_OS[status].descricao}</span>
    </button>
  )
}

function ChipServico({
  ativo,
  aoClicar,
  foraDaLista,
  children,
}: {
  ativo: boolean
  aoClicar: () => void
  /** Serviço que este registro tem, mas que não está (mais) na lista de serviços cadastrados. */
  foraDaLista?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={ativo}
      onClick={aoClicar}
      title={foraDaLista ? 'Este serviço não está na lista de serviços cadastrados' : undefined}
      className={cn(
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        ativo
          ? 'border-brand/40 bg-brand-soft text-brand-ink'
          : 'border-line-strong/80 bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2 hover:text-ink',
        foraDaLista && !ativo && 'border-dashed',
      )}
    >
      {ativo ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5 text-muted" />}
      {children}
    </button>
  )
}
