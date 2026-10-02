import { Copy, Ellipsis, FileDown, Pencil, ReceiptText, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { calcularEvento, FORMAS_PAGAMENTO } from '#shared/calc.ts'
import { STATUS_PROGRAMACAO } from '#shared/maquinas.ts'
import { cn } from '../lib/cn'
import { codigoEvento, moeda, numero, periodo } from '../lib/format'
import { useHoje } from '../lib/hoje'
import type { EventoCompleto } from '../lib/hooks'
import { podeGerarRecibo } from '../lib/recibo'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { PagamentoBadge, StatusBadge } from './Badges'
import { GoogleSyncBadge } from './GoogleSyncBadge'
import { IconeMaquinaFichas } from './IconeMaquinaFichas'
import { ProgramacaoBadge } from './Programacao'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Menu } from './ui/Misc'
import { Linha, Tabela, Td, Th } from './ui/Table'

export function useAcoesEvento() {
  const navegar = useNavigate()
  const duplicarEvento = useDados((s) => s.duplicarEvento)
  const excluirEvento = useDados((s) => s.excluirEvento)
  const config = useDados((s) => s.config)
  const maquinas = useDados((s) => s.maquinas)

  return {
    editar: (id: string) => navegar(`/eventos/${id}/editar`),
    duplicar: async (id: string) => {
      try {
        const novo = await duplicarEvento(id)
        toast.sucesso('Evento duplicado', `${codigoEvento(novo.codigo)} criado como “Em aberto”.`)
        navegar(`/eventos/${novo.id}/editar`)
      } catch (e) {
        avisarErro('Não foi possível duplicar', e)
      }
    },
    pdf: async ({ evento, cliente }: EventoCompleto) => {
      try {
        // jsPDF só é carregado quando o primeiro PDF é gerado
        const { baixarResumoPDF } = await import('../lib/pdf')
        const nome = await baixarResumoPDF(evento, cliente, config, maquinas)
        toast.sucesso('PDF gerado', nome)
      } catch (e) {
        toast.erro('Não foi possível gerar o PDF', (e as Error).message)
      }
    },
    /** Recibo do pagamento em PIX ou dinheiro, no papel timbrado. */
    recibo: async ({ evento, cliente }: Pick<EventoCompleto, 'evento' | 'cliente'>) => {
      const r = calcularEvento(evento)
      if (r.total <= 0) {
        toast.erro('Recibo sem valor', 'O total deste evento está zerado.')
        return
      }
      // Bobinas ainda não conferidas: o recibo sai só com o que já está calculado
      if (evento.bobinasConsignadas > 0 && r.conferencia !== 'CONFERIDO') {
        const ok = await confirmar({
          titulo: 'Bobinas ainda não conferidas',
          descricao: `O recibo vai sair só com o que já está calculado (${moeda(r.total)}), sem o valor das bobinas. Para incluí-las, use “Registrar devolução” antes.`,
          confirmar: 'Gerar assim mesmo',
        })
        if (!ok) return
      }
      try {
        const { baixarReciboPDF } = await import('../lib/pdfRecibo')
        const nome = await baixarReciboPDF(evento, cliente, config)
        toast.sucesso('Recibo gerado', `${FORMAS_PAGAMENTO[evento.formaPagamento].label} • ${moeda(r.total)} • ${nome}`)
      } catch (e) {
        toast.erro('Não foi possível gerar o recibo', (e as Error).message)
      }
    },
    excluir: async ({ evento }: EventoCompleto, depois?: () => void) => {
      const ok = await confirmar({
        titulo: `Excluir o evento ${codigoEvento(evento.codigo)}?`,
        descricao: `“${evento.nome}” e todos os seus lançamentos serão removidos. Esta ação não pode ser desfeita.`,
        confirmar: 'Excluir evento',
        perigo: true,
      })
      if (!ok) return
      try {
        await excluirEvento(evento.id)
        toast.sucesso('Evento excluído')
        depois?.()
      } catch (e) {
        avisarErro('Não foi possível excluir', e)
      }
    },
  }
}

/** Selo da programação das máquinas, com o ícone da máquina na frente (o rótulo sozinho é curto). */
function SeloProgramacao({ evento, className }: { evento: EventoCompleto['evento']; className?: string }) {
  return (
    <span
      title={`Programação das máquinas: ${STATUS_PROGRAMACAO[evento.programacao].label.toLowerCase()}`}
      className={cn('items-center gap-1', className)}
    >
      <IconeMaquinaFichas className="h-3.5 w-3.5 shrink-0 text-muted" />
      <ProgramacaoBadge status={evento.programacao} />
    </span>
  )
}

