# Funções compartilhadas pelos scripts de instalação, atualização e restauração.

$script:NomeTarefa = 'BC Fichas Control'
# ProviderPath: caminho do sistema de arquivos mesmo em pasta de rede (o .Path traria o prefixo do PowerShell)
$script:Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).ProviderPath
# Separador de pastas (no Windows, "\"; vale também nos testes fora do Windows)
$script:Sep = [IO.Path]::DirectorySeparatorChar
# Ferramentas desta cópia dos scripts (na atualização, as do pacote novo, que estão completas)
$script:Ferramentas = Join-Path $script:Raiz 'server\ferramentas'

function Confirmar-Administrador {
  $eu = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $eu.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute este script como Administrador (clique com o botão direito no PowerShell > Executar como administrador).'
  }
}

# Usa o Node.js que vem no pacote completo (pasta "node"); sem ela, o Node.js instalado no Windows.
function Exigir-Node {
  $embutido = Join-Path $script:Raiz 'node'
  if (Test-Path (Join-Path $embutido 'node.exe')) { $env:Path = "$embutido;$env:Path" }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js não encontrado. Use o pacote completo (já traz o Node.js) ou instale a versão LTS em https://nodejs.org e rode novamente.'
  }
  & node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)"
  if ($LASTEXITCODE -ne 0) {
    throw "O Node.js instalado ($(node --version)) é antigo demais. Instale a versão LTS em https://nodejs.org (precisa ser 22.18 ou mais nova)."
  }
}

# Pastas de usuário (Downloads, Área de Trabalho, OneDrive) não servem para o sistema: podem ser
# limpas ou sincronizadas, e a proteção da pasta tiraria o acesso do próprio usuário a elas.
function Exigir-PastaFixa {
  $usuarios = Join-Path $env:SystemDrive 'Users'
  if ($script:Raiz.StartsWith("$usuarios\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "A pasta do sistema está em $($script:Raiz). Mova a pasta BC-Fichas-Control para C:\ (fica C:\BC-Fichas-Control) e rode de novo a partir de lá."
  }
}

# Executa um comando externo (npm, node) e interrompe o script se ele falhar.
function Executar([string]$Descricao, [scriptblock]$Comando) {
  Write-Host $Descricao
  # Out-Host: a saída do comando vai para a tela, sem virar "valor de retorno" da função
  & $Comando | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$Descricao falhou (código $LASTEXITCODE)." }
}

# Pasta onde o sistema está instalado (a da tarefa agendada), ou $null se não estiver instalado.
function Pasta-Instalada {
  $tarefa = Get-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue
  if (-not $tarefa) { return $null }
  $pasta = @($tarefa.Actions)[0].WorkingDirectory
  if ([string]::IsNullOrWhiteSpace($pasta)) { return $null }
  return $pasta.TrimEnd($script:Sep)
}

# Compara duas pastas do Windows (sem diferenciar maiúsculas nem a barra final).
function Mesma-Pasta([string]$A, [string]$B) {
  return [string]::Equals($A.TrimEnd($script:Sep), $B.TrimEnd($script:Sep), [StringComparison]::OrdinalIgnoreCase)
}

# $Pasta é $Raiz ou fica dentro dela.
function Dentro-De([string]$Pasta, [string]$Raiz) {
  return (Mesma-Pasta $Pasta $Raiz) -or $Pasta.StartsWith($Raiz.TrimEnd($script:Sep) + $script:Sep, [StringComparison]::OrdinalIgnoreCase)
}

# Lê uma variável do .env exatamente como o servidor lê (o próprio Node interpreta o arquivo,
# aceitando aspas, "export" etc.). Devolve $Padrao se não houver .env ou a variável.
# O valor volta em base64: a saída de programas é decodificada na página de código do console
# (850 no Windows em português), que estragaria acentos (ex.: PASTA_DADOS=D:\Locação).
function Ler-Variavel([string]$Nome, [string]$Padrao) {
  $arquivoEnv = Join-Path $script:Raiz '.env'
  if (-not (Test-Path $arquivoEnv)) { return $Padrao }
  $codigo = "try { process.loadEnvFile(process.argv[1]) } catch {} ; process.stdout.write(Buffer.from(process.env[process.argv[2]] ?? '').toString('base64'))"
  $valor = & node -e $codigo $arquivoEnv $Nome 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($valor)) { return $Padrao }
  $texto = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(([string]$valor).Trim()))
  if ([string]::IsNullOrWhiteSpace($texto)) { return $Padrao }
  return $texto.Trim()
}

