/* Partida do PWA: service worker, senha da família, roteiro cifrado e as
   "capacidades" que o app espera (window.claude.use), agora servidas por
   Firestore (sincronia), API do Claude (assistente) e o próprio iPhone (arquivos). */
const KC = self.KC;
const CFG = self.E26_CONFIG || {};
const $ = s => document.querySelector(s);
const LS_AI = 'e26.ai';
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/* ---------- service worker e atualização ---------- */
let swReg = null;
/* Atualização sem aviso no topo: o app mostra um cartão em Mais quando há versão nova
   (window.E26_UPDATE.ready) e aplica sozinho na próxima vez que for para segundo plano. */
const UPD = window.E26_UPDATE = { ready: false, apply: () => location.reload(), check: async () => false };
async function startSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register('sw.js', { scope: './' });
    // pergunta ao service worker novo qual versão ele traz
    const versionOf = w => new Promise(res => {
      try { const ch = new MessageChannel(); ch.port1.onmessage = e => res(e.data && e.data.version); w.postMessage('version', [ch.port2]); setTimeout(() => res(null), 3000); }
      catch (e) { res(null); }
    });
    let reloaded = false;
    const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    const ready = () => {
      if (UPD.ready) return;
      UPD.ready = true;
      window.dispatchEvent(new CustomEvent('e26:update'));
      document.addEventListener('visibilitychange', () => { if (document.hidden) reload(); }); // aplica ao sair do app
    };
    const consider = async w => {
      if (!w || !navigator.serviceWorker.controller) return; // primeira instalação
      const v = await versionOf(w);
      if (v && CFG.version && v === CFG.version) return;
      ready();
    };
    UPD.apply = () => {
      const w = swReg.waiting;
      if (w) { w.postMessage('skipWaiting'); setTimeout(reload, 3000); } else reload();
    };
    // "Procurar atualização": baixa a versão nova, se houver, e espera ela ficar pronta
    UPD.check = async () => {
      try { await swReg.update(); } catch (e) { return UPD.ready; }
      if (swReg.installing || swReg.waiting) await new Promise(r => { window.addEventListener('e26:update', r, { once: true }); setTimeout(r, 30000); });
      return UPD.ready;
    };
    if (swReg.waiting) consider(swReg.waiting);
    swReg.addEventListener('updatefound', () => {
      const w = swReg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' || w.state === 'activated') consider(w); });
    });
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return; // primeira instalação
      if (document.hidden) reload(); else ready();
    });
    // procura versão nova ao voltar para o app
    document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) swReg.update().catch(() => {}); });
  } catch (e) { /* sem SW: funciona online */ }
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}

/* ---------- senha ---------- */
const getMeta = async () => (await fetch('data/meta.json', { cache: 'no-cache' }).catch(() => fetch('data/meta.json'))).json();
const fetchBuf = async p => { const r = await fetch(p); if (!r.ok) throw new Error(p + ' ' + r.status); return r.arrayBuffer(); };

function askPassword(meta) {
  return new Promise(resolve => {
    const form = $('#lockForm'), inp = $('#lockPass'), err = $('#lockErr'), go = $('#lockGo');
    $('#lockSub').textContent = 'O roteiro da família, sempre no bolso';
    const showForm = () => { $('#lockInstall').hidden = true; form.hidden = false; setTimeout(() => inp.focus(), 50); };
    if (isIOS && !standalone && !sessionStorage.getItem('e26.safari')) {
      $('#lockInstall').hidden = false;
      $('#lockAnyway').onclick = () => { try { sessionStorage.setItem('e26.safari', '1'); } catch (e) {} showForm(); };
    } else showForm();
    $('#lockEye').onclick = () => {
      const on = inp.type === 'password'; inp.type = on ? 'text' : 'password';
      $('#lockEye').setAttribute('aria-pressed', on ? 'true' : 'false'); $('#lockEye').setAttribute('aria-label', on ? 'Esconder senha' : 'Mostrar senha');
    };
    form.onsubmit = async ev => {
      ev.preventDefault();
      const pass = inp.value;
      if (!pass.trim()) return;
      err.textContent = ''; go.disabled = true; go.textContent = 'Conferindo...';
      try {
        const keys = await KC.derive(pass, meta);
        const trip = await KC.decryptText(keys.aes, await fetchBuf('data/trip.enc'));
        try { await KC.saveKeys(keys); } catch (e) { /* sem IndexedDB: pede a senha de novo na próxima vez */ }
        resolve({ keys: keys, trip: trip });
      } catch (e) {
        go.disabled = false; go.textContent = 'Entrar';
        err.textContent = e && e.name === 'OperationError' ? 'Senha errada. Confira maiúsculas e espaços.' : 'Não consegui abrir o roteiro. Conecte à internet e tente de novo.';
        inp.select();
      }
    };
  });
}

