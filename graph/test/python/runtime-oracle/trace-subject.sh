#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Run ONE subject under the runtime oracle: its own test suite, traced, then
# parsed and solved, then joined.
#
# THE INTEGRITY CHECK IS THE FIRST CLASS OF THIS FILE, not a nicety. A runtime
# oracle is only evidence if the run it observed is the run that happens without
# it. So the suite is executed TWICE -- once untouched, once with the tracer --
# and the two verdicts must be identical. If tracing changes what passes, the
# trace describes a different program and every number derived from it is void.
#
# The subject's command is NEVER rewritten. Activation is two environment
# variables and a PYTHONPATH entry (see sitecustomize.py), so what runs traced
# is character for character what runs clean.
#
#   trace-subject.sh --root DIR --cmd 'python -m pytest -q' [--work DIR]
#                    [--src SUBDIR] [--skip-baseline] [--python BIN]
#
#   --root   the checkout. Also the scope gate: a call is recorded only if its
#            caller or its callee is inside it.
#   --src    what to PARSE, if that is narrower than --root (a package
#            directory inside a repository whose tests live beside it).
#   --work   scratch. Defaults under $AXIOM_PY_RUNTIME_WORK or ~/.cache.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT_REPO="$(d="$HERE"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"

SUBJECT=""; CMD=""; WORK=""; SRC=""; SKIP_BASE=0
PY="${AXIOM_PY_PYTHON:-python3.10}"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) SUBJECT="$2"; shift 2 ;;
    --cmd) CMD="$2"; shift 2 ;;
    --work) WORK="$2"; shift 2 ;;
    --src) SRC="$2"; shift 2 ;;
    --python) PY="$2"; shift 2 ;;
    --skip-baseline) SKIP_BASE=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SUBJECT" ] && [ -n "$CMD" ] || { echo "usage: trace-subject.sh --root DIR --cmd CMD" >&2; exit 2; }
SUBJECT="$(cd "$SUBJECT" && pwd)"
NAME="$(basename "$SUBJECT")"
# NOT /tmp: a long trace plus an IR is hundreds of megabytes and the system
# reaper has taken a corpus out from under this harness family before.
WORK="${WORK:-${AXIOM_PY_RUNTIME_WORK:-$HOME/.cache/axiom-py-runtime}/$NAME}"
PARSE_SRC="$SUBJECT"; [ -n "$SRC" ] && PARSE_SRC="$SUBJECT/$SRC"
mkdir -p "$WORK"
TRACE="$WORK/trace"; rm -rf "$TRACE"; mkdir -p "$TRACE"

echo "▶ subject   $SUBJECT"
echo "  command   $CMD"
echo "  work      $WORK"

# ── 1. baseline ──────────────────────────────────────────────────────────────
if [ "$SKIP_BASE" = "0" ]; then
  echo "▶ baseline (untraced)"
  ( cd "$SUBJECT" && eval "$CMD" ) >"$WORK/baseline.log" 2>&1
  echo "  exit $? — $(tail -3 "$WORK/baseline.log" | tr '\n' ' ' | cut -c1-120)"
fi

# ── 2. traced ────────────────────────────────────────────────────────────────
echo "▶ traced"
( cd "$SUBJECT" \
  && AXIOM_PY_TRACE_ROOT="$SUBJECT" \
     AXIOM_PY_TRACE_OUT="$TRACE" \
     PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}" \
     eval "$CMD" ) >"$WORK/traced.log" 2>&1
TRACED_RC=$?
echo "  exit $TRACED_RC — $(tail -3 "$WORK/traced.log" | tr '\n' ' ' | cut -c1-120)"
echo "  $(ls "$TRACE" | wc -l | tr -d ' ') trace file(s), $(cat "$TRACE"/trace-*.tsv 2>/dev/null | wc -l | tr -d ' ') rows"

