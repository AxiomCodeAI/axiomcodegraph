#!/bin/bash
# =============================================================================
# axiom-code-graph - C# engine regression suite
#
#   ./run-tests.sh                     every case
#   ./run-tests.sh --only 03-target-typed-new
#   ./run-tests.sh --verbose 5         print the per-site failures for a red case
#   ./run-tests.sh <work-dir>          keep the per-case work under <work-dir>
#
# Named run-tests.sh because that is the entry point `bin/axiomcode test csharp`
# calls, the same as every other language in graph/test/.
#
# THERE IS NO --bless, AND THAT IS THE DESIGN. Every other suite here diffs against
# a golden file that a human blessed; this one scores against the Roslyn oracle. A
# blessed golden records what the engine did on the day it was blessed, so a rule
# that is wrong in the same way as the golden passes forever, and the quickest way
# past a red check is to re-bless. Scoring against the compiler removes both
# problems: there is nothing to re-bless, and a case needs no update when an
# unrelated relation changes shape.
#
# The CORPUS is separate and is not run here: it needs a network fetch and about
# half an hour. See corpus/run-corpus.sh and README.md.
#
# THE GOLDEN IS THE COMPILER, NOT A FILE SOMEONE BLESSED. Each case is scored
# against the Roslyn oracle exactly as a corpus project is, and the bar is the
# same: every in-source target agrees, every external target is labelled, no site
# is dropped, and no external target is wrongly resolved.
#
# That is deliberately different from a .expected file. A blessed golden records
# what the engine did on the day it was blessed, so a rule that is wrong in the
# same way as the golden passes forever; scoring against the compiler cannot do
# that. It also means a case needs no re-blessing when an unrelated rule changes
# the shape of an unrelated relation.
#
# EACH CASE CARRIES ITS OWN CONTROLS. A construct that must fan out sits in the
# same file as one that must not, so a rule that over-fans fails here instead of
# looking like a recall win. That convention is enforced by reading: the case
# files say which member is the control and why.
#
# Exit status: 0 if every case meets the bar, 1 otherwise. 77 if the toolchain is
# missing, so a machine without dotnet or souffle skips rather than fails.
# =============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
ORACLE="$HERE/ground-truth/AxiomCsOracle/bin/Release/net8.0/axiom-cs-oracle"

WORK="${1:-}"; ONLY=""; VERBOSE=0
shift 2>/dev/null || true
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2;;
    --verbose) VERBOSE="$2"; shift 2;;
    *) echo "unknown argument $1" >&2; exit 2;;
  esac
done
[ -n "$WORK" ] || WORK="$REPO/.cs-case-work"
mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"

command -v souffle >/dev/null || { echo "souffle is not installed (brew install souffle)" >&2; exit 77; }
[ -f "$REPO/parser/dist/index.js" ] || { echo "the parser is not built (npm run build)" >&2; exit 77; }
[ -x "$ORACLE" ] || {
  echo "the oracle is not built:  dotnet build -c Release $HERE/ground-truth/AxiomCsOracle" >&2; exit 77; }

# THE SCORER IS SCORED FIRST. Every case below is read through score.py, so a defect
# in its JOIN moves every number in this file and is indistinguishable from an engine
# change -- and two of its verdicts are gates rather than measurements. The self-test
# needs python3 and nothing else, so it runs before the toolchain is touched.
if ! python3 "$HERE/ground-truth/score-selftest.py"; then
  echo "the scorer's own self-test fails -- every number below would be unreadable" >&2
  exit 1
fi
echo

# AND THE ACCEPTANCE BAR. aggregate.py decides whether a change generalised or fitted
# the dev set, which is the check a human reviewer reliably forgets, and it had no
# test either. It needs no corpus: its cases are synthetic score.json trees.
if ! python3 "$HERE/corpus/aggregate-selftest.py"; then
  echo "the corpus aggregator's self-test fails -- its verdict cannot be trusted" >&2
  exit 1
fi
echo

