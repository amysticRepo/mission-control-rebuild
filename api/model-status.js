// /api/model-status
// Probes configured model providers with minimal requests, cached for 60s.

const https = require('https');

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 7_000;

let cache = { ts: 0, payload: null };

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function now() { return Date.now(); }

function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

function httpJson(url, { headers = {}, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* ignore */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: data, json: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function statusFromHttp(provider, resp) {
  const s = resp.status;
  const body = resp.body || '';

  if (s === 401 || s === 403) return { status: 'AUTH_ERROR', detail: `${provider}:${s}` };
  if (s === 402) return { status: 'BILLING/NO_CREDITS', detail: `${provider}:402` };
  if (s === 429) return { status: 'RATE_LIMIT', detail: `${provider}:429` };
  if (s >= 500) return { status: 'PROVIDER_ERROR', detail: `${provider}:${s}` };
  if (s >= 200 && s < 300) return { status: 'OK', detail: `${provider}:${s}` };

  // Some providers return 400 for malformed request; we use list endpoints that should be valid.
  if (s === 400) {
    // If we hit 400 with an auth header present, treat as provider error/unknown.
    return { status: 'UNKNOWN', detail: `${provider}:400` };
  }

  // Heuristic for billing messages
  if (/insufficient|quota|billing|credit/i.test(body)) return { status: 'BILLING/NO_CREDITS', detail: `${provider}:body` };

  return { status: 'UNKNOWN', detail: `${provider}:${s}` };
}

async function probeOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'OPENAI_API_KEY missing' };
  const resp = await httpJson('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('openai', resp);
}

async function probeAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'ANTHROPIC_API_KEY missing' };
  // Minimal endpoint
  const resp = await httpJson('https://api.anthropic.com/v1/models?limit=1', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  });
  return statusFromHttp('anthropic', resp);
}

async function probeOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'OPENROUTER_API_KEY missing' };
  const resp = await httpJson('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('openrouter', resp);
}

async function probeGoogle() {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'GOOGLE_API_KEY missing' };
  const resp = await httpJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  return statusFromHttp('google', resp);
}

async function probeDeepSeek() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'DEEPSEEK_API_KEY missing' };
  const resp = await httpJson('https://api.deepseek.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('deepseek', resp);
}

async function probeGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'GROQ_API_KEY missing' };
  const resp = await httpJson('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('groq', resp);
}

async function probeMistral() {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'MISTRAL_API_KEY missing' };
  const resp = await httpJson('https://api.mistral.ai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('mistral', resp);
}

async function probeCohere() {
  const key = process.env.COHERE_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'COHERE_API_KEY missing' };
  const resp = await httpJson('https://api.cohere.com/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('cohere', resp);
}

async function probeXAI() {
  const key = process.env.XAI_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'XAI_API_KEY missing' };
  // Endpoint resembles OpenAI-compatible APIs; if unavailable, will mark UNKNOWN/PROVIDER_ERROR.
  const resp = await httpJson('https://api.x.ai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('xai', resp);
}

async function probePerplexity() {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'PERPLEXITY_API_KEY missing' };
  const resp = await httpJson('https://api.perplexity.ai/models', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return statusFromHttp('perplexity', resp);
}

async function probeNexos() {
  const key = process.env.NEXOS_API_KEY;
  if (!key) return { status: 'NOT_CONFIGURED', detail: 'NEXOS_API_KEY missing' };

  // Nexos exposes an OpenAI-compatible surface.
  // Use a minimal chat completion request (small token count) to validate auth/billing.
  const url = 'https://api.nexos.ai/openai/v1/chat/completions';
  const body = JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
  });

  const resp = await new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { /* ignore */ }
        resolve({ status: res.statusCode || 0, headers: res.headers, body: data, json: parsed });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  return statusFromHttp('nexos', resp);
}

const PROVIDER_PROBES = {
  openai: probeOpenAI,
  anthropic: probeAnthropic,
  openrouter: probeOpenRouter,
  google: probeGoogle,
  deepseek: probeDeepSeek,
  groq: probeGroq,
  mistral: probeMistral,
  cohere: probeCohere,
  xai: probeXAI,
  perplexity: probePerplexity,
  nexos: probeNexos,
};

