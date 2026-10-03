import { format } from 'date-fns'
import {
  Ban,
  CalendarX2,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSignature,
  KeyRound,
  LoaderCircle,
  Mail,
  MapPin,
  MessageCircle,
  Monitor,
  Moon,
  PackageOpen,
  PackageX,
  Palette,
  Percent,
  Receipt,
  RotateCcw,
  Save,
  Scale,
  Send,
  ShieldCheck,
  Stamp,
  Sun,
  Trash2,
  TriangleAlert,
  Type,
  Upload,
  Wrench,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { DisponibilidadeMaquinas } from '../components/DisponibilidadeMaquinas'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { confirmar } from '../components/ui/Feedback'
import { CurrencyInput, Field, Input, Select, Textarea } from '../components/ui/Form'
import { PageHeader } from '../components/ui/Misc'
import { cn } from '../lib/cn'
import { numero } from '../lib/format'
import { baixarArquivo } from '../lib/storage'
import { cnpjValido, cpfValido, mascaraCnpj, mascaraCpf, normalizarCnpj, somenteDigitos } from '#shared/documentos.ts'
import { emailValido } from '#shared/dominio.ts'
import type { Configuracoes as Config } from '#shared/tipos.ts'
import { CONFIG_PADRAO, useDados } from '../store/dados'
import { avisarErro, toast, useUI, type Tema } from '../store/ui'
import { api, type ConfigEmail, type ConfigEmailEntrada } from '../lib/api'
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

  // Vindo do envio do recibo ("Configurar e-mail") ou do contrato (dados da empresa que faltam):
  // rola até o cartão
  const [params] = useSearchParams()
  const secao = params.get('secao')
  useEffect(() => {
    if (secao !== 'email' && secao !== 'contrato') return
    const t = setTimeout(() => document.getElementById(secao)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150)
    return () => clearTimeout(t)
  }, [secao])

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

  // CPF de quem assina o contrato pela empresa: a mesma regra do servidor (vazio pode; preenchido, válido)
  const cpfRep = somenteDigitos(f.empresaRepresentanteCpf)
  const cpfRepOk = cpfValido(cpfRep)
  const cpfRepInvalido = !!cpfRep && !cpfRepOk
  const erroCpfRep =
    cpfRepInvalido && (tentouSalvar || cpfRep.length >= 11)
      ? cpfRep.length < 11
        ? 'CPF incompleto. Complete o número ou deixe em branco.'
        : 'CPF inválido. Confira o número digitado.'
      : null

  // E-mail que sai no contrato (contato do cliente com a empresa): vazio pode; preenchido, válido
  const emailEmpresa = f.empresaEmail.trim()
  const emailEmpresaInvalido = !!emailEmpresa && !emailValido(emailEmpresa)
  const [saiuDoEmail, setSaiuDoEmail] = useState(false)
  const erroEmailEmpresa =
    emailEmpresaInvalido && (tentouSalvar || saiuDoEmail) ? 'E-mail inválido. Confira o endereço ou deixe em branco.' : null

  const salvar = async () => {
    if (cnpjInvalido) {
      setTentouSalvar(true)
      toast.erro('Confira o CNPJ do recibo', 'O número digitado não é um CNPJ válido. Corrija ou deixe em branco.')
      document.getElementById('cfg-cnpj')?.focus()
      return
    }
    if (cpfRepInvalido) {
      setTentouSalvar(true)
      toast.erro(
        'Confira o CPF de quem assina pela empresa',
        'O número digitado não é um CPF válido. Corrija ou deixe em branco (o contrato sai com a linha para preencher à mão).',
      )
      document.getElementById('cfg-rep-cpf')?.focus()
      return
    }
    if (emailEmpresaInvalido) {
      setTentouSalvar(true)
      toast.erro('Confira o e-mail do contrato', 'O endereço digitado não é um e-mail válido. Corrija ou deixe em branco.')
      document.getElementById('cfg-emp-email')?.focus()
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
    setSaiuDoEmail(false)
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
    // Backup de antes do cadastro de máquinas: as máquinas e manutenções atuais não voltam
    const semMaquinas = !Array.isArray((dados as { maquinas?: unknown } | null)?.maquinas)
    const aviso =
      semMaquinas && maquinas.length
        ? ` Atenção: este backup é de uma versão sem o cadastro de máquinas. ${maquinas.length === 1 ? 'A máquina' : `As ${qtd(maquinas.length, 'máquina', 'máquinas')}`} e as manutenções atuais serão apagadas e precisarão ser cadastradas de novo.`
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
        descricao="Máquinas, valores padrão, recibo, contrato de locação, e-mail, aparência e backup dos dados."
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
        <ContratoConfig
          id="contrato"
          f={f}
          set={(k, v) => setF((x) => ({ ...x, [k]: v }))}
          cpfOk={cpfRepOk}
          erroCpf={erroCpfRep}
          erroEmail={erroEmailEmpresa}
          aoSairDoEmail={() => setSaiuDoEmail(true)}
        />
      </div>

      <div className="mt-6">
        <EmailConfig id="email" />
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

// ---- Contrato de locação ------------------------------------------------------------

/**
 * Resumo das regras escolhidas pelo dono para o contrato (o texto das cláusulas fica em
 * shared/contrato.ts). Só para leitura: não mudam por aqui.
 */
const REGRAS_CONTRATO: Array<{ icone: ReactNode; titulo: string; texto: ReactNode }> = [
  {
    icone: <CalendarX2 className="h-4 w-4" />,
    titulo: 'Cancelamento',
    texto: 'Grátis até 7 dias antes do 1º dia. Depois, até 10% das diárias; se não vier retirar, até 20%.',
  },
  {
    icone: <MessageCircle className="h-4 w-4" />,
    titulo: 'Arrependimento',
    texto: '7 dias para desistir, com devolução total, quando fechado por WhatsApp ou telefone.',
  },
  {
    icone: <Wrench className="h-4 w-4" />,
    titulo: 'Danos por mau uso',
    texto: 'O cliente paga o conserto, com orçamento apresentado antes.',
  },
  {
    icone: <PackageX className="h-4 w-4" />,
    titulo: 'Perda ou furto por descuido',
    texto: 'O cliente paga o valor de reposição da máquina.',
  },
  {
    icone: <ShieldCheck className="h-4 w-4" />,
    titulo: 'Roubo e desgaste',
    texto: 'Roubo com boletim de ocorrência e desgaste natural não são cobrados.',
  },
  { icone: <Ban className="h-4 w-4" />, titulo: 'Caução', texto: 'Não é cobrada.' },
  {
    icone: <PackageOpen className="h-4 w-4" />,
    titulo: 'Bobinas',
    texto: 'As lacradas voltam sem custo; as abertas são cobradas como usadas.',
  },
  {
    icone: <Percent className="h-4 w-4" />,
    titulo: 'Atraso no pagamento',
    texto: 'Multa de 2% + juros (e correção pelo IPCA).',
  },
  { icone: <Clock className="h-4 w-4" />, titulo: 'Atraso na devolução', texto: 'Não é cobrado.' },
  { icone: <MapPin className="h-4 w-4" />, titulo: 'Retirada e devolução', texto: 'Sempre na empresa.' },
  {
    icone: <Type className="h-4 w-4" />,
    titulo: 'Texto',
    texto:
      'Letra corpo 12 e cláusulas importantes em negrito. Sem testemunhas; vale assinatura no papel ou eletrônica (gov.br ou plataforma).',
  },
]

/** Título de um grupo de campos dentro do cartão. */
function Grupo({ children }: { children: ReactNode }) {
  return (
    <p className="pt-2 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase first:pt-0 @sm:col-span-2">{children}</p>
  )
}

/**
 * Dados da empresa e valores que saem no contrato de locação. Os campos são das configurações
 * gerais: salvam com o mesmo botão “Salvar alterações” da página.
 */
function ContratoConfig({
  id,
  f,
  set,
  cpfOk,
  erroCpf,
  erroEmail,
  aoSairDoEmail,
}: {
  id: string
  f: Config
  set: <K extends keyof Config>(k: K, v: Config[K]) => void
  cpfOk: boolean
  erroCpf: string | null
  erroEmail: string | null
  aoSairDoEmail: () => void
}) {
  const cidade = f.empresaCidade.trim()
  const dicaReposicao = (valor: number, tipo: string) =>
    valor > 0
      ? `Cobrado se a máquina ${tipo} for perdida, furtada por descuido ou ficar sem conserto.`
      : 'Em R$ 0,00, o contrato diz “valor de mercado, por orçamento”.'

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icone={<FileSignature className="h-4 w-4" />}
        titulo="Contrato de locação"
        descricao="Dados da empresa e valores que saem em todos os contratos. Cada contrato guarda os dados do dia em que foi gerado. Salve com o botão “Salvar alterações”."
      />
      <div className="@container px-5 pb-5">
        <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="@container">
            <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
              <Grupo>Empresa no contrato</Grupo>
              <Field
                label="Endereço da empresa"
                htmlFor="cfg-emp-end"
                className="@sm:col-span-2"
                hint="A sede da empresa: é onde as máquinas são retiradas e devolvidas."
              >
                <Input
                  id="cfg-emp-end"
                  value={f.empresaEndereco}
                  onChange={(e) => set('empresaEndereco', e.target.value)}
                  placeholder="Ex.: Rua 13, nº 650, Bairro da Boa Morte, Rio Claro - SP"
                />
              </Field>
              <Field label="Telefone" htmlFor="cfg-emp-tel" hint="Para o suporte durante o evento.">
                <Input
                  id="cfg-emp-tel"
                  type="tel"
                  inputMode="tel"
                  value={f.empresaTelefone}
                  onChange={(e) => set('empresaTelefone', e.target.value)}
                  placeholder="Ex.: (19) 3023-9050"
                  className="tnum"
                />
              </Field>
              <Field label="E-mail de contato" htmlFor="cfg-emp-email" erro={erroEmail} hint="Para avisos e pedidos do cliente.">
                <Input
                  id="cfg-emp-email"
                  type="email"
                  value={f.empresaEmail}
                  onChange={(e) => set('empresaEmail', e.target.value)}
                  onBlur={aoSairDoEmail}
                  placeholder="Ex.: contato@empresa.com.br"
                  spellCheck={false}
                  aria-invalid={!!erroEmail}
                  className={cn(erroEmail && 'border-danger! focus:ring-danger/20!')}
                />
              </Field>

              <Grupo>Quem assina pela empresa</Grupo>
              <Field
                label="Nome"
                htmlFor="cfg-rep-nome"
                hint={f.empresaRepresentante.trim() ? undefined : 'Em branco, o contrato sai com a linha para preencher à mão.'}
              >
                <Input
                  id="cfg-rep-nome"
                  value={f.empresaRepresentante}
                  onChange={(e) => set('empresaRepresentante', e.target.value)}
                  placeholder="Ex.: Maria da Silva"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="CPF"
                htmlFor="cfg-rep-cpf"
                erro={erroCpf}
                hint={
                  cpfOk ? (
                    <span className="inline-flex items-center gap-1 font-medium text-success">
                      <CircleCheck className="h-3.5 w-3.5" />
                      CPF válido
                    </span>
                  ) : (
                    'Opcional. Sai no contrato junto do nome.'
                  )
                }
              >
                <Input
                  id="cfg-rep-cpf"
                  inputMode="numeric"
                  autoComplete="off"
                  value={f.empresaRepresentanteCpf}
                  onChange={(e) => set('empresaRepresentanteCpf', mascaraCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  aria-invalid={!!erroCpf}
                  className={cn('tnum', erroCpf && 'border-danger! focus:ring-danger/20!')}
                />
              </Field>

              <Grupo>Valores e foro</Grupo>
              <Field label="Reposição da máquina P" htmlFor="cfg-rep-p" hint={dicaReposicao(f.valorReposicaoP, 'P')}>
                <CurrencyInput id="cfg-rep-p" valor={f.valorReposicaoP} aoMudar={(v) => set('valorReposicaoP', v)} />
              </Field>
              <Field label="Reposição da máquina G" htmlFor="cfg-rep-g" hint={dicaReposicao(f.valorReposicaoG, 'G')}>
                <CurrencyInput id="cfg-rep-g" valor={f.valorReposicaoG} aoMudar={(v) => set('valorReposicaoG', v)} />
              </Field>
              <Field
                label="Foro (comarca)"
                htmlFor="cfg-foro"
                className="@sm:col-span-2"
                hint={
                  f.contratoForo.trim()
                    ? 'O cliente consumidor ainda pode entrar na Justiça na cidade dele (o contrato avisa).'
                    : cidade
                      ? `Em branco, vale a cidade da empresa: ${cidade}.`
                      : 'Em branco, vale a cidade da empresa (em “Dados do recibo”).'
                }
              >
                <Input
                  id="cfg-foro"
                  value={f.contratoForo}
                  onChange={(e) => set('contratoForo', e.target.value)}
                  placeholder={cidade ? `Ex.: ${cidade}` : 'Ex.: Rio Claro - SP'}
                />
              </Field>

              <Grupo>Condições a mais</Grupo>
              <Field
                label="Condições que saem em todos os contratos"
                htmlFor="cfg-condicoes"
                className="@sm:col-span-2"
                hint="Opcional. Uma por linha: entram nas disposições gerais do contrato. Para valer num contrato só, escreva ao gerar o contrato."
              >
                <Textarea
                  id="cfg-condicoes"
                  rows={3}
                  value={f.contratoCondicoes}
                  onChange={(e) => set('contratoCondicoes', e.target.value)}
                  placeholder="Ex.: As máquinas são entregues com um rolo de bobina de teste, sem custo."
                />
              </Field>
            </div>
          </div>

          {/* As regras escolhidas pelo dono, já escritas nas cláusulas (só leitura) */}
          <section aria-labelledby="regras-contrato" className="rounded-xl border border-line bg-surface-2/60 px-4 pt-3.5 pb-4">
            <div className="flex items-start gap-2.5">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" />
              <h4 id="regras-contrato" className="text-[13px] font-semibold text-ink">
                Regras do contrato <span className="font-normal text-muted">(conforme o Código de Defesa do Consumidor)</span>
              </h4>
            </div>
            <dl className="mt-3 flex flex-col gap-2.5">
              {REGRAS_CONTRATO.map((r) => (
                <div key={r.titulo} className="flex items-start gap-2.5 text-[13px] leading-snug">
                  <span aria-hidden className="mt-px shrink-0 text-muted">
                    {r.icone}
                  </span>
                  <div className="min-w-0">
                    <dt className="inline font-medium text-ink">{r.titulo}: </dt>
                    <dd className="inline text-ink-2">{r.texto}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <p className="mt-3.5 border-t border-line pt-3 text-xs text-muted">
              Estas regras já estão escritas nas cláusulas e valem para todos os contratos. Para acrescentar alguma combinação,
              use as condições a mais.
            </p>
          </section>
        </div>
      </div>
    </Card>
  )
}

/** "9 clientes, 12 eventos e 3 manutenções" (só o que existe). */
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
  const reclamacoes = useDados((s) => s.reclamacoes.length)
  const limparTudo = useDados((s) => s.limparTudo)
  const [apagando, setApagando] = useState(false)
  const resumo = listarQuantidades([
    [clientes, 'cliente', 'clientes'],
    [eventos, 'evento', 'eventos'],
    [maquinas, 'máquina', 'máquinas'],
    [ordens, 'manutenção', 'manutenções'],
    [reclamacoes, 'reclamação', 'reclamações'],
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
            Apaga os clientes, eventos, máquinas, manutenções, reclamações e arquivos anexados do servidor, em todos os
            computadores. As configurações continuam. Antes de apagar, o servidor guarda uma cópia automática.
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

// ---- E-mail para envio de recibos --------------------------------------------------

type Seguranca = ConfigEmail['seguranca']

/** Modelos prontos dos provedores mais comuns (servidor, porta e segurança). */
const MODELOS_EMAIL = [
  {
    id: 'gmail',
    label: 'Gmail',
    servidor: 'smtp.gmail.com',
    porta: 465,
    seguranca: 'SSL',
    dica: (
      <>
        No Gmail, a senha normal da conta não funciona aqui: use uma <b className="font-semibold text-ink">senha de app</b>. Ative
        a verificação em duas etapas na sua Conta do Google e crie a senha de app em{' '}
        <b className="font-medium text-ink">myaccount.google.com/apppasswords</b> (são 16 letras). Cole no campo Senha.
      </>
    ),
  },
  {
    id: 'outlook',
    label: 'Outlook / Hotmail',
    servidor: 'smtp-mail.outlook.com',
    porta: 587,
    seguranca: 'STARTTLS',
    dica: (
      <>
        No Outlook e no Hotmail, use uma <b className="font-semibold text-ink">senha de app</b>: ative a verificação em duas
        etapas em <b className="font-medium text-ink">account.microsoft.com</b> → Segurança e crie a senha de app nas opções
        avançadas. Se o teste falhar mesmo assim, a conta pode não permitir envio por programas: use uma conta do Gmail.
      </>
    ),
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    servidor: 'smtp.mail.yahoo.com',
    porta: 465,
    seguranca: 'SSL',
    dica: (
      <>
        No Yahoo, gere uma <b className="font-semibold text-ink">senha de app</b> em Segurança da conta → Gerar senha de app, e
        cole no campo Senha.
      </>
    ),
  },
  {
    id: 'outro',
    label: 'Outro',
    servidor: '',
    porta: 587,
    seguranca: 'STARTTLS',
    dica: (
      <>
        Use os dados de envio (SMTP) do seu provedor de e-mail. Eles costumam estar na página de ajuda do provedor, ou com quem
        cuida do e-mail da empresa.
      </>
    ),
  },
] as const satisfies ReadonlyArray<{
  id: string
  label: string
  servidor: string
  porta: number
  seguranca: Seguranca
  dica: ReactNode
}>

type ModeloEmail = (typeof MODELOS_EMAIL)[number]['id']

/** Porta padrão de cada segurança (a de "Nenhuma" é a mesma do STARTTLS). */
const PORTA_PADRAO: Record<Seguranca, string> = { SSL: '465', STARTTLS: '587', NENHUMA: '587' }

const SEGURANCAS: Array<{ valor: Seguranca; label: string }> = [
  { valor: 'SSL', label: 'SSL (porta 465)' },
  { valor: 'STARTTLS', label: 'STARTTLS (porta 587)' },
  { valor: 'NENHUMA', label: 'Nenhuma (não recomendado)' },
]

/** Campos do formulário (a senha fica em branco: só vai se o usuário digitar uma nova). */
type FormEmail = Omit<ConfigEmailEntrada, 'porta'> & { porta: string }

const formDoServidor = (c: ConfigEmail | null): FormEmail => ({
  servidor: c?.servidor ?? '',
  porta: c?.servidor ? String(c.porta) : '',
  seguranca: c?.seguranca ?? 'STARTTLS',
  usuario: c?.usuario ?? '',
  senha: '',
  remetenteNome: c?.remetenteNome ?? '',
  remetenteEmail: c?.remetenteEmail ?? '',
})

const modeloDe = (servidor: string): ModeloEmail | null =>
  MODELOS_EMAIL.find((m) => m.servidor && m.servidor === servidor.trim().toLowerCase())?.id ?? (servidor.trim() ? 'outro' : null)

/**
 * Configuração do e-mail que envia o recibo e o resumo para o cliente. Fica só no servidor (a
 * senha nunca volta para a tela) e tem o próprio botão de salvar, separado do resto da página.
 */
function EmailConfig({ id }: { id: string }) {
  const nomeEmpresa = useDados((s) => s.config.empresaNome)
  const [carregado, setCarregado] = useState<ConfigEmail | null>(null)
  const [erroCarga, setErroCarga] = useState('')
  const [f, setF] = useState<FormEmail>(formDoServidor(null))
  const [modelo, setModelo] = useState<ModeloEmail | null>(null)
  const [verSenha, setVerSenha] = useState(false)
  const [ocupado, setOcupado] = useState<'salvar' | 'teste' | 'esquecer' | null>(null)
  const [paraTeste, setParaTeste] = useState('')
  const [resultadoTeste, setResultadoTeste] = useState<{ ok: boolean; texto: string } | null>(null)
  const [recarga, setRecarga] = useState(0)

  useEffect(() => {
    let ativo = true
    api
      .configEmail()
      .then((c) => {
        if (!ativo) return
        setCarregado(c)
        setErroCarga('')
        setF(formDoServidor(c))
        setModelo(modeloDe(c.servidor))
        setParaTeste(c.remetenteEmail || c.usuario)
      })
      .catch((e: Error) => ativo && setErroCarga(e.message))
    return () => {
      ativo = false
    }
  }, [recarga])

  const set = <K extends keyof FormEmail>(k: K, v: FormEmail[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    setResultadoTeste(null)
  }

  // Trocou a segurança: a porta acompanha, a não ser que tenha sido digitada uma diferente
  const mudarSeguranca = (seguranca: Seguranca) => {
    setF((x) => {
      const padrao = !x.porta || Object.values(PORTA_PADRAO).includes(x.porta)
      return { ...x, seguranca, porta: padrao ? PORTA_PADRAO[seguranca] : x.porta }
    })
    setResultadoTeste(null)
  }

  const escolherModelo = (m: (typeof MODELOS_EMAIL)[number]) => {
    setModelo(m.id)
    setResultadoTeste(null)
    if (m.id === 'outro') {
      // Sai de um modelo pronto: o servidor fica para digitar
      if (modeloDe(f.servidor) !== 'outro') setF((x) => ({ ...x, servidor: '', porta: String(m.porta), seguranca: m.seguranca }))
      setTimeout(() => document.getElementById('cfg-smtp')?.focus(), 50)
      return
    }
    setF((x) => ({ ...x, servidor: m.servidor, porta: String(m.porta), seguranca: m.seguranca }))
  }

  const base = formDoServidor(carregado)
  const alterado = JSON.stringify({ ...f, senha: '' }) !== JSON.stringify(base) || !!f.senha
  const faltaSenha = !f.senha && !carregado?.senhaDefinida
  const completo = !!f.servidor.trim() && !!f.usuario.trim() && !faltaSenha
  const usuarioEhEmail = emailValido(f.usuario.trim())

  const salvar = async () => {
    setOcupado('salvar')
    try {
      const porta = Number(f.porta)
      const salvo = await api.salvarConfigEmail({
        ...f,
        porta: Number.isInteger(porta) && porta > 0 ? porta : f.seguranca === 'SSL' ? 465 : 587,
      })
      setCarregado(salvo)
      setF(formDoServidor(salvo))
      setVerSenha(false)
      setParaTeste((p) => p || salvo.remetenteEmail || salvo.usuario)
      toast.sucesso('E-mail configurado', 'Envie um e-mail de teste para conferir se está tudo certo.')
    } catch (e) {
      avisarErro('Não foi possível salvar o e-mail', e)
    } finally {
      setOcupado(null)
    }
  }

  const testar = async () => {
    const destino = paraTeste.trim()
    if (!emailValido(destino)) {
      setResultadoTeste({ ok: false, texto: 'Informe um e-mail válido para receber o teste.' })
      document.getElementById('cfg-email-teste')?.focus()
      return
    }
    setOcupado('teste')
    setResultadoTeste(null)
    try {
      await api.testarEmail(destino)
      setResultadoTeste({
        ok: true,
        texto: `E-mail de teste enviado para ${destino}. Confira a caixa de entrada (e a pasta de spam).`,
      })
    } catch (e) {
      setResultadoTeste({ ok: false, texto: (e as Error).message })
    } finally {
      setOcupado(null)
    }
  }

  const esquecer = async () => {
    const ok = await confirmar({
      titulo: 'Esquecer a configuração do e-mail?',
      descricao:
        'O servidor apaga o e-mail e a senha gravados. O envio de recibos por e-mail para de funcionar até ser configurado de novo (o WhatsApp continua funcionando).',
      confirmar: 'Esquecer configuração',
      perigo: true,
    })
    if (!ok) return
    setOcupado('esquecer')
    try {
      await api.esquecerConfigEmail()
      setCarregado(null)
      setF(formDoServidor(null))
      setModelo(null)
      setResultadoTeste(null)
      setRecarga((n) => n + 1)
      toast.sucesso('Configuração do e-mail apagada')
    } catch (e) {
      avisarErro('Não foi possível apagar a configuração', e)
    } finally {
      setOcupado(null)
    }
  }

  const dica = MODELOS_EMAIL.find((m) => m.id === modelo)?.dica

  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader
        icone={<Mail className="h-4 w-4" />}
        titulo="E-mail para envio de recibos"
        descricao="O e-mail da empresa que envia o recibo e o resumo do evento ao cliente. Fica só no servidor e vale para todos os computadores; tem o próprio botão de salvar."
        acoes={
          carregado &&
          (carregado.configurado ? <Badge tom="success">Configurado</Badge> : <Badge tom="neutral">Não configurado</Badge>)
        }
      />
      {!carregado && !erroCarga && recarga === 0 ? (
        <p className="flex items-center gap-2 px-5 pb-5 text-[13px] text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Carregando…
        </p>
      ) : erroCarga ? (
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5 text-[13px] text-danger">
          <CircleAlert className="h-4 w-4" />
          {erroCarga}
          <Button tamanho="sm" variante="ghost" onClick={() => setRecarga((n) => n + 1)}>
            Tentar de novo
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-5 pb-5">
          {/* Modelo pronto do provedor */}
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-medium text-ink-2">Qual é o e-mail da empresa?</p>
            <div role="radiogroup" aria-label="Provedor de e-mail" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MODELOS_EMAIL.map((m) => {
                const ativo = modelo === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => escolherModelo(m)}
                    className={cn(
                      'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-colors',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      ativo
                        ? 'border-brand/60 bg-brand-soft text-brand-ink'
                        : 'border-line-strong/80 text-ink-2 hover:bg-surface-2',
                    )}
                  >
                    {ativo && <Check className="h-4 w-4 shrink-0" />}
                    {m.label}
                  </button>
                )
              })}
            </div>
            <AnimatePresence initial={false} mode="wait">
              {dica && (
                <motion.p
                  key={modelo}
                  initial={{ opacity: 0, y: -2 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-start gap-2.5 rounded-xl bg-info-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink-2"
                >
                  <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <span>{dica}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="@container">
            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-6">
              <Field label="Servidor de envio (SMTP)" htmlFor="cfg-smtp" className="@xl:col-span-3">
                <Input
                  id="cfg-smtp"
                  value={f.servidor}
                  onChange={(e) => {
                    set('servidor', e.target.value)
                    setModelo(modeloDe(e.target.value) ?? 'outro')
                  }}
                  placeholder="Ex.: smtp.gmail.com"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Porta" htmlFor="cfg-porta" className="@xl:col-span-1">
                <Input
                  id="cfg-porta"
                  inputMode="numeric"
                  value={f.porta}
                  onChange={(e) => set('porta', e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder={f.seguranca === 'SSL' ? '465' : '587'}
                  className="tnum"
                />
              </Field>
              <Field label="Segurança" htmlFor="cfg-seguranca" className="@xl:col-span-2">
                <Select id="cfg-seguranca" value={f.seguranca} onChange={(e) => mudarSeguranca(e.target.value as Seguranca)}>
                  {SEGURANCAS.map((s) => (
                    <option key={s.valor} value={s.valor}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Usuário"
                htmlFor="cfg-usuario"
                className="@xl:col-span-3"
                hint="Normalmente é o próprio endereço de e-mail."
              >
                <Input
                  id="cfg-usuario"
                  type="email"
                  value={f.usuario}
                  onChange={(e) => set('usuario', e.target.value)}
                  placeholder="Ex.: contato@gmail.com"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field
                label="Senha"
                htmlFor="cfg-senha"
                className="@xl:col-span-3"
                hint={
                  carregado?.senhaDefinida
                    ? 'Já tem uma senha gravada. Deixe em branco para manter; digite só para trocar.'
                    : 'No Gmail, Outlook e Yahoo, use a senha de app (veja a dica acima).'
                }
              >
                <div className="relative">
                  <Input
                    id="cfg-senha"
                    type={verSenha ? 'text' : 'password'}
                    value={f.senha}
                    onChange={(e) => set('senha', e.target.value)}
                    placeholder={carregado?.senhaDefinida ? '•••••••• (gravada no servidor)' : 'Senha de app'}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setVerSenha((v) => !v)}
                    aria-label={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                    title={verSenha ? 'Esconder a senha' : 'Mostrar a senha'}
                    className="absolute top-1/2 right-1.5 flex h-7 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>
              <Field
                label="Nome do remetente"
                htmlFor="cfg-remetente-nome"
                className="@xl:col-span-3"
                hint="Como aparece para o cliente na caixa de entrada."
              >
                <Input
                  id="cfg-remetente-nome"
                  value={f.remetenteNome}
                  onChange={(e) => set('remetenteNome', e.target.value)}
                  placeholder={nomeEmpresa ? `Ex.: ${nomeEmpresa}` : 'Ex.: Nome da empresa'}
                />
              </Field>
              <Field
                label="E-mail do remetente"
                htmlFor="cfg-remetente-email"
                className="@xl:col-span-3"
                hint={usuarioEhEmail ? 'Em branco, usa o usuário.' : 'O e-mail que aparece como remetente.'}
              >
                <Input
                  id="cfg-remetente-email"
                  type="email"
                  value={f.remetenteEmail}
                  onChange={(e) => set('remetenteEmail', e.target.value)}
                  placeholder={usuarioEhEmail ? f.usuario.trim() : 'Ex.: contato@empresa.com.br'}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-line pt-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                variante="primary"
                icone={ocupado === 'salvar' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                onClick={() => void salvar()}
                disabled={!alterado || !completo || !!ocupado}
                title={!completo ? 'Preencha o servidor, o usuário e a senha.' : undefined}
              >
                {ocupado === 'salvar' ? 'Salvando…' : 'Salvar e-mail'}
              </Button>
              {alterado && carregado?.servidor && (
                <Button
                  variante="ghost"
                  icone={<RotateCcw className="h-4 w-4" />}
                  onClick={() => {
                    setF(formDoServidor(carregado))
                    setModelo(modeloDe(carregado.servidor))
                    setResultadoTeste(null)
                  }}
                  disabled={!!ocupado}
                >
                  Descartar
                </Button>
              )}
              {carregado?.servidor && (
                <Button
                  variante="ghost"
                  icone={<Trash2 className="h-4 w-4" />}
                  onClick={() => void esquecer()}
                  disabled={!!ocupado}
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                >
                  Esquecer configuração
                </Button>
              )}
            </div>

            {/* Teste: só com a configuração gravada (o teste usa a do servidor) */}
            {carregado?.configurado && (
              <div className="flex min-w-0 flex-col gap-1.5 lg:w-[420px]">
                <label htmlFor="cfg-email-teste" className="text-[13px] font-medium text-ink-2">
                  Enviar e-mail de teste para
                </label>
                <div className="flex gap-2">
                  <Input
                    id="cfg-email-teste"
                    type="email"
                    value={paraTeste}
                    onChange={(e) => {
                      setParaTeste(e.target.value)
                      setResultadoTeste(null)
                    }}
                    placeholder="voce@email.com"
                    className="min-w-0"
                  />
                  <Button
                    icone={ocupado === 'teste' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    onClick={() => void testar()}
                    disabled={!!ocupado || alterado}
                    title={alterado ? 'Salve as alterações antes de testar.' : undefined}
                  >
                    {ocupado === 'teste' ? 'Enviando…' : 'Testar'}
                  </Button>
                </div>
                {alterado && <p className="text-xs text-muted">Salve as alterações antes de testar.</p>}
              </div>
            )}
          </div>

          <AnimatePresence initial={false}>
            {resultadoTeste && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.18 }}
                className="-mt-2 overflow-hidden"
              >
                <span
                  className={cn(
                    'flex items-start gap-2 rounded-xl px-3.5 py-3 text-[13px]',
                    resultadoTeste.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
                  )}
                >
                  {resultadoTeste.ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  {resultadoTeste.texto}
                </span>
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  )
}
