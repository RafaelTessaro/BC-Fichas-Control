# BC Fichas Control

Sistema de controle de locação de máquinas de fichas: clientes, eventos, dias de uso,
máquinas por dia, bobinas, pagamentos, agenda e relatórios de faturamento. O cálculo é o
mesmo da planilha **Controle Interno de Locação** e o resumo do cliente sai em PDF no papel
timbrado da Balanças.com.

O sistema roda em um **servidor na rede da empresa**. Os outros computadores (e celulares
no Wi-Fi) acessam pelo navegador e veem os mesmos dados, atualizados na hora. **Não precisa
de internet** para funcionar: enquanto a rede local estiver ativa, tudo continua normal.
A internet só é usada para a consulta automática de CNPJ/CEP e para enviar os eventos ao
Google Agenda — se ela cair, essas duas funções esperam e voltam sozinhas.

```
  Computador do escritório ─┐
  Notebook ─────────────────┼──  rede da empresa  ──  Servidor (BC Fichas Control + banco de dados)
  Celular no Wi-Fi ─────────┘                              │
                                                           └── internet (opcional): CNPJ/CEP e Google Agenda
```

## Menus

| Grupo | Página | O que faz |
| --- | --- | --- |
| Visão geral | **Painel** | Faturamento do mês, valores a receber, máquinas em uso hoje, próximos eventos, pagamentos pendentes e bobinas a conferir |
| | **Agenda** | Calendário mensal com a ocupação da frota por dia; avisa quando passa de 80% ou estoura a frota |
| Cadastros | **Clientes** | Empresa (CNPJ, com consulta automática na Receita), pessoa física (CPF) ou cliente avulso; histórico e total faturado |
| | **Eventos** | Dias de uso com a quantidade de máquinas em cada dia, valores, bobinas consignadas/devolvidas, desconto, pagamento e PDF do cliente |
| Gestão | **Relatórios** | Faturamento por mês/semana, recebido × a receber, ticket médio, formas de pagamento, ranking de clientes e CSV |
| | **Configurações** | Valores padrão, frota, tema claro/escuro, backups e integração com o Google Agenda |

Atalhos: **Ctrl/⌘ + K** abre a busca global e **Ctrl/⌘ + S** salva o evento.

## Regras de cálculo (iguais às da planilha)

| Planilha | Sistema |
| --- | --- |
| `TOTAL DE DIÁRIAS = SOMA(QTD.)` | soma das máquinas de todos os dias do evento |
| `VALOR DAS DIÁRIAS = VALOR DA DIÁRIA × TOTAL DE DIÁRIAS` | igual |
| `BOBINAS UTILIZADAS = CONSIGNADAS − DEVOLVIDAS` | igual — até registrar a devolução, aparecem como "A conferir" e não são cobradas |
| `VALOR DAS BOBINAS = VALOR DE CADA BOBINA × UTILIZADAS` | igual |
| `TOTAL FINAL = DIÁRIAS + BOBINAS` | igual, menos um **desconto opcional** (padrão R$ 0,00) |
| Pagamento: Não pago, Dinheiro, Boleto, Crédito, Débito, PIX | igual; "Não pago" entra como valor a receber |
| Status: Em aberto, Pendente, Finalizado | igual, mais **Cancelado** (fica fora do faturamento e sai do Google Agenda) |

As regras ficam em [`shared/calc.ts`](shared/calc.ts), com testes em [`shared/calc.test.ts`](shared/calc.test.ts).

---

## Instalação no servidor (Windows)

Use um computador que fique ligado durante o expediente, de preferência com **IP fixo** na
rede (peça ao responsável pela rede para reservar o IP no roteador).

1. **Instale o Node.js** — baixe a versão **LTS** em <https://nodejs.org> (precisa ser 22.18 ou mais nova) e instale com as opções padrão.
2. **Copie a pasta do sistema** para o servidor, por exemplo `C:\BC-Fichas`.
3. Abra o **PowerShell como Administrador** (botão direito no menu Iniciar → *Terminal (Admin)* ou
   *Windows PowerShell (Admin)*) e rode, nesta ordem:

   ```powershell
   cd C:\BC-Fichas
   Set-ExecutionPolicy -Scope Process Bypass -Force
   npm ci
   npm run build
   .\deploy\windows\instalar-servico.ps1
   ```

   O script:
   - cria uma tarefa que **inicia o sistema junto com o Windows** (mesmo sem ninguém logado) e
     o **reinicia sozinho** se ele parar por qualquer motivo;
   - libera a porta no Firewall para a rede da empresa;
   - deixa a pasta do sistema e a pasta de dados acessíveis só para Administradores (o banco e a
     chave do Google ficam protegidos, e ninguém sem permissão consegue alterar o que roda no servidor);
   - mostra o endereço de acesso, por exemplo `http://192.168.0.10:3000`.

   Se aparecer o aviso de que a rede está como **Pública**, os outros computadores não vão
   conseguir acessar: marque a rede da empresa como **Privada** (o próprio aviso mostra o
   comando) ou rode o instalador com `-IncluirRedePublica`.
