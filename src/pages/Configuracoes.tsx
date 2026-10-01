import { format } from 'date-fns'
import { Cpu, Database, Download, Monitor, Moon, Palette, Receipt, RotateCcw, Save, Sun, Trash2, Upload } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { CurrencyInput, Field, Input, NumberInput } from '../components/ui/Form'
import { PageHeader } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { numero } from '../lib/format'
import { baixarArquivo } from '../lib/storage'
import type { Configuracoes as Config } from '../lib/types'
import { CONFIG_PADRAO, useDados } from '../store/dados'
import { toast, useUI, type Tema } from '../store/ui'

export function Configuracoes() {
  const { config, salvarConfig, clientes, eventos, exportar, importar, carregarExemplo, limparTudo } = useDados()
  const { tema, definirTema } = useUI()
  const [f, setF] = useState<Config>(config)
  const [base, setBase] = useState(config)
  const arquivo = useRef<HTMLInputElement>(null)

  // Se a configuração mudar fora deste formulário (ex.: backup restaurado), recarrega os campos
  if (base !== config) {
    setBase(config)
    setF(config)
  }
  const alterado = JSON.stringify(f) !== JSON.stringify(config)

  const salvar = () => {
    salvarConfig({ ...f, frotaMaquinas: Math.max(1, f.frotaMaquinas) })
    toast.sucesso('Configurações salvas', 'Os novos valores valem para os próximos eventos.')
  }

  const fazerBackup = () => {
    const nome = `bc-fichas-backup_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`
    baixarArquivo(nome, JSON.stringify(exportar(), null, 2), 'application/json')
    toast.sucesso('Backup gerado', nome)
  }

  const restaurar = async (file: File) => {
    try {
      const dados = JSON.parse(await file.text())
      const ok = await confirmar({
        titulo: 'Restaurar backup?',
        descricao: `Os dados atuais (${clientes.length} clientes e ${eventos.length} eventos) serão substituídos pelos do arquivo “${file.name}”.`,
        confirmar: 'Substituir dados',
        perigo: true,
      })
      if (!ok) return
      importar(dados)
      toast.sucesso('Backup restaurado')
    } catch (e) {
      toast.erro(
        'Não foi possível restaurar',
        e instanceof SyntaxError ? 'O arquivo não é um JSON válido.' : (e as Error).message,
      )
    }
  }

  return (
    <>
      <PageHeader
        titulo="Configurações"
        descricao="Valores padrão, frota, aparência e backup dos dados."
        acoes={
          <Button variante="primary" icone={<Save className="h-4 w-4" />} onClick={salvar} disabled={!alterado}>
            Salvar alterações
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            icone={<Receipt className="h-4 w-4" />}
            titulo="Valores padrão"
            descricao="Preenchidos automaticamente em cada novo evento."
          />
          <div className="grid grid-cols-1 gap-4 px-5 pb-5 sm:grid-cols-2">
            <Field label="Valor da diária" htmlFor="cfg-vd" hint="Por máquina, por dia">
              <CurrencyInput id="cfg-vd" valor={f.valorDiariaPadrao} aoMudar={(v) => setF({ ...f, valorDiariaPadrao: v })} />
            </Field>
            <Field label="Valor de cada bobina" htmlFor="cfg-vb" hint="Cobrado por bobina utilizada">
              <CurrencyInput id="cfg-vb" valor={f.valorBobinaPadrao} aoMudar={(v) => setF({ ...f, valorBobinaPadrao: v })} />
            </Field>
            <Field label="Mensagem de rodapé do PDF" htmlFor="cfg-rod" className="sm:col-span-2">
              <Input id="cfg-rod" value={f.rodapePadrao} onChange={(e) => setF({ ...f, rodapePadrao: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            icone={<Cpu className="h-4 w-4" />}
            titulo="Frota de máquinas"
            descricao="Usada para mostrar a disponibilidade na agenda e nos eventos."
          />
          <div className="flex flex-col gap-4 px-5 pb-5">
            <Field label="Quantidade de máquinas disponíveis" htmlFor="cfg-frota">
              <NumberInput
                id="cfg-frota"
                valor={f.frotaMaquinas}
                min={1}
                max={9999}
                aoMudar={(v) => setF({ ...f, frotaMaquinas: v ?? 1 })}
                className="sm:w-48"
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: Math.min(f.frotaMaquinas, 40) }, (_, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.012 }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand-ink"
                >
                  <Cpu className="h-3.5 w-3.5" />
                </motion.span>
              ))}
              {f.frotaMaquinas > 40 && <span className="self-center text-xs text-muted">+{f.frotaMaquinas - 40}</span>}
            </div>
            {alterado && (
              <Button
                tamanho="sm"
                variante="ghost"
                icone={<RotateCcw className="h-3.5 w-3.5" />}
                className="self-start"
                onClick={() => setF(config)}
              >
                Descartar alterações
              </Button>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            icone={<Palette className="h-4 w-4" />}
            titulo="Aparência"
            descricao="Escolha como o sistema deve ser exibido."
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

        <Card>
          <CardHeader
            icone={<Database className="h-4 w-4" />}
            titulo="Dados e backup"
            descricao="Os dados ficam salvos neste navegador. Faça backups com frequência."
          />
          <div className="flex flex-col gap-4 px-5 pb-5">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-surface-2 px-3.5 py-3">
                <p className="text-xs text-muted">Clientes</p>
                <p className="tnum text-lg font-semibold text-ink">{numero(clientes.length)}</p>
              </div>
              <div className="rounded-xl bg-surface-2 px-3.5 py-3">
                <p className="text-xs text-muted">Eventos</p>
                <p className="tnum text-lg font-semibold text-ink">{numero(eventos.length)}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icone={<Download className="h-4 w-4" />} onClick={fazerBackup}>
                Fazer backup
              </Button>
              <Button icone={<Upload className="h-4 w-4" />} onClick={() => arquivo.current?.click()}>
                Restaurar backup
              </Button>
              <input
                ref={arquivo}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) restaurar(file)
                  e.target.value = ''
                }}
              />
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <Button
                tamanho="sm"
                variante="ghost"
                icone={<Database className="h-3.5 w-3.5" />}
                onClick={async () => {
                  const ok =
                    clientes.length + eventos.length === 0 ||
                    (await confirmar({
                      titulo: 'Carregar dados de exemplo?',
                      descricao: 'Os clientes e eventos atuais serão substituídos por dados fictícios.',
                      confirmar: 'Carregar exemplo',
                      perigo: true,
                    }))
                  if (!ok) return
                  carregarExemplo()
                  toast.sucesso('Dados de exemplo carregados')
                }}
              >
                Carregar dados de exemplo
              </Button>
              <Button
                tamanho="sm"
                variante="ghost"
                icone={<Trash2 className="h-3.5 w-3.5" />}
                className="text-danger hover:bg-danger-soft hover:text-danger"
                onClick={async () => {
                  const ok = await confirmar({
                    titulo: 'Apagar todos os dados?',
                    descricao: 'Todos os clientes e eventos serão removidos deste navegador. Recomendamos fazer um backup antes.',
                    confirmar: 'Apagar tudo',
                    perigo: true,
                  })
                  if (!ok) return
                  limparTudo()
                  toast.sucesso('Dados apagados')
                }}
              >
                Apagar todos os dados
              </Button>
            </div>
          </div>
        </Card>
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
