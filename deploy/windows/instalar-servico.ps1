<#
  Instala o BC Fichas Control para iniciar sozinho com o Windows (antes mesmo de alguém fazer login),
  reiniciar se parar, e libera a porta no Firewall para os outros computadores da rede.

  Como usar (PowerShell como Administrador):
    cd C:\BC-Fichas
    Set-ExecutionPolicy -Scope Process Bypass
    npm ci
    npm run build
    .\deploy\windows\instalar-servico.ps1            # usa a PORTA do .env (ou 3000)
    .\deploy\windows\instalar-servico.ps1 -Porta 8080  # grava PORTA=8080 no .env

  -IncluirRedePublica: libera a porta também quando o Windows classifica a rede como "Pública"
  (prefira marcar a rede da empresa como "Privada" — veja o aviso no final).
#>
param(
  [int]$Porta = 0,
  [switch]$IncluirRedePublica
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'comum.ps1')

Confirmar-Administrador
Exigir-Node
Write-Host "Node.js encontrado: $(node --version)"

if ($Porta -gt 0) { Gravar-Porta $Porta } else { $Porta = Ler-Porta }

Push-Location $script:Raiz
try {
  if (-not (Test-Path 'node_modules')) { Executar 'Instalando dependências (npm ci)...' { npm.cmd ci } }
  if (-not (Test-Path 'dist\index.html')) { Executar 'Compilando a interface (npm run build)...' { npm.cmd run build } }
} finally { Pop-Location }

Proteger-Pasta

# Tarefa agendada: inicia com o Windows como SYSTEM; o .bat (modo "servico") reinicia o node se ele parar
$bat = Join-Path $PSScriptRoot 'iniciar-servidor.bat'
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"`"$bat`" servico`"" -WorkingDirectory $script:Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Parar-Servidor
Unregister-ScheduledTask -TaskName $script:NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $script:NomeTarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $usuario | Out-Null
Write-Host "Tarefa '$($script:NomeTarefa)' criada."

# Firewall: libera a porta para a rede da empresa
Get-NetFirewallRule -DisplayName $script:NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$perfis = if ($IncluirRedePublica) { 'Private,Domain,Public' } else { 'Private,Domain' }
New-NetFirewallRule -DisplayName $script:NomeTarefa -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile $perfis | Out-Null
Write-Host "Porta $Porta liberada no Firewall ($perfis)."

Start-ScheduledTask -TaskName $script:NomeTarefa
Start-Sleep -Seconds 4

try {
  $saude = Invoke-RestMethod -Uri "http://localhost:$Porta/api/saude" -TimeoutSec 5
  Write-Host "Servidor respondendo (versão $($saude.versao))." -ForegroundColor Green
} catch {
  Write-Warning "O servidor ainda não respondeu em http://localhost:$Porta. Veja o registro: $($script:Raiz)\dados\servidor.log"
}

$publicas = @(Get-NetConnectionProfile | Where-Object NetworkCategory -eq 'Public')
if ($publicas.Count -gt 0 -and -not $IncluirRedePublica) {
  Write-Host ''
  foreach ($r in $publicas) {
    Write-Warning "A rede '$($r.Name)' ($($r.InterfaceAlias)) está classificada como PÚBLICA: os outros computadores NÃO conseguirão acessar."
    Write-Host "  Se for a rede da empresa, marque-a como privada com:" -ForegroundColor Yellow
    Write-Host "  Set-NetConnectionProfile -InterfaceIndex $($r.InterfaceIndex) -NetworkCategory Private" -ForegroundColor Yellow
  }
}

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Acesse de qualquer computador da rede:' -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  http://$($ip):$Porta" -ForegroundColor Green }
Write-Host ''
Write-Host "Registro do servidor: $($script:Raiz)\dados\servidor.log"
