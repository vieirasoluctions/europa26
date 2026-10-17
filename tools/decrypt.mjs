/* Recupera private/ (roteiro e vouchers em texto claro) a partir de site/data, com a senha.
   Uso: E26_PASS='a-senha' npm run decrypt   — útil num clone novo, para editar o roteiro. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
createRequire(import.meta.url)('../src/kc.js'); const KC = globalThis.KC;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pass = process.env.E26_PASS || (fs.existsSync(path.join(ROOT, 'private/senha.txt')) && fs.readFileSync(path.join(ROOT, 'private/senha.txt'), 'utf8').trim());
if (!pass) { console.error('Defina E26_PASS com a senha da família.'); process.exit(1); }
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/meta.json'), 'utf8'));
const keys = await KC.derive(pass, meta);
const D = path.join(ROOT, 'site/data'), P = path.join(ROOT, 'private');
fs.mkdirSync(path.join(P, 'docs'), { recursive: true });
fs.writeFileSync(path.join(P, 'trip.js'), await KC.decryptText(keys.aes, fs.readFileSync(path.join(D, 'trip.enc'))));
for (const f of ['app.js', 'places.js']) fs.writeFileSync(path.join(P, f), await KC.decryptText(keys.aes, fs.readFileSync(path.join(D, f + '.enc'))));
let n = 0;
for (const f of fs.readdirSync(path.join(D, 'docs'))) { fs.writeFileSync(path.join(P, 'docs', f.replace(/\.enc$/, '')), await KC.decrypt(keys.aes, fs.readFileSync(path.join(D, 'docs', f)))); n++; }
if (!fs.existsSync(path.join(P, 'senha.txt'))) fs.writeFileSync(path.join(P, 'senha.txt'), pass + '\n', { mode: 0o600 });
console.log('private/ recuperado: trip.js, app.js, places.js e ' + n + ' vouchers');
