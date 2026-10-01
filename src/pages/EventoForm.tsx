import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CalendarRange,
  Clock,
  CreditCard,
  Landmark,
  Package,
  Plus,
  QrCode,
  Save,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ConferenciaBadge } from '../components/Badges'
import { ClienteFormModal } from '../components/ClienteFormModal'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { Combobox, type AcaoCombo } from '../components/ui/Combobox'
import { CurrencyInput, Field, Input, NumberInput, Select, Textarea } from '../components/ui/Form'
import { Modal } from '../components/ui/Modal'
import { confirmar } from '../components/ui/Feedback'
import { ErroApi } from '../lib/api'
import { AnimatedNumber, Avatar, EmptyState, PageHeader } from '../components/ui/Misc'
import { calcularEvento, FORMAS_PAGAMENTO, ocupacaoPorDia, STATUS_EVENTO } from '#shared/calc.ts'
import { cn } from '../lib/cn'
import { codigoEvento, dataExtensa, hojeISO, moeda, normalizar, numero } from '../lib/format'
import { CLIENTE_VAZIO } from '#shared/dominio.ts'
import { novoId } from '../lib/storage'
import type { DiaEvento, Evento, FormaPagamento, StatusEvento } from '#shared/tipos.ts'
import { useDados, type EventoInput } from '../store/dados'
import { avisarErro, toast } from '../store/ui'

const ICONES_PAGAMENTO: Record<FormaPagamento, ReactNode> = {
  NAO_PAGO: <Clock className="h-4 w-4" />,
  PIX: <QrCode className="h-4 w-4" />,
  DINHEIRO: <Banknote className="h-4 w-4" />,
  DEBITO: <CreditCard className="h-4 w-4" />,
  CREDITO: <CreditCard className="h-4 w-4" />,
  BOLETO: <Landmark className="h-4 w-4" />,
}
const ORDEM_PAGAMENTO: FormaPagamento[] = ['NAO_PAGO', 'PIX', 'DINHEIRO', 'DEBITO', 'CREDITO', 'BOLETO']

type Erros = Partial<Record<'cliente' | 'nome' | 'dias' | 'bobinas', string>>

