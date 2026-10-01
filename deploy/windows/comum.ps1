# Funções compartilhadas pelos scripts de instalação, atualização e restauração.

$script:NomeTarefa = 'BC Fichas Control'
$script:Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Confirmar-Administrador {
  $eu = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $eu.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Execute este script como Administrador (clique com o botão direito no PowerShell > Executar como administrador).'
  }
}

function Exigir-Node {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js não encontrado. Instale a versão LTS em https://nodejs.org e rode novamente.'
  }
}

# Executa um comando externo (npm, node) e interrompe o script se ele falhar.
function Executar([string]$Descricao, [scriptblock]$Comando) {
  Write-Host $Descricao
  # Out-Host: a saída do comando vai para a tela, sem virar "valor de retorno" da função
  & $Comando | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$Descricao falhou (código $LASTEXITCODE). Nada foi alterado no serviço; corrija e rode de novo." }
}

# Lê PORTA do .env (ou 3000).
function Ler-Porta {
  $arquivoEnv = Join-Path $script:Raiz '.env'
  if (Test-Path $arquivoEnv) {
    $m = Select-String -Path $arquivoEnv -Pattern '^\s*PORTA\s*=\s*(\d+)' | Select-Object -First 1
    if ($m) { return [int]$m.Matches[0].Groups[1].Value }
  }
  return 3000
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

# Cópia consistente do banco (aplica o -wal deixado por um encerramento forçado).
function Copiar-Banco([string]$Motivo) {
  $banco = Join-Path $script:Raiz 'dados\bc-fichas.db'
  if (-not (Test-Path $banco)) { return $null }
  $pasta = Join-Path $script:Raiz 'dados\backups'
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  $destino = Join-Path $pasta ("bc-fichas_{0}_{1}.db" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'), $Motivo)
  Executar "Copiando o banco de dados ($Motivo)..." { node (Join-Path $script:Raiz 'server\ferramentas\copiar-banco.mjs') $banco $destino }
  return $destino
}

# Somente SYSTEM e Administradores podem alterar os arquivos do sistema e ler os dados
# (a tarefa roda como SYSTEM; uma pasta gravável por usuários comuns permitiria elevar privilégios).
function Proteger-Pasta {
  # Raiz: só SYSTEM (S-1-5-18) e Administradores (S-1-5-32-544), herdado por tudo abaixo
  & icacls $script:Raiz /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  # Subpastas e arquivos voltam a herdar da raiz (remove permissões trazidas por cópias)
  & icacls (Join-Path $script:Raiz '*') /reset /T /C /Q | Out-Null
  if (-not $ok -or $LASTEXITCODE -ne 0) { Write-Warning 'Não foi possível ajustar todas as permissões da pasta (icacls).' }
}
