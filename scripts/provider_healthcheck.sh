#!/usr/bin/env bash
set -euo pipefail

# Provider curl healthcheck
# - minimal requests
# - 5s timeouts
# - no secrets hardcoded

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS_JSON="${MODELS_JSON:-$ROOT_DIR/scripts/models.json}"

TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"

# Badges
BADGE_OK="[OK]"
BADGE_NOT_CONFIGURED="[NOT_CONFIGURED]"
BADGE_AUTH="[AUTH]"
BADGE_RATE_LIMIT="[RATE_LIMIT]"
BADGE_BILLING="[BILLING]"
BADGE_ERROR="[ERROR]"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required" >&2
  exit 2
fi

bold() { if [[ -t 1 ]]; then printf "\033[1m%s\033[0m" "$1"; else printf "%s" "$1"; fi; }

title() {
  echo
  bold "$1"; echo
  echo "$(printf '%*s' ${#1} '' | tr ' ' '=')"
}

# curl wrapper
# writes body to stdout and http code to stderr? Instead: return "<http>\n<body>".
_curl_json() {
  local method="$1" url="$2" auth_header="$3" data="${4:-}"

  local args=(
    -sS
    --connect-timeout "$TIMEOUT_SECONDS"
    --max-time "$TIMEOUT_SECONDS"
    -H "Content-Type: application/json"
  )

  if [[ -n "$auth_header" ]]; then
    args+=( -H "$auth_header" )
  fi

  if [[ "$method" == "GET" ]]; then
    :
  else
    args+=( -X "$method" --data "$data" )
  fi

  # append HTTP status on its own line at end
  curl "${args[@]}" "$url" -w "\n%{http_code}"
}

classify() {
  # classify based on http code + body text
  local http="$1" body="$2" provider="$3"

  # network / curl errors are handled outside
  case "$http" in
    200|201)
      echo "$BADGE_OK"; return 0 ;;
    401|403)
      echo "$BADGE_AUTH"; return 0 ;;
    402)
      echo "$BADGE_BILLING"; return 0 ;;
    429)
      echo "$BADGE_RATE_LIMIT"; return 0 ;;
    500|502|503|504)
      echo "$BADGE_ERROR"; return 0 ;;
  esac

  # Provider-specific body hints
  local lc
  lc="$(printf "%s" "$body" | tr '[:upper:]' '[:lower:]')"

  if [[ "$lc" == *"rate limit"* || "$lc" == *"too many requests"* ]]; then
    echo "$BADGE_RATE_LIMIT"; return 0
  fi
  if [[ "$lc" == *"insufficient"* || "$lc" == *"no credits"* || "$lc" == *"payment"* || "$lc" == *"billing"* ]]; then
    echo "$BADGE_BILLING"; return 0
  fi
  if [[ "$lc" == *"unauthorized"* || "$lc" == *"invalid api key"* || "$lc" == *"authentication"* ]]; then
    echo "$BADGE_AUTH"; return 0
  fi

  echo "$BADGE_ERROR"
}

print_model_line() {
  local model="$1" badge="$2" extra="${3:-}"
  if [[ -n "$extra" ]]; then
    printf "  - %-32s %s  %s\n" "$model" "$badge" "$extra"
  else
    printf "  - %-32s %s\n" "$model" "$badge"
  fi
}

EXIT_CODE=0
ANY_HARD_FAIL=0

# ===== Providers =====

check_openrouter_model() {
  local model="$1"
  local key="${OPENROUTER_API_KEY:-}"
  if [[ -z "$key" ]]; then
    print_model_line "$model" "$BADGE_NOT_CONFIGURED" "(set OPENROUTER_API_KEY)"
    return 0
  fi

  local url="https://openrouter.ai/api/v1/chat/completions"
  local data
  data=$(jq -nc --arg m "$model" '{model:$m, messages:[{role:"user",content:"ping"}], max_tokens:1, temperature:0}')

  local out http body
  if ! out=$(_curl_json POST "$url" "Authorization: Bearer $key" "$data" 2>/dev/null); then
    print_model_line "$model" "$BADGE_ERROR" "(curl_failed)"
    ANY_HARD_FAIL=1
    return 0
  fi
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"

  local badge
  badge=$(classify "$http" "$body" openrouter)
  print_model_line "$model" "$badge" "(http:$http)"
  [[ "$badge" == "$BADGE_OK" || "$badge" == "$BADGE_NOT_CONFIGURED" ]] || ANY_HARD_FAIL=1
}

check_openai_model() {
  local model="$1"
  local key="${OPENAI_API_KEY:-}"
  if [[ -z "$key" ]]; then
    print_model_line "$model" "$BADGE_NOT_CONFIGURED" "(set OPENAI_API_KEY)"
    return 0
  fi

  local url="https://api.openai.com/v1/chat/completions"
  local data
  data=$(jq -nc --arg m "$model" '{model:$m, messages:[{role:"user",content:"ping"}], max_tokens:1, temperature:0}')

  local out http body
  if ! out=$(_curl_json POST "$url" "Authorization: Bearer $key" "$data" 2>/dev/null); then
    print_model_line "$model" "$BADGE_ERROR" "(curl_failed)"
    ANY_HARD_FAIL=1
    return 0
  fi
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"

  local badge
  badge=$(classify "$http" "$body" openai)
  print_model_line "$model" "$badge" "(http:$http)"
  [[ "$badge" == "$BADGE_OK" || "$badge" == "$BADGE_NOT_CONFIGURED" ]] || ANY_HARD_FAIL=1
}

