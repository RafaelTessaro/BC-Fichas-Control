// Ações sobre um contrato de locação, usadas no cartão do evento e na aba Contratos: baixar o PDF,
// enviar ao cliente, anexar ou ver a cópia assinada, marcar como assinado, cancelar, reabrir e
// gerar um novo. As janelas ficam aqui; quem usa só renderiza `janelas`.

import {
  CalendarCheck,
  CircleSlash,
  Download,
  Eye,
  FileDown,
  FilePlus,
  Mail,
  MessageCircle,
  RotateCcw,
  Ticket,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ANOS_GUARDA_CONTRATO, codigoContrato, podeExcluirContrato } from '#shared/contrato.ts'
import type { Contrato } from '#shared/tipos.ts'
import { api } from '../../lib/api'
import { aguardandoSemEfeito, contratoVigente } from '../../lib/contratos'
import { useHoje } from '../../lib/hoje'
import { useDados } from '../../store/dados'
import { avisarErro, toast } from '../../store/ui'
import { EnviarDocumentoModal, type CanalEnvio } from '../EnviarDocumentoModal'
import { confirmar } from '../ui/Feedback'
import { AnexarAssinadoModal } from './AnexarAssinadoModal'
import { GerarContratoModal } from './GerarContratoModal'
import { AssinarModal, CancelarModal } from './SituacaoContratoModais'

type Janela = 'enviar' | 'anexar' | 'assinar' | 'cancelar' | 'gerar'

interface EstadoJanela {
  janela: Janela
  /** Contrato da janela (em "gerar", o evento vem dele). */
  id: string
  aberta: boolean
  canal?: CanalEnvio
  arquivos?: File[]
  /** Motivo já escrito ao abrir "Cancelar" (ex.: substituído por um contrato mais novo). */
  motivo?: string
}

/** Item do menu "…" (o mesmo formato do componente Menu). */
export type ItemMenuContrato = { label: string; icone?: ReactNode; aoClicar: () => void; perigo?: boolean } | 'sep'

