# Funções compartilhadas pelos scripts de instalação, atualização e restauração.

$script:NomeTarefa = 'BC Fichas Control'
$script:Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

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
  if ($LASTEXITCODE -ne 0) { throw "$Descricao falhou (código $LASTEXITCODE). Nada foi alterado no serviço; corrija e rode de novo." }
}

# Pasta onde o sistema está instalado (a da tarefa agendada), ou $null se não estiver instalado.
function Pasta-Instalada {
  $tarefa = Get-ScheduledTask -TaskName $script:NomeTarefa -ErrorAction SilentlyContinue
  if (-not $tarefa) { return $null }
  $pasta = @($tarefa.Actions)[0].WorkingDirectory
  if ([string]::IsNullOrWhiteSpace($pasta)) { return $null }
  return $pasta.TrimEnd('\')
}

# Compara duas pastas do Windows (sem diferenciar maiúsculas nem a barra final).
function Mesma-Pasta([string]$A, [string]$B) {
  return [string]::Equals($A.TrimEnd('\'), $B.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)
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