4. Nos outros computadores, abra esse endereço no Chrome ou Edge e salve nos favoritos. Para
   ter um ícone na área de trabalho, no Chrome use **menu ⋮ → Transmitir, salvar e compartilhar →
   Criar atalho…** e marque **Abrir como janela**.

Para testar antes de instalar como serviço: `npm start` (Ctrl+C encerra).

Os comandos abaixo também são executados no **PowerShell como Administrador**:

| Para… | Comando |
| --- | --- |
| Atualizar para uma nova versão (copie os arquivos novos por cima antes; a pasta `dados` é preservada) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\atualizar.ps1` |
| Mudar a porta (padrão 3000) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\instalar-servico.ps1 -Porta 8080` |
| Voltar uma cópia do banco | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\restaurar-copia.ps1 -Arquivo C:\BC-Fichas\dados\backups\<arquivo>.db` |
| Remover o serviço (os dados não são apagados) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas\deploy\windows\desinstalar-servico.ps1` |

O registro (log) do servidor fica em `C:\BC-Fichas\dados\servidor.log`. Como a pasta é
restrita a Administradores, ao abri-la pelo Explorer o Windows pede confirmação.

### Linux

Precisa do Node.js 22.18 ou mais novo em `/usr/bin/node`.

```bash
sudo useradd --system --home /opt/bc-fichas bcfichas
sudo mkdir -p /opt/bc-fichas && sudo cp -r . /opt/bc-fichas && sudo chown -R bcfichas /opt/bc-fichas
cd /opt/bc-fichas && sudo -u bcfichas npm ci && sudo -u bcfichas npm run build
sudo cp deploy/linux/bc-fichas.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now bc-fichas
```

### Configurações do servidor

Copie `.env.exemplo` para `.env` para mudar a porta (`PORTA`), a interface de rede (`HOST`)
ou a pasta dos dados (`PASTA_DADOS`) e reinicie o servidor. No Windows, para mudar a porta
use `instalar-servico.ps1 -Porta N`, que também ajusta o Firewall.

## Dados e backups

- Tudo fica no banco `dados/bc-fichas.db` (SQLite) no servidor.
- O servidor faz **uma cópia automática por dia** em `dados/backups/` (guarda as 30 mais
  recentes) e também antes de restaurar um backup, apagar dados ou atualizar o sistema.
- Em **Configurações → Dados e backup** é possível baixar um backup completo (`.json`),
  restaurar um backup e fazer uma cópia na hora.
- Recomendado: copiar a pasta `dados/backups` para um pendrive, HD externo ou nuvem uma vez por semana.
- Para voltar uma cópia `.db`, use o `restaurar-copia.ps1` (tabela acima). **Não** copie o arquivo
  `.db` por cima com o Explorer: o banco trabalha junto com os arquivos `bc-fichas.db-wal` e
  `bc-fichas.db-shm`, e misturar arquivos de momentos diferentes corrompe os dados. No Linux:
  pare o serviço, apague `dados/bc-fichas.db-wal` e `dados/bc-fichas.db-shm`, copie a cópia por
  cima de `dados/bc-fichas.db` e inicie de novo.

**Vindo da versão anterior (que salvava no navegador)?** Abra o novo sistema em cada computador
que usava a versão anterior, no mesmo navegador: o Painel mostra o aviso *"Encontramos dados da
versão anterior"* com o botão **Enviar para o servidor**. Os dados de cada computador são
**acrescentados** aos que já estão no servidor (nada é apagado; clientes com o mesmo CNPJ/CPF
são unificados e códigos de evento repetidos ganham um número novo).

## Vários usuários ao mesmo tempo

Cada alteração aparece na hora em todos os computadores abertos. Se duas pessoas editarem o
**mesmo** evento ou cliente ao mesmo tempo, quem salvar por último recebe um aviso e escolhe
se mantém as próprias alterações. O servidor também não aceita dois clientes com o mesmo
CNPJ/CPF. Se a conexão com o servidor cair, uma faixa amarela avisa no topo da tela e o
sistema reconecta sozinho; quando o servidor é atualizado, as telas abertas recarregam sozinhas.