# PORTA do .env (ou 3000).
function Ler-Porta {
  $valor = Ler-Variavel 'PORTA' '3000'
  $porta = 0
  if ([int]::TryParse($valor, [ref]$porta) -and $porta -gt 0) { return $porta }
  return 3000
}

# Pasta de dados (PASTA_DADOS do .env; relativa à pasta do sistema, como no servidor), já sem ".." etc.
function Pasta-Dados {
  $valor = Ler-Variavel 'PASTA_DADOS' 'dados'
  if (-not [IO.Path]::IsPathRooted($valor)) { $valor = Join-Path $script:Raiz $valor }
  return [IO.Path]::GetFullPath($valor).TrimEnd($script:Sep)
}

# Grava/atualiza PORTA no .env (criado a partir do .env.exemplo se não existir).
function Gravar-Porta([int]$Porta) {
  $arquivoEnv = Join-Path $script:Raiz '.env'
  if (-not (Test-Path $arquivoEnv)) { Copy-Item (Join-Path $script:Raiz '.env.exemplo') $arquivoEnv }
  $linhas = [IO.File]::ReadAllLines($arquivoEnv)
  if ($linhas -match '^\s*PORTA\s*=') { $linhas = $linhas -replace '^\s*PORTA\s*=.*$', "PORTA=$Porta" }
  else { $linhas += "PORTA=$Porta" }
  # UTF-8 sem BOM (o BOM atrapalharia a leitura da primeira linha pelo Node)
  [IO.File]::WriteAllLines($arquivoEnv, [string[]]$linhas)
}

# Para a tarefa e o processo node do sistema.
function Parar-Servidor {
  Stop-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like '*server\iniciar.mjs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 1
}

# Espera o servidor responder (até ~40 s: no primeiro início o antivírus examina o node.exe).
# Devolve a resposta de /api/saude ou $null.
function Esperar-Servidor([int]$Porta) {
  for ($i = 0; $i -lt 20; $i++) {
    try {
      # 127.0.0.1: o servidor escuta em IPv4; "localhost" tentaria antes o IPv6 (::1) e demoraria
      return Invoke-RestMethod -Uri "http://127.0.0.1:$Porta/api/saude" -TimeoutSec 3 -UseBasicParsing
    } catch { Start-Sleep -Seconds 2 }
  }
  return $null
}

