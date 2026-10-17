/* Gera o site publicável em site/:
   - copia o app (src/)
   - cifra o roteiro (private/trip.js), o app (private/app.js, private/places.js) e os vouchers (private/docs/*.jpg) com a senha da família
   - escreve o service worker com a lista de arquivos e a versão
   A senha vem de E26_PASS ou de private/senha.txt (criada na 1ª vez). private/ nunca vai para o git. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import words from './words.js';

const require = createRequire(import.meta.url);
require('../src/kc.js'); const KC = globalThis.KC;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'src'), PRIV = path.join(ROOT, 'private'), OUT = path.join(ROOT, 'site');
const META = path.join(ROOT, 'tools', 'meta.json');

function passphrase() {
  if (process.env.E26_PASS) return process.env.E26_PASS;
  const f = path.join(PRIV, 'senha.txt');
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  // Já existe um site publicado com senha: nunca sortear outra por engano (os celulares deixariam de abrir o roteiro).
  if (fs.existsSync(path.join(OUT, 'data', 'trip.enc')) && process.env.E26_NEW_PASS !== '1') {
    console.error('Falta a senha da família. Rode com E26_PASS=\'a-senha\' (ou npm run decrypt antes).\n' +
      'Não vou criar senha nova porque já existe um site publicado com a senha atual.\n' +
      'Para trocar de senha de propósito: E26_NEW_PASS=1 npm run build');
    process.exit(1);
  }
  const pick = () => words[crypto.randomInt(words.length)];
  const p = [pick(), pick(), pick(), pick(), String(crypto.randomInt(100, 1000))].join('-');
  fs.writeFileSync(f, p + '\n', { mode: 0o600 });
  console.log('Senha nova criada em private/senha.txt');
  return p;
}
function meta() {
  if (fs.existsSync(META)) return JSON.parse(fs.readFileSync(META, 'utf8'));
  const m = { salt: crypto.randomBytes(16).toString('hex'), iter: 600000 };
  fs.writeFileSync(META, JSON.stringify(m, null, 2) + '\n');
  return m;
}
const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const mkdirp = p => fs.mkdirSync(p, { recursive: true });
function copyDir(a, b, skip) {
  mkdirp(b);
  for (const n of fs.readdirSync(a)) {
    if (skip && skip(n)) continue;
    const s = path.join(a, n), d = path.join(b, n);
    if (fs.statSync(s).isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function walk(d, base = d, out = []) {
  for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/')); }
  return out;
}

const pass = passphrase(), m = meta();
const keys = await KC.derive(pass, m);
// A senha tem que ser a do site já publicado; senão o build cifraria tudo com outra e quebraria os celulares.
const published = path.join(OUT, 'data', 'trip.enc');
if (fs.existsSync(published) && process.env.E26_NEW_PASS !== '1') {
  try { await KC.decrypt(keys.aes, fs.readFileSync(published)); }
  catch (e) {
    console.error('A senha não confere com o site já publicado (site/data/trip.enc). Nada foi alterado.\n' +
      'Use a senha da família. Para trocar de senha de propósito: E26_NEW_PASS=1 npm run build');
    process.exit(1);
  }
}
// Confere tudo antes de apagar site/: sem private/ o build falharia no meio e deixaria o site vazio.
const needed = ['trip.js', 'app.js', 'places.js'].filter(f => !fs.existsSync(path.join(PRIV, f)));
if (needed.length) {
  console.error('Faltam em private/: ' + needed.join(', ') + '.\nRode antes: E26_PASS=\'a-senha\' npm run decrypt\nNada foi alterado.');
  process.exit(1);
}
rmrf(OUT); mkdirp(path.join(OUT, 'data', 'docs'));
// app.js e places.js (em private/) citam a família e o roteiro: vão cifrados, como o trip.js
const SECRET_SRC = ['app.js', 'places.js'];
copyDir(SRC, OUT, n => n === 'sw.js' || SECRET_SRC.includes(n));

// dados privados, cifrados
const trip = fs.readFileSync(path.join(PRIV, 'trip.js'), 'utf8');
fs.writeFileSync(path.join(OUT, 'data', 'trip.enc'), await KC.encrypt(keys.aes, trip));
const docs = fs.existsSync(path.join(PRIV, 'docs')) ? fs.readdirSync(path.join(PRIV, 'docs')).filter(n => /\.jpe?g$/i.test(n)) : [];
for (const n of docs) fs.writeFileSync(path.join(OUT, 'data', 'docs', n + '.enc'), await KC.encrypt(keys.aes, fs.readFileSync(path.join(PRIV, 'docs', n))));
fs.writeFileSync(path.join(OUT, 'data', 'meta.json'), JSON.stringify(m) + '\n');
for (const n of SECRET_SRC) fs.writeFileSync(path.join(OUT, 'data', n + '.enc'), await KC.encrypt(keys.aes, fs.readFileSync(path.join(PRIV, n))));

// versão = hash do conteúdo público (texto cifrado muda a cada build; usa o texto claro para o hash)
const h = crypto.createHash('sha256');
for (const f of walk(SRC).sort()) h.update(f).update(fs.readFileSync(path.join(SRC, f)));
for (const n of SECRET_SRC) h.update(fs.readFileSync(path.join(PRIV, n)));
h.update(trip); for (const n of docs.sort()) h.update(n).update(fs.readFileSync(path.join(PRIV, 'docs', n)));
const version = h.digest('hex').slice(0, 10);

const cfgPath = path.join(OUT, 'config.js');
fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8').replace("version: ''", "version: '" + version + "'"));

const files = walk(OUT).filter(f => f !== 'sw.js' && f !== '.nojekyll').sort();
const sw = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(files));
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const size = files.reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`site/ pronto · versão ${version} · ${files.length} arquivos · ${(size / 1e6).toFixed(1)} MB · ${docs.length} vouchers cifrados`);
