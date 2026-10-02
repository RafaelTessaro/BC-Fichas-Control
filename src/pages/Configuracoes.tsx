import { format } from 'date-fns'
import {
  CircleCheck,
  Database,
  Download,
  Monitor,
  Moon,
  Palette,
  Receipt,
  RotateCcw,
  Save,
  Stamp,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
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
import { cnpjValido, mascaraCnpj, normalizarCnpj } from '#shared/documentos.ts'
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
  const { config, salvarConfig, clientes, eventos, maquinas, exportar, importar, carregarExemplo } = useDados()
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
  const [tentouSalvar, setTentouSalvar] = useState(false)
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

  // CNPJ do recibo: vazio pode (não aparece no recibo); preenchido, precisa ser válido
  const cnpj = normalizarCnpj(f.empresaCnpj)
  const cnpjOk = !!cnpj && cnpjValido(cnpj)
  const cnpjInvalido = !!cnpj && !cnpjOk
  const erroCnpj =
    cnpjInvalido && (tentouSalvar || cnpj.length >= 14)
      ? cnpj.length < 14
        ? 'CNPJ incompleto. Complete o número ou deixe em branco.'
        : 'CNPJ inválido. Confira o número digitado.'
      : null

  const salvar = async () => {
    if (cnpjInvalido) {
      setTentouSalvar(true)
      toast.erro('Confira o CNPJ do recibo', 'O número digitado não é um CNPJ válido. Corrija ou deixe em branco.')
      document.getElementById('cfg-cnpj')?.focus()
      return
    }
    setSalvando(true)
    try {
      // O servidor pode ajustar valores (ex.: espaços no fim do rodapé): o formulário passa a
      // mostrar exatamente o que foi gravado
      const salvo = await salvarConfig({ ...f, frotaMaquinas: Math.max(1, f.frotaMaquinas) })
      setBase(salvo)
      setF(salvo)
      setTentouSalvar(false)
      toast.sucesso('Configurações salvas', 'Os novos valores valem para os próximos eventos, em todos os computadores.')
    } catch (e) {
      avisarErro('Não foi possível salvar', e)
    } finally {
      setSalvando(false)
    }
  }

  const descartar = () => {
    setF(config)
    setTentouSalvar(false)
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
    // Backup de antes do cadastro de máquinas: as máquinas e O.S. atuais não voltam
    const semMaquinas = !Array.isArray((dados as { maquinas?: unknown } | null)?.maquinas)
    const aviso =
      semMaquinas && maquinas.length
        ? ` Atenção: este backup é de uma versão sem o cadastro de máquinas. ${maquinas.length === 1 ? 'A máquina' : `As ${qtd(maquinas.length, 'máquina', 'máquinas')}`} e as ordens de serviço atuais serão apagadas e precisarão ser cadastradas de novo.`
        : ''
    const ok = await confirmar({
      titulo: 'Restaurar backup?',
      descricao: `Os dados atuais (${qtd(clientes.length, 'cliente', 'clientes')}, ${qtd(eventos.length, 'evento', 'eventos')} e ${qtd(maquinas.length, 'máquina', 'máquinas')}) serão substituídos pelos do arquivo “${file.name}” em todos os computadores. Antes disso, o servidor guarda uma cópia automática.${aviso}`,
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
              <Button variante="ghost" icone={<RotateCcw className="h-4 w-4" />} onClick={descartar} disabled={salvando}>
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
              icone={<Stamp className="h-4 w-4" />}
              titulo="Dados do recibo"
              descricao="Aparecem no recibo de pagamento entregue ao cliente que pagou em PIX ou dinheiro. Salve com o botão “Salvar alterações”."
            />
            {/* Duas colunas só quando o cartão é largo (no notebook ele fica estreito, ao lado de outro) */}
            <div className="@container px-5 pb-5">
              <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
                <Field label="Nome fantasia" htmlFor="cfg-emp-nome" className="@sm:col-span-2" hint="Como a empresa é conhecida.">
                  <Input
                    id="cfg-emp-nome"
                    value={f.empresaNome}
                    onChange={(e) => setF({ ...f, empresaNome: e.target.value })}
                    placeholder="Ex.: Balanças.com"
                  />
                </Field>
                <Field
                  label="Razão social"
                  htmlFor="cfg-emp-razao"
                  className="@sm:col-span-2"
                  hint="Como consta no cartão do CNPJ."
                >
                  <Input
                    id="cfg-emp-razao"
                    value={f.empresaRazaoSocial}
                    onChange={(e) => setF({ ...f, empresaRazaoSocial: e.target.value })}
                    placeholder="Ex.: Empresa Exemplo LTDA"
                  />
                </Field>
                <Field
                  label="CNPJ"
                  htmlFor="cfg-cnpj"
                  erro={erroCnpj}
                  hint={
                    cnpjOk ? (
                      <span className="inline-flex items-center gap-1 font-medium text-success">
                        <CircleCheck className="h-3.5 w-3.5" />
                        CNPJ válido
                      </span>
                    ) : cnpj ? (
                      'Digite os 14 caracteres do CNPJ.'
                    ) : (
                      'Em branco, o recibo sai sem CNPJ.'
                    )
                  }
                >
                  <Input
                    id="cfg-cnpj"
                    // CNPJ alfanumérico tem letras: teclado completo, já em maiúsculas
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    value={f.empresaCnpj}
                    onChange={(e) => setF({ ...f, empresaCnpj: mascaraCnpj(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                    aria-invalid={!!erroCnpj}
                    className={cn('tnum', erroCnpj && 'border-danger! focus:ring-danger/20!')}
                  />
                </Field>
                <Field label="Cidade" htmlFor="cfg-emp-cidade" hint="Vai junto da data, no fim do recibo.">
                  <Input
                    id="cfg-emp-cidade"
                    value={f.empresaCidade}
                    onChange={(e) => setF({ ...f, empresaCidade: e.target.value })}
                    placeholder="Ex.: Rio Claro - SP"
                  />
                </Field>
              </div>
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
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
              {/* O servidor só carrega o exemplo com o sistema vazio (sem clientes, eventos nem máquinas) */}
              {clientes.length + eventos.length + maquinas.length === 0 && (
                <div className="flex flex-wrap gap-2 border-t border-line pt-4">
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
                </div>
              )}
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
      </div>

      <div className="mt-6">
        <GoogleAgendaConfig />
      </div>

      <ZonaDePerigo aoBaixarBackup={fazerBackup} />

      <p className="mt-6 text-center text-xs text-muted">
        BC Fichas Control • valores de fábrica: diária{' '}
        {CONFIG_PADRAO.valorDiariaPadrao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}, bobina{' '}
        {CONFIG_PADRAO.valorBobinaPadrao.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </p>

      {/* O botão Salvar fica lá no topo: com algo alterado, a barra acompanha a rolagem */}
      <AnimatePresence>
        {alterado && (
          <motion.div
            role="region"
            aria-label="Alterações não salvas"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-line-strong bg-surface/95 px-4 py-3 shadow-lg backdrop-blur-xl"
          >
            <p className="mr-auto flex items-center gap-2 text-sm font-medium text-ink">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning-dot" />
              Alterações não salvas
            </p>
            <div className="flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
              <Button
                variante="ghost"
                tamanho="sm"
                icone={<RotateCcw className="h-4 w-4" />}
                onClick={descartar}
                disabled={salvando}
              >
                Descartar
              </Button>
              <Button variante="primary" tamanho="sm" icone={<Save className="h-4 w-4" />} onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** "9 clientes, 12 eventos e 3 O.S." (só o que existe). */
function listarQuantidades(partes: Array<[number, string, string]>) {
  const itens = partes.filter(([n]) => n > 0).map(([n, um, varios]) => qtd(n, um, varios))
  return itens.length > 1 ? `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}` : (itens[0] ?? '')
}

/** Ações que não têm volta, separadas no fim da página para não serem clicadas por engano. */
function ZonaDePerigo({ aoBaixarBackup }: { aoBaixarBackup: () => void }) {
  const clientes = useDados((s) => s.clientes.length)
  const eventos = useDados((s) => s.eventos.length)
  const maquinas = useDados((s) => s.maquinas.length)
  const ordens = useDados((s) => s.ordens.length)
  const limparTudo = useDados((s) => s.limparTudo)
  const [apagando, setApagando] = useState(false)
  const resumo = listarQuantidades([
    [clientes, 'cliente', 'clientes'],
    [eventos, 'evento', 'eventos'],
    [maquinas, 'máquina', 'máquinas'],
    [ordens, 'ordem de serviço', 'ordens de serviço'],
  ])

  const apagar = async () => {
    const ok = await confirmar({
      titulo: 'Apagar todos os dados?',
      descricao: `Isto apaga ${resumo} do servidor e de todos os computadores. As configurações continuam. Antes de apagar, o servidor guarda uma cópia automática.`,
      confirmar: 'Apagar tudo',
      perigo: true,
      digitar: 'APAGAR',
    })
    if (!ok) return
    setApagando(true)
    try {
      await limparTudo()
      toast.sucesso('Dados apagados')
    } catch (e) {
      avisarErro('Não foi possível apagar', e)
    } finally {
      setApagando(false)
    }
  }

  return (
    <motion.section
      aria-labelledby="zona-perigo-titulo"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.1 }}
      className="mt-10 rounded-2xl border border-danger/40 bg-danger-soft shadow-xs"
    >
      <div className="flex items-start gap-3 px-5 pt-5 pb-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger text-surface">
          <TriangleAlert className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 id="zona-perigo-titulo" className="text-[15px] font-semibold tracking-[-0.01em] text-danger">
            Zona de perigo
          </h3>
          <p className="mt-0.5 text-[13px] text-ink-2">Ações que não têm volta. Baixe um backup antes de usar.</p>
        </div>
      </div>
      <div className="mx-5 mb-5 flex flex-col gap-4 rounded-xl border border-danger/30 bg-surface p-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Apagar todos os dados</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Apaga os clientes, eventos, máquinas e ordens de serviço do servidor, em todos os computadores. As configurações
            continuam. Antes de apagar, o servidor guarda uma cópia automática.
          </p>
          <p className="mt-1.5 text-xs text-muted">{resumo ? `Hoje: ${resumo}.` : 'Não há dados para apagar.'}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button icone={<Download className="h-4 w-4" />} onClick={aoBaixarBackup} disabled={!resumo}>
            Baixar backup antes
          </Button>
          <Button
            variante="danger"
            icone={<Trash2 className="h-4 w-4" />}
            onClick={apagar}
            disabled={!resumo || apagando}
            title={resumo ? undefined : 'Não há dados para apagar.'}
            // No escuro o vermelho é claro: texto escuro para dar leitura
            className="dark:text-bg"
          >
            {apagando ? 'Apagando…' : 'Apagar todos os dados'}
          </Button>
        </div>
      </div>
    </motion.section>
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
