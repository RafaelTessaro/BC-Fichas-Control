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
| | **Agenda** | Calendário mensal com a ocupação das máquinas por dia ("4+1" = 4 máquinas + 1 reserva) e os números das máquinas de cada evento; avisa quando passa de 80% ou do total de máquinas. Vai para qualquer mês ou ano (clique no nome do mês), mostra o ano inteiro num mapa de ocupação e compara com o mesmo mês do ano anterior |
| Cadastros | **Clientes** | Empresa (CNPJ, com consulta automática na Receita), pessoa física (CPF) ou cliente avulso; histórico e total faturado |
| | **Eventos** | Nome (o topo das fichas) e rodapé, dias de uso com a quantidade de máquinas e de **máquinas reserva** em cada dia (e se as máquinas ficam com o cliente entre um dia e outro), máquinas enviadas (titulares e reserva), andamento da programação, arquivos anexados (prints, logo, cardápio, PDF), valores, bobinas, desconto, pagamento, PDF do cliente, recibo (PIX ou dinheiro), **contrato de locação**, envio por e-mail ou WhatsApp e **Repetir em outras datas** (para o cliente que já passou as datas do ano) |
| | **Contratos** | Contratos de locação gerados nos eventos: quais esperam a assinatura, PDF, envio ao cliente (WhatsApp ou e-mail) e a cópia assinada (foto ou PDF) |
| Gestão | **Manutenção** | Máquinas P e G com identificação (P-01, G-03…), situação (disponível, locada, em manutenção, desativada) e onde cada uma está; registro das manutenções (preventiva ou corretiva, serviços feitos, problema relatado, responsável), lista de serviços cadastrados por você, reclamações de clientes e o histórico de cada máquina |
| | **Relatórios** | Faturamento por mês/semana, recebido × a receber, ticket médio, formas de pagamento, ranking de clientes e planilha (CSV) |
| | **Configurações** | Disponibilidade de máquinas (quantas P e G), valores padrão, dados do recibo, contrato de locação (dados da empresa e valores de reposição), e-mail para envio de recibos, tema claro/escuro, backups, integração com o Google Agenda e zona de perigo (apagar dados) |

Atalhos: **Ctrl/⌘ + K** abre a busca global e **Ctrl/⌘ + S** salva o evento.

## Regras de cálculo (iguais às da planilha)

| Planilha | Sistema |
| --- | --- |
| `TOTAL DE DIÁRIAS = SOMA(QTD.)` | soma das máquinas de todos os dias do evento, mais as **máquinas reserva que o cliente usou** (a reserva parada não é cobrada) |
| `VALOR DAS DIÁRIAS = VALOR DA DIÁRIA × TOTAL DE DIÁRIAS` | igual |
| `BOBINAS UTILIZADAS = CONSIGNADAS − DEVOLVIDAS` | igual — até registrar a devolução, aparecem como "A conferir" e não são cobradas |
| `VALOR DAS BOBINAS = VALOR DE CADA BOBINA × UTILIZADAS` | igual |
| `TOTAL FINAL = DIÁRIAS + BOBINAS` | igual, menos um **desconto opcional** (padrão R$ 0,00) |
| Pagamento: Não pago, Dinheiro, Boleto, Crédito, Débito, PIX | igual; "Não pago" entra como valor a receber |
| Status: Em aberto, Pendente, Finalizado | igual, mais **Cancelado** (fica fora do faturamento e sai do Google Agenda) |

As regras ficam em [`shared/calc.ts`](shared/calc.ts), com testes em [`shared/calc.test.ts`](shared/calc.test.ts).

### Recibo

Eventos pagos em **PIX** ou **Dinheiro** têm o botão **Gerar recibo** (no detalhe do evento e no
menu de cada evento da lista). O recibo sai em PDF no papel timbrado, com o número do evento, o
valor em algarismos e por extenso, o detalhamento (diárias, reserva usada, bobinas e desconto), a forma e a data
do pagamento e o espaço para assinatura. O nome, a razão social, o CNPJ e a cidade que aparecem
no recibo ficam em **Configurações → Dados do recibo**. Para cliente avulso sem nome, o recibo
deixa o espaço do nome em branco para preencher à mão. O texto traz o que um recibo precisa ter:
quem pagou (com CPF/CNPJ), quem recebeu (com CNPJ), o valor em algarismos e por extenso, a que se
refere, a forma de pagamento, o local, a data e a quitação do valor.

