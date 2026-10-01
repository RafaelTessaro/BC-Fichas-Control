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
  3. No fim, a janela mostra o endereço de acesso, por exemplo http://192.168.0.10:3000
     Abra esse endereço no Chrome ou Edge dos outros computadores e salve nos favoritos.

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

DADOS E CÓPIAS
  - Banco de dados: C:\BC-Fichas-Control\dados\bc-fichas.db
  - Cópias automáticas diárias: C:\BC-Fichas-Control\dados\backups
  - Registro do servidor: C:\BC-Fichas-Control\dados\servidor.log
  Mais detalhes no arquivo README.md.
EOF

nome="BC-Fichas-Control-$versao-windows.zip"
rm -f "$saida/$nome"
(cd "$tmp" && zip -qr -X "$saida/$nome" BC-Fichas-Control)
echo "Pacote gerado: $saida/$nome ($(du -h "$saida/$nome" | cut -f1))"
