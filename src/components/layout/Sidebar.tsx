import { osEmAberto } from '#shared/maquinas.ts'
import { Monitor, Moon, PanelLeftClose, PanelLeftOpen, Sun } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import logo from '../../assets/logo-mark.png'
import { cn } from '../../lib/cn'
import { aguardandoSemEfeito } from '../../lib/contratos'
import { useDados } from '../../store/dados'
import { useUI, type Tema } from '../../store/ui'
import { NAV, NAV_CONFIG, type ItemNav } from './nav'

function ativoPara(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

/**
 * Contador ao lado de um item do menu (eventos pendentes, contratos esperando assinatura,
 * manutenções em aberto) e o que ele significa.
 */
interface ContadorNav {
  valor: number
  /** Ex.: "11 eventos pendentes". */
  descricao: string
}

function Item({
  item,
  recolhida,
  contador,
  aoNavegar,
}: {
  item: ItemNav
  recolhida: boolean
  contador?: ContadorNav
  aoNavegar?: () => void
}) {
  const { pathname } = useLocation()
  const ativo = ativoPara(pathname, item.to)
  const Icone = item.icone
  const temContador = !!contador && contador.valor > 0
  const rotulo = temContador ? `${item.label}: ${contador.descricao}` : item.label
  return (
    <NavLink
      to={item.to}
      onClick={aoNavegar}
      title={recolhida ? rotulo : undefined}
      aria-label={recolhida || temContador ? rotulo : undefined}
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
      {/* O selo do menu recolhido fica preso ao ícone, sem tirá-lo do centro */}
      <span className="relative flex shrink-0">
        <Icone
          className={cn('h-[18px] w-[18px] transition-colors', ativo ? 'text-brand' : 'text-muted group-hover:text-ink-2')}
          strokeWidth={ativo ? 2.2 : 1.9}
        />
        {recolhida && temContador && <SeloContador valor={contador.valor} ativo={ativo} />}
      </span>
      {!recolhida && <span className="relative flex-1 truncate">{item.label}</span>}
      {!recolhida && temContador && (
        <span
          title={contador.descricao}
          className="tnum relative flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-soft px-1.5 text-[11px] font-semibold text-warning"
        >
          {contador.valor}
        </span>
      )}
    </NavLink>
  )
}

/** Selo no canto do ícone, com o menu recolhido: o número até 99; acima disso, só um ponto. */
function SeloContador({ valor, ativo }: { valor: number; ativo: boolean }) {
  // O anel tem a cor do fundo do item, para "recortar" o selo do ícone
  const anel = ativo ? 'ring-surface' : 'ring-bg'
  return (
    <motion.span
      aria-hidden="true"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(
        'pointer-events-none absolute rounded-full bg-warning ring-2',
        anel,
        valor > 99
          ? '-top-1 -right-1 h-2.5 w-2.5'
          : 'tnum -top-2.5 -right-3.5 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] leading-none font-bold text-surface',
      )}
    >
      {valor > 99 ? null : valor}
    </motion.span>
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
        type="button"
        onClick={() => definirTema(prox.valor)}
        title={`Tema: ${TEMAS[atual]?.label}. Clique para mudar para ${prox.label.toLowerCase()}`}
        aria-label={`Tema: ${TEMAS[atual]?.label}. Mudar para ${prox.label.toLowerCase()}`}
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
            type="button"
            key={t.valor}
            onClick={() => definirTema(t.valor)}
            title={`Tema ${t.label.toLowerCase()}`}
            aria-label={`Tema ${t.label.toLowerCase()}`}
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
  const ordens = useDados((s) => s.ordens)
  const osAbertas = useMemo(() => ordens.filter(osEmAberto).length, [ordens])
  const contratos = useDados((s) => s.contratos)
  const aAssinar = useMemo(
    () => contratos.filter((c) => c.status === 'AGUARDANDO' && !aguardandoSemEfeito(c, eventos)).length,
    [contratos, eventos],
  )
  const contadores: Record<string, ContadorNav> = {
    '/eventos': { valor: pendentes, descricao: `${pendentes} ${pendentes === 1 ? 'evento pendente' : 'eventos pendentes'}` },
    '/contratos': {
      valor: aAssinar,
      descricao: `${aAssinar} ${aAssinar === 1 ? 'contrato esperando assinatura' : 'contratos esperando assinatura'}`,
    },
    '/manutencao': {
      valor: osAbertas,
      descricao: `${osAbertas} ${osAbertas === 1 ? 'manutenção em aberto' : 'manutenções em aberto'}`,
    },
  }

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
                <Item key={it.to} item={it} recolhida={recolhida} contador={contadores[it.to]} aoNavegar={aoNavegar} />
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
              type="button"
              onClick={alternarSidebar}
              title={recolhida ? 'Expandir menu' : 'Recolher menu'}
              aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
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
