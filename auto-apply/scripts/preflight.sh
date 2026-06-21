#!/usr/bin/env bash
# preflight.sh — R0 pre-flight for a single application URL.
#   - dedup-checks the URL against logs/applications.jsonl
#   - creates a fresh logs/runs/<timestamp>/ directory
#
# Usage:  scripts/preflight.sh <url> [--force]
# Output (eval-friendly): prints RUN_DIR=... and DUP=yes|no, plus a human line.
# Exit codes: 0 = proceed, 10 = duplicate (skip unless --force).
set -euo pipefail

URL="${1:-}"
FORCE="${2:-}"
if [[ -z "$URL" ]]; then
  echo "usage: scripts/preflight.sh <url> [--force]" >&2
  exit 2
fi

# Resolve project root as this script's parent dir, so it works from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$ROOT/logs/applications.jsonl"
mkdir -p "$ROOT/logs/runs"
[[ -f "$LOG" ]] || : > "$LOG"

# Dedup: is this URL already logged as submitted or review_pending?
DUP="no"
if node -e '
  const fs=require("fs");
  const [url,log]=[process.argv[1],process.argv[2]];
  let dup=false;
  if(fs.existsSync(log)){
    for(const line of fs.readFileSync(log,"utf8").split("\n")){
      if(!line.trim()) continue;
      try{const r=JSON.parse(line);
        if(r.url===url && (r.status==="submitted"||r.status==="review_pending")){dup=true;break;}
      }catch{}
    }
  }
  process.exit(dup?10:0);
' "$URL" "$LOG"; then
  DUP="no"
else
  if [[ $? -eq 10 ]]; then DUP="yes"; fi
fi

TS="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="logs/runs/$TS"
mkdir -p "$ROOT/$RUN_DIR"

echo "RUN_DIR=$RUN_DIR"
echo "DUP=$DUP"

if [[ "$DUP" == "yes" && "$FORCE" != "--force" ]]; then
  echo "DUPLICATE: $URL already applied (submitted/review_pending). Re-run with --force to override." >&2
  exit 10
fi

echo "OK: proceeding. Run artifacts -> $RUN_DIR"
exit 0
