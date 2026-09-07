#!/bin/bash
# Run the whole corpus and report the development and held-out sets SEPARATELY.
#
#   run-corpus.sh <work-root> [--set dev|holdout|all] [--only n1,n2] [--baseline <root>]
#
# One project failing does not stop the run: it is recorded as NOT RUN and the rest
# proceed. A driver that aborts on the first failure reports nothing at all, which is
# the same information as a green run and easier to mistake for one.
#
# $AXIOM_PARSER must point at a BUILT parser dist whose module arity matches this
# engine's declarations. The drift gate will refuse otherwise, which is correct — but
# check it here so nine projects do not each fail the same way for the same reason.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(cd "$HERE/.." && pwd)"
# NOT /tmp. Measured the hard way: all nine corpus projects lost every source file
# mid-session to the system's /tmp reaper, directories and node_modules left standing and
# .git gone, which surfaced as four unrelated-looking harness failures. A corpus in /tmp
# is not a corpus. Override with TS_CORPUS.
ROOT="${TS_CORPUS:-$HOME/.cache/axiom-ts-corpus}"
WORK="${1:?usage: run-corpus.sh <work-root> [--set dev|holdout|all] [--only a,b] [--baseline <root>]}"
shift
SET=all; ONLY=""; BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --set) SET="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --baseline) BASE="$2"; shift 2 ;;
    *) echo "unknown argument: $1"; exit 2 ;;
  esac
done

PARSER="${AXIOM_PARSER:-}"
[ -n "$PARSER" ] || { echo "AXIOM_PARSER is unset. Point it at a built parser dist."; exit 2; }
[ -f "$PARSER" ] || { echo "AXIOM_PARSER=$PARSER does not exist."; exit 2; }

# ── the check that saves nine identical failures ─────────────────────────────
# The parser's module arity and this engine's declaration must agree. They drift on
# every schema append, and the symptom downstream is a drift-gate refusal per project
# with nothing saying they share one cause.
DECL=$(grep -o '^\.decl ts_module(.*' "$TS/../../src/typescript/souffle/decls_base.dl" 2>/dev/null \
       | tr ',' '\n' | wc -l | tr -d ' ')
echo "engine declares ts_module with $DECL columns; parser: $PARSER"

mkdir -p "$WORK"
echo "$(date -u +%FT%TZ)  parser=$PARSER  engine=$(cd "$TS/../.." && git rev-parse --short HEAD)" \
  > "$WORK/RUN.txt"

ran=0; failed=0
while read -r name set path repo commit note; do
  # `blocked` is in the corpus and not measurable — skipped unless named explicitly with
  # --only, so a fix can be verified without editing the manifest first.
  if [ "$set" = "blocked" ]; then
    case ",$ONLY," in *,"$name",*) ;; *) echo "▷ $name [blocked] skipped: $note"; continue ;; esac
  fi
  case "$SET" in dev|holdout) [ "$set" = "$SET" ] || continue ;; esac
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  proj="$ROOT/$name"; [ "$path" = "." ] || proj="$ROOT/$name/$path"
  if [ ! -d "$proj" ]; then
    echo "▶ $name [$set]: MISSING at $proj — run corpus/fetch.sh"; failed=$((failed+1)); continue
  fi
  echo "▶ $name [$set] $proj"
  rm -rf "$WORK/$name"
  # Production code only. See score.py's TEST_PATH for what that excludes and why.
  if SCORE_PRODUCTION=1 "$TS/run-evaluation.sh" "$proj" "$WORK/$name" "$PARSER" > "$WORK/$name.log" 2>&1; then
    ran=$((ran+1)); tail -1 "$WORK/$name.log" >/dev/null
    grep -E '^(EXACT|WRONG|CONSERVATION LOSS)' "$WORK/$name/score.txt" 2>/dev/null | sed 's/^/    /'
  else
    rc=$?; failed=$((failed+1)); echo "    FAILED (exit $rc) — see $WORK/$name.log"
    tail -3 "$WORK/$name.log" | sed 's/^/    | /'
  fi
done < <(grep -v '^#' "$HERE/corpus.tsv" | grep -v '^[[:space:]]*$')

echo
echo "ran=$ran failed=$failed"
if [ -n "$BASE" ]; then
  python3 "$HERE/aggregate.py" "$WORK" --baseline "$BASE"
else
  python3 "$HERE/aggregate.py" "$WORK"
fi
