#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
MP3_PATH="$ROOT_DIR/App Recording 20251212 2146.mp3"

if [ ! -f "$MP3_PATH" ]; then
  echo "MP3 not found: $MP3_PATH" >&2
  exit 1
fi

SANDBOX_ID="$(date +%Y%m%d_%H%M%S)"
SANDBOX_DIR="/tmp/loopforge_sandbox_$SANDBOX_ID"
DATA_DIR="$SANDBOX_DIR/data"
STORAGE_DIR="$SANDBOX_DIR/storage"
LOG_DIR="$SANDBOX_DIR/logs"

mkdir -p "$DATA_DIR" "$STORAGE_DIR" "$LOG_DIR"

PORT="8001"
BASE_URL="http://localhost:$PORT"

export LOOPFORGE_DATA_DIR="$DATA_DIR"
export LOOPFORGE_STORAGE="$STORAGE_DIR"

stty -tostop 2>/dev/null || true

BACKEND_LOG="$LOG_DIR/backend.log"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[sandbox] $SANDBOX_DIR"
echo "[backend] starting on :$PORT"

cd "$BACKEND_DIR"
source venv/bin/activate

python -m uvicorn app.main_v2:app --host 127.0.0.1 --port "$PORT" --timeout-keep-alive 60 >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

# Wait for health
for i in {1..30}; do
  if curl -s "$BASE_URL/health" >/dev/null 2>&1; then
    echo "[backend] healthy"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then
    echo "[backend] failed to start; tail log:" >&2
    tail -200 "$BACKEND_LOG" >&2 || true
    exit 1
  fi
done

echo "[upload] posting MP3: $(basename "$MP3_PATH")"
UPLOAD_JSON="$LOG_DIR/upload.json"

curl -s -X POST "$BASE_URL/api/sessions/upload" \
  -F "file=@$MP3_PATH" \
  -F "auto_separate=true" \
  -F "auto_analyze=true" \
  > "$UPLOAD_JSON"

SESSION_ID=$(python3 -c "import json; print(json.load(open('$UPLOAD_JSON'))['session_id'])")
SOURCE_REL_PATH=$(python3 -c "import json; print(json.load(open('$UPLOAD_JSON'))['source']['path'])")
echo "[upload] session_id=$SESSION_ID"
echo "[upload] source_path=$SOURCE_REL_PATH"

SOURCE_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/files/$SOURCE_REL_PATH" || true)
echo "[upload] source_file_http=$SOURCE_HTTP_CODE"

# Poll jobs until all complete/failed/cancelled
TIMEOUT_SEC=$((45*60))
START_TS=$(date +%s)

required_jobs=(separation analysis moments peaks)

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START_TS))
  if [ "$ELAPSED" -gt "$TIMEOUT_SEC" ]; then
    echo "[jobs] TIMEOUT after ${TIMEOUT_SEC}s" >&2
    tail -200 "$BACKEND_LOG" >&2 || true
    exit 1
  fi

  JOBS_FILE="$LOG_DIR/jobs_latest.json"
  curl -s "$BASE_URL/api/jobs?session_id=$SESSION_ID" > "$JOBS_FILE"

  all_done=true
  any_failed=false

  while IFS='|' read -r jt status prog stage; do
    echo "[jobs] $jt: $status ${prog}% $stage"

    if [ "$status" = "missing" ]; then
      any_failed=true
      all_done=false
    elif [ "$status" = "failed" ] || [ "$status" = "cancelled" ]; then
      any_failed=true
      all_done=true
    elif [ "$status" != "completed" ]; then
      all_done=false
    fi
  done < <(
    python3 - "$JOBS_FILE" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, 'r') as f:
    data = json.load(f)

by_type = {}
for job in data.get('jobs', []):
    jt = job.get('job_type')
    if jt:
        by_type[jt] = job

for jt in ['separation', 'analysis', 'moments', 'peaks']:
    job = by_type.get(jt)
    if not job:
        print(f"{jt}|missing|0|")
        continue
    status = job.get('status') or ''
    prog = job.get('progress', 0) or 0
    stage = (job.get('stage') or '').replace('|', '/')
    print(f"{jt}|{status}|{prog}|{stage}")
