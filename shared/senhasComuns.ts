// Senhas muito usadas (vazamentos públicos, em português e em inglês), todas com 8 caracteres ou mais e em
// minúsculas: a política de senha recusa estas, comparando em minúsculas. Separadas por espaço ou quebra de linha.

const LISTA = `
12345678 123456789 1234567890 12345678910 0123456789 01234567 87654321 987654321 9876543210
11111111 1111111111 00000000 0000000000 22222222 55555555 66666666 77777777 88888888 99999999
12341234 12121212 11223344 112233445566 123123123 123123123123 123321123 12344321 123454321 1234554321
147258369 147852369 159753456 159357456 789456123 456123789 741852963 963852741 321654987
10203040 1020304050 102030405060 13579246

1q2w3e4r 1q2w3e4r5t 1q2w3e4r5t6y q1w2e3r4 q1w2e3r4t5 1qaz2wsx 1qazxsw2 zaq12wsx
qwertyui qwertyuiop qwerty12 qwerty123 qwerty1234 qwerty12345 qwer1234 1234qwer qwerqwer qweqweqwe
asdfghjk asdfghjkl asdf1234 asdfasdf asdasdasd zxcvbnm1 zxcvbnm123 zxcv1234 zxczxczxc
abcd1234 abc12345 abc123456 abcdefgh abcdefghij a1b2c3d4 aa123456 123456aa 123456789a

password password1 password12 password123 password1234 password! passw0rd p@ssw0rd p@ssword
iloveyou iloveyou1 iloveyou123 sunshine sunshine1 princess princess1 football football1 football123
baseball basketball superman starwars trustno1 welcome1 welcome123 letmein1 letmein123 changeme changeme1
whatever computer internet michelle jennifer charlie1 liverpool mustang1 dragon123 monkey123 shadow123
master123 minecraft pokemon1 admin123 admin1234 admin2025 admin2026 administrator administrador administrador1

senha123 senha1234 senha12345 senha123456 senhasenha senhaforte senhaforte1 senhasegura senhafacil
minhasenha minhasenha1 minhasenha123 novasenha novasenha1 novasenha123 mudarsenha mudar123 mudar1234 mudar12345
trocar123 trocar1234 123mudar 123senha 123456senha

brasil10 brasil123 brasil2024 brasil2025 brasil2026 brasil2027
flamengo flamengo1 flamengo10 flamengo123 corinthians corinthians1 corinthians123 palmeiras palmeiras1 palmeiras123
saopaulo saopaulo1 saopaulo123 santos123 vasco123 vascodagama gremio123 cruzeiro cruzeiro1 botafogo fluminense
internacional atletico atletico123

deus1234 deusefiel deuseamor jesus123 jesus1234 jesuscristo jesusteama teamo123 teamo1234 meuamor123 amorzinho
gatinha123 princesa princesa1 princesa123 beijinho chocolate chocolate1 morango123 futebol10 futebol123
familia123 familia1234 felicidade liberdade qualquercoisa naosei123 seila1234

empresa123 recepcao recepcao1 recepcao123 secretaria secretaria1 escritorio escritorio1
balancas balancas123 balanca123 balancascom rioclaro rioclaro1 rioclaro123
maquina123 maquinas123 evento123 eventos123 locacao123
`

export const SENHAS_COMUNS: ReadonlySet<string> = new Set(LISTA.trim().split(/\s+/))