### Envio por e-mail e por WhatsApp

No detalhe do evento, **Enviar por e-mail** manda o recibo (ou o resumo do evento, com o total)
em PDF para o e-mail do cliente, já com assunto e mensagem prontos. O envio sai pelo e-mail da
empresa, configurado uma vez em **Configurações → E-mail** (servidor, usuário e senha; no Gmail e
no Outlook é preciso criar uma "senha de app"). A senha fica só no servidor.
**Enviar por WhatsApp** abre o WhatsApp com a mensagem pronta para o telefone do cliente; o PDF é
baixado para você anexar na conversa (o WhatsApp não aceita anexo pelo link).

## Contrato de locação

Cada aluguel pode ter o seu **contrato de locação** em PDF, pronto para imprimir e o cliente
assinar na retirada das máquinas. O texto já vem escrito dentro do Código de Defesa do Consumidor,
com as regras escolhidas pela empresa (abaixo).

**Como usar:**

1. **Gerar:** ao cadastrar um aluguel, o sistema pergunta *"Gerar o contrato de locação agora?"*.
   Também dá para gerar depois, pelo menu **…** do evento → **Gerar contrato**, ou pelo cartão
   **Contrato de locação** no detalhe do evento. Na janela, confira o local do evento, a data e a
   hora da retirada e da devolução (vêm das datas do evento; a hora em branco sai para preencher à
   mão), quem assina pelo cliente (nome e CPF) e, se quiser, alguma condição só daquele contrato.
   O sistema avisa o que vai sair em branco (ex.: cliente sem endereço).
2. **Enviar antes:** no cartão do contrato, **Enviar** manda o PDF ao cliente por WhatsApp ou
   e-mail. Mande **antes** da retirada: o CDC pede que o cliente possa ler o contrato antes de
   assinar, e o próprio contrato traz essa declaração.
3. **Imprimir e assinar na retirada:** imprima duas vias (uma fica com o cliente). A última
   página é o **Termo de Entrega e Devolução**, para anotar as máquinas, os acessórios e as bobinas
   na retirada e na devolução.
4. **Guardar a cópia assinada:** no cartão do contrato, anexe (ou arraste) a foto ou o PDF do
   contrato assinado (até 25 MB). O contrato passa a **Assinado**. Sem a cópia, dá para só
   **Marcar como assinado**, com a data.

O contrato guarda os dados do dia em que foi gerado: o PDF sai sempre igual, mesmo que o cliente,
o evento ou as configurações mudem depois. Se o aluguel mudar (datas, máquinas, valores ou dados
do cliente), o cartão avisa; é só gerar de novo, e o contrato anterior que esperava a assinatura é
cancelado sozinho (*"Substituído pelo contrato nº …"*). Se o anterior já estava assinado, ele
continua valendo até o cliente assinar o novo; aí o cartão mostra o botão para cancelar o anterior.

A aba **Contratos** (no menu, em Cadastros) reúne todos os contratos gerados, com a situação de
cada um (esperando assinatura, assinado ou cancelado) e a busca por número, cliente ou evento:
dali também dá para baixar o PDF de novo, enviar ao cliente e guardar ou abrir a cópia assinada.

**Regras do contrato** (escolhidas pela empresa, já escritas nas cláusulas):