PY
  )

  if [ "$any_failed" = true ]; then
    echo "[jobs] FAILURE" >&2
    tail -200 "$BACKEND_LOG" >&2 || true
    cp "$JOBS_FILE" "$LOG_DIR/jobs_failed.json" 2>/dev/null || true
    exit 1
  fi

  if [ "$all_done" = true ]; then
    echo "[jobs] all completed"
    cp "$JOBS_FILE" "$LOG_DIR/jobs_completed.json" 2>/dev/null || true
    break
  fi

  sleep 2
  echo "---"
done

echo "[verify] checking stem outputs exist"
for stem in drums bass vocals other; do
  f="$STORAGE_DIR/stems/$SESSION_ID/${stem}.wav"
  if [ ! -s "$f" ]; then
    echo "[verify] missing stem file: $f" >&2
    tail -200 "$BACKEND_LOG" >&2 || true
    exit 1
  fi
done
echo "[verify] stems ok"

echo "[session] fetching session metadata"
curl -s "$BASE_URL/api/sessions/$SESSION_ID" > "$LOG_DIR/session.json"

echo "[slices] creating drums slice bank"
SLICE_BANK_JSON="$LOG_DIR/slice_bank.json"

curl -s -X POST "$BASE_URL/api/slices/banks" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SESSION_ID\", \"stem_path\": \"stems/$SESSION_ID/drums.wav\", \"role\": \"drums\"}" \
  > "$SLICE_BANK_JSON"

BANK_ID=$(python3 -c "import json; print(json.load(open('$SLICE_BANK_JSON'))['id'])")
NUM_SLICES=$(python3 -c "import json; print(json.load(open('$SLICE_BANK_JSON'))['num_slices'])")
echo "[slices] bank_id=$BANK_ID slices=$NUM_SLICES"

echo "[embeddings] generating"
curl -s -X POST "$BASE_URL/api/embeddings/generate/$BANK_ID" > "$LOG_DIR/embeddings_generate.json"

EMB_GEN=$(python3 -c "import json; d=json.load(open('$LOG_DIR/embeddings_generate.json')); print(d.get('embeddings_generated', 0))")
EMB_TOTAL=$(python3 -c "import json; d=json.load(open('$LOG_DIR/embeddings_generate.json')); print(d.get('total_slices', 0))")
echo "[embeddings] generated=$EMB_GEN total=$EMB_TOTAL"
if [ "$EMB_GEN" = "0" ] || [ "$EMB_GEN" != "$EMB_TOTAL" ]; then
  echo "[embeddings] generation incomplete" >&2
  tail -200 "$BACKEND_LOG" >&2 || true
  exit 1
fi

echo "[search] text query"
curl -s -X POST "$BASE_URL/api/embeddings/search/text" \
  -H "Content-Type: application/json" \
  -d "{\"slice_bank_id\": \"$BANK_ID\", \"query\": \"punchy kick\", \"top_k\": 5}" \
  > "$LOG_DIR/search_text.json"

SEARCH_COUNT=$(python3 -c "import json; d=json.load(open('$LOG_DIR/search_text.json')); print(len(d.get('results', [])))")
echo "[search] results=$SEARCH_COUNT"
if [ "$SEARCH_COUNT" = "0" ]; then
  echo "[search] no results returned" >&2
  exit 1
fi

echo "[grid] analyze drums"
curl -s "$BASE_URL/api/grid/analyze/$SESSION_ID?stem=drums" > "$LOG_DIR/grid.json" || true

GRID_OK=$(python3 -c "
import json
try:
  d=json.load(open('$LOG_DIR/grid.json'))
  grid=d.get('grid') or {}
  bpm=grid.get('bpm')
  beats=grid.get('beats') or []
  print('1' if bpm and len(beats)>0 else '0')
except Exception:
  print('0')
")
if [ "$GRID_OK" != "1" ]; then
  echo "[grid] warning: grid analysis did not return bpm/beats (see $LOG_DIR/grid.json)" >&2
fi

echo "[ok] sandbox smoke test completed"
echo "[artifacts] $SANDBOX_DIR"
