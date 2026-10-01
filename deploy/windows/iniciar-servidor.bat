@echo off
REM Inicia o BC Fichas Control.
REM  - Com dois cliques: roda uma vez (bom para testar; feche a janela para parar).
REM  - Pela tarefa agendada (argumento "servico"): se o servidor parar por qualquer motivo,
REM    ele e iniciado de novo depois de 5 segundos.
cd /d "%~dp0..\.."
if not exist dados mkdir dados

:inicio
node server\iniciar.mjs >> dados\servidor.log 2>&1
if /i not "%~1"=="servico" goto :eof
echo [%date% %time%] servidor parou (codigo %errorlevel%); reiniciando em 5 s >> dados\servidor.log
REM "ping" funciona como espera mesmo sem console (o "timeout" falha quando roda como SYSTEM)
ping -n 6 127.0.0.1 >nul
goto inicio
