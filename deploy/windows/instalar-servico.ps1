<#
  Instala o BC Fichas Control para iniciar sozinho com o Windows (antes mesmo de alguém fazer login)
  e libera a porta no Firewall para os outros computadores da rede.

  Como usar: clique com o botão direito em "Windows PowerShell" > "Executar como administrador" e rode:
    cd C:\BC-Fichas\deploy\windows
    Set-ExecutionPolicy -Scope Process Bypass
    .\instalar-servico.ps1
#>
param(
  [int]$Porta = 3000,
  [string]$NomeTarefa = 'BC Fichas Control'
)

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$bat = Join-Path $PSScriptRoot 'iniciar-servidor.bat'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Execute este script como Administrador.'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error 'Node.js não encontrado. Instale a versão LTS em https://nodejs.org e rode novamente.' }
Write-Host "Node.js encontrado: $(node --version)"

if (-not (Test-Path (Join-Path $raiz 'dist\index.html'))) {
  Write-Host 'Compilando a interface (npm run build)...'
  Push-Location $raiz
  npm run build
  Pop-Location
}

# Tarefa agendada: inicia com o Windows como SYSTEM e reinicia se o processo cair
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$config = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$usuario = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Unregister-ScheduledTask -TaskName $NomeTarefa -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $NomeTarefa -Action $acao -Trigger $gatilho -Settings $config -Principal $usuario | Out-Null
Write-Host "Tarefa '$NomeTarefa' criada."

# Firewall: libera a porta apenas para redes privadas/de domínio (rede da empresa)
Get-NetFirewallRule -DisplayName $NomeTarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $NomeTarefa -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Private,Domain | Out-Null
Write-Host "Porta $Porta liberada no Firewall (redes privadas e de domínio)."

Start-ScheduledTask -TaskName $NomeTarefa
Start-Sleep -Seconds 4

$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress
Write-Host ''
Write-Host 'Pronto! Acesse de qualquer computador da rede:' -ForegroundColor Green
foreach ($ip in $ips) { Write-Host "  http://$($ip):$Porta" -ForegroundColor Green }
Write-Host ''
Write-Host "Registro do servidor: $raiz\dados\servidor.log"