export function useAcoesContrato() {
  const contratos = useDados((s) => s.contratos)
  const eventos = useDados((s) => s.eventos)
  const clientes = useDados((s) => s.clientes)
  const alterarContrato = useDados((s) => s.alterarContrato)
  const removerContratoAssinado = useDados((s) => s.removerContratoAssinado)
  const excluirContrato = useDados((s) => s.excluirContrato)
  const navegar = useNavigate()
  const hoje = useHoje()
  const [estado, setEstado] = useState<EstadoJanela | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)

  // O contrato da janela continua o mesmo enquanto ela fecha (animação de saída)
  const alvo = estado ? contratos.find((c) => c.id === estado.id) : undefined
  const eventoAlvo = alvo ? eventos.find((e) => e.id === alvo.eventoId) : undefined
  const clienteAlvo = eventoAlvo
    ? clientes.find((c) => c.id === eventoAlvo.clienteId)
    : alvo
      ? clientes.find((c) => c.id === alvo.clienteId)
      : undefined
  const aberta = (j: Janela) => !!estado?.aberta && estado.janela === j && !!alvo
  const fechar = () => setEstado((x) => (x ? { ...x, aberta: false } : x))

  const abrir = (janela: Janela, c: Contrato, extra: Pick<EstadoJanela, 'canal' | 'arquivos' | 'motivo'> = {}) =>
    setEstado({ janela, id: c.id, aberta: true, ...extra })

  /** O evento do contrato ainda existe (para enviar ou gerar de novo). */
  const temEvento = (c: Contrato) => eventos.some((e) => e.id === c.eventoId)
  /** Dá para gerar um novo para o evento (existe e não está cancelado). */
  const podeGerar = (c: Contrato) => eventos.some((e) => e.id === c.eventoId && e.status !== 'CANCELADO')

  const baixarPdf = async (c: Contrato) => {
    setBaixando(c.id)
    try {
      const { baixarContratoPDF } = await import('../../lib/pdfContrato')
      const nome = await baixarContratoPDF(c)
      toast.sucesso('PDF do contrato baixado', nome)
    } catch (e) {
      avisarErro('Não foi possível gerar o PDF do contrato', e)
    } finally {
      setBaixando(null)
    }
  }

  const verAssinado = (c: Contrato) => window.open(api.urlContratoAssinado(c.id), '_blank', 'noopener')

  const baixarAssinado = (c: Contrato) => {
    const link = document.createElement('a')
    link.href = api.urlContratoAssinado(c.id, true)
    link.download = c.arquivo?.nome ?? 'contrato-assinado'
    document.body.appendChild(link)
    link.click()
    link.remove()
  }

  const reabrir = async (c: Contrato) => {
    // Outro contrato já vale para o evento: reabrir este deixa os dois valendo
    const outro = contratoVigente(
      contratos.filter((x) => x.id !== c.id),
      c.eventoId,
    )
    const ok = await confirmar({
      titulo: `Reabrir o contrato ${codigoContrato(c.numero)}?`,
      descricao:
        (c.status === 'ASSINADO'
          ? 'Ele volta a esperar a assinatura do cliente (a data da assinatura é apagada; a cópia anexada continua).'
          : 'Ele volta a valer, esperando a assinatura do cliente.') +
        (outro && c.status === 'CANCELADO'
          ? ` Atenção: o evento já tem o contrato ${codigoContrato(outro.numero)} valendo; cancele um dos dois.`
          : ''),
      confirmar: 'Reabrir',
    })
    if (!ok) return
    try {
      const salvo = await alterarContrato(c.id, { acao: 'reabrir' }, c.versao)
      toast.sucesso(`Contrato ${codigoContrato(salvo.numero)} reaberto`, 'Esperando a assinatura do cliente.')
    } catch (e) {
      avisarErro('Não foi possível reabrir o contrato', e)
    }
  }

  const excluir = async (c: Contrato) => {
    const ok = await confirmar({
      titulo: `Excluir o contrato ${codigoContrato(c.numero)}?`,
      descricao:
        (c.status === 'CANCELADO'
          ? 'Ele sai da aba Contratos'
          : `Já passaram ${ANOS_GUARDA_CONTRATO} anos do fim da locação, o prazo de guarda. Ele sai da aba Contratos`) +
        `${c.arquivo ? ', junto com a cópia assinada' : ''}. Não dá para desfazer; o número dele não é usado de novo.`,
      confirmar: 'Excluir contrato',
      perigo: true,
    })
    if (!ok) return
    try {
      await excluirContrato(c.id)
      toast.sucesso(`Contrato ${codigoContrato(c.numero)} excluído`)
    } catch (e) {
      avisarErro('Não foi possível excluir o contrato', e)
    }
  }

  const removerArquivo = async (c: Contrato) => {
    const ok = await confirmar({
      titulo: 'Apagar a cópia assinada?',
      descricao: `“${c.arquivo?.nome ?? 'arquivo'}” será apagado do servidor. O contrato continua ${c.status === 'ASSINADO' ? 'assinado' : 'como está'}; você pode anexar outra cópia depois.`,
      confirmar: 'Apagar cópia',
      perigo: true,
    })
    if (!ok) return
    try {
      await removerContratoAssinado(c.id)
      toast.sucesso('Cópia assinada apagada', `Contrato ${codigoContrato(c.numero)}`)
    } catch (e) {
      avisarErro('Não foi possível apagar a cópia assinada', e)
    }
  }

  /**
   * Todas as ações do contrato, para o menu "…". `semEvento` tira "Abrir o evento" (no cartão do
   * evento); `sem` tira as que já estão em botões na tela.
   */
  const itensMenu = (c: Contrato, opcoes: { semEvento?: boolean; sem?: string[] } = {}): ItemMenuContrato[] => {
    const lista: ItemMenuContrato[] = []
    const add = (id: string, item: Exclude<ItemMenuContrato, 'sep'>) => {
      if (!opcoes.sem?.includes(id)) lista.push(item)
    }
    const sep = () => {
      if (lista.length && lista[lista.length - 1] !== 'sep') lista.push('sep')
    }
    // Esperando a assinatura de um evento cancelado ou excluído: não vale mais, só dá para cancelar
    const semEfeito = aguardandoSemEfeito(c, eventos)
    const ativo = c.status !== 'CANCELADO' && !semEfeito
    add('pdf', { label: 'Baixar PDF', icone: <FileDown className="h-4 w-4" />, aoClicar: () => void baixarPdf(c) })
    if (ativo && temEvento(c)) {
      add('whatsapp', {
        label: 'Enviar por WhatsApp',
        icone: <MessageCircle className="h-4 w-4" />,
        aoClicar: () => abrir('enviar', c, { canal: 'whatsapp' }),
      })
      add('email', {
        label: 'Enviar por e-mail',
        icone: <Mail className="h-4 w-4" />,
        aoClicar: () => abrir('enviar', c, { canal: 'email' }),
      })
    }
    sep()
    if (c.arquivo) {
      add('ver', { label: 'Ver assinado', icone: <Eye className="h-4 w-4" />, aoClicar: () => verAssinado(c) })
      add('baixar-assinado', {
        label: 'Baixar assinado',
        icone: <Download className="h-4 w-4" />,
        aoClicar: () => baixarAssinado(c),
      })
    }
    if (ativo) {
      add('anexar', {
        label: c.arquivo ? 'Trocar a cópia assinada' : 'Anexar assinado',
        icone: <Upload className="h-4 w-4" />,
        aoClicar: () => abrir('anexar', c),
      })
    }
    if (c.status === 'AGUARDANDO' && !semEfeito) {
      add('assinar', {
        label: 'Marcar como assinado',
        icone: <CalendarCheck className="h-4 w-4" />,
        aoClicar: () => abrir('assinar', c),
      })
    }
    sep()
    if (podeGerar(c) && ativo) {
      add('gerar', { label: 'Gerar novo', icone: <FilePlus className="h-4 w-4" />, aoClicar: () => abrir('gerar', c) })
    }
    if (!opcoes.semEvento && temEvento(c)) {
      add('evento', {
        label: 'Abrir o evento',
        icone: <Ticket className="h-4 w-4" />,
        aoClicar: () => navegar(`/eventos/${c.eventoId}`),
      })
    }
    // Cancelado só volta a valer com o evento de pé (o servidor confere o mesmo)
    if (c.status === 'ASSINADO' || (c.status === 'CANCELADO' && podeGerar(c))) {
      add('reabrir', { label: 'Reabrir', icone: <RotateCcw className="h-4 w-4" />, aoClicar: () => void reabrir(c) })
    }
    sep()
    if (c.arquivo) {
      add('remover', {
        label: 'Apagar a cópia assinada',
        icone: <Trash2 className="h-4 w-4" />,
        aoClicar: () => void removerArquivo(c),
        perigo: true,
      })
    }
    if (c.status !== 'CANCELADO') {
      add('cancelar', {
        label: 'Cancelar contrato',
        icone: <CircleSlash className="h-4 w-4" />,
        aoClicar: () =>
          abrir('cancelar', c, semEfeito ? { motivo: temEvento(c) ? 'Evento cancelado.' : 'Evento excluído.' } : {}),
        perigo: true,
      })
    }
    if (podeExcluirContrato(c, hoje)) {
      add('excluir', {
        label: 'Excluir contrato',
        icone: <X className="h-4 w-4" />,
        aoClicar: () => void excluir(c),
        perigo: true,
      })
    }
    if (lista[lista.length - 1] === 'sep') lista.pop()
    return lista
  }

  const janelas = (
    <>
      {eventoAlvo && (
        <EnviarDocumentoModal
          aberto={aberta('enviar')}
          aoFechar={fechar}
          canal={estado?.canal ?? 'whatsapp'}
          evento={eventoAlvo}
          cliente={clienteAlvo}
          contrato={alvo}
        />
      )}
      <AnexarAssinadoModal aberto={aberta('anexar')} contrato={alvo} arquivosIniciais={estado?.arquivos} aoFechar={fechar} />
      <AssinarModal aberto={aberta('assinar')} contrato={alvo} aoFechar={fechar} />
      <CancelarModal aberto={aberta('cancelar')} contrato={alvo} motivoInicial={estado?.motivo} aoFechar={fechar} />
      {eventoAlvo && <GerarContratoModal aberto={aberta('gerar')} evento={eventoAlvo} aoFechar={fechar} />}
    </>
  )

  return {
    abrir,
    baixarPdf,
    /** Id do contrato cujo PDF está sendo gerado agora. */
    baixando,
    verAssinado,
    baixarAssinado,
    reabrir,
    excluir,
    removerArquivo,
    itensMenu,
    temEvento,
    podeGerar,
    janelas,
  }
}