export function EventoForm() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const navegar = useNavigate()
  const { eventos, clientes, config, salvarEvento } = useDados()
  const existente = id ? eventos.find((e) => e.id === id) : undefined

  const [f, setF] = useState<EventoInput>(() => {
    if (existente) {
      const { id: _i, versao: _v, codigo: _c, criadoEm: _cr, atualizadoEm: _a, google: _g, ...resto } = existente
      return { ...resto, dias: resto.dias.map((d) => ({ ...d })) }
    }
    return {
      clienteId: params.get('cliente') ?? '',
      nome: '',
      local: '',
      cidade: '',
      dias: [{ id: novoId(), data: params.get('data') ?? hojeISO(), maquinas: 1 }],
      valorDiaria: config.valorDiariaPadrao,
      valorBobina: config.valorBobinaPadrao,
      bobinasConsignadas: 0,
      bobinasDevolvidas: null,
      desconto: 0,
      formaPagamento: 'NAO_PAGO',
      dataPagamento: '',
      status: 'EM_ABERTO',
      rodape: config.rodapePadrao,
      observacoes: '',
    }
  })
  const [erros, setErros] = useState<Erros>({})
  const [salvando, setSalvando] = useState(false)
  // Versão aberta para edição; se outra pessoa salvar antes, o servidor recusa e avisamos
  const [versaoBase, setVersaoBase] = useState(existente?.versao)
  const [clienteModal, setClienteModal] = useState<{ aberto: boolean; nome?: string }>({ aberto: false })
  const [periodoModal, setPeriodoModal] = useState(false)

  const set = <K extends keyof EventoInput>(k: K, v: EventoInput[K]) => setF((s) => ({ ...s, [k]: v }))
  const resumo = useMemo(() => calcularEvento(f), [f])
  const ocupacao = useMemo(() => ocupacaoPorDia(eventos, id), [eventos, id])
  const cliente = clientes.find((c) => c.id === f.clienteId)

  const opcoesClientes = useMemo(
    () =>
      [...clientes]
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
        .map((c) => ({
          valor: c.id,
          label: c.nome,
          detalhe: [c.tipo === 'AVULSO' ? 'Avulso' : c.documento, c.cidade].filter(Boolean).join(' • '),
          icone: <Avatar nome={c.nome} className="h-6 w-6 rounded-md text-[10px]" />,
        })),
    [clientes],
  )

  // ---- Seletor de cliente: cadastro completo (modal) ou cliente avulso na hora ----
  const salvarCliente = useDados((s) => s.salvarCliente)
  const selecionarCliente = (c: { id: string; cidade: string }) => {
    setF((s) => ({ ...s, clienteId: c.id, cidade: s.cidade || c.cidade }))
    setErros((e) => ({ ...e, cliente: undefined }))
  }
  const usarComoAvulso = async (nome: string) => {
    try {
      const c = await salvarCliente({ ...CLIENTE_VAZIO, tipo: 'AVULSO', nome })
      selecionarCliente(c)
      toast.sucesso('Cliente avulso criado', c.nome)
    } catch (e) {
      avisarErro('Não foi possível criar o cliente avulso', e)
    }
  }
  const acoesCliente: AcaoCombo[] = [
    {
      label: (nome: string) => (
        <>
          Cadastrar novo cliente
          {nome && <span className="truncate text-muted">“{nome}”</span>}
        </>
      ),
      icone: <UserPlus className="h-4 w-4" />,
      aoClicar: (nome: string) => setClienteModal({ aberto: true, nome }),
    },
    {
      label: (nome: string) => (
        <>
          Usar como cliente avulso: <span className="truncate">“{nome}”</span>
        </>
      ),
      icone: <UserRound className="h-4 w-4" />,
      aoClicar: usarComoAvulso,
      // Só com algo digitado e sem um cliente com exatamente esse nome
      visivel: (nome: string) => !!nome && !clientes.some((c) => normalizar(c.nome) === normalizar(nome)),
    },
  ]

  // ---- Dias -----------------------------------------------------------------
  const datasRepetidas = useMemo(() => {
    const vistos = new Set<string>()
    const rep = new Set<string>()
    for (const d of f.dias) {
      if (vistos.has(d.data)) rep.add(d.data)
      vistos.add(d.data)
    }
    return rep
  }, [f.dias])

  const atualizarDia = (diaId: string, patch: Partial<DiaEvento>) =>
    set(
      'dias',
      f.dias.map((d) => (d.id === diaId ? { ...d, ...patch } : d)),
    )

  const adicionarDia = () => {
    const ordenados = [...f.dias].filter((d) => d.data).sort((a, b) => a.data.localeCompare(b.data))
    const ultimo = ordenados[ordenados.length - 1]
    const data = ultimo ? format(addDays(parseISO(ultimo.data), 1), 'yyyy-MM-dd') : hojeISO()
    set('dias', [...f.dias, { id: novoId(), data, maquinas: ultimo?.maquinas ?? 1 }])
  }

  const adicionarPeriodo = (de: string, ate: string, maquinas: number) => {
    const n = differenceInCalendarDays(parseISO(ate), parseISO(de))
    const existentes = new Set(f.dias.map((d) => d.data))
    const novos: DiaEvento[] = []
    for (let i = 0; i <= n; i++) {
      const data = format(addDays(parseISO(de), i), 'yyyy-MM-dd')
      if (!existentes.has(data)) novos.push({ id: novoId(), data, maquinas })
    }
    // Remove a linha inicial "vazia" (padrão de hoje com 1 máquina) se o usuário ainda não mexeu nela
    const base =
      !existente &&
      f.dias.length === 1 &&
      f.dias[0].maquinas === 1 &&
      !novos.some((x) => x.data === f.dias[0].data) &&
      f.dias[0].data === hojeISO()
        ? []
        : f.dias
    set(
      'dias',
      [...base, ...novos].sort((a, b) => a.data.localeCompare(b.data)),
    )
    toast.sucesso(`${novos.length} ${novos.length === 1 ? 'dia adicionado' : 'dias adicionados'}`)
  }

  // ---- Salvar -----------------------------------------------------------------
  const validar = useCallback((): Erros => {
    const e: Erros = {}
    if (!f.clienteId) e.cliente = 'Selecione o cliente.'
    if (!f.nome.trim()) e.nome = 'Informe o nome do evento.'
    if (!f.dias.length) e.dias = 'Adicione pelo menos um dia de utilização.'
    else if (f.dias.some((d) => !d.data)) e.dias = 'Preencha a data de todos os dias.'
    else if (datasRepetidas.size) e.dias = 'Existem datas repetidas.'
    else if (f.dias.some((d) => d.maquinas < 1)) e.dias = 'Cada dia precisa de pelo menos 1 máquina.'
    if (f.bobinasDevolvidas !== null && f.bobinasDevolvidas > f.bobinasConsignadas)
      e.bobinas = 'As devolvidas não podem passar das consignadas.'
    return e
  }, [f, datasRepetidas])

  const salvar = useCallback(async () => {
    if (salvando) return
    const e = validar()
    setErros(e)
    const primeiro = Object.values(e)[0]
    if (primeiro) {
      toast.erro('Revise o formulário', primeiro)
      return
    }
    const dados = {
      ...f,
      nome: f.nome.trim(),
      dataPagamento: f.formaPagamento === 'NAO_PAGO' ? '' : f.dataPagamento || hojeISO(),
    }
    setSalvando(true)
    try {
      const salvo = await salvarEvento(dados, id && versaoBase !== undefined ? { id, versao: versaoBase } : undefined)
      toast.sucesso(id ? 'Evento atualizado' : 'Evento cadastrado', `${codigoEvento(salvo.codigo)} • ${salvo.nome}`)
      navegar(`/eventos/${salvo.id}`, { replace: !!id })
    } catch (err) {
      if (err instanceof ErroApi && err.status === 409) {
        const atual = err.dados.atual as Evento | undefined
        const manter = await confirmar({
          titulo: 'Evento alterado por outra pessoa',
          descricao:
            'Alguém salvou este evento enquanto você editava. Deseja manter as suas alterações por cima das dela? (Se não, recarregue o evento para ver a versão atual.)',
          confirmar: 'Manter as minhas',
        })
        if (manter && atual) {
          setVersaoBase(atual.versao)
          toast.info('Clique em “Salvar evento” novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar o evento', err)
    } finally {
      setSalvando(false)
    }
  }, [salvando, validar, salvarEvento, f, id, versaoBase, navegar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void salvar()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [salvar])

  if (id && !existente) {
    return (
      <EmptyState
        icone={<CalendarDays className="h-6 w-6" />}
        titulo="Evento não encontrado"
        descricao="Ele pode ter sido excluído."
        acao={<Button onClick={() => navegar('/eventos')}>Voltar para eventos</Button>}
      />
    )
  }

  return (
    <>
      <PageHeader
        voltar={
          <Link
            to={existente ? `/eventos/${existente.id}` : '/eventos'}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {existente ? 'Voltar ao evento' : 'Eventos'}
          </Link>
        }
        titulo={existente ? `Editar evento ${codigoEvento(existente.codigo)}` : 'Novo evento'}
        descricao="Preencha os dias de uso e os valores — o resumo é calculado automaticamente."
        acoes={
          <>
            <Button onClick={() => navegar(-1)}>Cancelar</Button>
            <Button variante="primary" icone={<Save className="h-4 w-4" />} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar evento'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* 1. Cliente e evento */}
          <Card>
            <CardHeader
              icone={<Users className="h-4 w-4" />}
              titulo="Cliente e evento"
              descricao="Quem contratou e onde as máquinas serão usadas."
            />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
              <Field label="Cliente" htmlFor="ev-cliente" erro={erros.cliente} className="sm:col-span-2">
                <Combobox
                  id="ev-cliente"
                  opcoes={opcoesClientes}
                  valor={f.clienteId}
                  aoMudar={(v) => {
                    // Preenche a cidade com a do cliente quando estiver vazia
                    const escolhido = clientes.find((c) => c.id === v)
                    selecionarCliente({ id: v, cidade: escolhido?.cidade ?? '' })
                  }}
                  placeholder="Selecione ou cadastre um cliente"
                  vazio="Nenhum cliente encontrado"
                  invalido={!!erros.cliente}
                  acoes={acoesCliente}
                />
              </Field>
              <Field label="Nome do evento" htmlFor="ev-nome" erro={erros.nome}>
                <Input
                  id="ev-nome"
                  value={f.nome}
                  onChange={(e) => {
                    set('nome', e.target.value)
                    setErros((x) => ({ ...x, nome: undefined }))
                  }}
                  placeholder="Ex.: Baile da Cidade"
                  className={cn(erros.nome && 'border-danger')}
                />
              </Field>
              <Field label="Status" htmlFor="ev-status">
                <Select id="ev-status" value={f.status} onChange={(e) => set('status', e.target.value as StatusEvento)}>
                  {(Object.keys(STATUS_EVENTO) as StatusEvento[]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_EVENTO[s].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Local" htmlFor="ev-local">
                <Input
                  id="ev-local"
                  value={f.local}
                  onChange={(e) => set('local', e.target.value)}
                  placeholder="Ex.: Ginásio municipal"
                />
              </Field>
              <Field label="Cidade" htmlFor="ev-cidade">
                <Input
                  id="ev-cidade"
                  value={f.cidade}
                  onChange={(e) => set('cidade', e.target.value)}
                  placeholder="Ex.: Rio Claro"
                />
              </Field>
            </div>
          </Card>

          {/* 2. Dias de utilização */}
          <Card>
            <CardHeader
              icone={<CalendarDays className="h-4 w-4" />}
              titulo="Dias de utilização"
              descricao="Cada máquina em cada dia conta como uma diária."
              acoes={
                <span className="tnum rounded-lg bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-ink">
                  {numero(resumo.totalDiarias)} {resumo.totalDiarias === 1 ? 'diária' : 'diárias'}
                </span>
              }
            />
            <div className="px-5 pb-5">
              <div className="hidden grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_36px] gap-3 px-1 pb-2 text-xs font-medium text-muted sm:grid">
                <span>Data</span>
                <span>Máquinas</span>
                <span>Disponibilidade da frota</span>
                <span />
              </div>
              <motion.div layout className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {f.dias.map((d) => {
                    const usadas = ocupacao.get(d.data) ?? 0
                    const livres = config.frotaMaquinas - usadas
                    const excede = d.maquinas > livres
                    const repetida = datasRepetidas.has(d.data)
                    return (
                      <motion.div
                        key={d.id}
                        layout
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_120px_36px] items-center gap-3 rounded-xl border border-line bg-surface-2/50 p-2 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)_36px] sm:border-0 sm:bg-transparent sm:p-0">
                          <div className="relative">
                            <Input
                              type="date"
                              value={d.data}
                              onChange={(e) => atualizarDia(d.id, { data: e.target.value })}
                              className={cn('tnum pr-3', repetida && 'border-danger')}
                              aria-label="Data"
                            />
                          </div>
                          <NumberInput
                            valor={d.maquinas}
                            min={1}
                            max={999}
                            aoMudar={(v) => atualizarDia(d.id, { maquinas: v ?? 1 })}
                            aria-label="Máquinas"
                          />
                          <div className="order-last col-span-3 flex min-w-0 items-center gap-2 text-xs sm:order-none sm:col-span-1">
                            {d.data && (
                              <>
                                <span className="truncate text-muted">{dataExtensa(d.data, 'EEE, d MMM')}</span>
                                <span className="text-line-strong">•</span>
                                {repetida ? (
                                  <span className="font-medium text-danger">Data repetida</span>
                                ) : excede ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-warning">
                                    <TriangleAlert className="h-3.5 w-3.5" />
                                    {livres <= 0 ? 'Frota esgotada' : `Só ${livres} livre${livres > 1 ? 's' : ''}`}
                                  </span>
                                ) : (
                                  <span className="tnum truncate text-muted">
                                    {livres - d.maquinas} de {config.frotaMaquinas} livres
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                          <Button
                            variante="ghost"
                            tamanho="icon-sm"
                            aria-label="Remover dia"
                            onClick={() =>
                              set(
                                'dias',
                                f.dias.filter((x) => x.id !== d.id),
                              )
                            }
                            className="hover:bg-danger-soft hover:text-danger"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </motion.div>
              {erros.dias && <p className="mt-2 text-xs font-medium text-danger">{erros.dias}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variante="soft" tamanho="sm" icone={<Plus className="h-4 w-4" />} onClick={adicionarDia}>
                  Adicionar dia
                </Button>
                <Button tamanho="sm" icone={<CalendarRange className="h-4 w-4" />} onClick={() => setPeriodoModal(true)}>
                  Adicionar período
                </Button>
              </div>
            </div>
          </Card>

          {/* 3. Valores e bobinas */}
          <Card>
            <CardHeader
              icone={<Package className="h-4 w-4" />}
              titulo="Valores e bobinas"
              descricao="Bobinas utilizadas = consignadas − devolvidas."
              acoes={<ConferenciaBadge status={resumo.conferencia} />}
            />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Valor da diária" htmlFor="ev-vd">
                <CurrencyInput id="ev-vd" valor={f.valorDiaria} aoMudar={(v) => set('valorDiaria', v)} />
              </Field>
              <Field label="Valor de cada bobina" htmlFor="ev-vb">
                <CurrencyInput id="ev-vb" valor={f.valorBobina} aoMudar={(v) => set('valorBobina', v)} />
              </Field>
              <Field label="Desconto" htmlFor="ev-desc" hint="Opcional">
                <CurrencyInput id="ev-desc" valor={f.desconto} aoMudar={(v) => set('desconto', v)} />
              </Field>
              <Field label="Bobinas consignadas" htmlFor="ev-bc" hint="Entregues ao cliente">
                <NumberInput
                  id="ev-bc"
                  valor={f.bobinasConsignadas}
                  aoMudar={(v) => {
                    set('bobinasConsignadas', v ?? 0)
                    setErros((x) => ({ ...x, bobinas: undefined }))
                  }}
                />
              </Field>
              <Field
                label="Bobinas devolvidas"
                htmlFor="ev-bd"
                hint={erros.bobinas ? undefined : 'Deixe vazio até a conferência'}
                erro={erros.bobinas}
              >
                <NumberInput
                  id="ev-bd"
                  valor={f.bobinasDevolvidas}
                  permitirVazio
                  max={f.bobinasConsignadas}
                  placeholder="Aguardando"
                  aoMudar={(v) => {
                    set('bobinasDevolvidas', v)
                    setErros((x) => ({ ...x, bobinas: undefined }))
                  }}
                />
              </Field>
              <div className="flex flex-col justify-center rounded-xl bg-surface-2 px-4 py-3">
                <p className="text-xs text-muted">Bobinas utilizadas</p>
                <p className="tnum mt-0.5 text-lg font-semibold text-ink">
                  {resumo.bobinasUtilizadas === null ? '—' : numero(resumo.bobinasUtilizadas)}
                </p>
              </div>
            </div>
          </Card>

          {/* 4. Pagamento */}
          <Card>
            <CardHeader icone={<Wallet className="h-4 w-4" />} titulo="Pagamento e observações" />
            <div className="flex flex-col gap-4 px-5 pb-5">
              <Field label="Forma de pagamento">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {ORDEM_PAGAMENTO.map((fp) => {
                    const ativo = f.formaPagamento === fp
                    return (
                      <button
                        key={fp}
                        type="button"
                        onClick={() => set('formaPagamento', fp)}
                        aria-pressed={ativo}
                        className={cn(
                          'relative flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition-[border-color,background-color,color,box-shadow] duration-150',
                          ativo
                            ? fp === 'NAO_PAGO'
                              ? 'border-warning-dot/60 bg-warning-soft text-warning'
                              : 'border-brand/60 bg-brand-soft text-brand-ink ring-4 ring-[var(--ring)]/40'
                            : 'border-line-strong/80 bg-surface text-ink-2 hover:border-line-strong hover:bg-surface-2',
                        )}
                      >
                        {ICONES_PAGAMENTO[fp]}
                        {FORMAS_PAGAMENTO[fp].label}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <AnimatePresence initial={false}>
                {f.formaPagamento !== 'NAO_PAGO' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <Field
                      label="Data do pagamento"
                      htmlFor="ev-dp"
                      className="sm:w-60"
                      hint="Se vazio, será usada a data de hoje."
                    >
                      <Input
                        id="ev-dp"
                        type="date"
                        value={f.dataPagamento}
                        onChange={(e) => set('dataPagamento', e.target.value)}
                      />
                    </Field>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Mensagem de rodapé do PDF" htmlFor="ev-rod" hint="Aparece no resumo entregue ao cliente.">
                  <Input
                    id="ev-rod"
                    value={f.rodape}
                    onChange={(e) => set('rodape', e.target.value)}
                    placeholder={config.rodapePadrao}
                  />
                </Field>
                <Field label="Observações" htmlFor="ev-obs">
                  <Textarea
                    id="ev-obs"
                    value={f.observacoes}
                    onChange={(e) => set('observacoes', e.target.value)}
                    placeholder="Ex.: entregar as máquinas às 18h"
                    className="min-h-10"
                    rows={1}
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        {/* Resumo financeiro (fixo ao rolar) */}
        <div className="xl:sticky xl:top-6">
          <Card className="overflow-hidden">
            <div className="relative overflow-hidden bg-brand px-5 pt-5 pb-6 text-white">
              <div className="pointer-events-none absolute -top-20 -right-12 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
              <p className="relative text-[13px] font-medium text-white/85">Total final</p>
              <p className="relative mt-1 text-[34px] leading-none font-semibold tracking-[-0.03em]">
                <AnimatedNumber valor={resumo.total} formatar={moeda} />
              </p>
              <p className="relative mt-2 truncate text-[13px] text-white/80">
                {cliente ? cliente.nome : 'Nenhum cliente selecionado'}
              </p>
            </div>
            <dl className="divide-y divide-line px-5 text-sm">
              <Linha rotulo="Total de diárias" valor={numero(resumo.totalDiarias)} />
              <Linha
                rotulo="Valor das diárias"
                valor={moeda(resumo.valorDiarias)}
                sub={`${numero(resumo.totalDiarias)} × ${moeda(f.valorDiaria)}`}
              />
              <Linha
                rotulo="Bobinas utilizadas"
                valor={resumo.bobinasUtilizadas === null ? 'A conferir' : numero(resumo.bobinasUtilizadas)}
              />
              <Linha
                rotulo="Valor das bobinas"
                valor={moeda(resumo.valorBobinas)}
                sub={
                  resumo.bobinasUtilizadas === null
                    ? 'Cobrado após a devolução'
                    : `${numero(resumo.bobinasUtilizadas)} × ${moeda(f.valorBobina)}`
                }
              />
              {resumo.desconto > 0 && <Linha rotulo="Desconto" valor={`− ${moeda(resumo.desconto)}`} />}
            </dl>
            <div className="border-t border-line p-5">
              <Button
                variante="primary"
                className="w-full"
                icone={<Save className="h-4 w-4" />}
                onClick={salvar}
                disabled={salvando}
              >
                {salvando ? 'Salvando…' : 'Salvar evento'}
              </Button>
              <p className="mt-2.5 text-center text-xs text-muted">
                Atalho: <kbd className="rounded border border-line bg-surface-2 px-1">Ctrl</kbd> +{' '}
                <kbd className="rounded border border-line bg-surface-2 px-1">S</kbd>
              </p>
            </div>
          </Card>
        </div>
      </div>

      <ClienteFormModal
        aberto={clienteModal.aberto}
        nomeInicial={clienteModal.nome}
        aoFechar={() => setClienteModal({ aberto: false })}
        aoSalvar={selecionarCliente}
      />
      <PeriodoModal aberto={periodoModal} aoFechar={() => setPeriodoModal(false)} aoConfirmar={adicionarPeriodo} />
    </>
  )
}

function Linha({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div>
        <dt className="text-ink-2">{rotulo}</dt>
        {sub && <p className="tnum mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      <dd className="tnum font-semibold whitespace-nowrap text-ink">{valor}</dd>
    </div>
  )
}

function PeriodoModal({
  aberto,
  aoFechar,
  aoConfirmar,
}: {
  aberto: boolean
  aoFechar: () => void
  aoConfirmar: (de: string, ate: string, maquinas: number) => void
}) {
  const [de, setDe] = useState(hojeISO)
  const [ate, setAte] = useState(() => format(addDays(new Date(), 2), 'yyyy-MM-dd'))
  const [maq, setMaq] = useState(1)
  const dias = de && ate ? differenceInCalendarDays(parseISO(ate), parseISO(de)) + 1 : 0
  const valido = dias >= 1 && dias <= 120
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<CalendarRange className="h-5 w-5" />}
      titulo="Adicionar período"
      descricao="Cria um dia para cada data do intervalo com a mesma quantidade de máquinas."
      largura="max-w-md"
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button
            variante="primary"
            disabled={!valido}
            onClick={() => {
              aoConfirmar(de, ate, maq)
              aoFechar()
            }}
          >
            Adicionar {valido ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : ''}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="De" htmlFor="per-de">
          <Input id="per-de" type="date" value={de} onChange={(e) => setDe(e.target.value)} />
        </Field>
        <Field label="Até" htmlFor="per-ate">
          <Input id="per-ate" type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
        </Field>
        <Field
          label="Máquinas por dia"
          htmlFor="per-maq"
          className="col-span-2"
          erro={dias > 120 ? 'Período máximo de 120 dias.' : dias < 1 ? 'A data final deve ser depois da inicial.' : null}
        >
          <NumberInput id="per-maq" valor={maq} min={1} aoMudar={(v) => setMaq(v ?? 1)} />
        </Field>
      </div>
    </Modal>
  )
}
