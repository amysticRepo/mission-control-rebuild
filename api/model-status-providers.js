// /api/model-status/providers
// Returns provider-grouped model status buckets.

const baseHandler = require('./model-status');

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function guessProvider(modelId) {
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

async function handler(req, res) {
  try {
    // Delegate to /api/model-status and reshape output.
    const capture = { code: 200, data: null };
    const resShim = {
      statusCode: 200,
      headers: {},
      setHeader: (k, v) => (resShim.headers[String(k).toLowerCase()] = v),
      end: (body) => {
        try {
          capture.code = resShim.statusCode || 200;
          capture.data = body ? JSON.parse(body) : null;
        } catch {
          capture.data = null;
        }
      },
    };

    await baseHandler(req, resShim);

    if (capture.code !== 200 || !capture.data) {
      return json(res, capture.code || 500, capture.data || { error: 'Upstream model-status failed' });
    }

    const providers = groupByProvider(capture.data.models || []);

    return json(res, 200, {
      ts: capture.data.ts,
      ttlMs: capture.data.ttlMs,
      cached: capture.data.cached,
      ageMs: capture.data.ageMs,
      defaults: capture.data.defaults,
      providers,
    });
  } catch (e) {
    return json(res, 500, { error: 'Internal Server Error', detail: String(e.message || e) });
  }
}

module.exports = handler;
