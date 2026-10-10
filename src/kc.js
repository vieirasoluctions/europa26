/* Chave da família: tudo o que é pessoal (roteiro, vouchers, gastos sincronizados)
   viaja e fica guardado cifrado com AES-GCM. A chave sai da senha da família
   (PBKDF2-SHA256) e nunca sai do aparelho. Usado pelo app, pelo service worker
   e pelas ferramentas de build (Node), por isso não depende de DOM. */
(function (g) {
  'use strict';
  const subtle = g.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const MAGIC = [0x45, 0x32, 0x36, 0x01]; // "E26" + versão do formato

  const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
  const b64 = u8 => { let s = ''; const a = new Uint8Array(u8); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return g.btoa(s); };
  const unb64 = s => { const r = g.atob(s), a = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) a[i] = r.charCodeAt(i); return a; };
  const b64url = u8 => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  /* senha -> { aes, mac (CryptoKey não exportáveis), fam (id do espaço no banco) } */
  async function derive(pass, meta) {
    const base = await subtle.importKey('raw', te.encode(String(pass).normalize('NFC').trim()), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(meta.salt), iterations: meta.iter }, base, 768));
    const aes = await subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    const mac = await subtle.importKey('raw', bits.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const fam = b64url(bits.slice(64, 96));
    bits.fill(0);
    return { aes: aes, mac: mac, fam: fam };
  }

  async function encrypt(aes, data) {
    const iv = g.crypto.getRandomValues(new Uint8Array(12));
    const pt = typeof data === 'string' ? te.encode(data) : new Uint8Array(data);
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: iv }, aes, pt));
    const out = new Uint8Array(4 + 12 + ct.length);
    out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
    return out;
  }
  async function decrypt(aes, buf) {
    const u = new Uint8Array(buf);
    for (let i = 0; i < 4; i++) if (u[i] !== MAGIC[i]) throw new Error('formato');
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(4, 16) }, aes, u.subarray(16)));
  }
  const decryptText = async (aes, buf) => td.decode(await decrypt(aes, buf));
  const encJson = async (aes, o) => b64(await encrypt(aes, JSON.stringify(o)));
  const decJson = async (aes, s) => JSON.parse(await decryptText(aes, unb64(s)));
  /* nome opaco e estável para um documento (o banco não vê ids nem nomes) */
  const tag = async (mac, s) => b64url(new Uint8Array(await subtle.sign('HMAC', mac, te.encode(s))).slice(0, 18));

  /* a chave fica no IndexedDB como CryptoKey não exportável; o service worker lê daqui */
  const DB = 'e26-keys', ST = 'k';
  function idb() {
    return new Promise((res, rej) => {
      const r = g.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(ST);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(ST, mode), st = tx.objectStore(ST), r = fn(st);
      tx.oncomplete = () => { db.close(); res(r && r.result); };
      tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  const saveKeys = k => idbDo('readwrite', st => st.put(k, 'family'));
  const loadKeys = () => idbDo('readonly', st => st.get('family')).catch(() => null);
  const clearKeys = () => idbDo('readwrite', st => st.delete('family'));

  const KC = { derive, encrypt, decrypt, decryptText, encJson, decJson, tag, saveKeys, loadKeys, clearKeys, hex, unhex, b64, unb64, b64url };
  g.KC = KC;
  if (typeof module !== 'undefined' && module.exports) module.exports = KC;
})(typeof self !== 'undefined' ? self : globalThis);
