import { format } from 'date-fns'
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Copy,
  FileJson,
  KeyRound,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/cn'
import { numero } from '../lib/format'
import { googleAgenda, type StatusGoogle } from '../lib/google'
import { avisarErro, toast } from '../store/ui'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Card, CardHeader } from './ui/Card'
import { confirmar } from './ui/Feedback'
import { Field, Input } from './ui/Form'

type Acao = 'chave' | 'remover' | 'agenda' | 'ativo' | 'valores' | 'testar' | 'sincronizar'

const dataHora = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm")

/** Copia texto mesmo fora de HTTPS (servidor acessado pelo IP da rede local). */
async function copiarTexto(texto: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(texto)
      return true
    }
  } catch {
    /* cai no método antigo */
  }
  const area = document.createElement('textarea')
  area.value = texto
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  area.remove()
  return ok
}

const PASSOS: ReactNode[] = [
  <>
    No <b>Google Cloud Console</b> (console.cloud.google.com), crie um projeto e ative a <b>“Google Calendar API”</b> em APIs e
    serviços › Biblioteca.
  </>,
  <>
    Em IAM e administrador › <b>Contas de serviço</b>, crie uma conta de serviço. Depois, em Chaves › Adicionar chave, gere uma
    chave do tipo <b>JSON</b> (o arquivo é baixado no computador).
  </>,
  <>
    No <b>Google Agenda</b>, abra Configurações da agenda › <b>Compartilhar com pessoas específicas</b> e adicione o e-mail da
    conta de serviço com a permissão <b>“Fazer alterações nos eventos”</b>.
  </>,
  <>
    Ainda nas configurações da agenda, em <b>Integrar agenda</b>, copie o <b>“ID da agenda”</b>.
  </>,
  <>Envie aqui o arquivo JSON, cole o ID da agenda, clique em “Testar conexão” e ative o envio automático.</>,
]

