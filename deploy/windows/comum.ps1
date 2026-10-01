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
