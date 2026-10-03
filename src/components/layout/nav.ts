import {
  CalendarDays,
  ChartColumn,
  FilePenLine,
  LayoutDashboard,
  Settings,
  Ticket,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

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
      { to: '/contratos', label: 'Contratos', icone: FilePenLine, descricao: 'Contratos de locação e assinaturas' },
    ],
  },
  {
    grupo: 'Gestão',
    itens: [
      { to: '/manutencao', label: 'Manutenção', icone: Wrench, descricao: 'Máquinas, manutenções e reclamações' },
      { to: '/relatorios', label: 'Relatórios', icone: ChartColumn, descricao: 'Faturamento e indicadores' },
    ],
  },
]

export const NAV_CONFIG: ItemNav = {
  to: '/configuracoes',
  label: 'Configurações',
  icone: Settings,
  descricao: 'Valores padrão, quantidade de máquinas e backup',
}

export const TODAS_PAGINAS = [...NAV.flatMap((g) => g.itens), NAV_CONFIG]