function guessProvider(modelId) {
  // Determine provider by model name prefix before first '/'
  // Required buckets: openrouter, nexos, google, anthropic, openai, opencode, other.
  if (!modelId || typeof modelId !== 'string') return 'other';
  const prefix = modelId.split('/')[0]?.toLowerCase() || '';
  const buckets = new Set(['openrouter', 'nexos', 'google', 'anthropic', 'openai', 'opencode']);
  return buckets.has(prefix) ? prefix : 'other';
}

function groupByProvider(models) {
  const out = {
    openrouter: { models: [], statusCounts: {} },
    nexos: { models: [], statusCounts: {} },
    google: { models: [], statusCounts: {} },
    anthropic: { models: [], statusCounts: {} },
    openai: { models: [], statusCounts: {} },
    opencode: { models: [], statusCounts: {} },
    other: { models: [], statusCounts: {} },
  };

  for (const m of models || []) {
    const p = guessProvider(m.id);
    const bucket = out[p] || out.other;
    bucket.models.push(m);
    const k = m.status || 'UNKNOWN';
    bucket.statusCounts[k] = (bucket.statusCounts[k] || 0) + 1;
  }

  for (const p of Object.keys(out)) {
    out[p].models.sort((a, b) => (a.id || '').localeCompare(b.id || ''));
  }

  return out;
}

const path = require('path');
const fs = require('fs');

function getConfiguredModels() {
  // Vercel cannot read OpenClaw config at runtime.
  // We ship a checked-in snapshot of configured models (generated from OpenClaw config at build/dev time).
  const defaults = {
    defaultModel: process.env.OPENCLAW_DEFAULT_MODEL || process.env.DEFAULT_MODEL || 'openrouter/openrouter/auto',
    imageModel: process.env.OPENCLAW_IMAGE_MODEL || process.env.IMAGE_MODEL || 'openai/gpt-image-1',
    transcriptionModel: process.env.OPENCLAW_TRANSCRIPTION_MODEL || process.env.TRANSCRIPTION_MODEL || 'openai/whisper-1',
  };

  const listPath = path.join(__dirname, 'model-list.json');
  let list = { models: [] };
  try {
    list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  } catch {
    // Fallback: keep server alive even if the list is missing.
    list = { models: [] };
  }

  const providers = {};
  for (const m of list.models || []) {
    const p = guessProvider(m.id);
    if (!providers[p]) providers[p] = { models: [] };
    providers[p].models.push(m.id);
  }

  return { defaults, providers };
}

async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { error: 'Method Not Allowed' });

    if (cache.payload && now() - cache.ts < CACHE_TTL_MS) {
      return json(res, 200, { ...cache.payload, cached: true, ageMs: now() - cache.ts });
    }

    const config = getConfiguredModels();

    const allModels = [];
    for (const [provider, { models }] of Object.entries(config.providers)) {
      for (const m of models || []) allModels.push({ id: m, provider: provider || guessProvider(m) });
    }

    const providersUsed = Array.from(new Set(allModels.map(m => guessProvider(m.id)).filter(p => p !== 'other')));

    const providerResults = {};
    await Promise.all(
      providersUsed.map(async (p) => {
        const fn = PROVIDER_PROBES[p];
        if (!fn) {
          providerResults[p] = { status: 'UNKNOWN', detail: 'no probe' };
          return;
        }
        try {
          providerResults[p] = await withTimeout(fn(), TIMEOUT_MS, p);
        } catch (e) {
          providerResults[p] = { status: 'UNKNOWN', detail: String(e.message || e) };
        }
      })
    );

    const models = allModels.map((m) => {
      const p = guessProvider(m.id);
      const base = providerResults[p] || { status: 'UNKNOWN', detail: 'provider unknown' };
      return { id: m.id, provider: p, status: base.status, detail: base.detail };
    });

    const payload = {
      ts: new Date().toISOString(),
      ttlMs: CACHE_TTL_MS,
      defaults: config.defaults,
      providers: providerResults,
      models,
      providersGrouped: groupByProvider(models),
    };

    cache = { ts: now(), payload };
    return json(res, 200, { ...payload, cached: false, ageMs: 0 });
  } catch (e) {
    return json(res, 500, { error: 'Internal Server Error', detail: String(e.message || e) });
  }
}

module.exports = handler;
