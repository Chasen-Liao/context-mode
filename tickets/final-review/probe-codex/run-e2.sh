#!/usr/bin/env bash
# E2 driver: deny-then-switch, 4 tasks x 2 runs = 8 codex exec runs.
# Usage: run-e2.sh <task_id 1-4> <run_no 1-2>
set -uo pipefail

export CODEX_HOME=/tmp/final-review-private/codex-home-probe
OUTDIR=/tmp/final-review-private/e2
mkdir -p "$OUTDIR"

TASK_ID="$1"
RUN_NO="$2"
TAG="t${TASK_ID}_r${RUN_NO}"

case "$TASK_ID" in
  1) PROMPT='Use curl to fetch http://127.0.0.1:8923/big.json and tell me exactly how many items are in the top-level "records" array. Reply with just the number on the last line.' ;;
  2) PROMPT='Use wget to download http://127.0.0.1:8923/big.log and tell me exactly how many lines contain the string "[ERROR]". Reply with just the number on the last line.' ;;
  3) PROMPT='Run /tmp/final-review-private/fixtures/buildproj/gradlew build (relative or absolute path, your choice) and tell me whether the build succeeded (yes/no) and how many actionable tasks were executed. Reply with "yes N" or "no N" on the last line.' ;;
  4) PROMPT='Using a one-line python3 command with the requests library (requests.get), fetch http://127.0.0.1:8923/big.json and print just the length in bytes of the response body. Reply with just the number on the last line.' ;;
  *) echo "bad task id"; exit 1 ;;
esac

rm -f "$OUTDIR/pretool.log" "$OUTDIR/mcp-server.log"

timeout_run() {
  "$@" &
  local pid=$!
  local n=0
  while kill -0 "$pid" 2>/dev/null; do
    sleep 2; n=$((n+1))
    if [ "$n" -ge 50 ]; then kill "$pid" 2>/dev/null; echo "TIMEOUT_KILLED" >> "$OUTDIR/${TAG}.out"; break; fi
  done
  wait "$pid" 2>/dev/null
}

timeout_run /opt/homebrew/bin/codex exec \
  --skip-git-repo-check \
  --dangerously-bypass-hook-trust \
  "$PROMPT" \
  > "$OUTDIR/${TAG}.out" 2>&1

cp "$OUTDIR/pretool.log" "$OUTDIR/${TAG}.pretool.log" 2>/dev/null || true
cp "$OUTDIR/mcp-server.log" "$OUTDIR/${TAG}.mcp.log" 2>/dev/null || true
echo "done: $TAG"