function Nome-Copia([string]$Motivo) {
  $pasta = Join-Path (Pasta-Dados) 'backups'
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  return Join-Path $pasta ("bc-fichas_{0}_{1}.db" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'), $Motivo)
}

# Cópia consistente do banco (aplica o -wal deixado por um encerramento forçado).
function Copiar-Banco([string]$Motivo) {
  $banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
  if (-not (Test-Path $banco)) { return $null }
  $destino = Nome-Copia $Motivo
  Executar "Copiando o banco de dados ($Motivo)..." { node (Join-Path $script:Ferramentas 'copiar-banco.mjs') $banco $destino }
  return $destino
}

# Cópia dos arquivos do banco como estão (.db, -wal, -shm), para quando a cópia consistente
# falha (ex.: banco corrompido). Abrir a cópia .db no SQLite aplica o -wal que estiver ao lado.
function Copiar-Bruto([string]$Motivo) {
  $banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
  if (-not (Test-Path $banco)) { return $null }
  $destino = Nome-Copia "$Motivo-bruto"
  Copy-Item -LiteralPath $banco -Destination $destino
  foreach ($sufixo in '-wal', '-shm') {
    if (Test-Path -LiteralPath "$banco$sufixo") { Copy-Item -LiteralPath "$banco$sufixo" -Destination "$destino$sufixo" }
  }
  return $destino
}

# Somente SYSTEM e Administradores podem alterar os arquivos do sistema e ler os dados
# (a tarefa roda como SYSTEM; uma pasta gravável por usuários comuns permitiria elevar privilégios).
function Proteger-Pasta {
  $pastas = @($script:Raiz)
  # Se os dados ficam fora da pasta do sistema (PASTA_DADOS no .env), protege-os também
  $dados = Pasta-Dados
  if (-not (Dentro-De $dados $script:Raiz)) {
    New-Item -ItemType Directory -Force -Path $dados | Out-Null
    $pastas += $dados
  }
  $ok = $true
  foreach ($pasta in $pastas) {
    # Dono = Administradores (o dono sempre pode mudar permissões; um usuário comum que tenha
    # copiado os arquivos continuaria podendo liberar o acesso para si)
    & icacls $pasta /setowner '*S-1-5-32-544' /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { $ok = $false }
    # Só SYSTEM (S-1-5-18) e Administradores (S-1-5-32-544), herdado por tudo abaixo
    & icacls $pasta /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { $ok = $false }
    # Subpastas e arquivos voltam a herdar (remove permissões trazidas por cópias)
    & icacls (Join-Path $pasta '*') /reset /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { $ok = $false }
  }
  if (-not $ok) { Write-Warning 'Não foi possível ajustar todas as permissões (icacls). Confira a pasta manualmente.' }
}

# Tira a marca de "baixado da internet" dos scripts (uma política de grupo poderia bloqueá-los).
function Desbloquear-Scripts([string]$Pasta) {
  Get-ChildItem -LiteralPath (Join-Path $Pasta 'deploy\windows') -Filter *.ps1 -ErrorAction SilentlyContinue |
    Unblock-File -ErrorAction SilentlyContinue
}

# ---- Usuários e senhas ----------------------------------------------------------------

$script:AvisoSemAdministrador = 'Ninguém consegue entrar no sistema até criar o administrador: neste computador, clique em Iniciar, digite BC Fichas e abra "Redefinir senha do BC Fichas" (ou procure em Todos os aplicativos > BC Fichas Control).'

# Roda a ferramenta de usuários (server\ferramentas\redefinir-senha.mjs) e devolve a resposta já
# convertida; um erro da ferramenta vira exceção com a mensagem dela. Entrada e resposta passam em
# base64 do UTF-8: o console usaria a página de código 850 e estragaria acentos (ex.: "João — Recepção"
# ou uma senha com "ç").
function Ferramenta-Usuarios([string]$Comando, [string[]]$Argumentos = @(), [string]$Entrada) {
  # Local: com 'Stop', uma linha no stderr do node viraria erro no Windows PowerShell
  $ErrorActionPreference = 'Continue'
  $ferramenta = Join-Path $script:Ferramentas 'redefinir-senha.mjs'
  $global:LASTEXITCODE = -1
  if ($PSBoundParameters.ContainsKey('Entrada')) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Entrada))
    $saida = $b64 | & node $ferramenta $Comando @Argumentos --base64 2>$null
  } else {
    $saida = & node $ferramenta $Comando @Argumentos --base64 2>$null
  }
  $codigo = $LASTEXITCODE
  $resposta = $null
  $texto = (@($saida) -join '').Trim()
  if ($texto) {
    try { $resposta = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($texto)) | ConvertFrom-Json }
    catch { $resposta = $null }
  }
  if ($codigo -ne 0) {
    if ($resposta -and $resposta.erro) { throw [string]$resposta.erro }
    throw "A ferramenta de usuários falhou (código $codigo)."
  }
  if ($null -eq $resposta) { throw 'A ferramenta de usuários não respondeu.' }
  return $resposta
}

# Texto digitado (já sem espaços nas pontas).
function Ler-Texto([string]$Pergunta) {
  return ([string](Read-Host $Pergunta)).Trim()
}

# Pergunta até a resposta ser S ou N.
function Perguntar-SimNao([string]$Pergunta) {
  while ($true) {
    $resposta = Ler-Texto $Pergunta
    if ($resposta -match '^s') { return $true }
    if ($resposta -match '^n') { return $false }
    Write-Host 'Responda S (sim) ou N (não).' -ForegroundColor Red
  }
}

# Nome de quem vai usar a conta: obrigatório e com até 60 caracteres, como na tela (assim, se o "definir"
# recusar algo com a senha digitada, o problema é a senha).
function Ler-Nome([string]$Pergunta) {
  while ($true) {
    $nome = Ler-Texto $Pergunta
    if ($nome -and $nome.Length -le 60) { return $nome }
    if ($nome) { Write-Host 'O nome pode ter até 60 caracteres.' -ForegroundColor Red }
  }
}

# Confere o usuário digitado com a mesma regra do sistema (shared/usuarios.ts): o erro, ou $null se
# serve. Na hora, antes de pedir a senha (o servidor continua sendo quem decide).
function Erro-Usuario([string]$Login) {
  $l = $Login.Normalize([Text.NormalizationForm]::FormC).ToLowerInvariant()
  # -cmatch: com o -match comum, o [a-z] aceitaria também maiúsculas e outras letras
  if ($l -cmatch '^[a-z0-9][a-z0-9._-]{2,31}$') { return $null }
  return 'Usuário inválido: use de 3 a 32 letras sem acento, números, ponto, hífen ou sublinhado, sem espaços (ex.: fabio ou maria.souza).'
}

