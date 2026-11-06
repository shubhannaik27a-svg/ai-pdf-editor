// AI proxy: the API key lives only here (env var), never in the browser.
import express from 'express';
import { readFileSync } from 'fs';
// Minimal .env loader (no extra dependency)
try { for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch {}
const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));

const GROQ = 'https://api.groq.com/openai/v1';
const wait = ms => new Promise(r => setTimeout(r, ms));
let visionPick = null; // vision model found automatically for this key (remembered until restart)

// POST to Groq. On a rate limit (429) it waits the time Groq asks for and retries, instead of failing.
async function groqPost(key, body) {
  for (let a = 0; ; a++) {
    const r = await fetch(GROQ + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429 && a < 3) {
      const hdr = parseFloat(r.headers.get('retry-after'));
      const m = String(data?.error?.message || '').match(/try again in\s*(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)/i);
      const ms = !isNaN(hdr) ? hdr * 1000 : m ? (+m[1] || 0) * 60000 + parseFloat(m[2]) * (m[3].toLowerCase() === 'ms' ? 1 : 1000) : 15000;
      if (ms <= 45000) { console.log('Rate limited by Groq, waiting ' + Math.ceil(ms / 1000) + 's then retrying...'); await wait(ms + 500); continue; }
    }
    return { r, data };
  }
}
// A REAL "this model is not available" error. (A rate-limit message also contains the word "model", so 429 never counts.)
const isJsonErr = (r, data) => !r.ok && r.status !== 429 && /failed to generate json|json_validate_failed/i.test((data?.error?.message || '') + ' ' + (data?.error?.code || ''));
const isModelErr = (r, data) => !r.ok && r.status !== 429 && /invalid model|model.*(does not exist|not found|decommission|deprecated|not supported|no access|do not have access)|(does not exist|not found).*model/i.test(data?.error?.message || '');

app.post('/api/ai', async (req, res) => {
  const key = process.env.AI_API_KEY;
  if (!key) return res.status(500).json({ error: 'AI_API_KEY is not set on the server.' });
  const { system, prompt } = req.body || {};
  const images = (Array.isArray(req.body?.images) ? req.body.images : []).filter(i => i && i.data).slice(0, 5); // optional screenshots (Groq's vision models take at most 5 per request)
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const temp = typeof req.body?.temperature === 'number' ? Math.min(1, Math.max(0, req.body.temperature)) : null; // chat replies use a warmer setting
  try {
    const groq = key.startsWith('gsk_') || process.env.AI_PROVIDER === 'groq';
    let r, data, text, finish;
    if (groq) {
      // Requests with images need a vision model; everything else keeps using the text model.
      const build = (model, plain) => {
        const body = {
          model,
          temperature: temp ?? (images.length ? 0.7 : 0.2),
          ...(plain ? {} : { response_format: { type: 'json_object' } }), // all prompts ask for JSON
          messages: [{ role: 'system', content: system || '' }, { role: 'user', content: images.length
            ? [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'image_url', image_url: { url: 'data:' + (i.mime || 'image/jpeg') + ';base64,' + i.data } }))]
            : prompt }],
        };
        if (/gpt-oss/.test(model)) { body.reasoning_effort = 'low'; body.max_completion_tokens = +process.env.AI_MAX_TOKENS || 4000; }
        else if (images.length) { body.max_completion_tokens = +process.env.AI_MAX_TOKENS || 4000; if (/qwen/.test(model)) body.reasoning_effort = 'none'; } // instruct mode: no hidden thinking eating the output budget
        return body;
      };
      const model = images.length ? (visionPick || process.env.AI_VISION_MODEL || 'qwen/qwen3.8-27b') : (process.env.AI_MODEL || 'openai/gpt-oss-120b');
      ({ r, data } = await groqPost(key, build(model)));
      // "Failed to generate JSON": the model's reply was not strictly valid JSON (code with quotes / line breaks does this).
      // Ask again without Groq's strict JSON mode; the app extracts and repairs the JSON itself.
      if (isJsonErr(r, data)) {
        const raw = data?.error?.failed_generation;
        ({ r, data } = await groqPost(key, build(model, true)));
        if (isJsonErr(r, data) && raw) { r = { ok: true, status: 200 }; data = { choices: [{ message: { content: String(raw) } }] }; }
      }
      if (isModelErr(r, data)) {
        // Model not available for this key: ask Groq what the account can use.
        let ids = [];
        try { ids = ((await (await fetch(GROQ + '/models', { headers: { Authorization: 'Bearer ' + key } })).json()).data || []).map(m => m.id).filter(id => !/whisper|guard|tts|orpheus/i.test(id)); } catch {}
        if (images.length) { // pick a vision-capable model automatically instead of asking the user to edit settings
          const pref = [/llama-4-scout/i, /llama-4-maverick/i, /vision/i, /qwen.*vl/i, /qwen3\.[5-9]/i], cands = [];
          pref.forEach(p => ids.filter(id => p.test(id) && id !== model && !cands.includes(id)).forEach(id => cands.push(id)));
          for (const c of cands.slice(0, 3)) {
            const x = await groqPost(key, build(c));
            if (isModelErr(x.r, x.data)) continue;
            r = x.r; data = x.data;
            if (r.ok) { visionPick = c; console.log('Vision model "' + model + '" is not available; using "' + c + '" instead. Set AI_VISION_MODEL=' + c + ' to make this permanent.'); }
            break;
          }
        }
        if (isModelErr(r, data)) return res.status(r.status).json({ error: data.error.message + ' Models available to your key: ' + ids.join(', ') + '. Set ' + (images.length ? 'AI_VISION_MODEL' : 'AI_MODEL') + ' to one of them and restart.' });
      }
      text = data?.choices?.[0]?.message?.content || '';
      finish = data?.choices?.[0]?.finish_reason; // 'length' = the reply was cut off
    } else {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: 8000, ...(temp != null ? { temperature: temp } : {}), system: system || '', messages: [{ role: 'user', content: images.length
          ? [...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime || 'image/jpeg', data: i.data } })), { type: 'text', text: prompt }]
          : prompt }] }),
      });
      data = await r.json();
      text = (data.content || []).map(c => c.text || '').join('');
      finish = data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason;
    }
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'AI request failed' });
    res.json({ text, finish });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('AI PDF Editor on http://localhost:' + (process.env.PORT || 3000));
  const k = process.env.AI_API_KEY;
  console.log(k ? 'AI_API_KEY found (' + (k.startsWith('gsk_') ? 'Groq' : 'Anthropic') + ' key, ends with ...' + k.slice(-4) + ')'
                : 'AI_API_KEY is not set: AI features are off (generate / rewrite / template). The editor, replace, erase, colour and page tools still work.');
});
