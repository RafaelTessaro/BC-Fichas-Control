import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import logo from '../../assets/logo-mark.png'
import { cn } from '../../lib/cn'
import { useDados } from '../../store/dados'
import { useUI, type Tema } from '../../store/ui'
import { NAV, NAV_CONFIG, type ItemNav } from './nav'

function ativoPara(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

function Item({
  item,
  recolhida,
  badge,
  aoNavegar,
}: {
  item: ItemNav
  recolhida: boolean
  badge?: number
  aoNavegar?: () => void
}) {
  const { pathname } = useLocation()
  const ativo = ativoPara(pathname, item.to)
  const Icone = item.icone
  return (
    <NavLink
      to={item.to}
      onClick={aoNavegar}
      title={recolhida ? item.label : undefined}
      className={cn(
        'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors duration-150',
        ativo ? 'text-ink' : 'text-ink-2 hover:text-ink',
        recolhida && 'justify-center px-0',
      )}
    >
      {ativo && (
        <motion.span
          layoutId="nav-ativo"
          className="absolute inset-0 rounded-xl bg-surface shadow-xs ring-1 ring-line"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      {!ativo && <span className="absolute inset-0 rounded-xl bg-surface-3/0 transition-colors group-hover:bg-surface-3/60" />}
      <Icone
        className={cn(
          'relative h-[18px] w-[18px] shrink-0 transition-colors',
          ativo ? 'text-brand' : 'text-muted group-hover:text-ink-2',
        )}
        strokeWidth={ativo ? 2.2 : 1.9}
      />
      {!recolhida && <span className="relative flex-1 truncate">{item.label}</span>}
      {!!badge && (
        <span
          className={cn(
            'tnum relative flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning',
            recolhida && 'absolute top-1 right-1 h-4 min-w-4 px-1 text-[10px]',
          )}
        >
          {badge}
        </span>
      )}
    </NavLink>
  )
}

const TEMAS: Array<{ valor: Tema; icone: typeof Sun; label: string }> = [
  { valor: 'light', icone: Sun, label: 'Claro' },
  { valor: 'dark', icone: Moon, label: 'Escuro' },
  { valor: 'system', icone: Monitor, label: 'Sistema' },
]

export function SeletorTema({ compacto }: { compacto?: boolean }) {
  const { tema, definirTema } = useUI()
  if (compacto) {
    const atual = TEMAS.findIndex((t) => t.valor === tema)
    const prox = TEMAS[(atual + 1) % TEMAS.length]
    const Icone = TEMAS[atual]?.icone ?? Monitor
    return (
      <button
        onClick={() => definirTema(prox.valor)}
        title={`Tema: ${TEMAS[atual]?.label}. Clique para ${prox.label.toLowerCase()}`}
        className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-3/60 hover:text-ink"
      >
        <Icone className="h-[18px] w-[18px]" />
      </button>
    )
  }
  return (
    <div className="flex items-center gap-0.5 rounded-xl bg-surface-3/70 p-1">
      {TEMAS.map((t) => {
        const ativo = t.valor === tema
        return (
          <button
            key={t.valor}
            onClick={() => definirTema(t.valor)}
            title={t.label}
            aria-pressed={ativo}
            className={cn(
              'relative flex h-7 flex-1 cursor-pointer items-center justify-center rounded-lg transition-colors',
              ativo ? 'text-ink' : 'text-muted hover:text-ink-2',
            )}
          >
            {ativo && (
              <motion.span
                layoutId="tema-ativo"
                className="absolute inset-0 rounded-lg bg-surface shadow-xs ring-1 ring-line"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <t.icone className="relative h-3.5 w-3.5" />
          </button>
        )
      })}
    </div>
  )
}

export function Sidebar({ mobile, aoNavegar }: { mobile?: boolean; aoNavegar?: () => void }) {
  const { sidebarRecolhida, alternarSidebar } = useUI()
  const recolhida = !mobile && sidebarRecolhida
  const eventos = useDados((s) => s.eventos)
  const pendentes = useMemo(() => eventos.filter((e) => e.status === 'PENDENTE').length, [eventos])

  return (
    <motion.aside
      animate={{ width: mobile ? 272 : recolhida ? 76 : 256 }}
      transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      className={cn('flex h-full shrink-0 flex-col bg-bg', !mobile && 'border-r border-line')}
    >
      <div className={cn('flex h-16 items-center gap-3 px-5', recolhida && 'justify-center px-0')}>
        <img src={logo} alt="" className="h-9 w-9 shrink-0 rounded-full shadow-xs ring-1 ring-line" />
        {!recolhida && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink">BC Fichas</p>
            <p className="truncate text-xs text-muted">Controle de locação</p>
          </motion.div>
        )}
      </div>

      <nav className="scroll-fino flex-1 overflow-y-auto px-3 pt-3 pb-4">
        {NAV.map((g) => (
          <div key={g.grupo} className="mb-5">
            {!recolhida ? (
              <p className="mb-1.5 px-3 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">{g.grupo}</p>
            ) : (
              <div className="mx-auto mb-2 h-px w-6 bg-line" />
            )}
            <div className="flex flex-col gap-0.5">
              {g.itens.map((it) => (
                <Item
                  key={it.to}
                  item={it}
                  recolhida={recolhida}
                  badge={it.to === '/eventos' ? pendentes : undefined}
                  aoNavegar={aoNavegar}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
        <Item item={NAV_CONFIG} recolhida={recolhida} aoNavegar={aoNavegar} />
        <div className={cn('flex items-center gap-2', recolhida ? 'flex-col' : 'px-1')}>
          {recolhida ? (
            <SeletorTema compacto />
          ) : (
            <div className="flex-1">
              <SeletorTema />
            </div>
          )}
          {!mobile && (
            <button
              onClick={alternarSidebar}
              title={recolhida ? 'Expandir menu' : 'Recolher menu'}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors hover:bg-surface-3/60 hover:text-ink"
            >
              {recolhida ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
          )}
        </div>
      </div>
    </motion.aside>
  )
}