| Assunto | Regra |
| --- | --- |
| Cancelamento | Grátis até 7 dias antes do 1º dia de uso. Depois, a empresa retém no máximo 10% das diárias (20% se o cliente não vier retirar e não avisar). Se a empresa cancelar, devolve tudo e paga 10% ao cliente |
| Arrependimento | Fechado por WhatsApp, telefone, e-mail ou internet: o cliente pode desistir em até 7 dias, com devolução total (art. 49 do CDC) |
| Danos | Por mau uso, o cliente paga o conserto, com orçamento antes. Perda ou furto por descuido (ou dano sem conserto): o **valor de reposição** da máquina. Desgaste natural e roubo com boletim de ocorrência não são cobrados |
| Caução | Não tem |
| Bobinas | As lacradas voltam sem custo; as abertas contam como usadas e são cobradas |
| Máquina reserva | Fica com o cliente sem custo; só é cobrada (pela diária) nos dias em que for usada |
| Atraso no pagamento | Multa de 2%, juros pela taxa legal e correção pelo IPCA |
| Atraso na devolução | Não é cobrado |
| Retirada e devolução | Sempre na sede da empresa |
| Assinatura | Sem testemunhas; vale no papel ou eletrônica (gov.br ou plataforma de assinatura) |
| Foro | A cidade da empresa, sem tirar do cliente o direito de processar na cidade dele |
| Texto | Letra corpo 12 e as cláusulas que limitam direitos em **negrito**, como pede o CDC |