# Texto de uma senha lida com Read-Host -AsSecureString; a cópia em memória não gerenciada é zerada.
function Texto-Da-Senha([Security.SecureString]$Segura) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Segura)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Pede a senha duas vezes, sem mostrar. Enter vazio: o sistema gera uma temporária (troca obrigatória
# no primeiro acesso). Senha digitada para outra pessoa também vira temporária.
# Devolve @{ Senha = '' ou a digitada; TrocarSenha = $true ou $false }.
function Perguntar-Senha {
  while ($true) {
    $senha = Texto-Da-Senha (Read-Host 'Senha (não aparece ao digitar; Enter = gerar uma senha temporária)' -AsSecureString)
    if ($senha -eq '') { return @{ Senha = ''; TrocarSenha = $true } }
    $repetida = Texto-Da-Senha (Read-Host 'Repita a senha' -AsSecureString)
    if ($senha -cne $repetida) {
      Write-Host 'As duas senhas não são iguais. Digite de novo.' -ForegroundColor Red
      continue
    }
    $propria = Perguntar-SimNao 'Quem vai usar esta conta é você mesmo, agora? (S/N)'
    return @{ Senha = $senha; TrocarSenha = -not $propria }
  }
}

# Pede a senha e roda o "definir" com $Entrada (login, nome, tornarAdmin). Senha recusada (comum demais,
# com o nome...): diz o motivo e pede só a senha de novo; Enter gera uma temporária, que sempre passa.
# Outro erro: mostra e devolve $null (quem chamou recomeça). Deu certo: a resposta da ferramenta.
function Definir-ComSenha([string]$Banco, [hashtable]$Entrada) {
  while ($true) {
    $senha = Perguntar-Senha
    $Entrada.senha = $senha.Senha
    $Entrada.trocarSenha = $senha.TrocarSenha
    try {
      return Ferramenta-Usuarios 'definir' @($Banco) ($Entrada | ConvertTo-Json -Compress)
    } catch {
      if (-not $senha.Senha) {
        Write-Host "Não deu certo: $($_.Exception.Message)" -ForegroundColor Red
        return $null
      }
      Write-Host "Senha recusada: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host 'Digite outra senha (ou Enter para o sistema gerar uma temporária).'
    }
  }
}

# Lista de usuários da ferramenta (situacao), administradores primeiro.
function Mostrar-Usuarios($Lista) {
  foreach ($u in @($Lista)) {
    $nivel = if ($u.nivel -eq 'ADMIN') { 'Administrador' } else { 'Comum' }
    $desativado = if ($u.ativo) { '' } else { ' (desativado)' }
    Write-Host ('  {0,-20} {1} - {2}{3}' -f $u.login, $u.nome, $nivel, $desativado)
  }
}

# Resultado do "definir": usuário, senha temporária e o que acontece no próximo acesso.
function Mostrar-ContaDefinida($Resultado) {
  $nivel = if ($Resultado.nivel -eq 'ADMIN') { 'Administrador' } else { 'Comum' }
  $feito = if ($Resultado.criado) { 'Conta criada' } else { 'Senha redefinida' }
  Write-Host ''
  Write-Host "$($feito): $($Resultado.nome) ($nivel)" -ForegroundColor Green
  Write-Host "  Usuário: $($Resultado.login)" -ForegroundColor Green
  if ($Resultado.senhaTemporaria) {
    Write-Host "  Senha temporária: $($Resultado.senhaTemporaria)" -ForegroundColor Green
    $quando = if ($Resultado.criado) { 'No primeiro acesso' } else { 'Na próxima entrada' }
    Write-Host "  Anote. $quando o sistema pede para trocar a senha." -ForegroundColor Yellow
  } elseif ($Resultado.trocarSenha) {
    Write-Host '  Na próxima entrada o sistema pede para trocar a senha.' -ForegroundColor Yellow
  }
}

# Na instalação, na atualização e na restauração de uma cópia: sem administrador ativo, ninguém entra
# no sistema, e ele só é criado aqui, no computador do servidor. Pergunta até criar (ou até a pessoa
# digitar PULAR). Nunca interrompe o script que a chamou: qualquer problema vira aviso.
function Garantir-Administrador([switch]$SemPerguntas) {
  try {
    $banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
    if (-not (Test-Path -LiteralPath $banco)) {
      Write-Warning "O banco de dados ainda não existe (o servidor não chegou a iniciar). $script:AvisoSemAdministrador"
      return
    }
    $situacao = Ferramenta-Usuarios 'situacao' @($banco)
    if ($situacao.administradoresAtivos -gt 0) { return }
    if ($SemPerguntas -or -not [Environment]::UserInteractive) {
      Write-Warning "Nenhum administrador cadastrado. $script:AvisoSemAdministrador"
      return
    }
    Write-Host ''
    Write-Host 'O sistema agora pede usuário e senha. Vamos criar o ADMINISTRADOR (acesso a tudo). Ninguém entra no sistema antes disso.' -ForegroundColor Yellow
    $lista = @($situacao.lista)
    if ($situacao.usuarios -gt 0) {
      Write-Host 'Há usuários cadastrados, mas nenhum administrador ativo. Para tornar um deles administrador, digite o usuário dele (a primeira coluna) quando a janela pedir o usuário:' -ForegroundColor Yellow
      Mostrar-Usuarios $lista
    }
    # O usuário primeiro (como no Redefinir senha): uma conta que já existe vira administrador sem mudar o nome
    for ($tentativa = 1; $tentativa -le 20; $tentativa++) {
      Write-Host ''
      $login = Ler-Texto 'Usuário para entrar no sistema (sem acentos nem espaços, ex.: fabio; Enter = admin; PULAR para deixar para depois)'
      if ($login -eq 'PULAR') { break }
      if (-not $login) { $login = 'admin' }
      $erroLogin = Erro-Usuario $login
      if ($erroLogin) {
        Write-Host $erroLogin -ForegroundColor Red
        continue
      }
      $entrada = @{ login = $login; tornarAdmin = $true }
      $conta = $lista | Where-Object { $_.login -eq $login } | Select-Object -First 1
      if ($conta) {
        Write-Host "Vamos tornar $($conta.nome) administrador." -ForegroundColor Yellow
        if (-not $conta.ativo) { Write-Host 'Esta conta está desativada: com a senha nova, ela volta a ficar ativa.' -ForegroundColor Yellow }
      } else {
        $entrada.nome = Ler-Nome 'Nome de quem vai administrar (ex.: Fabio Souza)'
      }
      $resultado = Definir-ComSenha $banco $entrada
      if ($resultado) {
        Mostrar-ContaDefinida $resultado
        Write-Host '  Entre no sistema com este usuário e cadastre os funcionários em Administração > Usuários.' -ForegroundColor Green
        return
      }
      Write-Host 'Vamos tentar de novo.'
    }
    Write-Host $script:AvisoSemAdministrador -ForegroundColor Red
  } catch {
    Write-Warning "Não foi possível conferir o administrador ($($_.Exception.Message)). $script:AvisoSemAdministrador"
  }
}

# Pasta do sistema no Menu Iniciar (para todos os usuários do computador).
function Pasta-MenuIniciar {
  return Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\BC Fichas Control'
}

# Comando do atalho: pede a elevação e roda o REDEFINIR-SENHA.bat da pasta num cmd de administrador.
# O PowerShell do atalho (sem elevação) não lê nada da pasta protegida; só o cmd elevado lê.
function Comando-AtalhoRedefinirSenha([string]$Pasta) {
  $bat = ($Pasta.TrimEnd('\') + '\REDEFINIR-SENHA.bat').Replace("'", "''")
  return "Start-Process -FilePath `$env:ComSpec -ArgumentList '/d /c `"`"$bat`" elevado`"' -Verb RunAs"
}

# Atalho "Redefinir senha do BC Fichas" no Menu Iniciar. É por ele que o dono cria o administrador ou
# redefine uma senha: abrir a pasta instalada pelo Explorer gravaria a conta dele nas permissões da pasta.
function Criar-AtalhoRedefinirSenha([string]$Pasta) {
  try {
    $menu = Pasta-MenuIniciar
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    $codificado = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes((Comando-AtalhoRedefinirSenha $Pasta)))
    $atalho = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $menu 'Redefinir senha do BC Fichas.lnk'))
    $atalho.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $atalho.Arguments = "-NoProfile -WindowStyle Hidden -EncodedCommand $codificado"
    $atalho.WorkingDirectory = Join-Path $env:SystemRoot 'System32'
    $atalho.Description = 'Cria o administrador ou redefine a senha de um usuário do BC Fichas Control'
    $atalho.Save()
    Write-Host 'Atalho criado: no Iniciar, digite BC Fichas e abra "Redefinir senha do BC Fichas" (ou procure em Todos os aplicativos > BC Fichas Control).'
  } catch {
    Write-Warning "Não foi possível criar o atalho no Menu Iniciar ($($_.Exception.Message)). Para criar o administrador ou redefinir uma senha, use o REDEFINIR-SENHA.bat do pacote do sistema."
  }
}

function Remover-AtalhoRedefinirSenha {
  Remove-Item -LiteralPath (Pasta-MenuIniciar) -Recurse -Force -ErrorAction SilentlyContinue
}
