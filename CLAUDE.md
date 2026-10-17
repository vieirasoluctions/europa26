# Europa 26 · PWA de viagem da família

App instalado nos iPhones da família (roteiro, reservas, vouchers, gastos, frases, guias).
Funciona offline e sincroniza entre dois celulares. Repositório **público**: nada pessoal pode ir em texto aberto.

## Onde está cada coisa
- `src/` · código do app que vai em texto aberto (boot, sync, anexos, service worker, CSS, ícones, `config.js` com o Firebase).
- `private/` · **não vai para o git**. É a fonte em texto aberto: `trip.js` (todos os dados da viagem), `app.js` (telas e lógica), `places.js` (curiosidades), `docs/*.jpg` (vouchers). Se a pasta não existir, recrie com `npm run decrypt`.
- `site/` · o que o GitHub Pages publica. **Gerado** pelo build; não edite à mão. Tudo que é pessoal está cifrado em `site/data/*.enc`.
- `tools/` · `build.mjs`, `decrypt.mjs`, `serve.mjs`, `vendor.mjs`, `meta.json` (sal da senha; não apague).

## Senha da família (regra de ouro)
- A senha vem de **`E26_PASS`** (variável de ambiente) ou, no computador da família, de `private/senha.txt` (ignorado pelo git). Os scripts leem as duas sozinhos.
- Nunca peça a senha no chat, nunca a escreva em arquivo versionado, commit, log ou resposta.
- Se não houver nem `E26_PASS` nem `private/senha.txt`, pare e peça para a pessoa configurá-la.
- O build recusa senha errada ou ausente. Só use `E26_NEW_PASS=1` se a pessoa pedir para trocar a senha de propósito (os celulares precisam digitar a nova).

## Como alterar dados ou telas
```bash
git pull
npm run decrypt     # só se private/ não existir; recria a pasta a partir de site/data
# edite private/trip.js, private/app.js ou private/places.js (vouchers novos em private/docs/)
npm run build       # regera site/ cifrado
git add -A && git commit -m "..." && git push   # o push em site/ publica no GitHub Pages sozinho
```
No Windows (PowerShell), para passar a senha por variável: `$env:E26_PASS='a-senha'; npm run build`.
- Só rode o build quando houver mudança real: cada build regrava todos os `.enc` (grande diff no git).
- Mantenha os **ids** dos itens em `trip.js`: marcações e gastos da família ficam presos a eles.
- Os celulares atualizam sozinhos; em Mais aparece o cartão "Nova versão do app".
- Uma sessão por vez altera o projeto; faça `git pull` antes para não conflitar.
- Teste local: `npm run serve` (http://localhost:8026/europa26/). Para testar sincronia sem tocar no Firebase real, use o emulador (veja o README) e **não** commite o `site/config.js` modificado.

## Convenções
- Português do Brasil em telas e mensagens. Texto curto, com a Flora (criança) em mente.
- iPhone 14 (390×844), modo escuro automático, alvos de toque de 44 px, sem bibliotecas externas além de `src/vendor/`.
- Tudo precisa funcionar offline; o que vai ao banco sai cifrado do celular (`src/sync.js`, `src/kc.js`).
- Nunca commite `private/`, `senha.txt` ou dados pessoais em texto aberto. Antes de enviar, confira que `git ls-files` não lista `private/`.
