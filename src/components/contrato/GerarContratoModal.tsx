// "Gerar contrato de locação": a tela confere com o usuário o que só ele sabe (hora da retirada e
// da devolução, quem assina, local, condições combinadas), mostra o que vai sair no contrato e o
// que está faltando no cadastro, grava o contrato no servidor e baixa o PDF.

import {
  CalendarClock,
  CircleSlash,
  Download,
  FilePenLine,
  Info,
  LoaderCircle,
  Settings,
  TriangleAlert,
  UserPen,
  X,
} from 'lucide-react'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  assinantePadrao,
  codigoContrato,
  devolucaoPadrao,
  montarDadosContrato,
  pendenciasContrato,
  reais,
  retiradaPadrao,
} from '#shared/contrato.ts'
import { cpfValido, mascaraCpf, somenteDigitos } from '#shared/documentos.ts'
import { datasOcupadas } from '#shared/maquinas.ts'
import type { Cliente, Configuracoes, Contrato, DataHora, Evento } from '#shared/tipos.ts'
import { cn } from '../../lib/cn'
import { contratoAguardando, contratosDoEvento, contratoVigente, maquinasDoContrato } from '../../lib/contratos'
import { datasDoEvento } from '../../lib/envio'
import { dataCurta, numero } from '../../lib/format'
import { useHoje } from '../../lib/hoje'
import { useDados } from '../../store/dados'
import { avisarErro, toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Form'
import { Modal } from '../ui/Modal'

export interface GerarContratoModalProps {
  aberto: boolean
  evento: Evento
  aoFechar: () => void
  /** Chamado depois de gerar (o PDF já foi baixado). */
  aoGerar?: (c: Contrato) => void
}

interface Formulario {
  retirada: DataHora
  devolucao: DataHora
  nome: string
  cpf: string
  local: string
  condicoes: string
}

/**
 * Valores iniciais: os sugeridos pelo evento ou, se ele já teve contrato, o que foi informado da
 * outra vez (retirada e devolução só se ainda combinam com as datas de uso).
 */
function valoresIniciais(evento: Evento, cliente: Cliente | undefined, anterior: Contrato | undefined, config: Configuracoes) {
  const padrao: Formulario = {
    retirada: retiradaPadrao(evento),
    devolucao: devolucaoPadrao(evento),
    ...assinantePadrao(cliente),
    local: '',
    condicoes: '',
  }
  // O evento mudou de cliente depois do contrato anterior: nada dele serve
  if (!anterior || anterior.clienteId !== evento.clienteId) return padrao
  const d = anterior.dados
  const datas = datasOcupadas(evento)
  const primeiro = datas[0] ?? ''
  const ultimo = datas[datas.length - 1] ?? ''
  const retiradaOk = !!d.retirada.data && !!primeiro && d.retirada.data <= primeiro && d.retirada.data >= somar(primeiro, -7)
  const devolucaoOk = !!d.devolucao.data && !!ultimo && d.devolucao.data >= ultimo && d.devolucao.data <= somar(ultimo, 7)
  // As condições das Configurações entram sozinhas em todo contrato: aqui fica só a parte deste
  const geral = config.contratoCondicoes.trim()
  const condicoes = geral && d.condicoes.startsWith(geral) ? d.condicoes.slice(geral.length).trim() : d.condicoes
  return {
    retirada: retiradaOk ? { ...d.retirada } : padrao.retirada,
    devolucao: devolucaoOk ? { ...d.devolucao } : padrao.devolucao,
    nome: d.assinante.nome || padrao.nome,
    cpf: d.assinante.cpf || padrao.cpf,
    local: d.evento.local,
    condicoes,
  }
}

const somar = (iso: string, dias: number) => {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

export function GerarContratoModal({ aberto, evento, aoFechar, aoGerar }: GerarContratoModalProps) {
  const clientes = useDados((s) => s.clientes)
  const maquinas = useDados((s) => s.maquinas)
  const config = useDados((s) => s.config)
  const contratos = useDados((s) => s.contratos)
  const gerarContrato = useDados((s) => s.gerarContrato)
  const navegar = useNavigate()
  const hoje = useHoje()
  const ids = useId()
  const cliente = clientes.find((c) => c.id === evento.clienteId)
  const doEvento = useMemo(() => contratosDoEvento(contratos, evento.id), [contratos, evento.id])
  const aguardando = contratoAguardando(doEvento, evento.id)
  const vigente = contratoVigente(doEvento, evento.id)

  const [f, setF] = useState<Formulario>(() => valoresIniciais(evento, cliente, doEvento[0], config))
  const [tentou, setTentou] = useState(false)
  const [gerando, setGerando] = useState(false)

  // Cada vez que abre, começa de novo com os dados atuais do evento
  const [abertoAntes, setAbertoAntes] = useState(aberto)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      setF(valoresIniciais(evento, cliente, doEvento[0], config))
      setTentou(false)
      setGerando(false)
    }
  }
  const set = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }))

  // O que vai sair no contrato, com o que está na tela agora
  const dados = useMemo(
    () =>
      aberto
        ? montarDadosContrato({
            evento,
            cliente,
            maquinas,
            config,
            entrada: {
              local: f.local,
              retirada: f.retirada,
              devolucao: f.devolucao,
              assinante: { nome: f.nome, cpf: f.cpf },
              condicoes: f.condicoes,
            },
            hoje,
          })
        : null,
    [aberto, evento, cliente, maquinas, config, f, hoje],
  )
  const pendencias = dados ? pendenciasContrato(dados) : []
  const datasUso = useMemo(() => [...new Set(evento.dias.map((d) => d.data).filter(Boolean))].sort(), [evento.dias])
  const ocupadas = useMemo(() => datasOcupadas(evento), [evento])
  const primeiroDia = ocupadas[0] ?? ''
  const ultimoDia = ocupadas[ocupadas.length - 1] ?? ''

  const cpfDigitos = somenteDigitos(f.cpf)
  const erroCpf =
    cpfDigitos && !cpfValido(cpfDigitos)
      ? 'CPF inválido: confira o número ou deixe em branco (sai a linha para preencher à mão).'
      : null
  const erroDatas =
    f.retirada.data && f.devolucao.data && f.devolucao.data < f.retirada.data
      ? 'A devolução não pode ser antes da retirada.'
      : null
  const avisoRetirada =
    f.retirada.data && primeiroDia && f.retirada.data > primeiroDia
      ? `Depois do primeiro dia com as máquinas (${dataCurta(primeiroDia)}).`
      : null
  const avisoDevolucao =
    f.devolucao.data && ultimoDia && f.devolucao.data < ultimoDia
      ? `Antes do último dia com as máquinas (${dataCurta(ultimoDia)}).`
      : null
  const cancelado = evento.status === 'CANCELADO'

  const irPara = (to: string) => {
    aoFechar()
    navegar(to)
  }

  const gerar = async () => {
    setTentou(true)
    if (erroDatas) return document.getElementById(`${ids}-devolucao`)?.focus()
    if (erroCpf) return document.getElementById(`${ids}-cpf`)?.focus()
    setGerando(true)
    let novo: Contrato
    try {
      novo = await gerarContrato({
        eventoId: evento.id,
        local: f.local,
        retirada: f.retirada,
        devolucao: f.devolucao,
        assinante: { nome: f.nome, cpf: f.cpf },
        condicoes: f.condicoes,
      })
    } catch (e) {
      setGerando(false)
      avisarErro('Não foi possível gerar o contrato', e)
      return
    }
    const titulo = `Contrato ${codigoContrato(novo.numero)} gerado`
    try {
      // O jsPDF só é carregado aqui, quando precisa
      const { baixarContratoPDF } = await import('../../lib/pdfContrato')
      const nome = await baixarContratoPDF(novo)
      toast.sucesso(titulo, `${nome}. Mande ao cliente para ler antes da retirada.`)
    } catch (e) {
      toast.erro(
        `${titulo}, mas o PDF não foi baixado`,
        `${e instanceof Error ? e.message : 'Erro inesperado.'} Use “Baixar PDF” no contrato.`,
      )
    }
    setGerando(false)
    aoGerar?.(novo)
    aoFechar()
  }

  const maq = dados ? maquinasDoContrato(dados) : null
  const valores = dados?.valores
  const tipoCliente = cliente?.tipo

  return (
    <Modal
      aberto={aberto}
      aoFechar={gerando ? () => {} : aoFechar}
      largura="max-w-2xl"
      icone={<FilePenLine className="h-5 w-5" />}
      titulo="Gerar contrato de locação"
      descricao={`${evento.nome} • ${cliente?.nome ?? 'Cliente removido'}`}
      rodape={
        <>
          <Button onClick={aoFechar} disabled={gerando} className="max-sm:hidden">
            Cancelar
          </Button>
          <Button
            variante="primary"
            icone={gerando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            onClick={() => void gerar()}
            disabled={gerando || cancelado}
            className="max-sm:flex-1"
          >
            {gerando ? 'Gerando…' : 'Gerar e baixar PDF'}
          </Button>
        </>
      }
    >
      {dados && valores && maq && (
        <div className="flex flex-col gap-5">
          {cancelado && (
            <Aviso tom="danger" icone={<CircleSlash className="h-4 w-4" />}>
              Este evento está cancelado. Para gerar o contrato, reative o evento antes.
            </Aviso>
          )}

          {/* O que vai no contrato (vem do cadastro do evento e do cliente) */}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
            {/* No celular, o cliente e o valor ocupam a linha inteira (o nome da empresa é longo) */}
            <Resumo
              className="max-sm:col-span-2"
              rotulo="Cliente"
              valor={dados.cliente.nome || cliente?.nome || '—'}
              detalhe={dados.cliente.documento || 'Sem CPF/CNPJ'}
            />
            <Resumo
              rotulo="Datas de uso"
              valor={datasDoEvento(datasUso) || '—'}
              detalhe={`${numero(datasUso.length)} ${datasUso.length === 1 ? 'dia' : 'dias'}${dados.evento.comCliente ? ', período corrido' : ''}`}
            />
            <Resumo
              rotulo="Máquinas"
              valor={<span title={maq.extenso}>{maq.curto}</span>}
              detalhe={dados.evento.maquinas.length ? dados.evento.maquinas.map((m) => m.identificacao).join(', ') : maq.extenso}
            />
            <Resumo
              className="max-sm:col-span-2"
              rotulo="Valor das diárias"
              valor={reais(valores.total)}
              detalhe={`${numero(valores.diarias)} ${valores.diarias === 1 ? 'diária' : 'diárias'} × ${reais(valores.diaria)}${valores.desconto > 0 ? ` − ${reais(valores.desconto)}` : ''}`}
            />
          </dl>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <CampoDataHora
              id={`${ids}-retirada`}
              rotulo="Retirada na empresa"
              valor={f.retirada}
              aoMudar={(v) => set('retirada', v)}
              aviso={avisoRetirada}
            />
            <CampoDataHora
              id={`${ids}-devolucao`}
              rotulo="Devolução na empresa"
              valor={f.devolucao}
              aoMudar={(v) => set('devolucao', v)}
              min={f.retirada.data || undefined}
              erro={tentou ? erroDatas : null}
              aviso={erroDatas && !tentou ? erroDatas : avisoDevolucao}
            />
          </div>

          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Quem assina pelo cliente</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
              <Input
                aria-label="Nome de quem assina pelo cliente"
                value={f.nome}
                onChange={(e) => set('nome', e.target.value)}
                placeholder="Nome completo"
                autoComplete="off"
              />
              <Input
                id={`${ids}-cpf`}
                aria-label="CPF de quem assina pelo cliente"
                value={f.cpf}
                onChange={(e) => set('cpf', mascaraCpf(e.target.value))}
                placeholder="CPF"
                inputMode="numeric"
                autoComplete="off"
                aria-invalid={!!(tentou && erroCpf)}
                className={cn('tnum', tentou && erroCpf && 'border-danger! focus:ring-danger/20!')}
              />
            </div>
            {erroCpf && (tentou || cpfDigitos.length >= 11) ? (
              <p className="text-xs font-medium text-danger">{erroCpf}</p>
            ) : (
              <p className="text-xs text-muted">
                {tipoCliente === 'PF'
                  ? 'O próprio cliente (pessoa física), como está no cadastro.'
                  : tipoCliente === 'PJ'
                    ? 'Quem representa a empresa na assinatura (o responsável do cadastro). Em branco, sai a linha para preencher à mão.'
                    : 'Em branco, sai a linha para preencher à mão.'}
              </p>
            )}
          </fieldset>

          <Field label="Local do evento (opcional)" htmlFor={`${ids}-local`} hint="Onde as máquinas vão ser usadas.">
            <Input
              id={`${ids}-local`}
              value={f.local}
              onChange={(e) => set('local', e.target.value)}
              placeholder="Ex.: Salão paroquial"
            />
          </Field>

          <Field
            label="Condições combinadas (opcional)"
            htmlFor={`${ids}-cond`}
            hint={
              config.contratoCondicoes.trim()
                ? 'Cada linha vira um item das disposições gerais, depois das condições que as Configurações põem em todo contrato.'
                : 'Cada linha vira um item das disposições gerais do contrato.'
            }
          >
            <Textarea
              id={`${ids}-cond`}
              value={f.condicoes}
              onChange={(e) => set('condicoes', e.target.value)}
              rows={3}
              placeholder="Ex.: O cliente busca as máquinas com o carro da paróquia."
            />
          </Field>

          {aguardando ? (
            <Aviso tom="info" icone={<Info className="h-4 w-4" />}>
              O contrato <b className="font-semibold">{codigoContrato(aguardando.numero)}</b>, gerado em{' '}
              {dataCurta(aguardando.dados.emitidoEm)}, ainda espera a assinatura: ele vai ser cancelado e substituído por este.
            </Aviso>
          ) : (
            vigente?.status === 'ASSINADO' && (
              <Aviso tom="info" icone={<Info className="h-4 w-4" />}>
                O contrato <b className="font-semibold">{codigoContrato(vigente.numero)}</b> já foi assinado e continua valendo.
                Depois que o cliente assinar este novo, cancele o anterior.
              </Aviso>
            )
          )}

          {pendencias.length > 0 && (
            <div className="rounded-xl bg-warning-soft px-4 py-3 text-[13px] text-warning">
              <p className="flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4 shrink-0" />
                Vai sair em branco (dá para gerar assim e preencher à mão)
              </p>
              <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-10 text-ink-2 marker:text-warning">
                {pendencias.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              <div className="mt-2.5 flex flex-wrap gap-2 pl-6">
                {cliente && pendencias.some((p) => /cliente não tem/.test(p)) && (
                  <Button tamanho="sm" icone={<UserPen className="h-4 w-4" />} onClick={() => irPara(`/clientes/${cliente.id}`)}>
                    Completar o cliente
                  </Button>
                )}
                {pendencias.some((p) => /Configurações|reposição/.test(p)) && (
                  <Button
                    tamanho="sm"
                    icone={<Settings className="h-4 w-4" />}
                    onClick={() => irPara('/configuracoes?secao=contrato')}
                  >
                    Completar em Configurações
                  </Button>
                )}
              </div>
            </div>
          )}

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Pelo Código de Defesa do Consumidor, o cliente deve receber o contrato{' '}
              <b className="font-medium text-ink-2">antes</b> de assinar: depois de gerar, use “Enviar” para mandar pelo WhatsApp
              ou e-mail.
            </span>
          </p>
        </div>
      )}
    </Modal>
  )
}

function Resumo({
  rotulo,
  valor,
  detalhe,
  className,
}: {
  rotulo: string
  valor: ReactNode
  detalhe?: string
  className?: string
}) {
  return (
    <div className={cn('min-w-0 bg-surface-2 px-3.5 py-2.5', className)}>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className="tnum mt-0.5 truncate text-sm font-semibold text-ink" title={typeof valor === 'string' ? valor : undefined}>
        {valor}
      </dd>
      {detalhe && (
        <dd className="tnum truncate text-xs text-muted" title={detalhe}>
          {detalhe}
        </dd>
      )}
    </div>
  )
}

/** Data e hora combinadas; a hora pode ficar em branco (sai "às ____h____" para preencher à mão). */
function CampoDataHora({
  id,
  rotulo,
  valor,
  aoMudar,
  min,
  erro,
  aviso,
}: {
  id: string
  rotulo: string
  valor: DataHora
  aoMudar: (v: DataHora) => void
  min?: string
  erro?: string | null
  aviso?: string | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        <CalendarClock className="h-3.5 w-3.5 text-muted" />
        {rotulo}
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
        <Input
          id={id}
          type="date"
          value={valor.data}
          min={min}
          onChange={(e) => aoMudar({ ...valor, data: e.target.value })}
          aria-invalid={!!erro}
          className={cn('tnum', erro && 'border-danger! focus:ring-danger/20!')}
        />
        <div className="relative">
          <Input
            type="time"
            aria-label={`Hora da ${rotulo.split(' ')[0].toLowerCase()}`}
            value={valor.hora}
            onChange={(e) => aoMudar({ ...valor, hora: e.target.value })}
            className={cn('tnum', valor.hora ? 'pr-8' : 'text-muted')}
          />
          {valor.hora && (
            <button
              type="button"
              onClick={() => aoMudar({ ...valor, hora: '' })}
              aria-label="Deixar a hora em branco"
              title="Deixar a hora em branco (preencher à mão)"
              className="absolute top-1/2 right-1.5 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {erro ? (
        <p className="text-xs font-medium text-danger">{erro}</p>
      ) : aviso ? (
        <p className="text-xs text-warning">{aviso}</p>
      ) : (
        <p className="text-xs text-muted">
          {valor.hora ? 'Na sede da empresa.' : 'Sem hora: sai “às ____h____” para preencher à mão.'}
        </p>
      )}
    </div>
  )
}

function Aviso({ tom, icone, children }: { tom: 'info' | 'danger'; icone: ReactNode; children: ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[13px]',
        tom === 'info' ? 'bg-info-soft text-info' : 'bg-danger-soft text-danger',
      )}
    >
      <span className="mt-0.5 shrink-0">{icone}</span>
      <span>{children}</span>
    </p>
  )
}
