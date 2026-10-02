// Cadastro e edição de uma máquina (P ou G).

import { CircleAlert, Cpu } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAQUINA_VAZIA, normalizarMaquina } from '#shared/dominio.ts'
import {
  chaveIdentificacao,
  ESTADO_MAQUINA,
  identificacaoPadrao,
  numeroDaIdentificacao,
  proximasIdentificacoes,
  STATUS_MAQUINA_LISTA,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
} from '#shared/maquinas.ts'
import type { Maquina, MaquinaInput, StatusMaquina, TipoMaquina } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
import { cn } from '../lib/cn'
import { hojeISO } from '../lib/format'
import { locacoesDeHojeEmDiante, perguntaSituacao } from '../lib/manutencao'
import { useDados } from '../store/dados'
import { avisarErro, toast } from '../store/ui'
import { Button } from './ui/Button'
import { confirmar } from './ui/Feedback'
import { Field, Input, Textarea } from './ui/Form'
import { Segmented } from './ui/Misc'
import { Modal } from './ui/Modal'

export function MaquinaFormModal({
  aberto,
  aoFechar,
  maquina,
  tipoInicial,
  aoSalvar,
}: {
  aberto: boolean
  aoFechar: () => void
  /** Máquina a editar; sem ela, cadastra uma nova. */
  maquina?: Maquina
  tipoInicial?: TipoMaquina
  aoSalvar?: (m: Maquina) => void
}) {
  const [salvando, setSalvando] = useState(false)
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      largura="max-w-xl"
      icone={<Cpu className="h-5 w-5" />}
      titulo={maquina ? `Editar máquina ${maquina.identificacao}` : 'Nova máquina'}
      descricao={
        maquina
          ? 'Identificação, situação e dados de cadastro.'
          : 'A letra (P ou G) vem do tipo: digite só o número escrito na máquina. Os outros campos são opcionais.'
      }
      rodape={
        <>
          <Button onClick={aoFechar}>Cancelar</Button>
          <Button variante="primary" type="submit" form="form-maquina" disabled={salvando}>
            {salvando ? 'Salvando…' : maquina ? 'Salvar alterações' : 'Cadastrar máquina'}
          </Button>
        </>
      }
    >
      {/* O formulário só existe com o modal aberto, então sempre começa com os dados atuais */}
      <FormularioMaquina
        key={maquina?.id ?? 'nova'}
        maquina={maquina}
        tipoInicial={tipoInicial}
        aoSalvar={aoSalvar}
        aoFechar={aoFechar}
        setSalvando={setSalvando}
      />
    </Modal>
  )
}

/** O número da máquina tem até 4 algarismos (P-07, G-150). */
const MAX_ALGARISMOS = 4
const soAlgarismos = (s: string) => s.replace(/\D/g, '').slice(0, MAX_ALGARISMOS)

/** Número que o campo mostra para uma identificação no padrão do tipo ("P-07" → "07"); `null` fora do padrão. */
function numeroDoCampo(identificacao: string, tipo: TipoMaquina) {
  const n = numeroDaIdentificacao(identificacao, tipo)
  return n === null ? null : String(n).padStart(2, '0')
}

/**
 * Na edição: o número da identificação atual. Fora do padrão ("Máquina 3"), os algarismos dela,
 * se o número resultante estiver livre; senão, vazio (a dica mostra como ela está hoje).
 */
function numeroInicial(m: Maquina, outras: Maquina[]) {
  const n = numeroDoCampo(m.identificacao, m.tipo)
  if (n !== null && n.length <= MAX_ALGARISMOS) return n
  // Só aproveita quando há um único número no nome ("Máquina 7"); "Lote 2 - 15" fica em branco
  const grupos = m.identificacao.match(/\d+/g) ?? []
  const algarismos = grupos.length === 1 ? grupos[0] : ''
  if (!algarismos || algarismos.length > MAX_ALGARISMOS || !Number(algarismos)) return ''
  const chave = chaveIdentificacao(identificacaoPadrao(m.tipo, Number(algarismos)))
  return outras.some((o) => chaveIdentificacao(o.identificacao) === chave) ? '' : algarismos.padStart(2, '0')
}