if [ "$SKIP_BASE" = "0" ]; then
  # Compare the VERDICT, not the whole log: timings and temporary paths differ
  # between any two runs and would make the check fail for no reason.
  b="$(grep -oE '[0-9]+ (passed|failed|error|errors|skipped|xfailed|deselected)' "$WORK/baseline.log" | sort | tr '\n' ' ')"
  t="$(grep -oE '[0-9]+ (passed|failed|error|errors|skipped|xfailed|deselected)' "$WORK/traced.log" | sort | tr '\n' ' ')"
  # A VACUOUS PASS IS THE ONE OUTCOME THIS CHECK MUST NOT HAVE, and equality is the
  # wrong question when there is nothing on either side.
  #
  # The first version of this guard required the verdict string to be NON-EMPTY, after a
  # subject with a missing test-only dependency produced `integrity ok` over 3 traced
  # rows. That is not enough, and a second subject proved it: pytest aborted during
  # COLLECTION, so the verdict was the non-empty string "1 error", the two sides matched,
  # and not one test had executed. The harness then scored the engine over 4,510 sites
  # reached while importing the package during collection and reported 94.17% agree, the
  # highest figure in the corpus, describing import-time code alone.
  #
  # So the test is POSITIVE: at least one test must have PASSED. A verdict made only of
  # errors, failures or skips stops the run.
  passed_n="$(grep -oE '[0-9]+ passed' "$WORK/baseline.log" | grep -oE '^[0-9]+' | tail -1)"
  if [ -z "$b" ] || [ -z "$passed_n" ] || [ "$passed_n" -lt 1 ]; then
    echo "  INTEGRITY INCONCLUSIVE: the baseline reported no passing test, so there is"
    echo "  nothing to compare and nothing the trace can be said to describe."
    echo "    $(tail -3 "$WORK/baseline.log" | tr '\n' ' ' | cut -c1-160)"
    exit 1
  fi
  if [ "$b" = "$t" ]; then
    echo "  integrity ok — traced verdict identical: $t"
  else
    echo "  INTEGRITY FAILED — tracing changed the suite"
    echo "    baseline: $b"
    echo "    traced:   $t"
    exit 1
  fi
fi

# ── 3. parse + solve ─────────────────────────────────────────────────────────
PARSER="${AXIOM_PARSER:-$ROOT_REPO/parser/dist/index.js}"
[ -f "$PARSER" ] || { echo "parser not found at $PARSER" >&2; exit 2; }
if [ ! -f "$WORK/ir/all-python-methods.csv" ]; then
  echo "▶ parsing $PARSE_SRC"
  rm -rf "$WORK/ir"
  node "$PARSER" "$PARSE_SRC" "$NAME" false "$WORK/ir" >"$WORK/parse.log" 2>&1 \
    || { echo "  parse failed — see $WORK/parse.log"; tail -5 "$WORK/parse.log"; exit 1; }
fi
echo "  IR $(wc -l <"$WORK/ir/all-python-methods.csv" | tr -d ' ') methods, $(wc -l <"$WORK/ir/all-python-call-sites.csv" | tr -d ' ') call sites"

EMPTY_LIB="$WORK/emptylib"; mkdir -p "$EMPTY_LIB"
if [ ! -f "$WORK/out/raw/call-chain-edges.csv" ]; then
  echo "▶ solving"
  rm -rf "$WORK/int" "$WORK/out"
  bash "$ROOT_REPO/graph/pipeline/run-souffle.sh" --debug --language python \
    --client-ir "$WORK/ir" --library "$EMPTY_LIB" \
    --intermediate "$WORK/int" --output "$WORK/out" >"$WORK/solve.log" 2>&1 \
    || { echo "  solve failed — see $WORK/solve.log"; tail -5 "$WORK/solve.log"; exit 1; }
fi
echo "  $(wc -l <"$WORK/out/raw/call-chain-edges.csv" | tr -d ' ') engine edge rows"

# ── 4. join ──────────────────────────────────────────────────────────────────
echo "▶ joining"
"$PY" "$HERE/join.py" --root "$PARSE_SRC" --ir "$WORK/ir" --out "$WORK/out/raw" \
      --trace "$TRACE" --json "$WORK/join.json" "$@" 2>&1 | tee "$WORK/join.txt"
