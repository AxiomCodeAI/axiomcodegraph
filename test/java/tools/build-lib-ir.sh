#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build a third-party library IR into the SHARED library store — the same folder every
# --library run already reads, replaced in place rather than re-extracted into a scratch dir.
#
# WHY IN PLACE. The store is the canonical copy: it is what --library stages, it is 2 GB, and a
# second copy under /tmp is both wasted disk and a second answer to the same question. An entry
# is replaced atomically and stamped with the parser revision AND the coordinate it came from,
# so a later rebuild is reproducible and staleness is a question that can be asked.
#
#   build-lib-ir.sh --coord <group:artifact:version> [--out DIR] [--parser FILE] [--force]
#   build-lib-ir.sh --check [--out DIR]          # report staleness across the whole store
#
# defaults:  --out $AXIOM_LIB_IR   --parser $AXIOM_PARSER
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

OUT="${AXIOM_LIB_IR:-/Users/swapnilpaliwal/Documents/AxiomCode/other-lib}"
PARSER="${AXIOM_PARSER:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/dist/index.js}"
COORD=""; CHECK=0; FORCE=0
while [ $# -gt 0 ]; do case "$1" in
  --coord) COORD="$2"; shift 2;; --out) OUT="$2"; shift 2;; --parser) PARSER="$2"; shift 2;;
  --check) CHECK=1; shift;; --force) FORCE=1; shift;;
  -h|--help) sed -n '2,16p' "$0"; exit 0;; *) echo "unknown arg $1" >&2; exit 2;; esac; done

[ -f "$PARSER" ] || { echo "no parser at $PARSER (build it: npm run build)" >&2; exit 1; }
. "$(cd "$(dirname "$0")/../../.." && pwd)/src/pipeline/portable-stat.sh"
PARSER_REPO="$(cd "$(dirname "$PARSER")/.." && pwd)"
PARSER_REV="$(git -C "$PARSER_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# THE REBUILD TRAP: dist/ is a build artefact and a branch switch does not update it.
if [ -d "$PARSER_REPO/.git" ]; then
  # file_mtime, not `stat -f %m || stat -c %Y` — see src/pipeline/portable-stat.sh.
  DT="$(file_mtime "$PARSER")" || DT=""
  HT=$(git -C "$PARSER_REPO" log -1 --format=%ct 2>/dev/null || echo 0)
  if [ -z "$DT" ]; then
    echo "!! cannot read the mtime of $PARSER — the parser-staleness guard did NOT run" >&2
  elif [ "$DT" -lt "$HT" ]; then
    echo "!! parser dist/ is OLDER than its HEAD commit — run 'npm run build' first" >&2
  fi
fi

if [ "$CHECK" = 1 ]; then
  cur=0; stale=0; unstamped=0
  for d in "$OUT"/*/; do
    b=$(basename "$d"); [ "$b" = "_logs" ] && continue
    [ -f "$d/all-types.csv" ] || continue
    if [ ! -f "$d/.parser-revision" ]; then unstamped=$((unstamped+1)); continue; fi
    if [ "$(head -1 "$d/.parser-revision")" = "$PARSER_REV" ]; then cur=$((cur+1)); else stale=$((stale+1)); fi
  done
  echo "library IR store: $OUT"
  echo "  parser now        : $PARSER_REV"
  echo "  current           : $cur"
  echo "  stale (stamped)   : $stale"
  echo "  UNSTAMPED         : $unstamped   <- built by an unknown parser; treat as stale"
  [ $((stale+unstamped)) -eq 0 ] && { echo "  ALL CURRENT"; exit 0; }
  echo "  re-extract with --coord <group:artifact:version>"; exit 1
fi

[ -n "$COORD" ] || { echo "need --coord <group:artifact:version> (or --check)" >&2; exit 2; }
G="${COORD%%:*}"; rest="${COORD#*:}"; A="${rest%%:*}"; V="${rest##*:}"
[ -n "$G" ] && [ -n "$A" ] && [ -n "$V" ] || { echo "malformed coordinate: $COORD" >&2; exit 2; }
NAME="$A-$V"; DEST="$OUT/$NAME"

if [ "$FORCE" = 0 ] && [ -f "$DEST/.parser-revision" ] && \
   [ "$(head -1 "$DEST/.parser-revision")" = "$PARSER_REV" ]; then
  echo "$NAME already current for parser $PARSER_REV — nothing to do"; exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
BASE="https://repo.maven.apache.org/maven2/$(echo "$G" | tr '.' '/')/$A/$V"
echo "$NAME: fetching sources"
curl -sfL -o "$TMP/src.jar" "$BASE/$A-$V-sources.jar" || { echo "  no sources jar at $BASE" >&2; exit 1; }
mkdir -p "$TMP/src" && (cd "$TMP/src" && unzip -qq -o "$TMP/src.jar" >/dev/null 2>&1)
n=$(find "$TMP/src" -name '*.java' | wc -l | tr -d ' ')
[ "$n" -gt 0 ] || { echo "  sources jar contains no .java" >&2; exit 1; }
echo "  $n source files -> extracting"

# Built into a scratch dir and moved into place, so an aborted run never leaves the store with a
# half-written entry that a later --check would call current.
if node "$PARSER" "$TMP/src" "lib-$NAME" true "$TMP/ir" >"$TMP/parse.log" 2>&1 && [ -f "$TMP/ir/all-types.csv" ]; then
  printf '%s\n%s\n' "$PARSER_REV" "$COORD extracted $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$TMP/ir/.parser-revision"
  rm -rf "$DEST"; mv "$TMP/ir" "$DEST"
  echo "  ok: $(( $(wc -l < "$DEST/all-types.csv") - 1 )) types, $(( $(wc -l < "$DEST/all-methods.csv") - 1 )) methods -> $DEST"
else
  echo "  FAILED (see $TMP/parse.log)" >&2; sed -n '1,5p' "$TMP/parse.log" >&2; exit 1
fi
