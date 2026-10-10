import { describe, expect, it } from 'vitest'
import { navDoNivel, paginasDoNivel } from './nav'

const ADMINISTRATIVAS = ['/relatorios', '/configuracoes', '/usuarios']
const rotas = (nivel: Parameters<typeof paginasDoNivel>[0]) => paginasDoNivel(nivel).map((p) => p.to)

describe('menu por nível', () => {
  it('o administrador vê todas as páginas, com Usuários e Configurações em "Administração"', () => {
    expect(rotas('ADMIN')).toEqual([
      '/',
      '/agenda',
      '/clientes',
      '/eventos',
      '/contratos',
      '/manutencao',
      '/relatorios',
      '/usuarios',
      '/configuracoes',
    ])
    const admin = navDoNivel('ADMIN').find((g) => g.grupo === 'Administração')
    expect(admin?.itens.map((i) => i.to)).toEqual(['/relatorios', '/usuarios', '/configuracoes'])
  })

  it('o comum não vê Relatórios, Configurações nem Usuários, e não sobra grupo vazio', () => {
    const paginas = rotas('COMUM')
    for (const rota of ADMINISTRATIVAS) expect(paginas).not.toContain(rota)
    expect(paginas).toEqual(['/', '/agenda', '/clientes', '/eventos', '/contratos', '/manutencao'])
    const grupos = navDoNivel('COMUM')
    expect(grupos.map((g) => g.grupo)).toEqual(['Visão geral', 'Cadastros', 'Gestão'])
    expect(grupos.every((g) => g.itens.length > 0)).toBe(true)
  })

  it('sem ninguém logado, nenhuma página restrita', () => {
    for (const rota of ADMINISTRATIVAS) expect(rotas(null)).not.toContain(rota)
    expect(navDoNivel(undefined).every((g) => g.itens.length > 0)).toBe(true)
  })

  it('o Painel do comum tem a descrição sem faturamento', () => {
    const painel = (nivel: 'ADMIN' | 'COMUM') => paginasDoNivel(nivel).find((p) => p.to === '/')?.descricao
    expect(painel('ADMIN')).toBe('Resumo do mês e pendências')
    expect(painel('COMUM')).toBe('Pendências, máquinas e próximos eventos')
  })
})
