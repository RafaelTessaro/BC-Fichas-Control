// Janelas que mudam a situação do contrato: "Marcar como assinado" (com a data) e "Cancelar
// contrato" (com o motivo). Abertas pelas ações do contrato (AcoesContrato.tsx).

import { CalendarCheck, CircleSlash, Paperclip } from 'lucide-react'
import { useId, useState } from 'react'
import { codigoContrato } from '#shared/contrato.ts'
import type { Contrato } from '#shared/tipos.ts'
import { cn } from '../../lib/cn'
import { nomeClienteContrato } from '../../lib/contratos'
import { dataCurta } from '../../lib/format'
import { useHoje } from '../../lib/hoje'
import { useDados } from '../../store/dados'
import { avisarErro, toast } from '../../store/ui'
import { Button } from '../ui/Button'
import { Field, Input, Textarea } from '../ui/Form'
import { Modal } from '../ui/Modal'

/** "Marcar como assinado" sem a cópia (assinou no papel e a foto fica para depois), com a data. */
export function AssinarModal({ aberto, contrato, aoFechar }: { aberto: boolean; contrato?: Contrato; aoFechar: () => void }) {
  const alterarContrato = useDados((s) => s.alterarContrato)
  const clientes = useDados((s) => s.clientes)
  const hoje = useHoje()
  const id = useId()
  const [data, setData] = useState(hoje)
  const [salvando, setSalvando] = useState(false)
  const [abertoAntes, setAbertoAntes] = useState(false)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      setData(hoje)
      setSalvando(false)
    }
  }
  const erro = data > hoje ? 'A data da assinatura não pode ser depois de hoje.' : null

  const salvar = async () => {
    if (!contrato || erro) return
    setSalvando(true)
    try {
      const salvo = await alterarContrato(contrato.id, { acao: 'assinar', data: data || hoje }, contrato.versao)
      toast.sucesso(`Contrato ${codigoContrato(salvo.numero)} assinado`, `Em ${dataCurta(salvo.assinadoEm)}`)
      aoFechar()
    } catch (e) {
      avisarErro('Não foi possível marcar como assinado', e)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-md"
      icone={<CalendarCheck className="h-5 w-5" />}
      titulo="Marcar como assinado"
      descricao={contrato && `Contrato ${codigoContrato(contrato.numero)} • ${nomeClienteContrato(contrato, clientes)}`}
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" onClick={() => void salvar()} disabled={salvando || !!erro}>
            {salvando ? 'Salvando…' : 'Marcar como assinado'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Data da assinatura" htmlFor={`${id}-data`} erro={erro}>
          <Input
            id={`${id}-data`}
            type="date"
            value={data}
            max={hoje}
            onChange={(e) => setData(e.target.value)}
            className="tnum"
          />
        </Field>
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
          <Paperclip className="mt-0.5 h-4 w-4 shrink-0" />
          Para quando o cliente assinou e a foto ou o PDF assinado fica para depois. Guarde a via em papel; dá para anexar a cópia
          quando quiser.
        </p>
      </div>
    </Modal>
  )
}

const MOTIVOS = ['Cliente desistiu', 'Evento cancelado', 'Datas ou valores mudaram', 'Gerado por engano']

/** Cancelar o contrato, com o motivo (opcional; `motivoInicial` já vem escrito). */
export function CancelarModal({
  aberto,
  contrato,
  motivoInicial,
  aoFechar,
}: {
  aberto: boolean
  contrato?: Contrato
  motivoInicial?: string
  aoFechar: () => void
}) {
  const alterarContrato = useDados((s) => s.alterarContrato)
  const id = useId()
  const [motivo, setMotivo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [abertoAntes, setAbertoAntes] = useState(false)
  if (aberto !== abertoAntes) {
    setAbertoAntes(aberto)
    if (aberto) {
      setMotivo(motivoInicial ?? '')
      setSalvando(false)
    }
  }

  const salvar = async () => {
    if (!contrato) return
    setSalvando(true)
    try {
      const salvo = await alterarContrato(contrato.id, { acao: 'cancelar', motivo: motivo.trim() }, contrato.versao)
      toast.sucesso(`Contrato ${codigoContrato(salvo.numero)} cancelado`, salvo.motivoCancelamento)
      aoFechar()
    } catch (e) {
      avisarErro('Não foi possível cancelar o contrato', e)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-md"
      icone={<CircleSlash className="h-5 w-5 text-danger" />}
      titulo={contrato ? `Cancelar o contrato ${codigoContrato(contrato.numero)}?` : 'Cancelar o contrato?'}
      descricao="Ele deixa de valer, mas continua guardado na aba Contratos, com o motivo. Dá para reabrir depois."
      rodape={
        <>
          <Button onClick={aoFechar}>Voltar</Button>
          <Button variante="danger" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Cancelando…' : 'Cancelar contrato'}
          </Button>
        </>
      }
    >
      <Field label="Motivo (opcional)" htmlFor={`${id}-motivo`}>
        <Textarea
          id={`${id}-motivo`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={2}
          placeholder="Ex.: Cliente desistiu"
          maxLength={500}
        />
      </Field>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMotivo(m)}
            className={cn(
              'h-7 cursor-pointer rounded-full border px-2.5 text-xs font-medium transition-colors',
              motivo === m
                ? 'border-brand/60 bg-brand-soft text-brand-ink'
                : 'border-line-strong/80 text-ink-2 hover:bg-surface-2',
            )}
          >
            {m}
          </button>
        ))}
      </div>
    </Modal>
  )
}
