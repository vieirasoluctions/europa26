# Europa 26 · Copiloto da viagem (PWA)

App da viagem da família (19/10 a 09/11/2026) instalado na tela inicial do iPhone:
roteiro, reservas, vouchers, gastos, frases e guias. Funciona **sem internet** e
**sincroniza** os dois celulares quando há conexão.

## Como funciona

| Parte | Onde fica | Observação |
|---|---|---|
| App (HTML/CSS/JS) | `site/` → GitHub Pages | público, sem dados pessoais |
| Roteiro, vouchers e o código do app (`app.js`, `places.js`) | `private/` → `site/data/*.enc` | cifrados (AES-GCM, chave derivada da senha da família com PBKDF2 600 mil iterações) |
| Gastos, marcações, notas | Firestore `fam/<id>/…` | cifrados no próprio celular antes de sair; o Google só vê texto embaralhado |
| Offline | service worker (`sw.js`) | guarda tudo no 1º acesso; edições feitas offline ficam numa fila e sobem sozinhas |
| Assistente (Claude) | API da Anthropic | opcional, precisa de internet e de uma chave de API (cifrada e sincronizada) |

A **senha da família** fica em `private/senha.txt` (nunca vai para o git). Ela abre o app em
cada celular uma única vez e também define o espaço no banco: quem tem a senha vê os dados.

## Configuração (uma vez)

### 1. Firebase (sincronia), cerca de 5 minutos
1. Entre em <https://console.firebase.google.com> → **Criar projeto** → nome `europa26` → pode desligar o Google Analytics.
2. **Criação → Authentication → Vamos começar → Método de login → Anônimo → Ativar → Salvar.**
3. **Criação → Firestore Database → Criar banco de dados** → local `europe-west1` (ou `southamerica-east1`) → **modo de produção**.
4. Na aba **Regras** do Firestore, apague o conteúdo, cole o arquivo [`firestore.rules`](firestore.rules) e clique em **Publicar**.
5. **⚙️ Configurações do projeto → Seus apps → ícone `</>` (Web)** → apelido `europa26` (sem Hosting) → copie o objeto `firebaseConfig`.
6. Cole esse objeto em `src/config.js` (campo `firebase`) e rode o build.

O plano gratuito (Spark) sobra: são duas pessoas e poucos KB por dia.

### 2. GitHub Pages
1. Crie o repositório público `europa26` (sem README) e envie este projeto.
2. No repositório: **Settings → Pages → Source: GitHub Actions**.
3. O endereço fica `https://<usuario>.github.io/europa26/`.

### 3. Em cada iPhone
1. Abra o endereço no **Safari** → **Compartilhar** → **Adicionar à Tela de Início**.
2. Abra o **Europa 26** pelo ícone e digite a senha da família.
3. Espere a primeira carga terminar com internet (uns 9 MB, com os vouchers). Pronto: funciona offline.

## Atualizar o roteiro
```bash
npm install
npm run decrypt         # num clone novo: recria private/ a partir de site/data (pede E26_PASS)
# edite private/trip.js, private/app.js, private/places.js (e private/docs/ se houver voucher novo)
npm run build           # gera site/ cifrado com a mesma senha
git add site && git commit -m "Roteiro: ..." && git push
```
Os celulares mostram **"Nova versão do roteiro disponível → Atualizar"** na próxima abertura com internet.
Marcações, gastos e notas ficam presos aos ids dos itens; mantenha os ids ao editar.

## Desenvolvimento
- `npm run vendor` — reempacota Firebase e o SDK da Anthropic em `src/vendor/` (sem CDN, funciona offline).
- `npm run serve` — serve `site/` em <http://localhost:8026/europa26/>.
- Emulador: `firebase emulators:start --only firestore,auth --project demo-europa26` e, em `site/config.js`,
  `firebase: { apiKey: 'demo', projectId: 'demo-europa26', appId: 'demo', emulator: '127.0.0.1' }`.

## Trocar a senha
Apague `private/senha.txt`, rode `npm run build` (uma senha nova é sorteada) e publique.
Atenção: os gastos e marcações sincronizados ficam no espaço da senha antiga. Troque só antes da viagem ou exporte os gastos (CSV) antes.
