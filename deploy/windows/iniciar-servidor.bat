@echo off
REM Inicia o BC Fichas Control. Usado pela tarefa agendada criada por instalar-servico.ps1,
REM mas também pode ser aberto com dois cliques para testar.
cd /d "%~dp0..\.."
if not exist dados mkdir dados
node server\iniciar.mjs >> dados\servidor.log 2>&1