/** Configuração da integração com o Google Agenda (exibida em Configurações). */
export function GoogleAgendaConfig() {
  const [status, setStatus] = useState<StatusGoogle | null>(null)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [ocupado, setOcupado] = useState<Acao | null>(null)
  const [teste, setTeste] = useState<{ ok: boolean; mensagem: string } | null>(null)
  const [ajuda, setAjuda] = useState<boolean | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const arquivo = useRef<HTMLInputElement>(null)
  const idAgenda = useId()

  const preenchido = useRef(false)
  const carregar = useCallback(
    () =>
      googleAgenda.status().then(
        (s) => {
          setStatus(s)
          setErroCarga(null)
          // Primeira carga: preenche o campo do ID da agenda (depois, não sobrescreve o que está sendo digitado)
          if (!preenchido.current) {
            preenchido.current = true
            setCalendarId(s.calendarId)
          }
        },
        (e: unknown) => setErroCarga(e instanceof Error ? e.message : 'Não foi possível consultar a integração.'),
      ),
    [],
  )

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Atualiza sozinho: a cada 5 s enquanto houver envios pendentes; a cada 30 s com a integração ativa
  const intervalo = !status ? null : status.resumo.pendentes > 0 ? 5_000 : status.ativo ? 30_000 : null
  useEffect(() => {
    if (!intervalo) return
    const t = setInterval(() => void carregar(), intervalo)
    return () => clearInterval(t)
  }, [intervalo, carregar])

  const executar = async (acao: Acao, fn: () => Promise<void>) => {
    setOcupado(acao)
    try {
      await fn()
    } finally {
      setOcupado(null)
    }
  }

  const enviarArquivo = (file: File) =>
    executar('chave', async () => {
      if (file.size > 200 * 1024) {
        toast.erro('Arquivo muito grande', 'Envie o arquivo JSON da chave da conta de serviço (alguns KB).')
        return
      }
      try {
        const s = await googleAgenda.enviarCredenciais(await file.text())
        setStatus(s)
        setTeste(null)
        toast.sucesso('Chave salva no servidor', `Compartilhe a agenda com ${s.contaServico}.`)
      } catch (e) {
        avisarErro('Não foi possível usar este arquivo', e)
      }
    })

  const removerChave = async () => {
    const ok = await confirmar({
      titulo: 'Remover a chave do Google?',
      descricao:
        'O envio automático será desativado. Os eventos já enviados continuam na agenda do Google até serem apagados por lá.',
      confirmar: 'Remover chave',
      perigo: true,
    })
    if (!ok) return
    await executar('remover', async () => {
      try {
        setStatus(await googleAgenda.removerCredenciais())
        setTeste(null)
        toast.sucesso('Chave removida', 'A integração com o Google Agenda foi desativada.')
      } catch (e) {
        avisarErro('Não foi possível remover a chave', e)
      }
    })
  }

  /** O ID digitado é diferente do salvo no servidor (só é salvo com confirmação explícita). */
  const agendaAlterada = !!status && calendarId.trim() !== status.calendarId

  /** Trocar de agenda com eventos já enviados move todos eles: pede confirmação. */
  const confirmarTroca = () =>
    !status?.calendarId || calendarId.trim() === status.calendarId
      ? Promise.resolve(true)
      : confirmar({
          titulo: 'Mover os eventos para outra agenda?',
          descricao:
            `Todos os eventos serão criados na agenda nova e, depois disso, apagados da agenda atual (${status.calendarId}). ` +
            'A agenda nova é testada antes; se ela não existir ou não estiver compartilhada, nada é alterado.',
          confirmar: 'Mover eventos',
          perigo: true,
        })

  const salvarAgenda = async () => {
    if (!status || !agendaAlterada || ocupado === 'agenda') return
    if (status.ativo && !(await confirmarTroca())) return
    await executar('agenda', async () => {
      try {
        const s = await googleAgenda.salvarConfig({ calendarId })
        setStatus(s)
        setCalendarId(s.calendarId)
        setTeste(null)
        toast.sucesso(
          'ID da agenda salvo',
          s.ativo ? 'Os eventos estão sendo criados na nova agenda e, depois, apagados da anterior.' : undefined,
        )
      } catch (e) {
        avisarErro('A agenda não foi trocada', e)
      }
    })
  }

  const alternarAtivo = async (ativo: boolean) => {
    // Ao ativar, usa o ID do campo (o servidor testa a agenda antes); ao desativar, não mexe nele
    // (só pergunta se já há eventos enviados à agenda anterior)
    const jaEnviou = !!status && status.resumo.ok + status.resumo.erros > 0
    if (ativo && agendaAlterada && jaEnviou && !(await confirmarTroca())) return
    await executar('ativo', async () => {
      try {
        const s = await googleAgenda.salvarConfig(ativo ? { ativo, calendarId } : { ativo })
        setStatus(s)
        if (ativo) setCalendarId(s.calendarId)
        if (ativo) toast.sucesso('Google Agenda ativado', 'Os eventos estão sendo enviados para a agenda.')
        else toast.info('Envio ao Google Agenda desativado', 'Os eventos já enviados continuam na agenda do Google.')
      } catch (e) {
        avisarErro(ativo ? 'Não foi possível ativar' : 'Não foi possível desativar', e)
      }
    })
  }

  const alternarValores = (incluirValores: boolean) =>
    executar('valores', async () => {
      try {
        setStatus(await googleAgenda.salvarConfig({ incluirValores }))
      } catch (e) {
        avisarErro('Não foi possível salvar a opção', e)
      }
    })

  const testar = () =>
    executar('testar', async () => {
      setTeste(null)
      try {
        const r = await googleAgenda.testar(calendarId.trim() || undefined)
        setTeste({ ok: true, mensagem: `Conexão funcionando: agenda “${r.agenda}” encontrada.` })
      } catch (e) {
        setTeste({ ok: false, mensagem: e instanceof Error ? e.message : 'Falha ao testar a conexão.' })
      }
    })

  const sincronizar = () =>
    executar('sincronizar', async () => {
      try {
        const r = await googleAgenda.sincronizar()
        setStatus(r)
        toast.info(
          'Sincronização iniciada',
          r.marcados === 1
            ? '1 evento será reenviado ao Google Agenda.'
            : `${numero(r.marcados)} eventos serão reenviados ao Google Agenda.`,
        )
      } catch (e) {
        avisarErro('Não foi possível sincronizar', e)
      }
    })

  const copiarEmail = async () => {
    if (!status?.contaServico) return
    if (await copiarTexto(status.contaServico)) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } else toast.erro('Não foi possível copiar', 'Selecione o e-mail e copie manualmente.')
  }

  const ajudaAberta = ajuda ?? (status ? !status.configurado : false)
  const r = status?.resumo ?? { ok: 0, pendentes: 0, erros: 0 }
  const pilula = !status?.ativo ? (
    <Badge tom="neutral">Desativado</Badge>
  ) : r.erros > 0 ? (
    <Badge tom="danger">Com erros</Badge>
  ) : (
    <Badge tom="success">Ativo</Badge>
  )

  return (
    <Card>
      <CardHeader
        icone={<CalendarDays className="h-4 w-4" />}
        titulo="Google Agenda"
        descricao="Envia automaticamente os eventos para uma agenda do Google — cada dia de locação aparece no calendário, inclusive no celular."
        acoes={status && pilula}
      />

      {!status ? (
        <div className="flex items-center gap-2 px-5 pb-5 text-[13px] text-muted">
          {erroCarga ? (
            <>
              <CircleAlert className="h-4 w-4 text-danger" />
              {erroCarga}
              <Button tamanho="sm" variante="ghost" onClick={() => void carregar()}>
                Tentar de novo
              </Button>
            </>
          ) : (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Carregando…
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-5 pb-5">
          {/* ---- Passo a passo ---- */}
          <div className="rounded-xl border border-line bg-surface-2/50">
            <button
              type="button"
              onClick={() => setAjuda(!ajudaAberta)}
              aria-expanded={ajudaAberta}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-medium text-ink-2 transition-colors hover:text-ink"
            >
              Como configurar
              <motion.span animate={{ rotate: ajudaAberta ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-muted">
                <ChevronDown className="h-4 w-4" />
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {ajudaAberta && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <ol className="flex flex-col gap-2.5 px-4 pb-4">
                    {PASSOS.map((passo, i) => (
                      <li key={i} className="flex gap-3 text-[13px] leading-relaxed text-ink-2">
                        <span className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand-ink">
                          {i + 1}
                        </span>
                        <span>{passo}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="mx-4 mb-4 rounded-lg bg-surface px-3 py-2 text-xs text-muted ring-1 ring-line">
                    O envio vai só do sistema para o Google: o que for mudado direto no Google Agenda é substituído na próxima
                    sincronização. Faça as alterações sempre aqui no sistema.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
            {/* ---- Configuração ---- */}
            <div className="flex flex-col gap-4">
              <Field label="Chave da conta de serviço">
                {status.configurado ? (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[12.5px] text-ink select-all" title={status.contaServico}>
                        {status.contaServico}
                      </p>
                      <p className="truncate text-xs text-muted">
                        Compartilhe a agenda com este e-mail{status.projeto ? ` • Projeto ${status.projeto}` : ''}
                      </p>
                    </div>
                    <Button
                      variante="ghost"
                      tamanho="icon-sm"
                      onClick={copiarEmail}
                      aria-label="Copiar e-mail da conta de serviço"
                      title="Copiar e-mail"
                    >
                      {copiado ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <Button
                      variante="ghost"
                      tamanho="icon-sm"
                      onClick={removerChave}
                      disabled={ocupado === 'remover'}
                      aria-label="Remover chave"
                      title="Remover chave"
                      className="hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </motion.div>
                ) : (
                  <button
                    type="button"
                    onClick={() => arquivo.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setArrastando(true)
                    }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setArrastando(false)
                      const file = e.dataTransfer.files?.[0]
                      if (file) void enviarArquivo(file)
                    }}
                    disabled={ocupado === 'chave'}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left transition-colors',
                      arrastando
                        ? 'border-brand bg-brand-soft'
                        : 'border-line-strong bg-surface hover:border-brand hover:bg-surface-2/60',
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">
                      {ocupado === 'chave' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink">
                        {ocupado === 'chave' ? 'Enviando…' : 'Enviar arquivo JSON da chave'}
                      </p>
                      <p className="text-xs text-muted">Clique para escolher ou arraste o arquivo baixado do Google Cloud.</p>
                    </div>
                    <Upload className="ml-auto h-4 w-4 shrink-0 text-muted" />
                  </button>
                )}
                <input
                  ref={arquivo}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void enviarArquivo(file)
                    e.target.value = ''
                  }}
                />
              </Field>

              <Field
                label="ID da agenda"
                htmlFor={idAgenda}
                hint={
                  agendaAlterada && status.calendarId ? (
                    <span className="text-warning">
                      Alteração não salva.
                      {status.ativo
                        ? ' Ao salvar, os eventos são movidos: criados na agenda nova e depois apagados da atual.'
                        : ' Clique em “Salvar” para usar esta agenda.'}
                    </span>
                  ) : (
                    'Em Configurações da agenda › Integrar agenda › ID da agenda (ex.: seu-email@gmail.com ou …@group.calendar.google.com).'
                  )
                }
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id={idAgenda}
                    value={calendarId}
                    onChange={(e) => {
                      setCalendarId(e.target.value)
                      setTeste(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      void salvarAgenda()
                    }}
                    placeholder="exemplo@group.calendar.google.com"
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 font-mono text-[13px]"
                  />
                  {agendaAlterada && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variante="primary"
                        icone={
                          ocupado === 'agenda' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />
                        }
                        onClick={() => void salvarAgenda()}
                        disabled={!calendarId.trim() || ocupado === 'agenda'}
                      >
                        {status.ativo && status.calendarId ? 'Salvar e mover' : 'Salvar'}
                      </Button>
                      <Button
                        variante="ghost"
                        onClick={() => {
                          setCalendarId(status.calendarId)
                          setTeste(null)
                        }}
                        disabled={ocupado === 'agenda'}
                      >
                        Desfazer
                      </Button>
                    </div>
                  )}
                </div>
              </Field>

              <div className="flex flex-col divide-y divide-line rounded-xl border border-line">
                <Opcao
                  titulo="Ativar envio automático"
                  descricao="Cria, atualiza e apaga os eventos na agenda sempre que algo muda no sistema."
                  ligado={status.ativo}
                  ocupado={ocupado !== null}
                  aoMudar={(v) => void alternarAtivo(v)}
                />
                <Opcao
                  titulo="Incluir valores (R$) na descrição"
                  descricao="Mostra o total do evento para quem tem acesso à agenda."
                  ligado={status.incluirValores}
                  ocupado={ocupado !== null}
                  aoMudar={(v) => void alternarValores(v)}
                />
              </div>

              <AnimatePresence>
                {teste && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    role="status"
                    className={cn(
                      'flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px]',
                      teste.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                    )}
                  >
                    {teste.ok ? (
                      <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{teste.mensagem}</span>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex flex-wrap gap-2">
                <Button
                  icone={
                    ocupado === 'testar' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />
                  }
                  onClick={testar}
                  disabled={!status.configurado || !calendarId.trim() || ocupado === 'testar'}
                >
                  {ocupado === 'testar' ? 'Testando…' : 'Testar conexão'}
                </Button>
                <Button
                  variante="soft"
                  icone={<RefreshCw className={cn('h-4 w-4', ocupado === 'sincronizar' && 'animate-spin')} />}
                  onClick={sincronizar}
                  disabled={!status.ativo || ocupado === 'sincronizar'}
                >
                  Sincronizar tudo agora
                </Button>
              </div>
            </div>

            {/* ---- Situação ---- */}
            <div className="flex flex-col gap-3">
              <p className="text-[13px] font-medium text-ink-2">Eventos no Google Agenda</p>
              <div className="grid grid-cols-3 gap-2">
                <Contador rotulo="Enviados" dica="Eventos já enviados ao Google Agenda" valor={r.ok} tom="success" />
                <Contador
                  rotulo="Na fila"
                  dica="Eventos aguardando envio ao Google Agenda"
                  valor={r.pendentes}
                  tom="info"
                  animar={status.ativo && r.pendentes > 0}
                />
                <Contador rotulo="Com erro" dica="Eventos que não puderam ser enviados" valor={r.erros} tom="danger" />
              </div>
              <p className="text-xs text-muted">
                {status.ultimaSincronizacao
                  ? `Última sincronização: ${dataHora(status.ultimaSincronizacao)}`
                  : 'Nenhuma sincronização ainda.'}
              </p>
              <AnimatePresence>
                {status.ativo && status.ultimoErro && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="rounded-xl bg-danger-soft px-3.5 py-3 text-[13px] text-danger">
                      <p className="flex items-center gap-1.5 font-medium">
                        <CircleAlert className="h-4 w-4 shrink-0" />
                        Último erro
                        {status.ultimoErroEm && <span className="font-normal opacity-80">• {dataHora(status.ultimoErroEm)}</span>}
                      </p>
                      <p className="mt-1 leading-relaxed">{status.ultimoErro}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-xs leading-relaxed text-muted">
                Sem internet no servidor, o sistema continua funcionando normalmente na rede da empresa: as alterações ficam na
                fila e são enviadas ao Google assim que a conexão voltar.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function Contador({
  rotulo,
  dica,
  valor,
  tom,
  animar,
}: {
  rotulo: string
  /** Explicação mostrada ao passar o mouse. */
  dica: string
  valor: number
  tom: 'success' | 'info' | 'danger'
  animar?: boolean
}) {
  const cor = { success: 'bg-success', info: 'bg-info', danger: 'bg-danger' }[tom]
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-2.5 py-2.5 sm:px-3" title={dica}>
      <p className="flex min-w-0 items-center gap-1.5 text-xs leading-tight text-muted">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cor, animar && 'animate-pulse')} />
        <span className="min-w-0 break-words">{rotulo}</span>
      </p>
      <motion.p
        key={valor}
        initial={{ opacity: 0.4, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        className="tnum mt-0.5 text-lg font-semibold text-ink"
      >
        {numero(valor)}
      </motion.p>
    </div>
  )
}

/** Linha com título, descrição e interruptor. */
function Opcao({
  titulo,
  descricao,
  ligado,
  ocupado,
  aoMudar,
}: {
  titulo: string
  descricao: string
  ligado: boolean
  ocupado?: boolean
  aoMudar: (v: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <p className="text-[13px] font-medium text-ink">{titulo}</p>
        <p className="text-xs text-muted">{descricao}</p>
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={ocupado}
        onClick={() => aoMudar(!ligado)}
        className={cn(
          'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200',
          'focus-visible:ring-4 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:cursor-wait disabled:opacity-70',
          ligado ? 'justify-end bg-brand' : 'justify-start bg-surface-3 ring-1 ring-line-strong ring-inset',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 700, damping: 35 }}
          className="h-5 w-5 rounded-full bg-white shadow-xs"
        />
      </button>
    </div>
  )
}
