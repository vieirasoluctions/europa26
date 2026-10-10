/* Assistente: o mesmo contrato do "sample" do artefato, por cima da API do Claude.
   sample(input, {onText, signal}) -> {text, truncated}
   sample.json(input, {images, modelTier}) -> objeto
   sample.limits() -> {images: {mediaTypes}}
   A chave da API é da família: fica cifrada no banco e no aparelho. Precisa de internet. */
import { Anthropic } from './vendor/anthropic.js';

const MODEL = 'claude-opus-5-5';
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function fail(code, text) { const e = new Error(code); e.code = code; if (text) e.text = text; return e; }
function mapErr(e, partial) {
  if (e && e.code) return e;
  if (e instanceof Anthropic.APIUserAbortError) return fail('cancelled', partial);
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail('not_granted', partial);
  if (e instanceof Anthropic.RateLimitError) return fail('rate_limited', partial);
  if (e instanceof Anthropic.APIConnectionError) return fail('offline', partial);
  if (e instanceof Anthropic.BadRequestError && /image/i.test(e.message || '')) return fail('image_rejected', partial);
  return fail('unavailable', partial);
}
const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });

/* reduz fotos grandes do iPhone antes de enviar */
async function shrink(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
    if (k === 1 && blob.size < 3.5e6 && IMG_TYPES.includes(blob.type)) return blob;
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
  } catch (e) { return blob; }
}

export function makeSample(getKey) {
  let client = null, lastKey = '';
  const cl = () => {
    const k = getKey();
    if (!k) throw fail('not_granted');
    if (!client || k !== lastKey) { client = new Anthropic({ apiKey: k, dangerouslyAllowBrowser: true, maxRetries: 1 }); lastKey = k; }
    return client;
  };
  async function messagesOf(input, images) {
    const turns = typeof input === 'string' ? [{ role: 'user', content: input }] : input.map(t => ({ role: t.role, content: t.content }));
    const imgs = images ? (Array.isArray(images) ? images : [images]) : [];
    if (imgs.length) {
      const last = turns[turns.length - 1];
      const blocks = [];
      for (const b of imgs) {
        const s = await shrink(b);
        blocks.push({ type: 'image', source: { type: 'base64', media_type: IMG_TYPES.includes(s.type) ? s.type : 'image/jpeg', data: await toB64(s) } });
      }
      last.content = blocks.concat([{ type: 'text', text: String(last.content) }]);
    }
    return turns;
  }
  async function call(input, opts, json) {
    opts = opts || {};
    if (!navigator.onLine) throw fail('offline');
    const c = cl();
    let text = '';
    const stream = c.beta.messages.stream({
      model: MODEL,
      max_tokens: json ? 4000 : 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: opts.modelTier === 'quick' || json ? 'low' : 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: await messagesOf(input, opts.images),
    }, { signal: opts.signal });
    stream.on('text', d => { text += d; if (opts.onText) opts.onText({ text: text, delta: d }); });
    let msg;
    try { msg = await stream.finalMessage(); } catch (e) { throw mapErr(e, text); }
    if (msg.stop_reason === 'refusal') throw fail('refused');
    text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return { text: text, truncated: msg.stop_reason === 'max_tokens' };
  }
  const sample = (input, opts) => call(input, opts, false);
  sample.json = async (input, opts) => {
    const r = await call(input, opts, true);
    const m = r.text.match(/\{[\s\S]*\}/);
    if (!m) throw fail('unavailable');
    try { return JSON.parse(m[0]); } catch (e) { throw fail('unavailable'); }
  };
  sample.limits = async () => ({ images: { mediaTypes: IMG_TYPES } });
  return sample;
}

/* teste rápido da chave, usado na tela de configuração */
export async function testKey(k) {
  const c = new Anthropic({ apiKey: k, dangerouslyAllowBrowser: true, maxRetries: 0 });
  try { await c.models.retrieve(MODEL); return true; } catch (e) { return false; }
}