**Onde configurar:** em **Configurações → Contrato de locação** ficam o endereço, o telefone e o
e-mail da empresa, quem assina pela empresa (nome e CPF), o foro (em branco, vale a cidade da
empresa), o **valor de reposição** da máquina P e da G (em R$ 0,00, o contrato diz *"valor de
mercado, por orçamento"*) e as condições que saem em todos os contratos. O nome, a razão social, o
CNPJ e a cidade vêm de **Dados do recibo**.

A cópia assinada fica no servidor, na pasta `dados/contratos`, fora do backup `.json` (como os
arquivos anexados): para guardá-la, copie a pasta `dados` inteira. Os dados dos contratos vão no
backup, e o PDF é gerado de novo igual.

### Assinatura virtual

**Hoje, sem custo, pelo gov.br:**

1. Gere o contrato e envie o PDF ao cliente (WhatsApp ou e-mail).
2. O cliente entra em [assinador.iti.br](https://assinador.iti.br) com a conta gov.br nível
   **prata ou ouro** (a bronze não assina), envia o PDF, assina e baixa o arquivo assinado.
3. Ele devolve o PDF assinado. Confira em [validar.iti.gov.br](https://validar.iti.gov.br): o
   site mostra quem assinou e se o arquivo foi alterado depois.
4. Anexe o PDF assinado no cartão **Contrato de locação** do evento (ou na aba **Contratos**).

Se a empresa também for assinar pelo gov.br, quem assina pela empresa assina primeiro e manda ao
cliente o arquivo já assinado; o cliente assina o mesmo arquivo.

**Integrado com uma plataforma de assinatura:** a plataforma manda o contrato ao cliente, ele
assina pelo celular e o contrato voltaria assinado sozinho para o sistema. **Autentique** e
**Assinafy** têm 10 documentos por mês grátis, com API; **ZapSign** e **Clicksign** são pagos. A
integração pode ser feita numa próxima versão; para isso, a empresa precisaria:

1. criar a conta na plataforma escolhida, com o e-mail da empresa;
2. gerar o **token da API** no painel da plataforma;
3. informar o token em **Configurações** (ele ficaria só no servidor, como a senha do e-mail).

---

## Instalação no servidor (Windows)

Use um computador que fique ligado durante o expediente, de preferência com **IP fixo** na
rede (peça ao responsável pela rede para reservar o IP no roteador).

### Com o pacote completo (recomendado)

O pacote `BC-Fichas-Control-<versão>-windows.zip` já traz o Node.js, as dependências e a interface
compilada: **não precisa de internet nem de instalar nada antes**. Ele fica na página
[**Releases**](../../releases) do repositório: a cada alteração enviada, o GitHub roda os testes, monta
o pacote ([`.github/workflows/pacote-windows.yml`](.github/workflows/pacote-windows.yml)) e
substitui o arquivo da versão.

1. Extraia o `.zip` direto no `C:\` (a pasta fica `C:\BC-Fichas-Control`). Não use Downloads nem
   a Área de Trabalho: pastas de usuário podem ser limpas ou sincronizadas, e o instalador as recusa.
2. Dê dois cliques em **`INSTALAR.bat`** e responda **Sim** quando o Windows pedir permissão de
   administrador. Se aparecer *"O Windows protegeu o computador"*, clique em **Mais informações →
   Executar assim mesmo**.
3. O instalador:
   - cria uma tarefa que **inicia o sistema junto com o Windows** (mesmo sem ninguém logado) e
     o **reinicia sozinho** se ele parar por qualquer motivo;
   - libera a porta no Firewall para a rede da empresa;
   - deixa a pasta do sistema e a pasta de dados acessíveis só para Administradores (o banco e a
     chave do Google ficam protegidos, e ninguém sem permissão consegue alterar o que roda no servidor);
   - mostra o endereço de acesso, por exemplo `http://192.168.0.10:3000`.

   Se aparecer o aviso de que a rede está como **Pública**, os outros computadores não vão
   conseguir acessar: marque a rede da empresa como **Privada** (o próprio aviso mostra o
   comando) ou libere também a rede pública com o comando da tabela [Outros comandos](#outros-comandos).
4. Nos outros computadores, abra esse endereço no Chrome ou Edge e salve nos favoritos. Para
   ter um ícone na área de trabalho, no Chrome use **menu ⋮ → Transmitir, salvar e compartilhar →
   Criar atalho…** e marque **Abrir como janela**.

**Para atualizar:** extraia o pacote novo em outra pasta, fora da instalação (ex.:
`C:\BC-Fichas-Control-novo`), e dê dois cliques no **`ATUALIZAR.bat` dessa pasta nova**. Ele encontra a instalação, faz uma cópia do
banco, troca os arquivos do sistema (a pasta `dados` e o `.env` ficam como estão) e reinicia o
servidor. Depois a pasta nova pode ser apagada.

Para **gerar o pacote** a partir do código (Linux, macOS ou WSL, com Node.js, git, curl, zip e unzip):
`scripts/empacotar-windows.sh` → `pacotes/BC-Fichas-Control-<versão>-windows.zip`. Ele empacota o
último commit, com o Node.js para Windows conferido pela soma SHA-256 oficial.

### A partir do código-fonte

1. **Instale o Node.js** — baixe a versão **LTS** em <https://nodejs.org> (precisa ser 22.18 ou mais nova) e instale com as opções padrão.
2. **Copie a pasta do sistema** para o servidor, por exemplo `C:\BC-Fichas-Control`.
3. Abra o **PowerShell como Administrador** na pasta e rode
   `Set-ExecutionPolicy -Scope Process Bypass -Force` e depois `.\deploy\windows\instalar-servico.ps1`
   (sem a pasta `node_modules`, ele roda `npm ci` e `npm run build` antes, o que precisa de internet).

Para testar antes de instalar como serviço: `npm start` (Ctrl+C encerra).

### Outros comandos

Executados no **PowerShell como Administrador**:

| Para… | Comando |
| --- | --- |
| Atualizar na própria pasta (depois de copiar os arquivos novos por cima; a pasta `dados` é preservada; com o código-fonte numa instalação feita pelo pacote, apague antes o `pacote.json`) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\atualizar.ps1` |
| Mudar a porta (padrão 3000) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\instalar-servico.ps1 -Porta 8080` |
| Liberar o acesso também com a rede classificada como Pública | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\instalar-servico.ps1 -IncluirRedePublica` |
| Voltar uma cópia do banco (o servidor volta a funcionar no fim, mesmo se der errado) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1 -Arquivo C:\BC-Fichas-Control\dados\backups\<arquivo>.db` |
| Remover o serviço (os dados não são apagados) | `powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\desinstalar-servico.ps1` |

O registro (log) do servidor fica em `C:\BC-Fichas-Control\dados\servidor.log`. Como a pasta é
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

Por segurança, o servidor só responde quando é aberto pelo **endereço IP**, por `localhost` ou
pelo **nome do computador** (ex.: `http://SERVIDOR:3000`). Se a empresa criou outro nome no
roteador ou no DNS (ex.: `http://bcfichas:3000`), coloque-o em `HOSTS_PERMITIDOS` no `.env`
(vários separados por vírgula) e reinicie o servidor. Isso impede que um site malicioso aberto
num computador da rede consiga ler os dados do sistema.

## Dados e backups

- Tudo fica no banco `dados/bc-fichas.db` (SQLite) no servidor.
- O servidor faz **uma cópia automática por dia** em `dados/backups/` (guarda as 30 mais
  recentes) e também antes de restaurar um backup, apagar dados ou atualizar o sistema.
- Em **Configurações → Dados e backup** é possível baixar um backup completo (`.json`),
  restaurar um backup e fazer uma cópia na hora.
- Recomendado: copiar a pasta `dados/backups` para um pendrive, HD externo ou nuvem uma vez por semana.
- Os **arquivos anexados** aos eventos ficam em `dados/anexos` e não vão no backup `.json` (que
  seria grande demais): para guardá-los, copie a pasta `dados` inteira.
- As **cópias assinadas dos contratos** ficam em `dados/contratos` e também não vão no backup
  `.json`: copie a pasta `dados` inteira.
- Os arquivos de eventos excluídos (ou que saíram numa restauração/limpeza) não são apagados:
  vão para `dados/anexos-removidos` e voltam sozinhos se o evento voltar (ex.: ao restaurar uma
  cópia). Essa pasta pode ser apagada à mão quando não precisar mais deles.
- **Apagar todos os dados** fica separado, no fim de Configurações, na **Zona de perigo**: pede para
  digitar `APAGAR` e o servidor guarda uma cópia automática antes. As configurações continuam.
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

## Máquinas e manutenção

- **Quantas máquinas a empresa tem:** em Configurações › Disponibilidade de máquinas, informe
  quantas **Máquinas P** (pequenas) e **Máquinas G** (grandes) existem; o total é a soma. Ao
  aumentar, as novas são cadastradas já numeradas (P-13, P-14…). Ao diminuir, as nunca usadas são
  apagadas e as que têm histórico ficam **desativadas** (o histórico continua guardado); máquinas
  em manutenção ou com eventos de hoje em diante não são retiradas. Também dá para cadastrar uma a
  uma na aba Manutenção.
- **Onde cada máquina está:** no evento, marque os números das máquinas enviadas. Nos dias do
  evento a máquina aparece como **Locada**, com o nome do evento como local. Máquina em outro
  evento nas mesmas datas, em manutenção (para eventos de hoje em diante) ou desativada fica
  apagada e não pode ser marcada; o servidor também recusa. Uma máquina que já estava no evento e
  depois entrou em manutenção não trava a edição: o sistema só avisa. Máquina com manutenção em
  aberto ainda pode ser marcada, com um aviso para conferir se está pronta.
- **Máquinas que ficam com o cliente:** para quem usa só nos fins de semana do mês mas não devolve
  as máquinas no meio da semana, marque no evento **"As máquinas ficam com o cliente entre os dias
  de uso"**. Elas passam a contar como ocupadas do primeiro ao último dia (na agenda, na
  disponibilidade e na escolha das máquinas de outros eventos); as diárias continuam só nos dias
  de uso.
- **Máquina reserva:** além das máquinas do dia (titulares), o cliente pode levar **reservas**:
  máquinas a mais que ficam com ele sem custo, para o caso de alguma dar problema ou de o movimento
  ser grande. Nos dias de utilização, informe as reservas de cada dia (podem mudar de um dia para o
  outro). A reserva conta como máquina fora da empresa (na agenda aparece "4+1"), mas só é cobrada
  se o cliente usar: marque **"Usou a reserva"** no dia (no formulário ou direto no detalhe do
  evento) e ela entra nas diárias pelo mesmo valor da diária. Nas máquinas enviadas, escolha
  "Enviar como: Reserva" (ou clique com o botão direito na máquina) para marcar qual vai como
  reserva. A agenda e o Painel mostram as **reservas paradas** de cada dia: se faltar máquina para
  outro cliente, você sabe onde tem uma sem uso. No resumo em PDF a reserva aparece com a
  explicação de que só é cobrada quando usada; no recibo, a reserva usada vem numa linha própria.
- **Identificação:** no cadastro da máquina, a letra vem do tipo (P ou G) e o número é livre
  (P-07, G-12…). O sistema não aceita duas máquinas com a mesma identificação.
- **Texto das fichas:** o **nome do evento** é o que sai no topo das fichas programadas nas
  máquinas, e o **rodapé** sai no fim de cada ficha (também fecha o resumo em PDF do cliente).
  Eventos antigos que tinham "Local" ou um "Cabeçalho" diferente do nome: o texto foi guardado no
  início das observações do evento.
- **Programação:** cada evento mostra o andamento da programação das máquinas (não iniciada, em
  programação, enviada ao cliente, concluída). O Painel lista os próximos eventos com a programação
  pendente, para a secretária acompanhar.
- **Aluguéis futuros (cliente que já passou as datas do ano):** cadastre o primeiro evento e use
  **Repetir em outras datas** (no menu "…" do evento). Escolha as datas no calendário — ou use
  "Repetir todo mês" (ex.: todo 2º sábado) — e o sistema cria um evento para cada data, com os
  mesmos valores, máquinas por dia e reservas. Cada data é um evento separado, com pagamento,
  recibo e status próprios; as máquinas enviadas são escolhidas perto de cada data. Os eventos
  criados juntos formam uma **série**: o detalhe mostra as outras datas e a lista de eventos pode
  ser filtrada por ela. Para ver tudo o que vem pela frente, use em Eventos o período
  **"Próximos"**, ou a Agenda (que vai para qualquer mês ou ano).
- **Arquivos do evento:** no evento dá para anexar prints da conversa (até colando com Ctrl+V),
  PDFs, imagens, logo e cardápio que o cliente mandou. Imagens e PDFs abrem na própria tela e
  qualquer arquivo pode ser baixado. Ficam no servidor, na pasta `dados/anexos` (até 25 MB cada).
- **Manutenções:** cada serviço feito numa máquina fica registrado na ficha dela: preventiva ou
  corretiva, situação (iniciada, em andamento, concluída ou cancelada), data, os serviços feitos,
  o problema relatado e o responsável. Os serviços são os que você cadastra (ex.: troca de
  cabeçote, higienização, revisão) — dá para cadastrar um novo na hora. Ao registrar a manutenção,
  a máquina pode ir para "Em manutenção"; ao concluir, volta para "Disponível".
- **Reclamações de clientes:** quando a máquina volta de um evento, registre o que o cliente
  relatou (ex.: "estava travando"). A reclamação fica no histórico da máquina, com o evento e o
  cliente, e dela dá para abrir uma manutenção corretiva.

## Cadastro de clientes: empresa, pessoa física ou avulso

- **Empresa (CNPJ):** basta digitar o CNPJ — o servidor consulta a Receita Federal (via
  BrasilAPI, com CNPJ.ws e Minha Receita como alternativas) e preenche razão social, nome
  fantasia, endereço, telefone, e-mail e situação cadastral (com alerta se estiver baixada ou
  inapta). O CNPJ **alfanumérico** (com letras, emitido a partir de julho de 2026) também é
  aceito; enquanto os serviços de consulta não o suportarem, preencha os dados à mão.
- **Pessoa física (CPF):** CPF validado e endereço preenchido pelo CEP.
- **Avulso:** cliente eventual, sem documento — só um nome (ou nem isso). Também dá para criar
  na hora, no lançamento do evento: a opção **"Cliente avulso (sem cadastro)"** fica sempre no
  fim da lista de clientes, e ao digitar um nome que não existe aparece **"Usar como cliente
  avulso"**.

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
