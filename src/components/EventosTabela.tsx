import { Copy, Ellipsis, FileDown, Pencil, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { codigoEvento, moeda, numero, periodo } from '../lib/format'
import type { EventoCompleto } from '../lib/hooks'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { PagamentoBadge, StatusBadge } from './Badges'
import { GoogleSyncBadge } from './GoogleSyncBadge'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Menu } from './ui/Misc'
import { Linha, Tabela, Td, Th } from './ui/Table'

export function useAcoesEvento() {
  const navegar = useNavigate()
  const duplicarEvento = useDados((s) => s.duplicarEvento)
  const excluirEvento = useDados((s) => s.excluirEvento)
  const config = useDados((s) => s.config)

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
        const nome = await baixarResumoPDF(evento, cliente, config)
        toast.sucesso('PDF gerado', nome)
      } catch (e) {
        toast.erro('Não foi possível gerar o PDF', (e as Error).message)
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

export function EventosTabela({ itens, ocultarCliente }: { itens: EventoCompleto[]; ocultarCliente?: boolean }) {
  const navegar = useNavigate()
  const acoes = useAcoesEvento()
  return (
    <Tabela>
      <thead>
        <tr>
          <Th className="w-20">Código</Th>
          <Th>Evento</Th>
          {!ocultarCliente && <Th className="max-md:hidden">Cliente</Th>}
          <Th>Período</Th>
          <Th alinhar="right" className="max-lg:hidden">
            Diárias
          </Th>
          <Th alinhar="right">Total</Th>
          <Th className="max-sm:hidden">Pagamento</Th>
          <Th className="max-md:hidden">Status</Th>
          <Th className="w-12" />
        </tr>
      </thead>
      <tbody>
        {itens.map((it, i) => {
          const { evento: e, resumo: r, cliente } = it
          return (
            <Linha key={e.id} indice={i} aoClicar={() => navegar(`/eventos/${e.id}`)}>
              <Td className="tnum text-xs font-medium text-muted">{codigoEvento(e.codigo)}</Td>
              <Td>
                <p className="max-w-[260px] truncate font-medium text-ink">{e.nome}</p>
                <p className="max-w-[260px] truncate text-xs text-muted">{e.cidade || (ocultarCliente ? '' : cliente?.nome)}</p>
              </Td>
              {!ocultarCliente && <Td className="max-w-[220px] truncate max-md:hidden">{cliente?.nome ?? '—'}</Td>}
              <Td className="tnum whitespace-nowrap">{periodo(r.dataInicio, r.dataFim)}</Td>
              <Td alinhar="right" className="max-lg:hidden">
                {numero(r.totalDiarias)}
              </Td>
              <Td alinhar="right" className="font-medium whitespace-nowrap text-ink">
                {moeda(r.total)}
              </Td>
              <Td className="max-sm:hidden">
                <PagamentoBadge forma={e.formaPagamento} />
              </Td>
              <Td className="max-md:hidden">
                <div className="flex items-center gap-1">
                  <StatusBadge status={e.status} />
                  <GoogleSyncBadge evento={e} compacto />
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
