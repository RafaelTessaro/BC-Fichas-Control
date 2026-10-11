#!/usr/bin/env bash
# Gera o pacote completo para Windows: código do sistema + interface já compilada + dependências do
# servidor + Node.js portátil. No servidor basta extrair em C:\ e dar dois cliques em INSTALAR.bat
# (sem internet e sem instalar o Node.js).
#
# Uso: scripts/empacotar-windows.sh [pasta de saída]     (padrão: ./pacotes)
# Empacota o último commit (HEAD), não alterações ainda não commitadas.
set -euo pipefail

NODE_VERSAO="${NODE_VERSAO:-24.21.0}"
raiz="$(cd "$(dirname "$0")/.." && pwd)"
saida="${1:-$raiz/pacotes}"
mkdir -p "$saida"
saida="$(cd "$saida" && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
pacote="$tmp/BC-Fichas-Control"
# Versão e código vêm do mesmo lugar: o último commit
versao="$(git -C "$raiz" show HEAD:package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
commit="$(git -C "$raiz" rev-parse --short HEAD)"
if [ -n "$(git -C "$raiz" status --porcelain)" ]; then
  echo "Atenção: há alterações não commitadas; elas NÃO entram no pacote (só o commit $commit)." >&2
fi

echo "Código do commit $commit..."
git -C "$raiz" archive --format=tar --prefix=BC-Fichas-Control/ HEAD | tar -x -C "$tmp"

echo "Compilando a interface..."
(cd "$pacote" && npm ci --no-audit --no-fund --loglevel=error && npm run build && rm -rf node_modules)

