// Model Status (grouped by provider)

function badgeClass(status) {
  switch (status) {
    case 'OK': return 'ok';
    case 'NOT_CONFIGURED': return 'nc';
    case 'BILLING/NO_CREDITS': return 'bill';
    case 'RATE_LIMIT': return 'rate';
    case 'AUTH_ERROR': return 'auth';
    case 'PROVIDER_ERROR': return 'prov';
    default: return 'unk';
  }
}

function safe(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function sumCounts(counts) {
  return Object.values(counts || {}).reduce((a, b) => a + (Number(b) || 0), 0);
}

function formatProviderLabel(p) {
  if (!p) return 'OTHER';
  if (p === 'openrouter') return 'OPENROUTER';
  if (p === 'nexos') return 'NEXOS';
  if (p === 'google') return 'GOOGLE';
  if (p === 'anthropic') return 'ANTHROPIC';
  if (p === 'openai') return 'OPENAI';
  if (p === 'opencode') return 'OPENCODE';
  return String(p).toUpperCase();
}

async function loadModelStatus(force = false) {
  const grid = document.getElementById('modelStatusGrid');
  const meta = document.getElementById('modelMeta');
  grid.innerHTML = '';
  meta.textContent = 'Loading…';

  try {
    const url = force ? '/api/model-status/providers?refresh=true' : '/api/model-status/providers';
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    meta.textContent = `Updated ${data.ts} • cached=${data.cached} • age=${data.ageMs}ms`;

    const order = ['openrouter', 'nexos', 'google', 'anthropic', 'openai', 'opencode', 'other'];
    const providers = data.providers || {};

    grid.innerHTML = order.map((p) => {
      const bucket = providers[p] || { models: [], statusCounts: {} };
      const total = sumCounts(bucket.statusCounts);
      const ok = (bucket.statusCounts || {}).OK || 0;

      // Extract billing/account info
      const providerSpecificInfo = data.providers[p]; // Access raw probe results per provider
      const creditBalance = providerSpecificInfo?.account?.credit_balance ?? providerSpecificInfo?.billing?.usage?.cost ?? 'N/A';
      const accountPlan = providerSpecificInfo?.account?.plan ?? providerSpecificInfo?.billing?.billing_status ?? 'N/A';
      const accountEmail = providerSpecificInfo?.account?.email ?? providerSpecificInfo?.billing?.account?.email ?? 'N/A';

      const modelsHtml = (bucket.models || []).map((m) => {
        const cls = badgeClass(m.status);
        return `
          <div class="model-row" style="padding: 8px 0; border-bottom: 1px solid var(--border-subtle);">
            <div class="model-id" title="${safe(m.id)}">${safe(m.id)}</div>
            <span class="badge ${cls}">${safe(m.status)}</span>
          </div>
        `;
      }).join('') || `<div class="log-message" style="color: var(--text-muted);">No configured models</div>`;

      return `
        <div class="link-card">
          <div class="link-header" style="margin-bottom: 12px;">
            <span class="model-provider">${formatProviderLabel(p)}</span>
            <span class="badge ${ok === total && total > 0 ? 'ok' : 'unk'}">${ok}/${total} OK</span>
          </div>
          <div style="color: var(--text-muted); font-size: 11px; font-family: var(--font-mono); margin-bottom: 10px;">
            ${Object.entries(bucket.statusCounts || {}).map(([k, v]) => `${safe(k)}=${safe(v)}`).join(' • ') || 'No data'}
          </div>
          ${ p === 'openrouter' || p === 'openai' || p === 'anthropic' ? `
            <div style="margin-top: 12px; border-top: 1px solid var(--border-subtle); padding-top: 12px; color: var(--text-muted); font-size: 11px; font-family: var(--font-mono);">
              <span style="color: var(--accent-cyan);">Balance:</span> ${safe(creditBalance)}<br>
              <span style="color: var(--accent-cyan);">Plan:</span> ${safe(accountPlan)}<br>
              ${accountEmail !== 'N/A' ? `<span style="color: var(--accent-cyan);">Email:</span> ${safe(accountEmail)}<br>` : ''}
            </div>
          ` : ''}
          <div>${modelsHtml}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    meta.textContent = 'Failed to load /api/model-status/providers';
    grid.innerHTML = `<div class="link-card"><div class="link-header"><span class="link-title">ERROR</span></div><div class="log-message">${safe(e.message || e)}</div></div>`;
  }
}

document.getElementById('refreshModels')?.addEventListener('click', () => loadModelStatus(true));
loadModelStatus(false);
