// Generates api/model-list.json from local OpenClaw config (~/.openclaw/openclaw.json)
// Used for committing a snapshot because Vercel cannot read OpenClaw config at runtime.

const fs = require('fs');
const path = require('path');

function guessProvider(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'other';
  const prefix = modelId.split('/')[0]?.toLowerCase() || '';
  const buckets = new Set(['openrouter', 'nexos', 'google', 'anthropic', 'openai', 'opencode']);
  return buckets.has(prefix) ? prefix : 'other';
}

function main() {
  const openclawPath = process.env.OPENCLAW_CONFIG_PATH || path.join(process.env.HOME, '.openclaw', 'openclaw.json');
  const raw = fs.readFileSync(openclawPath, 'utf8');
  const cfg = JSON.parse(raw);

  const models = cfg?.agents?.defaults?.models || {};
  const ids = Object.keys(models).sort();

  const out = {
    generatedAt: new Date().toISOString(),
    source: openclawPath,
    count: ids.length,
    models: ids.map((id) => ({ id, provider: guessProvider(id) })),
  };

  const outPath = path.join(__dirname, '..', 'api', 'model-list.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
  process.stdout.write(`Wrote ${outPath} (${out.count} models)\n`);
}

main();