async function unlock() {
  const meta = await getMeta();
  let keys = await KC.loadKeys();
  if (keys && keys.aes) {
    try { return { keys: keys, trip: await KC.decryptText(keys.aes, await fetchBuf('data/trip.enc')) }; }
    catch (e) { if (e && e.name === 'OperationError') await KC.clearKeys(); else throw e; } // senha trocada
  }
  return askPassword(meta);
}

/* ---------- carregar scripts em ordem ---------- */
const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.body.appendChild(s); });
async function runText(code) { const u = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })); try { await loadScript(u); } finally { URL.revokeObjectURL(u); } }

/* Sem service worker (1ª visita ou navegador sem suporte), os vouchers são abertos aqui mesmo. */
async function inlineDocs(keys) {
  const T = window.TRIP; if (!T || !T.docs) return;
  const cache = {};
  const one = p => cache[p] || (cache[p] = fetchBuf('data/' + p + '.enc').then(b => KC.decrypt(keys.aes, b)).then(u => URL.createObjectURL(new Blob([u], { type: 'image/jpeg' }))).catch(() => p));
  const all = [];
  Object.keys(T.docs).forEach(k => T.docs[k].forEach(d => { d.f.forEach((p, i) => all.push(one(p).then(u => { d.f[i] = u; }))); }));
  await Promise.all(all);
}

/* ---------- capacidades para o app ---------- */
function makeDownloads() {
  return {
    async save({ filename, data }) {
      const type = /\.csv$/i.test(filename) ? 'text/csv' : 'application/octet-stream';
      const file = new File([data], filename, { type: type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: filename }); return; }
        catch (e) { if (e && e.name === 'AbortError') { const x = new Error('declined'); x.code = 'declined'; throw x; } }
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = filename;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    },
  };
}

