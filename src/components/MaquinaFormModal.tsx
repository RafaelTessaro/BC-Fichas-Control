// Cadastro e edição de uma máquina (P ou G).

import { CircleAlert, Cpu } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { MAQUINA_VAZIA, normalizarMaquina } from '#shared/dominio.ts'
import {
  chaveIdentificacao,
  ESTADO_MAQUINA,
  numeroDaIdentificacao,
  proximasIdentificacoes,
  STATUS_MAQUINA_LISTA,
  TIPO_MAQUINA,
  TIPOS_MAQUINA,
} from '#shared/maquinas.ts'
import type { Maquina, MaquinaInput, StatusMaquina, TipoMaquina } from '#shared/tipos.ts'
import { ErroApi } from '../lib/api'
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
        maquina ? (
          'Identificação, situação e dados de cadastro.'
        ) : (
          <>
            Use a mesma identificação escrita na máquina (ex.: <span className="whitespace-nowrap">P-01</span>). Os outros campos
            são opcionais.
          </>
        )
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

  const [f, setF] = useState<MaquinaInput>(() => {
    if (maquina) {
      const { id: _i, versao: _v, criadoEm: _c, atualizadoEm: _a, ...resto } = maquina
      return { ...MAQUINA_VAZIA, ...resto }
    }
    const tipo = tipoInicial ?? 'P'
    return { ...MAQUINA_VAZIA, tipo, identificacao: sugestao(tipo) }
  })
  // Versão que o usuário abriu para editar: se outra pessoa salvar antes, avisamos
  const [versaoBase, setVersaoBase] = useState(maquina?.versao)
  const [tentou, setTentou] = useState(false)
  /** Identificação recusada pelo servidor por já existir (cadastrada em outro computador). */
  const [repetidaServidor, setRepetidaServidor] = useState<{ id: string; identificacao: string; texto: string } | null>(null)

  const set = <K extends keyof MaquinaInput>(k: K, v: MaquinaInput[K]) => setF((s) => ({ ...s, [k]: v }))

  const mudarTipo = (tipo: TipoMaquina) =>
    setF((s) => {
      // Troca a identificação sugerida (vazia ou no padrão do tipo anterior) pela próxima livre do novo tipo
      const seguePadrao = !s.identificacao.trim() || numeroDaIdentificacao(s.identificacao, s.tipo) !== null
      return { ...s, tipo, identificacao: seguePadrao && tipo !== s.tipo ? sugestao(tipo) : s.identificacao }
    })

  const { valor, erros } = normalizarMaquina(f)
  const erroIdentificacao = erros.find((e) => /identifica/i.test(e))
  const erroData = erros.find((e) => /aquisi/i.test(e))
  const chave = chaveIdentificacao(f.identificacao)
  const repetida = chave ? outras.find((m) => chaveIdentificacao(m.identificacao) === chave) : undefined
  const repetidaNoServidor = repetidaServidor && chaveIdentificacao(repetidaServidor.texto) === chave ? repetidaServidor : null
  const outraComMesmoNome =
    repetida ?? (repetidaNoServidor ? { id: repetidaNoServidor.id, identificacao: repetidaNoServidor.identificacao } : null)
  const proxima = sugestao(f.tipo)

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    setTentou(true)
    if (erros.length || outraComMesmoNome) return
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
        setRepetidaServidor({ ...duplicado, texto: f.identificacao })
      } else if (err instanceof ErroApi && err.status === 409 && maquina && err.dados.atual) {
        // Conflito de versão: outra pessoa salvou esta máquina enquanto você editava
        const atual = err.dados.atual as Maquina | undefined
        const sobrescrever = await confirmar({
          titulo: 'Máquina alterada por outra pessoa',
          descricao: 'Alguém salvou esta máquina enquanto você editava. Deseja manter as suas alterações por cima das dela?',
          confirmar: 'Manter as minhas',
        })
        if (sobrescrever && atual) {
          setVersaoBase(atual.versao)
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

      <Field
        label="Identificação"
        htmlFor="maq-id"
        className="sm:col-span-3"
        erro={outraComMesmoNome ? null : tentou ? erroIdentificacao : null}
        hint={
          outraComMesmoNome ? (
            <span className="flex items-start gap-1.5 font-medium text-danger" role="alert">
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              <span>
                Já existe a máquina {outraComMesmoNome.identificacao}.{' '}
                <button
                  type="button"
                  onClick={() => abrirOutra(outraComMesmoNome.id)}
                  className="cursor-pointer text-brand-ink underline underline-offset-2"
                >
                  Abrir a ficha dela
                </button>
              </span>
            </span>
          ) : proxima && chave !== chaveIdentificacao(proxima) ? (
            <span>
              Próxima livre:{' '}
              <button
                type="button"
                onClick={() => set('identificacao', proxima)}
                className="cursor-pointer font-medium text-brand-ink underline-offset-2 hover:underline"
              >
                {proxima}
              </button>
            </span>
          ) : (
            'Como está escrita na máquina.'
          )
        }
      >
        <Input
          id="maq-id"
          value={f.identificacao}
          onChange={(e) => set('identificacao', e.target.value.toUpperCase())}
          autoComplete="off"
          autoFocus
          placeholder={proxima}
          aria-invalid={!!outraComMesmoNome || (tentou && !!erroIdentificacao)}
          className="text-base font-semibold"
        />
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
