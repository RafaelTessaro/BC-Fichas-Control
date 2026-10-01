import { CalendarDays, ChartColumn, LayoutDashboard, Settings, Ticket, Users, type LucideIcon } from 'lucide-react'

export interface ItemNav {
  to: string
  label: string
  icone: LucideIcon
  descricao: string
}

export const NAV: Array<{ grupo: string; itens: ItemNav[] }> = [
  {
    grupo: 'Visão geral',
    itens: [
      { to: '/', label: 'Painel', icone: LayoutDashboard, descricao: 'Resumo do mês e pendências' },
      { to: '/agenda', label: 'Agenda', icone: CalendarDays, descricao: 'Calendário de máquinas por dia' },
    ],
  },
  {
    grupo: 'Cadastros',
    itens: [
      { to: '/clientes', label: 'Clientes', icone: Users, descricao: 'Cadastro e histórico de clientes' },
      { to: '/eventos', label: 'Eventos', icone: Ticket, descricao: 'Locações, diárias e bobinas' },
    ],
  },
  {
    grupo: 'Gestão',
    itens: [{ to: '/relatorios', label: 'Relatórios', icone: ChartColumn, descricao: 'Faturamento e indicadores' }],
  },
]

export const NAV_CONFIG: ItemNav = {
  to: '/configuracoes',
  label: 'Configurações',
  icone: Settings,
  descricao: 'Empresa, valores padrão e backup',
}

export const TODAS_PAGINAS = [...NAV.flatMap((g) => g.itens), NAV_CONFIG]