function installCapabilities(keys) {
  const E = window.E26 = { status: 'local', aiKey: '', listeners: [] };
  const emit = () => E.listeners.forEach(f => { try { f(E); } catch (e) {} });
  E.on = f => E.listeners.push(f);

  // chave do assistente: cifrada no aparelho; sincronizada pelo banco quando houver
  const aiLoaded = (async () => { try { const s = localStorage.getItem(LS_AI); if (s) { E.aiKey = (await KC.decJson(keys.aes, s)).k || ''; } } catch (e) {} })();
  const storeAi = async k => { E.aiKey = k || ''; try { if (k) localStorage.setItem(LS_AI, await KC.encJson(keys.aes, { k: k })); else localStorage.removeItem(LS_AI); } catch (e) {} };

  let dbP = null;
  const getDb = () => dbP || (dbP = (async () => {
    if (!CFG.firebase || !CFG.firebase.apiKey) return null;
    try {
      const m = await import('./sync.js');
      const db = await m.connectSync(CFG.firebase, keys, st => { E.status = st; emit(); });
      // só o documento da chave: a coleção cfg também guarda os pedaços dos anexos
      db.doc('cfg/ai').onSnapshot(snap => {
        const k = snap.exists && snap.data() && snap.data().k;
        if (k && k !== E.aiKey) storeAi(k).then(() => window.dispatchEvent(new CustomEvent('e26:ai')));
        else if (!k && E.aiKey && !snap.fromCache) storeAi('').then(() => window.dispatchEvent(new CustomEvent('e26:ai'))); // desligado no outro celular
      });
      return db;
    } catch (e) { console.warn('sync', e); return null; }
  })());

  let sampleP = null;
  const getSample = async () => {
    await aiLoaded;
    if (!E.aiKey) return null;
    if (!sampleP) sampleP = import('./ai.js').then(m => m.makeSample(() => E.aiKey));
    return sampleP;
  };
  E.sample = () => { sampleP = null; return getSample(); };
  E.setAiKey = async k => {
    k = String(k || '').trim();
    if (k) { const m = await import('./ai.js'); if (!(await m.testKey(k))) return false; }
    await storeAi(k);
    const db = await getDb();
    if (db) { try { await (k ? db.doc('cfg/ai').set({ k: k }) : db.doc('cfg/ai').delete()); } catch (e) {} }
    window.dispatchEvent(new CustomEvent('e26:ai'));
    return true;
  };
  E.lock = async () => { await KC.clearKeys(); try { localStorage.removeItem(LS_AI); } catch (e) {} location.reload(); };
  E.hasSync = !!(CFG.firebase && CFG.firebase.apiKey);
  E.standalone = standalone;
  E.version = CFG.version || '';

  // anexos: guardados cifrados aqui e no banco; o que o outro celular incluir é baixado uma vez
  let assetsP = null;
  const getAssets = () => assetsP || (assetsP = import('./att.js').then(m => {
    const a = m.makeAssets(getDb, keys);
    getDb().then(db => {
      if (!db) return;
      // o registro pode chegar antes das páginas terminarem de subir no outro celular: repete até baixar tudo
      let ids = [], timer = 0, busy = false;
      const pull = async () => {
        clearTimeout(timer);
        if (busy) return; busy = true;
        const r = await a.ensure(ids).catch(() => ({ got: 0, missing: ids.length }));
        busy = false;
        if (r.got) window.dispatchEvent(new CustomEvent('e26:files'));
        if (r.missing) timer = setTimeout(pull, 15000);
      };
      db.collection('files').onSnapshot(snap => {
        ids = [];
        snap.docs.forEach(d => { const f = d.data() || {}; (f.pages || [f.a]).forEach(x => x && ids.push(x)); });
        pull();
      });
      addEventListener('online', pull);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    });
    return a;
  }).catch(() => null));
  getAssets();

  const downloads = makeDownloads();
  window.claude = {
    use(name) {
      if (name === 'db') return getDb();
      if (name === 'downloads') return Promise.resolve(downloads);
      if (name === 'sample') return getSample();
      if (name === 'assets') return getAssets();
      return Promise.resolve(null); // user: não usado fora do claude.ai
    },
  };
}

/* ---------- partida ---------- */
(async function main() {
  const sw = startSW();
  let got;
  try { got = await unlock(); }
  catch (e) {
    $('#lockSub').textContent = 'Não consegui abrir o app. Conecte à internet uma vez para baixar o roteiro.';
    return;
  }
  installCapabilities(got.keys);
  await sw;
  await runText(got.trip);
  if (navigator.serviceWorker && !navigator.serviceWorker.controller && swReg) {
    // 1ª abertura: espera um pouco o service worker assumir (ele abre os vouchers)
    await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 4000); });
  }
  if (!navigator.serviceWorker || !navigator.serviceWorker.controller) await inlineDocs(got.keys);
  await loadScript('phrases.js');
  // places.js e app.js também vêm cifrados (citam a família e o roteiro)
  const [places, app] = await Promise.all(['places.js', 'app.js'].map(async n => KC.decryptText(got.keys.aes, await fetchBuf('data/' + n + '.enc'))));
  await runText(places);
  await runText(app);
  const lock = $('#lock');
  lock.classList.add('out');
  setTimeout(() => lock.remove(), 400);
})();
