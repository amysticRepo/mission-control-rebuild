# Mission Control (ComCrash)

## Provider curl healthcheck

A lightweight bash script to sanity-check model providers using **minimal curl** requests (5s timeouts) and your API keys from env vars.

### Usage

```bash
# from repo root
chmod +x scripts/provider_healthcheck.sh

# set the keys you have
export OPENROUTER_API_KEY="..."
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."   # or GOOGLE_API_KEY
export NEXOS_API_KEY="..."

./scripts/provider_healthcheck.sh
```

### Config

Models are listed in:

- `scripts/models.json`

You can override the file path and timeout:

```bash
MODELS_JSON=/path/to/models.json TIMEOUT_SECONDS=5 ./scripts/provider_healthcheck.sh
```

### Exit codes

- `0` = all checks are **OK** or **NOT_CONFIGURED**
- `2` = one or more checks returned **AUTH / BILLING / RATE_LIMIT / ERROR**

### Output format (example)

```text
Provider: openai
================
  - gpt-4o-mini                      [OK]  (http:200)
  - gpt-4.1-mini                     [RATE_LIMIT]  (http:429)
```
