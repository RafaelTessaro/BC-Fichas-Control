import { format } from 'date-fns'
import { Database, Download, Monitor, Moon, Palette, Receipt, RotateCcw, Save, Sun, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DisponibilidadeMaquinas } from '../components/DisponibilidadeMaquinas'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { CurrencyInput, Field, Input } from '../components/ui/Form'
import { PageHeader } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { numero } from '../lib/format'
import { baixarArquivo } from '../lib/storage'
import type { Configuracoes as Config } from '#shared/tipos.ts'
import { CONFIG_PADRAO, useDados } from '../store/dados'
import { avisarErro, toast, useUI, type Tema } from '../store/ui'
import { api } from '../lib/api'
import { GoogleAgendaConfig } from '../components/GoogleAgendaConfig'

type CopiaServidor = { arquivo: string; tamanho: number; criadoEm: string }
const dataHora = (iso: string) => format(new Date(iso), "dd/MM/yyyy 'às' HH:mm")

/** "1 cliente", "9 clientes". */
const qtd = (n: number, um: string, varios: string) => `${numero(n)} ${n === 1 ? um : varios}`

export function Configuracoes() {
  const { config, salvarConfig, clientes, eventos, maquinas, exportar, importar, carregarExemplo, limparTudo } = useDados()
  const { tema, definirTema } = useUI()
  const [f, setF] = useState<Config>(config)
  const [base, setBase] = useState(config)
  const arquivo = useRef<HTMLInputElement>(null)

  // Quando a configuração muda no servidor (outro computador, backup restaurado), os campos que o
  // usuário não está editando acompanham o servidor; os que ele alterou continuam como estão.
  if (base !== config) {
    const mesclado = { ...f }
    for (const k of Object.keys(config) as Array<keyof Config>) {
      if (f[k] === base[k]) Object.assign(mesclado, { [k]: config[k] })
    }
    setBase(config)
    setF(mesclado)
  }
  const alterado = JSON.stringify(f) !== JSON.stringify(config)

  const [salvando, setSalvando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [copias, setCopias] = useState<CopiaServidor[] | null>(null)

  useEffect(() => {
    let ativo = true
    api
      .backupsAutomaticos()
      .then((r) => ativo && setCopias(r.backups))
      .catch(() => ativo && setCopias([]))
    return () => {
      ativo = false
    }
  }, [])

  const salvar = async () => {
    setSalvando(true)
    try {
      // O servidor pode ajustar valores (ex.: espaços no fim do rodapé): o formulário passa a
      // mostrar exatamente o que foi gravado
      const salvo = await salvarConfig({ ...f, frotaMaquinas: Math.max(1, f.frotaMaquinas) })
      setBase(salvo)
      setF(salvo)
      toast.sucesso('Configurações salvas', 'Os novos valores valem para os próximos eventos, em todos os computadores.')
    } catch (e) {
      avisarErro('Não foi possível salvar', e)
    } finally {
      setSalvando(false)
    }
  }

  const fazerBackup = async () => {
    try {
      const dados = await exportar()
      const nome = `bc-fichas-backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`
      baixarArquivo(nome, JSON.stringify(dados, null, 2), 'application/json')
      toast.sucesso('Backup baixado', nome)
    } catch (e) {
      avisarErro('Não foi possível gerar o backup', e)
    }
  }

  const copiaAgora = async () => {
    try {
      setCopias((await api.copiaAgora()).backups)
      toast.sucesso('Cópia salva no servidor')
    } catch (e) {
      avisarErro('Não foi possível fazer a cópia', e)
    }
  }

  const restaurar = async (file: File) => {
    let dados: unknown
    try {
      dados = JSON.parse(await file.text())
    } catch {
      toast.erro('Não foi possível restaurar', 'O arquivo não é um backup válido (JSON).')
      return
    }
    const ok = await confirmar({
      titulo: 'Restaurar backup?',
      descricao: `Os dados atuais (${qtd(clientes.length, 'cliente', 'clientes')}, ${qtd(eventos.length, 'evento', 'eventos')} e ${qtd(maquinas.length, 'máquina', 'máquinas')}) serão substituídos pelos do arquivo “${file.name}” em todos os computadores. Antes disso, o servidor guarda uma cópia automática.`,
      confirmar: 'Restaurar',
      perigo: true,
      digitar: 'RESTAURAR',
    })
    if (!ok) return
    setOcupado(true)
    try {
      const r = await importar(dados)
      toast.sucesso(
        'Backup restaurado',
        `${qtd(r.clientes, 'cliente', 'clientes')}, ${qtd(r.eventos, 'evento', 'eventos')} e ${qtd(r.maquinas, 'máquina', 'máquinas')}.`,
      )
    } catch (e) {
      avisarErro('Não foi possível restaurar', e)
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <PageHeader
        titulo="Configurações"
        descricao="Máquinas, valores padrão, aparência e backup dos dados."
        acoes={
          <>
            {alterado && (
              <Button variante="ghost" icone={<RotateCcw className="h-4 w-4" />} onClick={() => setF(config)} disabled={salvando}>
                Descartar
              </Button>
            )}
            <Button variante="primary" icone={<Save className="h-4 w-4" />} onClick={salvar} disabled={!alterado || salvando}>
              {salvando ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </>
        }
      />

      <DisponibilidadeMaquinas />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              icone={<Receipt className="h-4 w-4" />}
              titulo="Valores padrão"
              descricao="Vêm preenchidos em cada novo evento. Salve com o botão “Salvar alterações”."
            />
            <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
              <Field label="Valor da diária" htmlFor="cfg-vd" hint="Por máquina, por dia">
                <CurrencyInput id="cfg-vd" valor={f.valorDiariaPadrao} aoMudar={(v) => setF({ ...f, valorDiariaPadrao: v })} />
              </Field>
              <Field label="Valor de cada bobina" htmlFor="cfg-vb" hint="Cobrado por bobina utilizada">
                <CurrencyInput id="cfg-vb" valor={f.valorBobinaPadrao} aoMudar={(v) => setF({ ...f, valorBobinaPadrao: v })} />
              </Field>
              <Field
                label="Rodapé padrão das fichas"
                htmlFor="cfg-rod"
                className="sm:col-span-2"
                hint="Texto impresso no fim de cada ficha. Também fecha o resumo em PDF entregue ao cliente."
              >
                <Input
                  id="cfg-rod"
                  value={f.rodapePadrao}
                  onChange={(e) => setF({ ...f, rodapePadrao: e.target.value })}
                  placeholder="Ex.: AGRADECEMOS SUA PRESENÇA!"
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              icone={<Palette className="h-4 w-4" />}
              titulo="Aparência"
              descricao="Escolha como o sistema deve ser exibido neste computador."
            />
            <div className="grid grid-cols-3 gap-3 px-5 pb-5">
              <OpcaoTema valor="light" atual={tema} aoEscolher={definirTema} icone={<Sun className="h-4 w-4" />} label="Claro" />
              <OpcaoTema valor="dark" atual={tema} aoEscolher={definirTema} icone={<Moon className="h-4 w-4" />} label="Escuro" />
              <OpcaoTema
                valor="system"
                atual={tema}
                aoEscolher={definirTema}
                icone={<Monitor className="h-4 w-4" />}
                label="Sistema"
              />
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader
            icone={<Database className="h-4 w-4" />}
            titulo="Dados e backup"
            descricao="Os dados ficam no servidor da empresa e são copiados automaticamente todos os dias."
          />
          <div className="flex flex-col gap-4 px-5 pb-5">
            <div className="grid grid-cols-3 gap-2">
              {[
                { rotulo: 'Clientes', valor: clientes.length },
                { rotulo: 'Eventos', valor: eventos.length },
                { rotulo: 'Máquinas', valor: maquinas.length },
              ].map((x) => (
                <div key={x.rotulo} className="min-w-0 rounded-xl bg-surface-2 px-3.5 py-3">
                  <p className="truncate text-xs text-muted">{x.rotulo}</p>
                  <p className="tnum text-lg font-semibold text-ink">{numero(x.valor)}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icone={<Download className="h-4 w-4" />} onClick={fazerBackup}>
                Baixar backup
              </Button>
              <Button icone={<Upload className="h-4 w-4" />} onClick={() => arquivo.current?.click()} disabled={ocupado}>
                {ocupado ? 'Restaurando…' : 'Restaurar backup'}
              </Button>
              <input
                ref={arquivo}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void restaurar(file)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="rounded-xl border border-line px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-ink-2">Cópias automáticas no servidor</p>
                <Button tamanho="sm" variante="ghost" icone={<Save className="h-3.5 w-3.5" />} onClick={copiaAgora}>
                  Copiar agora
                </Button>
              </div>
              {copias === null ? (
                <p className="mt-1 text-xs text-muted">Carregando…</p>
              ) : copias.length === 0 ? (
                <p className="mt-1 text-xs text-muted">Nenhuma cópia ainda. A primeira é feita ao iniciar o servidor.</p>
              ) : (
                <ul className="mt-1.5 flex flex-col gap-1 text-xs text-muted">
                  {copias.slice(0, 3).map((c) => (
                    <li key={c.arquivo} className="flex justify-between gap-3">
                      <span className="truncate">{dataHora(c.criadoEm)}</span>
                      <span className="tnum shrink-0">
                        {(c.tamanho / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {/* O servidor só carrega o exemplo com o sistema vazio (sem clientes, eventos nem máquinas) */}
              {clientes.length + eventos.length + maquinas.length === 0 && (
                <Button
                  tamanho="sm"
                  variante="ghost"
                  icone={<Database className="h-3.5 w-3.5" />}
                  onClick={async () => {
                    try {
                      await carregarExemplo()
                      toast.sucesso('Dados de exemplo carregados')
                    } catch (e) {
                      avisarErro('Não foi possível carregar o exemplo', e)
                    }
                  }}
                >
                  Carregar dados de exemplo
                </Button>
              )}
              <Button
                tamanho="sm"
                variante="ghost"
                icone={<Trash2 className="h-3.5 w-3.5" />}
                className="text-danger hover:bg-danger-soft hover:text-danger"
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: 'Apagar todos os dados?',
                    descricao:
                      'Todos os clientes, eventos, máquinas e ordens de serviço serão removidos do servidor, em todos os computadores. Antes de apagar, o servidor guarda uma cópia automática.',
                    confirmar: 'Apagar tudo',
                    perigo: true,
                    digitar: 'APAGAR',
                  })
                  if (!ok) return
                  try {
                    await limparTudo()
                    toast.sucesso('Dados apagados')
                  } catch (e) {
                    avisarErro('Não foi possível apagar', e)
                  }
                }}
              >
                Apagar todos os dados
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <GoogleAgendaConfig />
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        BC Fichas Control • valores de fábrica: diária{' '}
        {CONFIG_PADRAO.valorDiariaPadrao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, bobina{' '}
        {CONFIG_PADRAO.valorBobinaPadrao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>
    </>
  )
}

function OpcaoTema({
  valor,
  atual,
  aoEscolher,
  icone,
  label,
}: {
  valor: Tema
  atual: Tema
  aoEscolher: (t: Tema) => void
  icone: ReactNode
  label: string
}) {
  const ativo = valor === atual
  const preview = (escuro: boolean) => (
    <div className={cn('flex h-full w-full gap-1 p-1.5', escuro ? 'bg-[#0e1012]' : 'bg-[#f5f6f7]')}>
      <div className={cn('w-1/4 rounded', escuro ? 'bg-[#16181b]' : 'bg-white')} />
      <div className="flex flex-1 flex-col gap-1">
        <div className={cn('h-2 w-2/3 rounded-sm', escuro ? 'bg-[#24282d]' : 'bg-[#e7e9ec]')} />
        <div className={cn('flex-1 rounded', escuro ? 'bg-[#16181b]' : 'bg-white')}>
          <div className="m-1 h-1.5 w-1/3 rounded-sm bg-[#0b9e4f]" />
        </div>
      </div>
    </div>
  )
  return (
    <button
      type="button"
      onClick={() => aoEscolher(valor)}
      aria-pressed={ativo}
      className={cn(
        'group cursor-pointer rounded-2xl border p-2 text-left transition-all',
        ativo ? 'border-brand ring-4 ring-[var(--ring)]' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="h-16 overflow-hidden rounded-xl border border-line">
        {valor === 'system' ? (
          <div className="flex h-full">
            <div className="w-1/2 overflow-hidden">{preview(false)}</div>
            <div className="w-1/2 overflow-hidden">{preview(true)}</div>
          </div>
        ) : (
          preview(valor === 'dark')
        )}
      </div>
      <p className={cn('mt-2 flex items-center gap-1.5 px-1 text-[13px] font-medium', ativo ? 'text-ink' : 'text-ink-2')}>
        {icone}
        {label}
      </p>
    </button>
  )
}