PASS=0; FAIL=0; FAILED=""
for dir in "$HERE"/cases/*/; do
  name="$(basename "$dir")"
  [ -d "$dir/src" ] || continue
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  w="$WORK/$name"; rm -rf "$w"; mkdir -p "$w"

  if ! node "$REPO/parser/dist/index.js" "$dir/src" "case-$name" false "$w/ir" --per-language > "$w/parse.log" 2>&1; then
    echo "  $name: PARSER FAILED (see $w/parse.log)"; FAIL=$((FAIL+1)); FAILED="$FAILED $name"; continue
  fi
  if ! bash "$REPO/graph/csharp/souffle/devrun.sh" "$w/ir" "$w/engine" > "$w/engine.log" 2>&1; then
    echo "  $name: ENGINE FAILED"; grep -m3 '^Error' "$w/engine.log"; FAIL=$((FAIL+1)); FAILED="$FAILED $name"; continue
  fi
  if ! "$ORACLE" --src "$dir/src" --out "$w/oracle.tsv" --out-dispatch "$w/oracle.dispatch.tsv" > "$w/oracle.log" 2>&1; then
    echo "  $name: ORACLE FAILED"; tail -3 "$w/oracle.log"; FAIL=$((FAIL+1)); FAILED="$FAILED $name"; continue
  fi
  # A case whose own source does not compile is not evidence about the engine.
  cerr=$(sed -n 's/^compileErrors\t//p' "$w/oracle.manifest.tsv")
  if [ "${cerr:-0}" != "0" ]; then
    echo "  $name: THE CASE DOES NOT COMPILE ($cerr errors) -- fix the case, not the engine"
    sed -n 's/^topErrorCodes\t/    /p' "$w/oracle.manifest.tsv"
    FAIL=$((FAIL+1)); FAILED="$FAILED $name"; continue
  fi

  # THE INVARIANTS THE SCORE CANNOT SEE. Roslyn writes no ground-truth row for a call
  # it cannot bind either, so coverage, agreement and fan are all blind to whether
  # the engine answered `ambiguous_dynamic`, `ambiguous_unknown` or `boundary_lib`
  # there -- all three score the same and only one is true. These are written claims
  # about every case's output, not a blessed file.
  if ! python3 "$HERE/engine-invariants.py" "$w/engine/out" "$w/ir/csharp" --label "$name"; then
    FAIL=$((FAIL+1)); FAILED="$FAILED $name"; continue
  fi

  out=$(python3 "$HERE/ground-truth/score.py" \
        --engine-raw "$w/engine/out" --engine-ir "$w/ir/csharp" \
        --oracle "$w/oracle.tsv" --oracle-dispatch "$w/oracle.dispatch.tsv" \
        --json "$w/score.json" --label "$name" --verbose "$VERBOSE" 2>&1)
  rc=$?
  # THE BAR, read off the score rather than eyeballed.
  read -r cover agree drop wrong fan <<EOF2
$(python3 - "$w/score.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); s = d["stats"]; f = d.get("fan", {})
def pct(a, b): return (100.0*a/b) if b else 100.0
print(f'{pct(s.get("site_seen",0), s.get("held_sites",0)):.2f}',
      f'{pct(s.get("declared_agree",0), s.get("in_source_sites",0)):.2f}',
      d.get("dropped",0), s.get("external_wrongly_resolved",0),
      f'{pct(f.get("sound",0), f.get("sites",0)):.2f}')
PY
)
EOF2
  ok=1
  [ "$drop" = "0" ] || ok=0
  [ "$wrong" = "0" ] || ok=0
  awk -v a="$agree" 'BEGIN{exit !(a+0 >= 100.0)}' || ok=0
  awk -v c="$cover" 'BEGIN{exit !(c+0 >= 100.0)}' || ok=0
  awk -v f="$fan" 'BEGIN{exit !(f+0 >= 100.0)}' || ok=0

  if [ "$ok" = "1" ]; then
    printf '  ✓ %-28s cover %s%%  agree %s%%  fan %s%%\n' "$name" "$cover" "$agree" "$fan"
    PASS=$((PASS+1))
  else
    printf '  ✗ %-28s cover %s%%  agree %s%%  fan %s%%  dropped %s  wrong %s\n' \
      "$name" "$cover" "$agree" "$fan" "$drop" "$wrong"
    [ "$VERBOSE" -gt 0 ] && printf '%s\n' "$out" | sed 's/^/      /'
    FAIL=$((FAIL+1)); FAILED="$FAILED $name"
  fi
done

echo
echo "cases: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] || { echo "failing:$FAILED"; exit 1; }

# AND THE STAGING PATH, which no case above can reach: the per-case runner uses
# devrun.sh, which stages every lib_* relation EMPTY by design. A C# library
# could be staged and nothing it declared could ever be named, with every case
# here green. staging-test.sh runs the real executor, which is the only thing
# that stages.
echo
bash "$HERE/staging-test.sh" "$WORK/staging" || exit 1
exit 0
