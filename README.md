# BC Fichas Control

Sistema de controle de locação de máquinas de fichas: clientes, eventos, dias de uso,
máquinas por dia, bobinas, pagamentos e relatórios de faturamento. O cálculo é o mesmo da
planilha **Controle Interno de Locação** (`Controle_Interno_Bobinas_Automaticas.xlsm`) e o
resumo do cliente sai em PDF no papel timbrado da Balanças.com.

## Menus

| Grupo | Página | O que faz |
| --- | --- | --- |
| Visão geral | **Painel** | Faturamento do mês, valores a receber, máquinas em uso hoje, próximos eventos, pagamentos pendentes e bobinas a conferir |
| | **Agenda** | Calendário mensal com a ocupação da frota por dia. Avisa quando a frota está acima de 80% ou estourada |
| Cadastros | **Clientes** | Cadastro de pessoa física ou jurídica (CPF/CNPJ, contato, endereço), histórico de eventos e total faturado |
| | **Eventos** | Lançamento do evento: cliente, local, **dias de uso com a quantidade de máquinas em cada dia**, valores, bobinas consignadas/devolvidas, desconto e pagamento. Gera o PDF do cliente |
| Gestão | **Relatórios** | Faturamento por mês/semana (diárias × bobinas), recebido × a receber, ticket médio, formas de pagamento, ranking de clientes e exportação em CSV |
| | **Configurações** | Valores padrão (diária, bobina, rodapé do PDF), tamanho da frota, tema claro/escuro, backup e restauração |

Atalhos: **Ctrl/⌘ + K** abre a busca global (clientes, eventos e páginas) e **Ctrl/⌘ + S** salva o evento.

## Regras de cálculo (iguais às da planilha)

| Planilha | Sistema |
| --- | --- |
| `TOTAL DE DIÁRIAS = SOMA(QTD.)` | soma das máquinas de todos os dias do evento |
| `VALOR DAS DIÁRIAS = VALOR DA DIÁRIA × TOTAL DE DIÁRIAS` | igual |
| `BOBINAS UTILIZADAS = CONSIGNADAS − DEVOLVIDAS` (vazio sem devolução ou se inválido) | igual — enquanto a devolução não é registrada as bobinas aparecem como "A conferir" e não são cobradas |
| `VALOR DAS BOBINAS = VALOR DE CADA BOBINA × UTILIZADAS` | igual |
| `TOTAL FINAL = VALOR DAS DIÁRIAS + VALOR DAS BOBINAS` | igual, menos um **desconto opcional** (padrão R$ 0,00) |
| Tipo de pagamento: Não pago, Dinheiro, Boleto, Crédito, Débito, PIX | igual; "Não pago" entra como valor a receber |
| Status: Em aberto, Pendente, Finalizado | igual, mais **Cancelado** (fica fora do faturamento) |

As regras ficam em [`src/lib/calc.ts`](src/lib/calc.ts) e são cobertas por testes em
[`src/lib/calc.test.ts`](src/lib/calc.test.ts). Nos relatórios, cada evento conta no mês da
sua **primeira data de uso**.

## Como usar

Requer [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
npm run dev          # abre em http://localhost:5173
```

### Versão em arquivo único (sem instalar nada no computador de uso)

```bash
npm run build:single # gera dist-single/index.html
```

O arquivo `dist-single/index.html` contém o sistema inteiro (fontes, logo e papel timbrado
incluídos). Basta copiar para o computador e abrir com dois cliques no Chrome ou Edge —
funciona sem internet.

`npm run build:demo` gera o mesmo arquivo, mas já carregado com dados de exemplo no primeiro acesso.

### Onde ficam os dados

Os dados ficam salvos **no navegador** do computador onde o sistema é usado (localStorage).
Por isso:

- use sempre o mesmo navegador e computador;
- faça backups em **Configurações → Fazer backup** (arquivo `.json`), que podem ser
  restaurados em outro computador por **Restaurar backup**;
- limpar os dados de navegação do navegador apaga as informações.

Se no futuro for preciso usar em vários computadores ao mesmo tempo, a camada de dados está
isolada em [`src/store/dados.ts`](src/store/dados.ts) e pode ser trocada por um banco na
nuvem sem mexer nas telas.

## Scripts

| Comando | Descrição |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção em `dist/` (pode ser publicado em qualquer hospedagem estática) |
| `npm run build:single` | build em arquivo único em `dist-single/index.html` |
| `npm run build:demo` | arquivo único com dados de exemplo |
| `npm test` | testes de cálculo, relatórios e formatação |
| `npm run lint` | análise estática (oxlint) |
| `npm run format` | formatação (Prettier) |

## Estrutura

```
src/
  lib/            regras de negócio e utilitários
    calc.ts         cálculo do evento (regras da planilha)
    relatorio.ts    agrupamentos e totais dos relatórios
    pdf.ts          resumo do cliente em PDF com papel timbrado
    format.ts       moeda, datas, máscaras de CPF/CNPJ/telefone
  store/          estado persistido (dados e preferências de interface)
  components/     componentes visuais (layout, menus, formulários, gráficos)
  pages/          Painel, Agenda, Clientes, Eventos, Relatórios, Configurações
  assets/         logo, papel timbrado e fontes
```

Tecnologias: React 19, TypeScript, Vite, Tailwind CSS 4, Motion (animações), Recharts
(gráficos), jsPDF (PDF), Zustand (estado) e date-fns (datas).
