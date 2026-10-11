/* Service worker do Europa 26: guarda o app inteiro para funcionar sem internet
   e abre os vouchers cifrados (docs/*.jpg) com a chave da família. */
importScripts('kc.js');
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
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
