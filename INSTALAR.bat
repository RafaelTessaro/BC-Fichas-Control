@echo off
REM Instala o BC Fichas Control neste computador: dois cliques e "Sim" no pedido de permissao.
REM (Roda deploy\windows\instalar-servico.ps1 como Administrador.)
setlocal
set "BC_BAT=%~f0"
set "BC_DIR=%~dp0"

REM Aberto de dentro do .zip, sem extrair: os outros arquivos nao estao ao lado
if not exist "%~dp0deploy\windows\instalar-servico.ps1" (
  echo Extraia o arquivo .zip antes: clique com o botao direito nele e escolha "Extrair tudo".
  echo Depois rode este arquivo de dentro da pasta extraida.
  pause
  exit /b 1
)

fltmc >nul 2>&1
if not errorlevel 1 goto :administrador
if /i "%~1"=="elevado" (
  echo Nao foi possivel obter permissao de administrador.
  pause
  exit /b 1
)

REM A janela de administrador nao enxerga unidades de rede mapeadas: a pasta precisa estar no disco
powershell -NoProfile -Command "$p = $env:BC_BAT; if ($p.StartsWith('\\') -or ([IO.DriveInfo]($p.Substring(0, 3))).DriveType -eq 'Network') { exit 3 }"
if errorlevel 3 (
  echo Esta pasta fica na rede. Copie a pasta BC-Fichas-Control para o disco C: e rode de novo.
  pause
  exit /b 1
)

echo Pedindo permissao de administrador...
REM Eleva o cmd.exe com o caminho entre aspas duplas: funciona com espacos, parenteses ou "&" na pasta
REM (pedir a elevacao do proprio .bat falha, por exemplo, em "...windows (1)", nome comum de download repetido)
powershell -NoProfile -Command "$q = [char]34; Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\cmd.exe') -ArgumentList ('/d /c ' + $q + $q + $env:BC_BAT + $q + ' elevado' + $q) -Verb RunAs"
if errorlevel 1 pause
exit /b

:administrador
cd /d "%~dp0"
REM Tira a marca de "baixado da internet" dos scripts (uma politica de grupo poderia bloquea-los)
powershell -NoProfile -Command "Get-ChildItem -LiteralPath (Join-Path $env:BC_DIR 'deploy\windows') -Filter *.ps1 | Unblock-File"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\windows\instalar-servico.ps1"
echo.
pause
