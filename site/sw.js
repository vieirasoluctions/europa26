/* Service worker do Europa 26: guarda o app inteiro para funcionar sem internet
   e abre os vouchers cifrados (docs/*.jpg) com a chave da família. */
importScripts('kc.js');
const VERSION = 'ef004eae04';
const PRECACHE = ["ai.js","app.css","boot.css","boot.js","config.js","data/app.js.enc","data/docs/alsa-1.jpg.enc","data/docs/alsa-2.jpg.enc","data/docs/alsa-3.jpg.enc","data/docs/bb-1.jpg.enc","data/docs/bb-2.jpg.enc","data/docs/bcn-1.jpg.enc","data/docs/bcn-2.jpg.enc","data/docs/carv-1.jpg.enc","data/docs/disney-adulto-1.jpg.enc","data/docs/disney-adulto-2.jpg.enc","data/docs/disney-crianca.jpg.enc","data/docs/faro-1.jpg.enc","data/docs/faro-2.jpg.enc","data/docs/ib-app.jpg.enc","data/docs/ib-conf-1.jpg.enc","data/docs/ib-conf-3.jpg.enc","data/docs/ib-flora-1.jpg.enc","data/docs/ib-vinicius-1.jpg.enc","data/docs/latam-1.jpg.enc","data/docs/latam-2.jpg.enc","data/docs/lis-1.jpg.enc","data/docs/mal-1.jpg.enc","data/docs/mal-2.jpg.enc","data/docs/paris-1.jpg.enc","data/docs/sagrada-adulto-1.jpg.enc","data/docs/sagrada-adulto-2.jpg.enc","data/docs/sagrada-crianca.jpg.enc","data/docs/seguro-flora-1.jpg.enc","data/docs/seguro-flora-2.jpg.enc","data/docs/seguro-flora-3.jpg.enc","data/docs/seguro-luiza-1.jpg.enc","data/docs/seguro-luiza-2.jpg.enc","data/docs/seguro-luiza-3.jpg.enc","data/docs/seguro-vinicius-1.jpg.enc","data/docs/seguro-vinicius-2.jpg.enc","data/docs/seguro-vinicius-3.jpg.enc","data/docs/tap-1.jpg.enc","data/docs/tap-4.jpg.enc","data/docs/tgv-flora-1.jpg.enc","data/docs/tgv-luiza-1.jpg.enc","data/docs/tgv-vinicius-1.jpg.enc","data/meta.json","data/places.js.enc","data/trip.enc","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg","index.html","kc.js","manifest.webmanifest","phrases.js","sync.js","vendor/anthropic.js","vendor/firebase.js"];
const CACHE = 'e26-' + VERSION;
const RUNTIME = 'e26-runtime';

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // em lotes para não estourar conexões no celular
    for (let i = 0; i < PRECACHE.length; i += 8) {
      await Promise.all(PRECACHE.slice(i, i + 8).map(async u => {
        const r = await fetch(new Request(u, { cache: 'reload' }));
        if (!r.ok) throw new Error(u + ' ' + r.status);
        await c.put(u, r);
      }));
    }
    // assume assim que terminar de baixar; o app aberto avisa e recarrega na hora certa
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE && k !== RUNTIME && k.startsWith('e26-')) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', ev => {
  if (ev.data === 'skipWaiting') self.skipWaiting();
  if (ev.data === 'version' && ev.ports && ev.ports[0]) ev.ports[0].postMessage({ version: VERSION });
});

const scopePath = new URL(self.registration.scope).pathname;
const rel = url => url.pathname.slice(scopePath.length);

async function fromCache(key) {
  const c = await caches.open(CACHE);
  return c.match(key, { ignoreSearch: true });
}

async function openDoc(path) {
  const keys = await KC.loadKeys();
  if (!keys || !keys.aes) return new Response('', { status: 403 });
  let r = await fromCache('data/' + path + '.enc');
  if (!r) { r = await fetch('data/' + path + '.enc'); if (!r.ok) return new Response('', { status: 404 }); }
  try {
    const u = await KC.decrypt(keys.aes, await r.arrayBuffer());
    return new Response(u, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch (e) { return new Response('', { status: 403 }); }
}

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.startsWith(scopePath)) {
    const p = rel(url);
    if (/^docs\/.+\.jpg$/.test(p)) { ev.respondWith(openDoc(p)); return; }
    if (req.mode === 'navigate') { ev.respondWith(fromCache('index.html').then(r => r || fetch(req))); return; }
    ev.respondWith(fromCache(p || 'index.html').then(r => r || fetch(req)));
    return;
  }

  // câmbio de referência: rede com cache de reserva
  if (url.hostname === 'cdn.jsdelivr.net') {
    ev.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch (e) { return (await c.match(req)) || Response.error(); }
    })());
  }
  // Firestore, login e API do Claude passam direto
});
