#!/usr/bin/env python3
"""Gera src/assets/timbrado.jpg a partir do papel timbrado original em alta resolução.

O que faz:
  1. Abre o original (2481x3508, A4 a 300 dpi) e apaga o endereço antigo do rodapé,
     reconstruindo o fundo cinza (média local dos pixels vizinhos, sobre uma
     máscara dilatada das letras).
  2. Escreve o endereço novo em Poppins Light, com a mesma cor, tamanho, x inicial
     e baselines medidos no original (as medidas reproduzem o texto antigo com erro
     mínimo; rode com --validar para conferir).
  3. Exporta do mesmo jeito que a versão anterior: RGB, 1654x2339 (LANCZOS),
     JPEG qualidade 82, optimize, progressive.

Uso (a partir da raiz do repositório):
  python3 scripts/timbrado/gerar_timbrado.py
  python3 scripts/timbrado/gerar_timbrado.py --revisao /tmp/revisao   # salva recortes antes/depois
  python3 scripts/timbrado/gerar_timbrado.py --validar               # mede o casamento da fonte

Dependências: Pillow, numpy, opencv-python-headless.
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, features

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent

ORIGINAL = AQUI / 'timbrado-original.png'
FONTE = AQUI / 'fonte' / 'Poppins-Light-latin.ttf'
SAIDA = RAIZ / 'src' / 'assets' / 'timbrado.jpg'

# Endereço antigo (só para --validar) e novo, uma entrada por linha do rodapé.
ENDERECO_ANTIGO = ('Avenida 12, Número 1313, Entre as ruas 13 e 14,', 'Bairro Santa Cruz, Rio Claro - SP')
ENDERECO_NOVO = ('Rua 13, Número 650, Entre as Avenidas 9 e 11,', 'Bairro da Boa Morte, Rio Claro - SP')

# Métricas medidas no original (pixels da imagem 2481x3508).
TAMANHO_FONTE = 39.7  # px (em) — Poppins Light
X_INICIAL = 647.25  # x da origem do texto (alinhado à esquerda)
BASELINES = (3386.0, 3433.0)  # baseline de cada linha (entrelinha de 47 px)
COR_TEXTO = (247, 247, 247)  # branco levemente acinzentado, igual ao do CNPJ
COR_FUNDO = (90, 91, 93)  # cinza-escuro da faixa do rodapé

# Área de trabalho do endereço: fica à direita do separador vertical (x≈588)
# e à esquerda das linhas de circuito do canto direito (x≈1575).
REGIAO = (630, 3335, 1560, 3460)  # x0, y0, x1, y1

# Exportação idêntica à da versão anterior do projeto.
TAMANHO_SAIDA = (1654, 2339)
JPEG = dict(quality=82, optimize=True, progressive=True)

SUPERAMOSTRAGEM = 4


def carregar_original() -> np.ndarray:
    img = Image.open(ORIGINAL)
    if img.size != (2481, 3508):
        sys.exit(f'Original com tamanho inesperado: {img.size}')
    # O PNG tem canal alfa (a folha branca é transparente), mas os valores RGB já
    # trazem o desenho completo; a exportação anterior descartava o alfa com
    # convert('RGB') e fazemos o mesmo para manter o resto idêntico.
    return np.array(img.convert('RGB'))


def renderizar_alpha(linhas: tuple[str, ...], tamanho_regiao: tuple[int, int]) -> np.ndarray:
    """Cobertura (0..1) do texto na região, com antialiasing por superamostragem."""
    x0, y0, _, _ = REGIAO
    largura, altura = tamanho_regiao
    ss = SUPERAMOSTRAGEM
    layout = ImageFont.Layout.RAQM if features.check('raqm') else ImageFont.Layout.BASIC
    if layout != ImageFont.Layout.RAQM:
        print('Aviso: Pillow sem libraqm; o kerning pode diferir levemente do medido.', file=sys.stderr)
    fonte = ImageFont.truetype(str(FONTE), TAMANHO_FONTE * ss, layout_engine=layout)
    camada = Image.new('L', (largura * ss, altura * ss), 0)
    desenho = ImageDraw.Draw(camada)
    for texto, baseline in zip(linhas, BASELINES):
        desenho.text(((X_INICIAL - x0) * ss, (baseline - y0) * ss), texto, font=fonte, fill=255, anchor='ls')
    camada = camada.resize((largura, altura), Image.LANCZOS)
    return np.asarray(camada, dtype=np.float32) / 255.0


def mascara_texto_antigo(regiao: np.ndarray) -> np.ndarray:
    diferenca = np.abs(regiao.astype(int) - np.array(COR_FUNDO)).max(axis=2)
    mascara = (diferenca > 4).astype(np.uint8) * 255
    nucleo = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    return cv2.dilate(mascara, nucleo)


def reconstruir_fundo(regiao: np.ndarray, mascara: np.ndarray) -> np.ndarray:
    """Preenche a máscara com a média local do fundo vizinho (convolução normalizada).

    O fundo atrás do endereço é uma faixa lisa; preencher com a média dos pixels
    válidos próximos não deixa ruído nem "fantasmas" (o inpainting do OpenCV deixava
    variações de 1 a 6 níveis no contorno das letras antigas). Se a vizinhança
    tivesse gradiente, a média local o acompanharia.
    """
    valido = (mascara == 0).astype(np.float32)
    cores = regiao.astype(np.float32) * valido[..., None]
    janela = (61, 61)
    soma = cv2.boxFilter(cores, -1, janela, normalize=False, borderType=cv2.BORDER_REFLECT)
    peso = cv2.boxFilter(valido, -1, janela, normalize=False, borderType=cv2.BORDER_REFLECT)
    if peso[mascara > 0].min() < 1:
        sys.exit('Máscara grande demais para a janela de reconstrução do fundo.')
    preenchido = np.rint(soma / np.maximum(peso, 1)[..., None]).astype(np.uint8)
    return np.where(mascara[..., None] > 0, preenchido, regiao)


def editar(original: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = REGIAO
    img = original.copy()
    regiao = img[y0:y1, x0:x1]

    # 1. Remove o texto antigo reconstruindo o fundo.
    mascara = mascara_texto_antigo(regiao)
    limpo = reconstruir_fundo(regiao, mascara)

    # 2. Desenha o texto novo (composição alfa sobre o fundo reconstruído).
    alpha = renderizar_alpha(ENDERECO_NOVO, (x1 - x0, y1 - y0))[..., None]
    ys, xs = np.where(alpha[..., 0] > 0.02)
    if xs.max() >= (x1 - x0) - 10:
        sys.exit('O endereço novo ficou largo demais e invadiria o desenho do canto direito.')
    print(f'Texto novo: x {xs.min() + x0}..{xs.max() + x0}, y {ys.min() + y0}..{ys.max() + y0}')
    composto = limpo.astype(np.float32) * (1 - alpha) + np.array(COR_TEXTO, dtype=np.float32) * alpha
    img[y0:y1, x0:x1] = np.clip(np.rint(composto), 0, 255).astype(np.uint8)
    return img


def validar(original: np.ndarray) -> None:
    """Re-renderiza o endereço ANTIGO com as métricas e compara com o original."""
    x0, y0, x1, y1 = REGIAO
    regiao = original[y0:y1, x0:x1].astype(np.float32).mean(axis=2)
    fundo = float(np.mean(COR_FUNDO))
    ref = np.clip((regiao - fundo) / (np.mean(COR_TEXTO) - fundo), 0, 1)
    alpha = renderizar_alpha(ENDERECO_ANTIGO, (x1 - x0, y1 - y0))
    erro = np.abs(alpha - ref)
    print(f'Tinta original: {ref.sum():.0f}  renderizada: {alpha.sum():.0f}')
    print(f'Erro médio absoluto por pixel de tinta: {erro.sum() / max(ref.sum(), 1):.3f}')
    print(f'Pixels com diferença > 0,5: {(erro > 0.5).sum()}')


def salvar_revisao(original: np.ndarray, editada: np.ndarray, pasta: Path) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    caixa = (480, 3270, 1720, 3480)
    for nome, matriz in (('antes', original), ('depois', editada)):
        recorte = Image.fromarray(matriz).crop(caixa)
        recorte.resize((recorte.width * 2, recorte.height * 2), Image.LANCZOS).save(pasta / f'{nome}.png')
    Image.fromarray(editada).resize((827, 1170), Image.LANCZOS).save(pasta / 'pagina.png')
    print(f'Recortes de revisão em {pasta}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--saida', type=Path, default=SAIDA, help='JPEG gerado (padrão: src/assets/timbrado.jpg)')
    parser.add_argument('--revisao', type=Path, help='pasta para salvar antes.png, depois.png e pagina.png')
    parser.add_argument('--validar', action='store_true', help='só mede o casamento da fonte com o texto antigo')
    args = parser.parse_args()

    original = carregar_original()
    if args.validar:
        validar(original)
        return

    editada = editar(original)
    final = Image.fromarray(editada).resize(TAMANHO_SAIDA, Image.LANCZOS)
    final.save(args.saida, 'JPEG', **JPEG)
    print(f'Gerado {args.saida} ({final.width}x{final.height})')
    if args.revisao:
        salvar_revisao(original, editada, args.revisao)


if __name__ == '__main__':
    main()