echo "Dependências do servidor..."
(cd "$pacote" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
# O npm deixa pastas vazias dos escopos das dependências de desenvolvimento (@types, @vitejs...)
find "$pacote/node_modules" -mindepth 1 -maxdepth 1 -type d -empty -delete
# Só JavaScript puro funciona igual no Windows: um módulo nativo (.node) compilado aqui não serviria lá
if find "$pacote/node_modules" -name '*.node' | grep -q .; then
  echo "ERRO: dependência com módulo nativo; o pacote não funcionaria no Windows." >&2
  exit 1
fi

echo "Node.js $NODE_VERSAO para Windows..."
zipNode="node-v$NODE_VERSAO-win-x64.zip"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/bc-fichas-control"
mkdir -p "$cache"
if [ ! -f "$cache/$zipNode" ]; then
  curl -fsSL -o "$cache/$zipNode.baixando" "https://nodejs.org/dist/v$NODE_VERSAO/$zipNode"
  mv "$cache/$zipNode.baixando" "$cache/$zipNode"
fi
# Confere com a soma SHA-256 publicada pelo projeto Node.js (sha256sum no Linux, shasum no macOS)
if command -v sha256sum >/dev/null; then conferir=(sha256sum -c --quiet -); else conferir=(shasum -a 256 -c --quiet -); fi
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSAO/SHASUMS256.txt" | grep " $zipNode\$" | (cd "$cache" && "${conferir[@]}")
unzip -q "$cache/$zipNode" -d "$tmp"
mv "$tmp/node-v$NODE_VERSAO-win-x64" "$pacote/node"

# Marca do pacote completo (os scripts do Windows pulam o npm ci / npm run build)
cat > "$pacote/pacote.json" <<EOF
{
  "versao": "$versao",
  "commit": "$commit",
  "node": "$NODE_VERSAO",
  "geradoEm": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

# Texto do Bloco de Notas: UTF-8 com BOM e quebras de linha do Windows
{ printf '\xEF\xBB\xBF'; awk '{ printf "%s\r\n", $0 }'; } > "$pacote/COMO-INSTALAR.txt" <<'EOF'
BC FICHAS CONTROL - INSTALAÇÃO NO SERVIDOR DA EMPRESA (Windows 10, 11 ou Server)
================================================================================

Este pacote já traz tudo: não precisa de internet nem instalar o Node.js.

INSTALAR (primeira vez)
  1. Extraia este arquivo .zip direto no C:\  (a pasta fica C:\BC-Fichas-Control).
     Não deixe em Downloads nem na Área de Trabalho.
  2. Abra a pasta C:\BC-Fichas-Control e dê dois cliques em INSTALAR.bat.
     - Se aparecer "O Windows protegeu o computador", clique em "Mais informações"
       e depois em "Executar assim mesmo".
     - Responda "Sim" quando o Windows pedir permissão de administrador.
  3. No fim, a janela pede para criar o ADMINISTRADOR do sistema (veja PRIMEIRO ACESSO).
  4. A janela mostra o endereço de acesso, por exemplo http://192.168.0.10:3000
     Abra esse endereço no Chrome ou Edge dos outros computadores e salve nos favoritos.
  5. Feche a janela da pasta C:\BC-Fichas-Control. Depois de instalado, NÃO abra mais
     essa pasta pelo Explorer (veja o aviso em ESQUECEU A SENHA DO ADMINISTRADOR).

  O sistema passa a iniciar sozinho junto com o Windows (mesmo sem ninguém fazer login)
  e reinicia sozinho se parar.

  Se a janela avisar que a rede está como PÚBLICA, os outros computadores não vão
  conseguir acessar: siga a instrução que aparece na própria janela.

ATUALIZAR (quando receber uma versão nova)
  1. Extraia o pacote novo em outra pasta (por exemplo C:\BC-Fichas-Control-novo),
     fora de C:\BC-Fichas-Control.
  2. Dê dois cliques em ATUALIZAR.bat DENTRO da pasta nova.
     Os dados e as configurações são mantidos; antes é feita uma cópia do banco.
  3. Depois pode apagar a pasta nova.
  Na atualização para a versão 2.6, a janela pede no fim para criar o ADMINISTRADOR:
  até isso ser feito, ninguém entra no sistema (veja PRIMEIRO ACESSO).

PRIMEIRO ACESSO (usuários e senhas)
  O sistema pede usuário e senha em todos os computadores. O ADMINISTRADOR vê e faz tudo.
  O usuário COMUM faz o dia a dia (agenda, clientes, eventos, contratos, pagamentos e
  manutenção) e não vê os totais de faturamento, os relatórios, as configurações, os
  usuários nem as cópias de segurança.

  1. No fim do INSTALAR ou do ATUALIZAR, a janela pergunta:
     - o usuário para entrar no sistema (sem acentos nem espaços; Enter = admin);
     - o nome de quem vai administrar;
     - a senha, duas vezes (ela não aparece ao digitar). Use 8 caracteres ou mais; uma
       frase de 3 ou 4 palavras é fácil de lembrar. Enter em branco = o sistema gera uma
       senha temporária: anote, porque no primeiro acesso ele pede para trocar.
     - se você digitou a senha, se a conta é sua (S). Responda N se for de outra
       pessoa: ela terá de trocar a senha ao entrar.
     Se a senha for recusada, a janela diz o motivo e pede só a senha de novo.
     Digitar PULAR no usuário deixa para depois, mas NINGUÉM entra no sistema até o
     administrador ser criado pelo atalho "Redefinir senha do BC Fichas" (abaixo).
  2. Entre no sistema com esse usuário e cadastre os funcionários em
     Administração > Usuários > Novo usuário. O sistema gera uma senha temporária para
     entregar à pessoa; no primeiro acesso ela cria a própria senha.
  3. Tenha dois administradores, e cada pessoa com o seu próprio usuário.

ESQUECEU A SENHA DO ADMINISTRADOR
  Funcionário que esqueceu a senha: o administrador abre Administração > Usuários,
  clica nos três pontinhos (...) no fim da linha da pessoa e escolhe Redefinir senha.
  Administrador que esqueceu a senha (ou ninguém consegue entrar):
  1. No computador do servidor, clique em Iniciar, digite BC Fichas e abra
     "Redefinir senha do BC Fichas" (ou procure em Todos os aplicativos >
     BC Fichas Control). Responda "Sim" ao pedido de permissão.
  2. A janela mostra os usuários. Digite o usuário e a senha nova (ou Enter para uma
     senha temporária). Se você digitou a senha, a janela pergunta se a conta é sua:
     responda N se for de outra pessoa (ela troca a senha ao entrar). Um usuário que
     não existe vira um administrador novo.
  3. Pronto: não precisa reiniciar nada. O bloqueio daquele usuário também acaba.
     Se ainda aparecer "Muitas tentativas erradas neste computador", foram muitos
     erros no mesmo computador (com qualquer usuário): espere o tempo mostrado na tela
     (até 15 minutos) ou entre de outro computador.
  Sem o atalho: dê dois cliques em REDEFINIR-SENHA.bat dentro de um pacote do sistema
  extraído em outra pasta (ele sempre usa a instalação).

  IMPORTANTE: nunca abra a pasta C:\BC-Fichas-Control pelo Explorer. O Windows diz
  que você não tem permissão e oferece "Continuar": isso dá à sua conta acesso
  permanente à pasta e desfaz parte da proteção do banco de dados e do sistema.
  Para as senhas, use sempre o atalho "Redefinir senha do BC Fichas"; para o resto,
  os comandos abaixo e os do README.md.

DADOS E CÓPIAS
  - Banco de dados: C:\BC-Fichas-Control\dados\bc-fichas.db
  - Cópias automáticas diárias: C:\BC-Fichas-Control\dados\backups
  - Registro do servidor: C:\BC-Fichas-Control\dados\servidor.log
  - Para copiar os dados para um pendrive (letra E:, por exemplo) sem abrir a pasta:
    antes, faça uma cópia na hora em Configurações > Dados e backup, para o pendrive
    levar os dados de agora. Depois abra o PowerShell como Administrador e use:
      robocopy C:\BC-Fichas-Control\dados E:\BC-Fichas-dados /E /XF bc-fichas.db bc-fichas.db-wal bc-fichas.db-shm /R:2 /W:5
    O banco em uso não vai para o pendrive porque, com o servidor ligado, a cópia dele
    pode sair estragada. Para voltar, use os arquivos de E:\BC-Fichas-dados\backups
    (veja VOLTAR UMA CÓPIA DO BANCO).
  - As cópias levam também os usuários e as senhas (guardadas de forma protegida):
    guarde o pendrive ou HD com as cópias como um documento sigiloso.

VOLTAR UMA CÓPIA DO BANCO
  1. Abra o PowerShell como Administrador: no Iniciar, digite PowerShell, clique com o
     botão direito em Windows PowerShell e escolha "Executar como administrador".
  2. Rode:
       powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1
     A janela lista as cópias mais recentes (data e nome); digite o número da que vai
     voltar. Para ver todas as cópias, a mais recente no fim:
       Get-ChildItem C:\BC-Fichas-Control\dados\backups\*.db | Sort-Object LastWriteTime | Format-Table Name, LastWriteTime
     e informe o nome copiado da lista:
       powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1 -Arquivo C:\BC-Fichas-Control\dados\backups\<nome copiado da lista>
  3. O banco de agora é guardado antes, e o servidor volta a funcionar no fim. Os
     usuários e as senhas de hoje continuam (se a cópia tiver usuários que hoje não
     existem, a janela pergunta: H = os de hoje, C = os da cópia). Quem estava no
     sistema entra de novo. Não abra a pasta pelo Explorer para isso.

TROCAR O SERVIDOR DE COMPUTADOR (ou computador novo depois de uma pane)
  1. Instale o sistema no computador novo (INSTALAR, acima). Crie um administrador
     ou digite PULAR.
  2. Volte a cópia mais recente do pendrive com as contas e as senhas dela:
       powershell -ExecutionPolicy Bypass -File C:\BC-Fichas-Control\deploy\windows\restaurar-copia.ps1 -ContasDaCopia -Arquivo E:\BC-Fichas-dados\backups\<arquivo>.db
     (sem -ContasDaCopia, a janela pergunta: responda C).
  3. Copie de volta os arquivos anexados e as cópias assinadas dos contratos:
       robocopy E:\BC-Fichas-dados\anexos C:\BC-Fichas-Control\dados\anexos /E
       robocopy E:\BC-Fichas-dados\contratos C:\BC-Fichas-Control\dados\contratos /E

  Mais detalhes no arquivo README.md.
EOF

nome="BC-Fichas-Control-$versao-windows.zip"
rm -f "$saida/$nome"
(cd "$tmp" && zip -qr -X "$saida/$nome" BC-Fichas-Control)
echo "Pacote gerado: $saida/$nome ($(du -h "$saida/$nome" | cut -f1))"
