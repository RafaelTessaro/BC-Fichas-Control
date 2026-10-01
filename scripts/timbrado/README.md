# Papel timbrado do PDF

`src/assets/timbrado.jpg` é o fundo das páginas do PDF do resumo do cliente. Ele é gerado por
`gerar_timbrado.py` a partir do original em alta resolução guardado aqui.

## Arquivos

| Arquivo                         | O que é                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `timbrado-original.png`         | Timbrado original da empresa (2481x3508, A4 a 300 dpi, com o endereço antigo), extraído da planilha original |
| `gerar_timbrado.py`             | Apaga o endereço antigo do rodapé, escreve o novo e exporta o JPEG usado pelo sistema                        |
| `fonte/Poppins-Light-latin.ttf` | Fonte do rodapé (Poppins Light, subconjunto latino)                                                          |
| `fonte/OFL.txt`                 | Licença da fonte (SIL Open Font License 1.1, permite redistribuição)                                         |

## Como regenerar

Na raiz do repositório:

```sh
pip install pillow numpy opencv-python-headless
python3 scripts/timbrado/gerar_timbrado.py                       # grava src/assets/timbrado.jpg
python3 scripts/timbrado/gerar_timbrado.py --revisao /tmp/rev    # e salva antes.png, depois.png, pagina.png para conferir
python3 scripts/timbrado/gerar_timbrado.py --validar             # mede o casamento da fonte com o texto original
```

Para trocar o endereço outra vez, edite `ENDERECO_NOVO` no script (uma entrada por linha). O script recusa um texto que
ficaria largo demais e invadiria o desenho do canto direito.

A exportação é igual à da versão anterior do projeto: RGB, redimensionado para 1654x2339 com LANCZOS, JPEG qualidade 82,
`optimize` e `progressive`. Rodar o script duas vezes gera o mesmo arquivo, byte a byte.

## Como o texto foi casado com o original

- **Fonte**: Poppins Light (peso 300), 39,7 px na imagem de 2481 px de largura. Ela foi identificada comparando
  renderizações de Poppins e Montserrat (pesos 200 a 500) com o endereço antigo. A largura das linhas, a forma das letras
  e a quantidade de tinta casaram com a Poppins Light, sem espaçamento extra entre letras.
- **Posição**: o texto começa em x = 647,25 e as baselines estão em y = 3386 e y = 3433 (entrelinha de 47 px).
- **Cores**: o texto é (247, 247, 247), a mesma cor do CNPJ, e o fundo da faixa é (90, 91, 93).
- **Remoção do texto antigo**: o fundo atrás do endereço é liso. As letras antigas são cobertas por uma máscara dilatada,
  e cada pixel dela recebe a média dos pixels de fundo vizinhos (convolução normalizada), o que não deixa marcas nem
  "fantasmas". O padrão de circuito fica fora dessa área e não é tocado.
- O texto novo é desenhado com superamostragem 4x e composição alfa sobre o fundo reconstruído. Todo o resto da imagem
  (cabeçalho, CNPJ, separador e desenho verde) continua idêntico.

## De onde vem a fonte

O arquivo é a Poppins Light do pacote npm `@fontsource/poppins`
(`files/poppins-latin-300-normal.woff2`), convertida para TTF com fontTools. Para obter de novo:

```sh
npm pack @fontsource/poppins          # numa pasta temporária, fora do projeto
tar xzf fontsource-poppins-*.tgz
python3 -c "from fontTools.ttLib import TTFont; f = TTFont('package/files/poppins-latin-300-normal.woff2'); f.flavor = None; f.save('Poppins-Light-latin.ttf')"
```

O texto é desenhado com o layout do libraqm (kerning da fonte), que vem com o Pillow das rodas oficiais do pip. Sem o
libraqm, o script avisa e usa o layout básico, e o espaçamento pode variar um pouco.