check_anthropic_model() {
  local model="$1"
  local key="${ANTHROPIC_API_KEY:-}"
  if [[ -z "$key" ]]; then
    print_model_line "$model" "$BADGE_NOT_CONFIGURED" "(set ANTHROPIC_API_KEY)"
    return 0
  fi

  local url="https://api.anthropic.com/v1/messages"
  local data
  data=$(jq -nc --arg m "$model" '{model:$m, max_tokens:1, messages:[{role:"user",content:[{type:"text",text:"ping"}]}]}')

  # Anthropic requires these headers
  local out http body
  if ! out=$(curl -sS --connect-timeout "$TIMEOUT_SECONDS" --max-time "$TIMEOUT_SECONDS" \
      -H "Content-Type: application/json" \
      -H "x-api-key: $key" \
      -H "anthropic-version: 2023-06-01" \
      -d "$data" \
      "$url" -w "\n%{http_code}" 2>/dev/null); then
    print_model_line "$model" "$BADGE_ERROR" "(curl_failed)"
    ANY_HARD_FAIL=1
    return 0
  fi
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"

  local badge
  badge=$(classify "$http" "$body" anthropic)
  print_model_line "$model" "$badge" "(http:$http)"
  [[ "$badge" == "$BADGE_OK" || "$badge" == "$BADGE_NOT_CONFIGURED" ]] || ANY_HARD_FAIL=1
}

check_gemini_model() {
  local model="$1"
  local key="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}"
  if [[ -z "$key" ]]; then
    print_model_line "$model" "$BADGE_NOT_CONFIGURED" "(set GEMINI_API_KEY or GOOGLE_API_KEY)"
    return 0
  fi

  # Gemini REST: POST .../models/{model}:generateContent?key=...
  local url="https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}"
  local data
  data=$(jq -nc '{contents:[{role:"user",parts:[{text:"ping"}]}], generationConfig:{maxOutputTokens:1, temperature:0}}')

  local out http body
  if ! out=$(_curl_json POST "$url" "" "$data" 2>/dev/null); then
    print_model_line "$model" "$BADGE_ERROR" "(curl_failed)"
    ANY_HARD_FAIL=1
    return 0
  fi
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"

  local badge
  badge=$(classify "$http" "$body" gemini)
  print_model_line "$model" "$badge" "(http:$http)"
  [[ "$badge" == "$BADGE_OK" || "$badge" == "$BADGE_NOT_CONFIGURED" ]] || ANY_HARD_FAIL=1
}

check_nexos_model() {
  local model="$1"
  local key="${NEXOS_API_KEY:-}"
  if [[ -z "$key" ]]; then
    print_model_line "$model" "$BADGE_NOT_CONFIGURED" "(set NEXOS_API_KEY)"
    return 0
  fi

  # Nexos is OpenAI-compatible in most setups; try /chat/completions.
  local base="${NEXOS_BASE_URL:-https://api.nexos.ai/v1}"
  local url="${base%/}/chat/completions"
  local data
  data=$(jq -nc --arg m "$model" '{model:$m, messages:[{role:"user",content:"ping"}], max_tokens:1, temperature:0}')

  local out http body
  if ! out=$(_curl_json POST "$url" "Authorization: Bearer $key" "$data" 2>/dev/null); then
    print_model_line "$model" "$BADGE_ERROR" "(curl_failed)"
    ANY_HARD_FAIL=1
    return 0
  fi
  http="${out##*$'\n'}"
  body="${out%$'\n'*}"

  local badge
  badge=$(classify "$http" "$body" nexos)
  print_model_line "$model" "$badge" "(http:$http)"
  [[ "$badge" == "$BADGE_OK" || "$badge" == "$BADGE_NOT_CONFIGURED" ]] || ANY_HARD_FAIL=1
}

check_provider() {
  local provider="$1"

  title "Provider: ${provider}"

  local models
  models=$(jq -r --arg p "$provider" '.[$p].models[]? // empty' "$MODELS_JSON")

  if [[ -z "$models" ]]; then
    echo "  (no models configured in $MODELS_JSON)"
    return 0
  fi

  while IFS= read -r m; do
    case "$provider" in
      openrouter) check_openrouter_model "$m" ;;
      openai) check_openai_model "$m" ;;
      anthropic) check_anthropic_model "$m" ;;
      gemini) check_gemini_model "$m" ;;
      nexos) check_nexos_model "$m" ;;
      *) print_model_line "$m" "$BADGE_ERROR" "(unknown_provider)"; ANY_HARD_FAIL=1 ;;
    esac
  done <<< "$models"
}

main() {
  if [[ ! -f "$MODELS_JSON" ]]; then
    echo "models file not found: $MODELS_JSON" >&2
    exit 2
  fi

  local providers
  providers=$(jq -r 'keys[]' "$MODELS_JSON")

  echo "Provider Healthcheck"
  echo "- models: $MODELS_JSON"
  echo "- timeout: ${TIMEOUT_SECONDS}s"

  while IFS= read -r p; do
    check_provider "$p"
  done <<< "$providers"

  echo
  if [[ "$ANY_HARD_FAIL" -eq 1 ]]; then
    echo "Result: FAIL (one or more providers returned AUTH/BILLING/RATE_LIMIT/ERROR)"
    exit 2
  fi
  echo "Result: OK (all providers OK or NOT_CONFIGURED)"
  exit 0
}

main "$@"
