import {
  CalendarDays,
  ChartColumn,
  FilePenLine,
  LayoutDashboard,
  Settings,
  Ticket,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { pode, type Permissao } from '#shared/permissoes.ts'
import type { NivelUsuario } from '#shared/tipos.ts'

export interface ItemNav {
  to: string
  label: string
  icone: LucideIcon
  descricao: string
  /** Só aparece para quem tem a permissão (o servidor também recusa as rotas da página). */
  permissao?: Permissao
  /** Descrição para quem não vê o faturamento (a página mostra menos coisas para ele). */
  descricaoComum?: string
}

export interface GrupoNav {
  grupo: string
  itens: ItemNav[]
}

const NAV: GrupoNav[] = [
  {
    grupo: 'Visão geral',
    itens: [
      {
        to: '/',
        label: 'Painel',
        icone: LayoutDashboard,
        descricao: 'Resumo do mês e pendências',
        descricaoComum: 'Pendências, máquinas e próximos eventos',
      },
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
    itens: [{ to: '/manutencao', label: 'Manutenção', icone: Wrench, descricao: 'Máquinas, manutenções e reclamações' }],
  },
  {
    grupo: 'Administração',
    itens: [
      {
        to: '/relatorios',
        label: 'Relatórios',
        icone: ChartColumn,
        descricao: 'Faturamento e indicadores',
        permissao: 'verFaturamento',
      },
      {
        to: '/usuarios',
        label: 'Usuários',
        icone: UserCog,
        descricao: 'Quem acessa o sistema e o nível de cada um',
        permissao: 'usuarios',
      },
      {
        to: '/configuracoes',
        label: 'Configurações',
        icone: Settings,
        descricao: 'Valores padrão, quantidade de máquinas e backup',
        permissao: 'configuracoes',
      },
    ],
  },
]

/** Menu de quem entrou: só as páginas que o nível pode abrir, sem grupo vazio. */
export function navDoNivel(nivel: NivelUsuario | null | undefined): GrupoNav[] {
  const veFaturamento = pode(nivel, 'verFaturamento')
  return NAV.map((g) => ({
    grupo: g.grupo,
    itens: g.itens
      .filter((it) => !it.permissao || pode(nivel, it.permissao))
      .map((it) => (!veFaturamento && it.descricaoComum ? { ...it, descricao: it.descricaoComum } : it)),
  })).filter((g) => g.itens.length > 0)
}

/** Todas as páginas que o nível pode abrir (título do cabeçalho e busca global). */
export function paginasDoNivel(nivel: NivelUsuario | null | undefined): ItemNav[] {
  return navDoNivel(nivel).flatMap((g) => g.itens)
}