export function EventosTabela({ itens, ocultarCliente }: { itens: EventoCompleto[]; ocultarCliente?: boolean }) {
  const navegar = useNavigate()
  const acoes = useAcoesEvento()
  const hoje = useHoje()
  return (
    <Tabela>
      <thead>
        <tr>
          {/* Em telas menores que 1536 px o código vai para baixo do nome (o "…" precisa caber) */}
          <Th className="w-20 max-2xl:hidden">Código</Th>
          <Th>Evento</Th>
          {!ocultarCliente && <Th className="max-xl:hidden">Cliente</Th>}
          <Th className="max-sm:hidden">Período</Th>
          <Th alinhar="right" className="max-2xl:hidden">
            Diárias
          </Th>
          <Th alinhar="right">Total</Th>
          {/* Abaixo de 1280 px a coluna também mostra o status (e a programação), logo abaixo do pagamento */}
          <Th className="max-sm:hidden">
            <span className="xl:hidden">Situação</span>
            <span className="max-xl:hidden">Pagamento</span>
          </Th>
          <Th className="max-xl:hidden">Status</Th>
          <Th className="w-12" />
        </tr>
      </thead>
      <tbody>
        {itens.map((it, i) => {
          const { evento: e, resumo: r, cliente } = it
          // A cidade do evento (só os antigos têm) ou a do cliente; no histórico do cliente, só a do evento
          const cidade = e.cidade || (ocultarCliente ? '' : (cliente?.cidade ?? ''))
          // Programação das máquinas: só aparece enquanto falta concluir, nos eventos de hoje em diante
          const programacao = e.status !== 'CANCELADO' && e.programacao !== 'CONCLUIDA' && (r.dataFim ?? '') >= hoje
          return (
            <Linha key={e.id} indice={i} aoClicar={() => navegar(`/eventos/${e.id}`)}>
              <Td className="tnum text-xs font-medium text-muted max-2xl:hidden">{codigoEvento(e.codigo)}</Td>
              <Td>
                <p className="max-w-[150px] truncate font-medium text-ink sm:max-w-[200px] 2xl:max-w-[260px]">{e.nome}</p>
                <p className="max-w-[150px] truncate text-xs text-muted sm:max-w-[200px] 2xl:max-w-[260px]">
                  {/* No celular o período aparece aqui (a coluna some) */}
                  <span className="tnum sm:hidden">{periodo(r.dataInicio, r.dataFim)} • </span>
                  {/* Abaixo de 1536 px o código vem aqui; abaixo de 1280 px, também o cliente (as colunas somem) */}
                  <span className="tnum 2xl:hidden">{codigoEvento(e.codigo)}</span>
                  {!ocultarCliente && cliente && <span className="xl:hidden"> • {cliente.nome}</span>}
                  {cidade ? (
                    <>
                      <span className="2xl:hidden"> • </span>
                      {cidade}
                    </>
                  ) : (
                    !ocultarCliente &&
                    cliente && (
                      // Sem cidade, o cliente faz as vezes do local (abaixo de 1280 px ele já apareceu acima)
                      <span className="max-xl:hidden">
                        <span className="2xl:hidden"> • </span>
                        {cliente.nome}
                      </span>
                    )
                  )}
                  {e.maquinasIds.length > 0 && (
                    <>
                      <span className={cidade || (!ocultarCliente && cliente) ? undefined : '2xl:hidden'}> • </span>
                      {e.maquinasIds.length} {e.maquinasIds.length === 1 ? 'máquina' : 'máquinas'}
                    </>
                  )}
                </p>
                {/* No celular as colunas de situação somem: a programação aparece aqui */}
                {programacao && <SeloProgramacao evento={e} className="mt-1 flex sm:hidden" />}
              </Td>
              {!ocultarCliente && (
                <Td className="max-w-[150px] truncate max-xl:hidden 2xl:max-w-[220px]">{cliente?.nome ?? '—'}</Td>
              )}
              <Td className="tnum whitespace-nowrap max-sm:hidden">{periodo(r.dataInicio, r.dataFim)}</Td>
              <Td alinhar="right" className="max-2xl:hidden">
                {numero(r.totalDiarias)}
              </Td>
              <Td alinhar="right" className="font-medium whitespace-nowrap text-ink">
                {moeda(r.total)}
              </Td>
              <Td className="max-sm:hidden">
                <div className="flex flex-col items-start gap-1">
                  <PagamentoBadge forma={e.formaPagamento} />
                  <div className="flex items-center gap-1 xl:hidden">
                    <StatusBadge status={e.status} />
                    <GoogleSyncBadge evento={e} compacto />
                  </div>
                  {programacao && <SeloProgramacao evento={e} className="flex xl:hidden" />}
                </div>
              </Td>
              <Td className="max-xl:hidden">
                <div className="flex flex-col items-start gap-1">
                  <div className="flex items-center gap-1">
                    <StatusBadge status={e.status} />
                    <GoogleSyncBadge evento={e} compacto />
                  </div>
                  {programacao && <SeloProgramacao evento={e} className="flex" />}
                </div>
              </Td>
              <Td onClick={(ev) => ev.stopPropagation()}>
                <Menu
                  gatilho={(abrir) => (
                    <Button variante="ghost" tamanho="icon-sm" onClick={abrir} aria-label="Ações do evento">
                      <Ellipsis className="h-4 w-4" />
                    </Button>
                  )}
                  itens={[
                    { label: 'Editar', icone: <Pencil className="h-4 w-4" />, aoClicar: () => acoes.editar(e.id) },
                    { label: 'Gerar PDF', icone: <FileDown className="h-4 w-4" />, aoClicar: () => acoes.pdf(it) },
                    ...(podeGerarRecibo(e)
                      ? [{ label: 'Gerar recibo', icone: <ReceiptText className="h-4 w-4" />, aoClicar: () => acoes.recibo(it) }]
                      : []),
                    { label: 'Duplicar', icone: <Copy className="h-4 w-4" />, aoClicar: () => acoes.duplicar(e.id) },
                    'sep',
                    { label: 'Excluir', icone: <Trash2 className="h-4 w-4" />, aoClicar: () => acoes.excluir(it), perigo: true },
                  ]}
                />
              </Td>
            </Linha>
          )
        })}
      </tbody>
    </Tabela>
  )
}