/** Botão com cara de link, usado nas dicas do campo. */
function LinkDica({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="cursor-pointer font-medium text-brand-ink underline underline-offset-2">
      {children}
    </button>
  )
}

function FormularioMaquina({
  maquina,
  tipoInicial,
  aoSalvar,
  aoFechar,
  setSalvando,
}: {
  maquina?: Maquina
  tipoInicial?: TipoMaquina
  aoSalvar?: (m: Maquina) => void
  aoFechar: () => void
  setSalvando: (v: boolean) => void
}) {
  const maquinas = useDados((s) => s.maquinas)
  const salvarMaquina = useDados((s) => s.salvarMaquina)
  const navegar = useNavigate()
  // As outras máquinas (na edição, a própria não conta para sugerir nem para repetir)
  const outras = maquinas.filter((m) => m.id !== maquina?.id)
  const sugestao = (tipo: TipoMaquina) => proximasIdentificacoes(outras, tipo, 1)[0]
  /** Próximo número livre do tipo, como o campo mostra ("08"). */
  const numeroSugerido = (tipo: TipoMaquina) => numeroDoCampo(sugestao(tipo), tipo) ?? ''

  const [f, setF] = useState<MaquinaInput>(() => {
    if (maquina) {
      const { id: _i, versao: _v, criadoEm: _c, atualizadoEm: _a, ...resto } = maquina
      return { ...MAQUINA_VAZIA, ...resto }
    }
    return { ...MAQUINA_VAZIA, tipo: tipoInicial ?? 'P' }
  })
  // A letra vem do tipo; o usuário digita só o número
  const [numero, setNumero] = useState(() => (maquina ? numeroInicial(maquina, outras) : numeroSugerido(f.tipo)))
  /** Número preenchido pelo sistema: enquanto o usuário não digitar outro, acompanha o tipo. */
  const [sugerido, setSugerido] = useState<string | null>(() => (maquina ? null : numero))
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(maquina?.versao)
  const [tentou, setTentou] = useState(false)
  /** Identificação recusada pelo servidor por já existir (cadastrada em outro computador). */
  const [repetidaServidor, setRepetidaServidor] = useState<{ id: string; identificacao: string; texto: string } | null>(null)
  const campoNumero = useRef<HTMLInputElement>(null)

  // Abre no número, já selecionado: basta digitar para trocar a sugestão
  useEffect(() => {
    campoNumero.current?.focus()
    campoNumero.current?.select()
  }, [])

  const set = <K extends keyof MaquinaInput>(k: K, v: MaquinaInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const usarSugestao = (n: string) => {
    setNumero(n)
    setSugerido(n)
  }

  const mudarTipo = (tipo: TipoMaquina) => {
    if (tipo === f.tipo) return
    set('tipo', tipo)
    // Número vazio ou ainda o sugerido: passa a ser o próximo livre do novo tipo
    if (!numero || numero === sugerido) usarSugestao(numeroSugerido(tipo))
  }

  const prefixo = `${f.tipo}-`
  const n = Number(numero || 0)
  const identificacao = n > 0 ? identificacaoPadrao(f.tipo, n) : ''
  const erroNumero = !numero ? 'Digite o número da máquina.' : n === 0 ? 'Use um número a partir de 1.' : null
  const { valor, erros } = normalizarMaquina({ ...f, identificacao })
  const erroData = erros.find((e) => /aquisi/i.test(e))
  const chave = chaveIdentificacao(identificacao)
  const repetida = chave ? outras.find((m) => chaveIdentificacao(m.identificacao) === chave) : undefined
  const repetidaNoServidor = repetidaServidor && chaveIdentificacao(repetidaServidor.texto) === chave ? repetidaServidor : null
  const outraComMesmoNome =
    repetida ?? (repetidaNoServidor ? { id: repetidaNoServidor.id, identificacao: repetidaNoServidor.identificacao } : null)
  const proxima = sugestao(f.tipo)
  const proximaLivre = proxima && chaveIdentificacao(proxima) !== chave ? proxima : null
  const mostrarErroNumero = !!erroNumero && (tentou || !!numero)
  const invalido = !!outraComMesmoNome || mostrarErroNumero
  /** Identificação gravada hoje, quando vai mudar ao salvar (na edição). */
  const atual = maquina && maquina.identificacao !== identificacao ? maquina.identificacao : null

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erroNumero || outraComMesmoNome) {
      campoNumero.current?.focus()
      return
    }
    if (erros.length) return
    // Desativar (ou pôr em manutenção com eventos marcados) pede confirmação, como na ficha
    if (maquina) {
      const locacoes = locacoesDeHojeEmDiante(maquina.id, useDados.getState().eventos, hojeISO())
      const pergunta = perguntaSituacao(maquina, valor.status, locacoes)
      if (pergunta && !(await confirmar(pergunta))) return
    }
    setSalvando(true)
    try {
      const alvo = maquina && versaoBase !== undefined ? { id: maquina.id, versao: versaoBase } : undefined
      const salva = await salvarMaquina(valor, alvo)
      toast.sucesso(
        maquina ? 'Máquina atualizada' : 'Máquina cadastrada',
        `${salva.identificacao} · ${TIPO_MAQUINA[salva.tipo].label}`,
      )
      // Fecha antes de navegar: fechar limpa o "?nova=maquina" da busca global e, depois da
      // navegação, trocaria a página da máquina recém-aberta de volta para a lista
      aoFechar()
      aoSalvar?.(salva)
    } catch (err) {
      const duplicado =
        err instanceof ErroApi && err.status === 409
          ? (err.dados.duplicado as { id: string; identificacao: string } | undefined)
          : undefined
      if (duplicado) {
        // Outro computador cadastrou a mesma identificação antes (a lista daqui ainda não mostrava)
        setRepetidaServidor({ ...duplicado, texto: identificacao })
        campoNumero.current?.focus()
      } else if (err instanceof ErroApi && err.status === 409 && maquina && err.dados.atual) {
        // Conflito de versão: outra pessoa salvou esta máquina enquanto você editava
        const atualServidor = err.dados.atual as Maquina | undefined
        const sobrescrever = await confirmar({
          titulo: 'Máquina alterada por outra pessoa',
          descricao: 'Alguém salvou esta máquina enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atualServidor) {
          setVersaoBase(atualServidor.versao)
          toast.info('Clique em “Salvar alterações” novamente para confirmar.')
        }
      } else avisarErro('Não foi possível salvar a máquina', err)
    } finally {
      setSalvando(false)
    }
  }

  const abrirOutra = (id: string) => {
    aoFechar()
    navegar(`/manutencao/${id}`)
  }

  const usarProxima = () => usarSugestao(numeroSugerido(f.tipo))
  const linkProxima = proximaLivre && <LinkDica onClick={usarProxima}>{proximaLivre}</LinkDica>

  // No cadastro, ou na edição sem número, oferece o próximo número livre
  const oferecerProxima = (!maquina || !numero) && linkProxima
  // Com erro, a identificação de hoje continua visível numa linha à parte
  const linhaAtual = atual && <span className="mt-1 block pl-5">Hoje está como “{atual}”.</span>

  let dica: ReactNode
  if (outraComMesmoNome) {
    dica = (
      <>
        <span className="flex items-start gap-1.5 font-medium text-danger" role="alert">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Já existe a máquina {outraComMesmoNome.identificacao}.{' '}
            <LinkDica onClick={() => abrirOutra(outraComMesmoNome.id)}>Abrir a ficha dela</LinkDica>
            {proximaLivre && (
              <>
                {' '}
                ou <LinkDica onClick={usarProxima}>usar {proximaLivre}</LinkDica>
              </>
            )}
            .
          </span>
        </span>
        {linhaAtual}
      </>
    )
  } else if (mostrarErroNumero) {
    dica = (
      <>
        <span className="flex items-start gap-1.5 font-medium text-danger" role="alert">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {erroNumero}
            {oferecerProxima && <> Próxima livre: {linkProxima}</>}
          </span>
        </span>
        {linhaAtual}
      </>
    )
  } else {
    dica = (
      <>
        {identificacao ? (
          <>
            Fica <b className="font-semibold text-ink-2">{identificacao}</b>
            {atual ? <> (hoje está como “{atual}”)</> : !maquina && !proximaLivre && ', a próxima livre'}.
          </>
        ) : atual ? (
          <>Hoje está como “{atual}”. Digite só o número escrito na máquina.</>
        ) : (
          'Digite só o número escrito na máquina.'
        )}
        {oferecerProxima && <> Próxima livre: {linkProxima}</>}
      </>
    )
  }

  return (
    <form id="form-maquina" onSubmit={enviar} className="grid grid-cols-1 gap-4 sm:grid-cols-6" noValidate>
      <Field label="Tipo de máquina" className="sm:col-span-6">
        <Segmented
          className="self-start"
          valor={f.tipo}
          aoMudar={mudarTipo}
          opcoes={TIPOS_MAQUINA.map((t) => ({
            valor: t,
            label: (
              <span>
                {TIPO_MAQUINA[t].label}
                <span className="font-normal text-muted"> · {TIPO_MAQUINA[t].descricao.toLowerCase()}</span>
              </span>
            ),
          }))}
        />
      </Field>

      <Field label="Identificação" htmlFor="maq-id" className="sm:col-span-3" hint={dica}>
        <div className="relative">
          {/* Prefixo fixo do tipo: faz parte do campo, mas não dá para apagar */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-px left-px z-10 flex w-11 items-center justify-center overflow-hidden rounded-l-[11px] border-r border-line bg-surface-2 text-base font-semibold text-ink-2"
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={f.tipo}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16 }}
              >
                {prefixo}
              </motion.span>
            </AnimatePresence>
          </span>
          <Input
            ref={campoNumero}
            id="maq-id"
            value={numero}
            onChange={(e) => setNumero(soAlgarismos(e.target.value))}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={MAX_ALGARISMOS}
            autoComplete="off"
            placeholder={numeroSugerido(f.tipo) || '01'}
            aria-describedby="maq-id-prefixo"
            aria-invalid={invalido}
            className={cn('tnum pl-14 text-base font-semibold', invalido && 'border-danger! focus:ring-danger/20!')}
          />
          <span id="maq-id-prefixo" className="sr-only">
            {`Começa com ${prefixo}. Digite só o número.`}
          </span>
        </div>
      </Field>
      <Field label="Modelo" htmlFor="maq-modelo" className="sm:col-span-3">
        <Input
          id="maq-modelo"
          value={f.modelo}
          onChange={(e) => set('modelo', e.target.value)}
          placeholder="Ex.: Compacta 2 vias"
        />
      </Field>

      <Field
        label="Situação"
        className="sm:col-span-6"
        hint="“Locada” não se marca aqui: aparece sozinha quando a máquina está num evento."
      >
        <Segmented
          className="self-start"
          valor={f.status}
          aoMudar={(v: StatusMaquina) => set('status', v)}
          opcoes={STATUS_MAQUINA_LISTA.map((s) => ({ valor: s, label: ESTADO_MAQUINA[s].label }))}
        />
      </Field>

      <Field label="Nº de série" htmlFor="maq-serie" className="sm:col-span-3">
        <Input id="maq-serie" value={f.numeroSerie} onChange={(e) => set('numeroSerie', e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Data de aquisição" htmlFor="maq-aquisicao" className="sm:col-span-3" erro={erroData}>
        <Input
          id="maq-aquisicao"
          type="date"
          value={f.dataAquisicao}
          max={hojeISO()}
          onChange={(e) => set('dataAquisicao', e.target.value)}
        />
      </Field>
      <Field label="Observações" htmlFor="maq-obs" className="sm:col-span-6">
        <Textarea
          id="maq-obs"
          value={f.observacoes}
          onChange={(e) => set('observacoes', e.target.value)}
          placeholder="Ex.: comprada usada, acompanha capa de proteção…"
        />
      </Field>
    </form>
  )
}