O acesso não pede senha: qualquer computador da rede da empresa consegue abrir o sistema.
Não exponha a porta do servidor para a internet.

## Cadastro de clientes: empresa, pessoa física ou avulso

- **Empresa (CNPJ):** basta digitar o CNPJ — o servidor consulta a Receita Federal (via
  BrasilAPI, com CNPJ.ws e Minha Receita como alternativas) e preenche razão social, nome
  fantasia, endereço, telefone, e-mail e situação cadastral (com alerta se estiver baixada ou
  inapta). O CNPJ **alfanumérico** (com letras, emitido a partir de julho de 2026) também é
  aceito; enquanto os serviços de consulta não o suportarem, preencha os dados à mão.
- **Pessoa física (CPF):** CPF validado e endereço preenchido pelo CEP.
- **Avulso:** cliente eventual, sem documento — só um nome (ou nem isso). Também dá para criar
  na hora, no lançamento do evento, com **"Usar como cliente avulso"**.

O sistema não permite dois clientes com o mesmo CNPJ/CPF. As consultas precisam de internet no
servidor; sem internet, os campos podem ser preenchidos à mão normalmente.

## Google Agenda

Os eventos podem ser enviados automaticamente para uma agenda do Google (um evento de dia
inteiro para cada período de uso, com cliente, máquinas por dia, status e pagamento).
Alterações e cancelamentos são refletidos sozinhos; sem internet, o envio fica na fila e é
feito quando a conexão voltar. O envio é **de mão única**: mudanças feitas direto no Google
Agenda são substituídas pelo sistema.

Configuração (uma vez só, cerca de 10 minutos):

1. Acesse o [Google Cloud Console](https://console.cloud.google.com) com a conta do Google da
   empresa, crie um projeto (ex.: "BC Fichas") e ative a **Google Calendar API**
   (APIs e serviços → Biblioteca).
2. Em **IAM e administrador → Contas de serviço**, crie uma conta de serviço (ex.:
   "bc-fichas-agenda"). Abra-a, vá em **Chaves → Adicionar chave → Criar nova chave → JSON** e
   guarde o arquivo baixado.
3. No [Google Agenda](https://calendar.google.com), crie (ou escolha) a agenda que vai receber
   os eventos. Em **Configurações e compartilhamento → Compartilhar com pessoas específicas**,
   adicione o e-mail da conta de serviço (termina com `iam.gserviceaccount.com`) com a
   permissão **"Fazer alterações nos eventos"**.
4. Na mesma página, em **Integrar agenda**, copie o **ID da agenda**.
5. No BC Fichas Control, em **Configurações → Google Agenda**: envie o arquivo JSON, cole o ID
   da agenda, clique em **Testar conexão** e depois em **Ativar**.

A chave fica guardada só no servidor (`dados/google/credenciais.json`) e nunca é enviada aos navegadores.

Observações:

- Ativar a integração ou trocar de agenda exige internet no servidor naquele momento (o sistema
  confere se a agenda existe antes de mover os eventos). Na troca, os eventos são criados na
  agenda nova antes de serem apagados da antiga.
- Ao iniciar, uma vez por dia e no botão **Sincronizar tudo agora**, o servidor confere a agenda:
  recria o que foi apagado direto no Google e remove cópias de eventos que não existem mais no
  sistema (por exemplo, depois de voltar uma cópia antiga do banco). Eventos criados à mão na
  agenda nunca são mexidos.
- Use a agenda com **uma única instalação** do sistema: um servidor de teste apontando para a
  mesma agenda apagaria os eventos da outra instalação.

---

## Desenvolvimento

```bash
npm install
npm run dev          # servidor (porta 3000) + interface com recarga automática (porta 5173)
```

| Comando | Descrição |
| --- | --- |
| `npm run dev` | servidor e interface em modo de desenvolvimento |
| `npm run build` | compila a interface em `dist/` (servida pelo servidor) |
| `npm start` | inicia o servidor de produção |
| `npm test` | testes (cálculo, API, banco, relatórios, consultas, Google Agenda) |
| `npm run lint` / `npm run format` | análise estática / formatação |

```
shared/   regras de negócio usadas pelo servidor e pela interface (tipos, cálculo, validação)
server/   servidor Node (Fastify + SQLite): API, tempo real, backups, consultas, Google Agenda
src/      interface React (páginas, componentes, gráficos, PDF)
deploy/   scripts de instalação como serviço (Windows e Linux)
```

Tecnologias: Node.js (SQLite embutido), Fastify, React 19, TypeScript, Vite, Tailwind CSS 4,
Motion, Recharts, jsPDF, Zustand e date-fns.
