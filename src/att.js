/* Anexos que a família inclui pelo app (fotos e PDFs de vouchers, bilhetes, recibos).
   - PDF vira imagens (uma por página): o iPhone não abre PDF direito dentro de app instalado.
   - Fica cifrado no aparelho (Cache Storage "e26-att") e o service worker abre em att/<id>.
   - Sobe cifrado para o banco em pedaços (cfg/blob.<id>.<n>), e o outro celular baixa uma vez.
   - Sem internet: guarda aqui e envia depois (fila em localStorage). */
const KC = self.KC;
const CACHE = 'e26-att';
const COLL = 'cfg';                 // as regras do banco já liberam esta coleção
const CHUNK = 200 * 1024;           // cada pedaço cifrado fica abaixo do limite das regras
const PENDING = 'e26.att.pending';
const MAX_PAGES = 12;

function fail(code) { const e = new Error(code); e.code = code; return e; }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
const keyOf = id => new URL('att/' + id, location.href).href;
const chunkPath = (id, i) => COLL + '/blob.' + id + '.' + i;
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || '[]'); } catch (e) { return []; } };
const writePending = l => { try { localStorage.setItem(PENDING, JSON.stringify(l)); } catch (e) {} };

const toJpeg = cv => new Promise((res, rej) => cv.toBlob(b => (b ? res(b) : rej(fail('image_rejected'))), 'image/jpeg', 0.85));

async function shrinkImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { throw fail('unsupported_type'); }
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  return toJpeg(cv);
}

async function pdfPages(file) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1600 / base.width) });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await toJpeg(cv));
  }
  await doc.destroy();
  return out;
}

export function makeAssets(getDb, keys) {
  const cacheP = caches.open(CACHE);
  async function putLocal(id, bytes, type) {
    const enc = await KC.encrypt(keys.aes, bytes);
    await (await cacheP).put(keyOf(id), new Response(enc, { headers: { 'Content-Type': 'application/octet-stream', 'X-Type': type } }));
  }
  async function readLocal(id) {
    const r = await (await cacheP).match(keyOf(id));
    if (!r) return null;
    return { bytes: await KC.decrypt(keys.aes, await r.arrayBuffer()), type: r.headers.get('X-Type') || 'image/jpeg' };
  }
  const hasLocal = async id => !!(await (await cacheP).match(keyOf(id)));

  let flushing = false;
  async function flush() {
    if (flushing || navigator.onLine === false) return;
    const db = await getDb(); if (!db) return;
    flushing = true;
    try {
      for (const id of readPending()) {
        const f = await readLocal(id);
        if (f) {
          const n = Math.max(1, Math.ceil(f.bytes.length / CHUNK));
          for (let i = 0; i < n; i++) await db.doc(chunkPath(id, i)).set({ i: i, n: n, t: f.type, b: KC.b64(f.bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) });
        }
        writePending(readPending().filter(x => x !== id));
      }
    } catch (e) { /* sem rede: tenta de novo depois */ }
    flushing = false;
  }
  addEventListener('online', () => flush());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(); });
  setTimeout(flush, 3000);

  async function store(blob) {
    const id = uid();
    await putLocal(id, new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/jpeg');
    writePending(readPending().concat(id));
    return { id: id, size: blob.size };
  }

  return {
    async upload(file) {
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      if (!isPdf && !/^image\//.test(file.type || '')) throw fail('unsupported_type');
      if (file.size > 25 * 1024 * 1024) throw fail('too_large');
      const imgs = isPdf ? await pdfPages(file) : [await shrinkImage(file)];
      if (!imgs.length) throw fail('unsupported_type');
      const saved = [];
      for (const b of imgs) saved.push(await store(b));
      flush();
      return { id: saved[0].id, pages: saved.map(x => x.id), contentType: 'image/jpeg', sizeBytes: saved.reduce((s, x) => s + x.size, 0) };
    },
    async delete(id) {
      try { await (await cacheP).delete(keyOf(id)); } catch (e) {}
      writePending(readPending().filter(x => x !== id));
      const db = await getDb(); if (!db) return;
      const first = await db.doc(chunkPath(id, 0)).get().catch(() => null);
      const n = first && first.n ? first.n : 1;
      for (let i = 0; i < n; i++) await db.doc(chunkPath(id, i)).delete().catch(() => {});
    },
    /* baixa (uma vez) os anexos que o outro celular incluiu; diz quantos ainda faltam */
    async ensure(ids) {
      const db = await getDb(); if (!db || navigator.onLine === false) return { got: 0, missing: ids.length };
      let got = 0, missing = 0;
      for (const id of ids) {
        if (!id || await hasLocal(id)) continue;
        try {
          const first = await db.doc(chunkPath(id, 0)).get();
          if (!first) { missing++; continue; } // ainda subindo do outro celular
          const parts = [KC.unb64(first.b)];
          for (let i = 1; i < first.n; i++) { const c = await db.doc(chunkPath(id, i)).get(); if (!c) throw fail('partial'); parts.push(KC.unb64(c.b)); }
          const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
          let o = 0; parts.forEach(p => { all.set(p, o); o += p.length; });
          await putLocal(id, all, first.t || 'image/jpeg');
          got++;
        } catch (e) { missing++; }
      }
      return { got: got, missing: missing };
    },
    flush: flush,
  };
}
