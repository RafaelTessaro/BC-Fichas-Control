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

# Lê uma variável do .env exatamente como o servidor lê (o próprio Node interpreta o arquivo,
# aceitando aspas, "export" etc.). Devolve $Padrao se não houver .env ou a variável.
function Ler-Variavel([string]$Nome, [string]$Padrao) {
  $arquivoEnv = Join-Path $script:Raiz '.env'
  if (-not (Test-Path $arquivoEnv)) { return $Padrao }
  $codigo = "try { process.loadEnvFile(process.argv[1]) } catch {} ; process.stdout.write(process.env[process.argv[2]] ?? '')"
  $valor = & node -e $codigo $arquivoEnv $Nome 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($valor)) { return $Padrao }
  return $valor.Trim()
}

# PORTA do .env (ou 3000).
function Ler-Porta {
  $valor = Ler-Variavel 'PORTA' '3000'
  $porta = 0
  if ([int]::TryParse($valor, [ref]$porta) -and $porta -gt 0) { return $porta }
  return 3000
}

# Pasta de dados (PASTA_DADOS do .env; relativa à pasta do sistema, como no servidor).
function Pasta-Dados {
  $valor = Ler-Variavel 'PASTA_DADOS' 'dados'
  if ([IO.Path]::IsPathRooted($valor)) { return $valor }
  return (Join-Path $script:Raiz $valor)
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
  $banco = Join-Path (Pasta-Dados) 'bc-fichas.db'
  if (-not (Test-Path $banco)) { return $null }
  $pasta = Join-Path (Pasta-Dados) 'backups'
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  $destino = Join-Path $pasta ("bc-fichas_{0}_{1}.db" -f (Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'), $Motivo)
  Executar "Copiando o banco de dados ($Motivo)..." { node (Join-Path $script:Raiz 'server\ferramentas\copiar-banco.mjs') $banco $destino }
  return $destino
}

# Somente SYSTEM e Administradores podem alterar os arquivos do sistema e ler os dados
# (a tarefa roda como SYSTEM; uma pasta gravável por usuários comuns permitiria elevar privilégios).
function Proteger-Pasta {
  $pastas = @($script:Raiz)
  # Se os dados ficam fora da pasta do sistema (PASTA_DADOS no .env), protege-os também
  $dados = Pasta-Dados
  if (-not $dados.StartsWith($script:Raiz, [StringComparison]::OrdinalIgnoreCase)) {
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
