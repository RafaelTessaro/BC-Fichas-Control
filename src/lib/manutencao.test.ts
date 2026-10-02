import { describe, expect, it } from 'vitest'
import type { Evento, Maquina, OrdemServico, Reclamacao } from '#shared/tipos.ts'
import {
  adicionarServico,
  avisoLocacoes,
  eventoSugerido,
  eventosDaMaquina,
  formatarServico,
  haQuantoTempo,
  historicoMaquina,
  indicesOrdens,
  locacoesDeHojeEmDiante,
  maquinaCombina,
  opcoesServico,
  ordenarOrdens,
  perguntaSituacao,
  problemaDaReclamacao,
  reclamacoesPorMaquina,
  renomearServico,
  resumoMaquina,
  sugestaoMaquina,
  sugestaoMarcada,
  usoDosServicos,
} from './manutencao'

const maq = (identificacao: string, extra: Partial<Maquina> = {}): Maquina => ({
  id: identificacao,
  versao: 1,
  tipo: identificacao.toUpperCase().startsWith('G') ? 'G' : 'P',
  identificacao,
  status: 'DISPONIVEL',
  modelo: '',
  numeroSerie: '',
  dataAquisicao: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const ev = (id: string, datas: string[], maquinasIds: string[], extra: Partial<Evento> = {}): Evento => ({
  id,
  versao: 1,
  codigo: Number(id.replace(/\D/g, '')) || 1,
  clienteId: 'c',
  nome: `Evento ${id}`,
  cidade: '',
  cabecalho: '',
  periodoCorrido: false,
  programacao: 'NAO_INICIADA',
  dias: datas.map((data, i) => ({ id: `${id}${i}`, data, maquinas: 1 })),
  maquinasIds,
  valorDiaria: 0,
  valorBobina: 0,
  bobinasConsignadas: 0,
  bobinasDevolvidas: null,
  desconto: 0,
  formaPagamento: 'NAO_PAGO',
  dataPagamento: '',
  status: 'EM_ABERTO',
  rodape: '',
  observacoes: '',
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const os = (numero: number, maquinaId: string, extra: Partial<OrdemServico> = {}): OrdemServico => ({
  id: `os${numero}`,
  versao: 1,
  numero,
  maquinaId,
  tipo: 'PREVENTIVA',
  status: 'CONCLUIDA',
  abertura: '2026-01-10',
  conclusao: '2026-01-10',
  servicos: ['Limpeza completa'],
  problema: '',
  solucao: '',
  pecas: '',
  responsavel: '',
  custo: 0,
  criadoEm: '',
  atualizadoEm: '',
  ...extra,
})

const rec = (id: string, maquinaId: string, data: string, extra: Partial<Reclamacao> = {}): Reclamacao => ({
  id,
  versao: 1,
  maquinaId,
  eventoId: '',
  data,
  descricao: 'Estava travando',
  criadoEm: `${data}T12:00:00.000Z`,
  atualizadoEm: '',
  ...extra,
})

const HOJE = '2026-10-02'

describe('busca de máquinas', () => {
  const p1 = maq('P-01', { modelo: 'Compacta 2 vias', numeroSerie: 'SN-778' })
  it('acha pela identificação com ou sem traço e zeros', () => {
    expect(maquinaCombina(p1, 'p1')).toBe(true)
    expect(maquinaCombina(p1, 'P 01')).toBe(true)
    expect(maquinaCombina(p1, 'p-01')).toBe(true)
    expect(maquinaCombina(p1, 'P-0')).toBe(true)
    expect(maquinaCombina(p1, 'g1')).toBe(false)
    expect(maquinaCombina(maq('P-10'), 'p1')).toBe(false)
    expect(maquinaCombina(p1, '')).toBe(true)
  })
  it('"máquina 1" acha a de número 1 dos dois tipos', () => {
    expect(maquinaCombina(p1, 'máquina 1')).toBe(true)
    expect(maquinaCombina(maq('G-01'), 'maq 01')).toBe(true)
    expect(maquinaCombina(maq('G-02'), 'maquina 1')).toBe(false)
  })
  it('não acha pelos campos antigos (modelo e nº de série saíram do cadastro)', () => {
    expect(maquinaCombina(p1, 'compacta')).toBe(false)
    expect(maquinaCombina(p1, 'sn-778')).toBe(false)
  })
})

describe('tempo e ordenação', () => {
  it('descreve há quanto tempo', () => {
    expect(haQuantoTempo(HOJE, HOJE)).toBe('hoje')
    expect(haQuantoTempo('2026-10-01', HOJE)).toBe('ontem')
    expect(haQuantoTempo('2026-09-27', HOJE)).toBe('há 5 dias')
  })
  it('coloca as manutenções em aberto primeiro, a mais antiga antes', () => {
    const lista = ordenarOrdens([
      os(1, 'a', { conclusao: '2026-03-01' }),
      os(2, 'a', { status: 'ABERTA', abertura: '2026-09-30', conclusao: '' }),
      os(3, 'a', { conclusao: '2026-08-01' }),
      os(4, 'a', { status: 'EM_ANDAMENTO', abertura: '2026-09-01', conclusao: '' }),
    ])
    expect(lista.map((o) => o.numero)).toEqual([4, 2, 3, 1])
  })
})

describe('resumo da máquina', () => {
  const ordens = [
    os(1, 'P-01', { custo: 100, conclusao: '2026-03-02' }),
    os(2, 'P-01', { custo: 50.5, conclusao: '2026-07-20' }),
    os(3, 'P-01', { status: 'CANCELADA', custo: 999, conclusao: '' }),
    os(4, 'P-01', { status: 'ABERTA', custo: 20, conclusao: '' }),
    os(5, 'G-01', { custo: 70 }),
  ]
  const reclamacoes = [
    rec('r1', 'P-01', '2026-05-02', { eventoId: 'e1' }),
    rec('r2', 'P-01', '2026-08-15'),
    rec('r3', 'G-01', '2026-06-05'),
  ]
  const eventos = [
    ev('e1', ['2026-05-01', '2026-05-02'], ['P-01']),
    ev('e2', ['2026-10-10'], ['P-01', 'G-01']),
    ev('e3', ['2026-06-01'], ['P-01'], { status: 'CANCELADO' }),
    ev('e4', ['2026-06-05'], ['G-01']),
  ]

  it('soma manutenções, reclamações, eventos e diárias (sem custo)', () => {
    expect(resumoMaquina('P-01', ordens, eventos, reclamacoes, HOJE)).toEqual({
      concluidas: 2,
      emAberto: 1,
      ultimaManutencao: '2026-07-20',
      reclamacoes: 2,
      ultimaReclamacao: '2026-08-15',
      eventos: 2,
      diarias: 2, // o dia de e2 ainda não chegou
      agendados: 1,
    })
    expect(resumoMaquina('G-02', ordens, eventos, reclamacoes, HOJE)).toMatchObject({ reclamacoes: 0, ultimaReclamacao: null })
  })

  it('conta as reclamações de cada máquina', () => {
    const mapa = reclamacoesPorMaquina(reclamacoes)
    expect(mapa.get('P-01')).toBe(2)
    expect(mapa.get('G-01')).toBe(1)
    expect(mapa.has('G-02')).toBe(false)
  })

  it('indexa a última manutenção e as manutenções em aberto de cada máquina', () => {
    const { ultima, abertas } = indicesOrdens(ordens)
    expect(ultima.get('P-01')).toBe('2026-07-20')
    expect(ultima.get('G-01')).toBe('2026-01-10')
    expect(abertas.get('P-01')).toBe(1)
    expect(abertas.has('G-01')).toBe(false)
  })

  it('lista as locações de hoje em diante, da mais próxima para a mais distante', () => {
    const lista = locacoesDeHojeEmDiante(
      'P-01',
      [...eventos, ev('e5', ['2026-10-01', '2026-10-03'], ['P-01']), ev('e6', ['2026-10-09'], ['P-01'])],
      HOJE,
    )
    expect(lista.map((l) => l.evento.id)).toEqual(['e5', 'e6', 'e2'])
  })

  it('monta a linha do tempo sem eventos cancelados, da mais recente para a mais antiga', () => {
    const itens = historicoMaquina('P-01', ordens, [...eventos, ev('e5', ['2026-10-01', '2026-10-03'], ['P-01'])], [], HOJE)
    expect(itens.map((i) => i.id)).toEqual(['e2', 'e5', 'e1', 'os4', 'os3', 'os2', 'os1'])
    const quando = itens.flatMap((i) => (i.tipo === 'locacao' ? [i.quando] : []))
    expect(quando).toEqual(['futura', 'agora', 'passada'])
  })

  it('inclui as reclamações, com o evento de cada uma', () => {
    const itens = historicoMaquina('P-01', ordens, eventos, reclamacoes, HOJE)
    expect(itens.map((i) => i.id)).toEqual(['e2', 'r2', 'r1', 'e1', 'os4', 'os3', 'os2', 'os1'])
    const r1 = itens.find((i) => i.id === 'r1')
    expect(r1?.tipo === 'reclamacao' && r1.evento?.id).toBe('e1')
    const r2 = itens.find((i) => i.id === 'r2')
    expect(r2?.tipo === 'reclamacao' && r2.evento).toBeUndefined()
  })

  it('no mesmo dia: manutenção, depois a reclamação, depois a locação', () => {
    const dia = '2026-09-10'
    const itens = historicoMaquina(
      'P-01',
      [os(9, 'P-01', { abertura: dia, conclusao: dia })],
      [ev('e9', [dia], ['P-01'])],
      [rec('rb', 'P-01', dia, { criadoEm: '2026-09-10T15:00:00.000Z' }), rec('ra', 'P-01', dia)],
      HOJE,
    )
    expect(itens.map((i) => i.id)).toEqual(['os9', 'rb', 'ra', 'e9'])
  })
})

describe('reclamações de clientes', () => {
  const eventos = [
    ev('e1', ['2026-05-01', '2026-05-02'], ['P-01']),
    ev('e2', ['2026-09-26', '2026-09-27'], ['P-01']),
    ev('e3', ['2026-09-20'], ['P-01'], { status: 'CANCELADO' }),
    ev('e4', ['2026-10-10'], ['P-01']),
    ev('e5', ['2026-09-27'], ['G-01']),
    ev('e6', ['2026-09-01', '2026-10-03'], ['P-01'], { periodoCorrido: true }),
  ]

  it('lista os eventos já começados com a máquina, do mais recente para o mais antigo', () => {
    expect(eventosDaMaquina('P-01', eventos, HOJE).map((l) => l.evento.id)).toEqual(['e6', 'e2', 'e1'])
  })

  it('sugere o evento mais recente, se terminou há no máximo 30 dias', () => {
    const lista = eventosDaMaquina('P-01', eventos.slice(0, 3), HOJE)
    expect(eventoSugerido(lista, HOJE)?.id).toBe('e2')
    expect(eventoSugerido(lista, '2026-10-27')?.id).toBe('e2')
    expect(eventoSugerido(lista, '2026-10-28')).toBeUndefined()
    expect(eventoSugerido([], HOJE)).toBeUndefined()
  })

  it('monta o problema da manutenção com o relato do cliente', () => {
    const r = rec('r', 'P-01', '2026-09-27', { descricao: ' Estava travando ' })
    expect(problemaDaReclamacao(r, { codigo: 12, nome: 'Festa Junina' })).toBe(
      'Reclamação do cliente no evento #0012 Festa Junina (27/09/2026): Estava travando',
    )
    expect(problemaDaReclamacao(r)).toBe('Reclamação do cliente (27/09/2026): Estava travando')
  })
})

describe('serviços de manutenção cadastrados', () => {
  const lista = ['Troca de cabeçote', 'Higienização']

  it('formata o nome: espaços e primeira letra maiúscula', () => {
    expect(formatarServico('  revisão   geral ')).toBe('Revisão geral')
    expect(formatarServico('   ')).toBe('')
  })

  it('adiciona sem repetir (sem diferenciar maiúsculas e acentos)', () => {
    expect(adicionarServico(lista, ' revisão ')).toEqual({ lista: [...lista, 'Revisão'], nome: 'Revisão' })
    expect(adicionarServico(lista, 'HIGIENIZACAO')).toEqual({ erro: '“Higienização” já está na lista.' })
    expect(adicionarServico(lista, '  ')).toEqual({ erro: 'Digite o nome do serviço.' })
    const cheia = Array.from({ length: 100 }, (_, i) => `Serviço ${i}`)
    expect(adicionarServico(cheia, 'Outro')).toEqual({ erro: 'Dá para cadastrar no máximo 100 serviços.' })
  })

  it('renomeia sem repetir outro serviço (mudar só maiúsculas do próprio pode)', () => {
    expect(renomearServico(lista, 1, 'Higienização completa')).toEqual({
      lista: ['Troca de cabeçote', 'Higienização completa'],
      nome: 'Higienização completa',
    })
    expect(renomearServico(lista, 1, 'HIGIENIZAÇÃO')).toEqual({
      lista: ['Troca de cabeçote', 'HIGIENIZAÇÃO'],
      nome: 'HIGIENIZAÇÃO',
    })
    expect(renomearServico(lista, 1, 'troca de cabecote')).toEqual({ erro: '“Troca de cabeçote” já está na lista.' })
    expect(renomearServico(lista, 0, '')).toEqual({ erro: 'O nome não pode ficar vazio.' })
  })

  it('oferece os cadastrados e os que o registro já tem, sem repetir', () => {
    expect(opcoesServico(lista, ['higienização', 'Limpeza completa'])).toEqual([...lista, 'Limpeza completa'])
    expect(opcoesServico([], [])).toEqual([])
  })

  it('conta em quantas manutenções cada serviço aparece', () => {
    const uso = usoDosServicos([
      os(1, 'a', { servicos: ['Higienização', 'Revisão'] }),
      os(2, 'a', { servicos: ['higienizacao'] }),
      os(3, 'a', { servicos: [] }),
    ])
    expect(uso.get('higienizacao')).toBe(2)
    expect(uso.get('revisao')).toBe(1)
  })
})

describe('sugestão para a máquina ao salvar a manutenção', () => {
  it('coloca em manutenção ao abrir e libera ao concluir', () => {
    expect(sugestaoMaquina('ABERTA', 'DISPONIVEL')).toBe('MANUTENCAO')
    expect(sugestaoMaquina('EM_ANDAMENTO', 'MANUTENCAO')).toBeNull()
    expect(sugestaoMaquina('CONCLUIDA', 'MANUTENCAO')).toBe('LIBERAR')
    expect(sugestaoMaquina('CANCELADA', 'MANUTENCAO')).toBe('LIBERAR')
    expect(sugestaoMaquina('CONCLUIDA', 'DISPONIVEL')).toBeNull()
    expect(sugestaoMaquina('ABERTA', 'DESATIVADA')).toBeNull()
  })
  it('só vem marcada em manutenção nova ou quando a situação muda, e não libera com outra em aberto', () => {
    expect(sugestaoMarcada('MANUTENCAO', { nova: true, situacaoMudou: false, outrasEmAberto: 0 })).toBe(true)
    expect(sugestaoMarcada('MANUTENCAO', { nova: false, situacaoMudou: false, outrasEmAberto: 0 })).toBe(false)
    expect(sugestaoMarcada('LIBERAR', { nova: false, situacaoMudou: true, outrasEmAberto: 0 })).toBe(true)
    expect(sugestaoMarcada('LIBERAR', { nova: false, situacaoMudou: true, outrasEmAberto: 1 })).toBe(false)
    expect(sugestaoMarcada(null, { nova: true, situacaoMudou: true, outrasEmAberto: 0 })).toBe(false)
    // Locada agora: a caixa aparece, mas desmarcada (a máquina ainda está no evento)
    expect(sugestaoMarcada('MANUTENCAO', { nova: true, situacaoMudou: false, outrasEmAberto: 0, locadaAgora: true })).toBe(false)
  })
})

describe('confirmação ao trocar a situação', () => {
  const locacoes = locacoesDeHojeEmDiante(
    'P-01',
    [ev('e1', ['2026-10-02', '2026-10-03'], ['P-01'], { nome: 'Festa da Primavera' })],
    HOJE,
  )
  const p1 = maq('P-01')

  it('desativar sempre pergunta e avisa dos eventos de hoje em diante', () => {
    const semEventos = perguntaSituacao(p1, 'DESATIVADA', [])
    expect(semEventos?.perigo).toBe(true)
    expect(semEventos?.descricao).not.toContain('Atenção')
    const comEventos = perguntaSituacao(p1, 'DESATIVADA', locacoes)
    expect(comEventos?.descricao).toContain('Festa da Primavera (02 a 03/10/2026)')
    expect(comEventos?.descricao).toContain('Troque a máquina nesse evento.')
  })

  it('manutenção só pergunta com eventos marcados; voltar para disponível não pergunta', () => {
    expect(perguntaSituacao(p1, 'MANUTENCAO', [])).toBeNull()
    expect(perguntaSituacao(p1, 'MANUTENCAO', locacoes)?.descricao).toContain('Se o conserto não ficar pronto a tempo')
    expect(perguntaSituacao({ ...p1, status: 'MANUTENCAO' }, 'DISPONIVEL', locacoes)).toBeNull()
    expect(perguntaSituacao(p1, 'DISPONIVEL', locacoes)).toBeNull()
    expect(avisoLocacoes([])).toBe('')
  })
})
