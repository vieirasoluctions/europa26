/* Sincronização entre os celulares da família via Firestore, com cifra de ponta a ponta.
   Expõe a mesma forma do banco do artefato que o app já usava:
     db.doc('colecao/id').set(d) | .update(patch) | .delete()
     db.collection('colecao').onSnapshot(cb, onErr)
   O servidor só guarda { e: <cifrado>, u: <hora do servidor> } em
   fam/<id da família>/<colecao>/<nome opaco>. Sem a senha, nada é legível. */
import {
  initializeApp, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, signInAnonymously, onAuthStateChanged,
  initializeFirestore, memoryLocalCache, doc, collection, setDoc, getDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp,
  connectAuthEmulator, connectFirestoreEmulator,
} from './vendor/firebase.js';

const KC = self.KC;
const OP_TIMEOUT = 15000;

function deepMerge(a, b) {
  const o = Object.assign({}, a);
  for (const k in b) {
    const v = b[k];
    o[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(o[k] && typeof o[k] === 'object' ? o[k] : {}, v) : v;
  }
  return o;
}
/* erros no formato que o app entende (e.code) */
function fail(code, cause) { const e = new Error(code); e.code = code; e.cause = cause; e.ours = true; return e; }
function mapErr(e) {
  const c = e && e.code ? String(e.code).replace(/^firestore\//, '') : '';
  if (c === 'permission-denied' || c === 'unauthenticated') return fail('not_granted', e);
  if (c === 'resource-exhausted') return fail('quota_exceeded', e);
  if (c === 'invalid-argument') return fail('transform_error', e);
  return fail('unavailable', e);
}
const withTimeout = p => new Promise((res, rej) => {
  const t = setTimeout(() => rej(fail('unavailable')), OP_TIMEOUT);
  p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
});

export async function connectSync(cfg, keys, onStatus) {
  const opts = Object.assign({}, cfg); delete opts.emulator; delete opts.databaseId;
  const app = initializeApp(opts, 'e26');
  let auth;
  try { auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] }); }
  catch (e) { auth = initializeAuth(app); }
  // banco com nome próprio (databaseId) ou o padrão do projeto
  const fs = cfg.databaseId ? initializeFirestore(app, { localCache: memoryLocalCache() }, cfg.databaseId) : initializeFirestore(app, { localCache: memoryLocalCache() });
  if (cfg.emulator) { // só para testes locais
    connectAuthEmulator(auth, 'http://' + cfg.emulator + ':9099', { disableWarnings: true });
    connectFirestoreEmulator(fs, cfg.emulator, 8080);
  }

  // sessão anônima: guardada no aparelho; offline, a última sessão continua valendo
  const ready = new Promise(res => {
    const off = onAuthStateChanged(auth, u => {
      if (u) { off(); res(u); return; }
      signInAnonymously(auth).catch(() => { /* sem rede: tenta de novo quando voltar */ });
    });
    self.addEventListener('online', () => { if (!auth.currentUser) signInAnonymously(auth).catch(() => {}); });
  });

  const root = 'fam/' + keys.fam;
  const ref = async (c, id) => doc(fs, root + '/' + c + '/' + await KC.tag(keys.mac, c + '/' + id));
  const pack = async (id, d) => ({ e: await KC.encJson(keys.aes, { id: id, d: d }), u: serverTimestamp() });
  const unpack = async snap => { const o = await KC.decJson(keys.aes, snap.data().e); return o; };
  const run = async fn => { try { return await withTimeout(ready.then(fn)); } catch (e) { throw e && e.ours ? e : mapErr(e); } };

  const db = {
    doc(path) {
      const i = path.indexOf('/'), c = path.slice(0, i), id = path.slice(i + 1);
      return {
        set: d => run(async () => setDoc(await ref(c, id), await pack(id, d))),
        delete: () => run(async () => deleteDoc(await ref(c, id))),
        get: () => run(async () => { const sn = await getDoc(await ref(c, id)); if (!sn.exists()) return null; try { return (await unpack(sn)).d; } catch (e) { return null; } }),
        // escuta um documento só (usado para a chave do assistente)
        onSnapshot(cb, onErr) {
          let off = () => {}, stopped = false;
          ready.then(async () => {
            if (stopped) return;
            const r = await ref(c, id);
            if (stopped) return;
            off = onSnapshot(r, async sn => {
              if (sn.metadata.fromCache) return; // sem internet: não sabe o valor real ainda
              let d = null;
              if (sn.exists()) { try { d = (await unpack(sn)).d; } catch (e) { d = null; } }
              if (!stopped) cb({ exists: d != null, data: () => d, fromCache: sn.metadata.fromCache });
            }, e => { onErr && onErr(mapErr(e)); });
          });
          return () => { stopped = true; off(); };
        },
        // mescla no servidor dentro de uma transação: dois celulares marcando ao mesmo tempo não se atropelam
        update: patch => run(async () => {
          const r = await ref(c, id);
          await runTransaction(fs, async tx => {
            const s = await tx.get(r);
            let cur = {};
            if (s.exists()) { try { cur = (await unpack(s)).d || {}; } catch (e) { cur = {}; } }
            tx.set(r, await pack(id, deepMerge(cur, patch)));
          });
        }),
      };
    },
    collection(c) {
      return {
        onSnapshot(cb, onErr) {
          let off = () => {}, stopped = false, seq = 0;
          ready.then(() => {
            if (stopped) return;
            let fromServer = false;
            off = onSnapshot(collection(fs, root + '/' + c), async qs => {
              // aberto sem internet, o cache em memória ainda está vazio: não é "o banco está vazio".
              // Ignora até a 1ª resposta do servidor; o app segue com o que guardou no aparelho.
              if (qs.metadata.fromCache && !fromServer) return;
              fromServer = true;
              const my = ++seq, docs = [];
              await Promise.all(qs.docs.map(async s => {
                try { const o = await unpack(s); if (o && o.id != null) docs.push({ id: String(o.id), exists: true, data: () => o.d }); }
                catch (e) { /* documento de outra senha ou corrompido: ignora */ }
              }));
              if (my === seq && !stopped) { cb({ docs: docs, fromCache: qs.metadata.fromCache }); onStatus && onStatus(qs.metadata.fromCache ? 'cache' : 'live'); }
            }, e => { onErr && onErr(mapErr(e)); onStatus && onStatus('error'); });
          });
          return () => { stopped = true; off(); };
        },
      };
    },
  };
  return db;
}
