#!/bin/bash
# =============================================================================
# Run the C# engine and the Roslyn oracle over the corpus, and score them.
#
#   run-corpus.sh <work-dir> [--set dev|holdout|all] [--only a,b] [--verbose N]
#
# THE TWO SETS ARE REPORTED SEPARATELY AND ALWAYS. A single combined number
# cannot answer the only question that matters about a rule: did it generalise,
# or did it fit the five projects it was written against. `--set all` runs both
# and prints two tables; it does not print one.
#
# HOLDOUT DISCIPLINE, ENFORCED BY THIS SCRIPT RATHER THAN BY MEMORY: with
# `--set holdout` the per-site failure listing is SUPPRESSED unless
# AXIOM_CS_HOLDOUT_INSPECT=1 is set explicitly. The aggregate numbers are the
# deliverable; reading a held-out project's unresolved rows is how a rule comes
# to be derived from the set that was meant to validate it. Setting the variable
# is allowed and is recorded in the run header, so the decision is visible.
#
# Every project is run with the SAME engine and the SAME oracle pins, and the
# header records both, because a number measured on one version and compared
# against another is not a measurement.
# =============================================================================
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TESTDIR="$(cd "$HERE/.." && pwd)"          # graph/test/csharp
. "$HERE/manifest.sh"
resolve_corpus_manifest "$HERE" || exit 2
REPO="$(cd "$HERE/../../../.." && pwd)"    # repository root
CORPUS="${CS_CORPUS:-$HOME/.cache/axiom-cs-corpus}"
ORACLE="$TESTDIR/ground-truth/AxiomCsOracle/bin/Release/net8.0/axiom-cs-oracle"

WORK=""; SET="all"; ONLY=""; VERBOSE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --set) SET="$2"; shift 2;;
    --only) ONLY="$2"; shift 2;;
    --verbose) VERBOSE="$2"; shift 2;;
    -*) echo "unknown argument $1" >&2; exit 2;;
    *) WORK="$1"; shift;;
  esac
done
[ -n "$WORK" ] || { echo "usage: run-corpus.sh <work-dir> [--set dev|holdout|all] [--only a,b]" >&2; exit 2; }
mkdir -p "$WORK"; WORK="$(cd "$WORK" && pwd)"

[ -d "$CORPUS" ] || { echo "no corpus at $CORPUS -- run fetch.sh (or set CS_CORPUS)" >&2; exit 77; }
[ -x "$ORACLE" ] || {
  echo "the oracle is not built. Run:" >&2
  echo "  dotnet build -c Release $TESTDIR/ground-truth/AxiomCsOracle" >&2
  exit 77; }

command -v souffle >/dev/null || { echo "souffle is not installed (brew install souffle)" >&2; exit 77; }
[ -f "$REPO/parser/dist/index.js" ] || { echo "the parser is not built (npm run build)" >&2; exit 77; }

ENGINE_REV="$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
ENGINE_DIRTY=""
git -C "$REPO" diff --quiet -- "$REPO/graph/csharp" 2>/dev/null || ENGINE_DIRTY=" +dirty"
ORACLE_VER="$("$ORACLE" 2>&1 | head -1 || true)"

echo "=============================================================="
echo " C# corpus run"
echo "   engine      $ENGINE_REV$ENGINE_DIRTY"
echo "   corpus      $CORPUS"
echo "   set         $SET"
echo "   node        $(node -v 2>/dev/null || echo '?')"
echo "   souffle     $(souffle --version 2>/dev/null | sed -n 's/^Version: //p' | head -1)"
if [ "${AXIOM_CS_HOLDOUT_INSPECT:-0}" = "1" ]; then
  echo "   HOLDOUT INSPECTION IS ON -- per-site failures will be printed for held-out"
  echo "   projects. Anything derived from them is derived from the validation set."
fi
echo "=============================================================="

run_one(){
  local name="$1" pset="$2" path="$3" commit="$4"
  local src="$CORPUS/$name/$path"
  local w="$WORK/$name"
  if [ ! -d "$src" ]; then echo "  $name: not provisioned; skipped"; return 77; fi
  rm -rf "$w"; mkdir -p "$w"

  local files
  files=$(find "$src" -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' | wc -l | tr -d ' ')
  printf '\n── %s [%s] %s files @ %s\n' "$name" "$pset" "$files" "${commit:0:8}"

  # ── the engine ───────────────────────────────────────────────────────────
  # The IR is extracted once per project and reused by the scorer, which needs it
  # to turn engine hashes into oracle-shaped keys.
  local t0 t1
  t0=$(date +%s)
  if ! node "$REPO/parser/dist/index.js" "$src" "$commit" false "$w/ir" --per-language > "$w/parse.log" 2>&1; then
    echo "   PARSER FAILED -- see $w/parse.log"; tail -3 "$w/parse.log"; return 1
  fi
  [ -f "$w/ir/csharp/all-csharp-modules.csv" ] || { echo "   no C# IR extracted"; return 1; }
  t1=$(date +%s)
  local parse_s=$((t1-t0))

  t0=$(date +%s)
  if ! bash "$REPO/graph/csharp/souffle/devrun.sh" "$w/ir" "$w/engine" > "$w/engine.log" 2>&1; then
    echo "   ENGINE FAILED -- see $w/engine.log"; grep -m5 '^Error' "$w/engine.log"; return 1
  fi
  t1=$(date +%s)
  local solve_s=$((t1-t0))

  # ── the oracle ───────────────────────────────────────────────────────────
  t0=$(date +%s)
  if ! "$ORACLE" --src "$src" --out "$w/oracle.tsv" --out-dispatch "$w/oracle.dispatch.tsv" > "$w/oracle.log" 2>&1; then
    echo "   ORACLE FAILED -- see $w/oracle.log"; tail -3 "$w/oracle.log"; return 1
  fi
  t1=$(date +%s)
  local oracle_s=$((t1-t0))
  # The oracle's own compile-error count. A subject it could not fully read produces
  # fewer ground-truth rows, and a recall number computed against a partial oracle
  # is not comparable with one computed against a complete one -- so it is printed
  # next to the score rather than buried in a log.
  local cerr cfiles
  cerr=$(sed -n 's/^compileErrors\t//p' "$w/oracle.manifest.tsv")
  cfiles=$(sed -n 's/^filesWithCompileErrors\t//p' "$w/oracle.manifest.tsv")

  printf '   parse %ss · solve %ss · oracle %ss · oracle compile errors %s in %s files\n' \
    "$parse_s" "$solve_s" "$oracle_s" "${cerr:-?}" "${cfiles:-?}"

  local vflag=0
  if [ "$pset" = "dev" ] || [ "${AXIOM_CS_HOLDOUT_INSPECT:-0}" = "1" ]; then vflag="$VERBOSE"; fi

  python3 "$TESTDIR/ground-truth/score.py" \
    --engine-raw "$w/engine/out" --engine-ir "$w/ir/csharp" \
    --oracle "$w/oracle.tsv" --oracle-dispatch "$w/oracle.dispatch.tsv" \
    --json "$w/score.json" --label "$name/$pset" --verbose "$vflag"
  local rc=$?
  if [ "$pset" = "holdout" ] && [ "${AXIOM_CS_HOLDOUT_INSPECT:-0}" != "1" ]; then
    echo "   (per-site failures suppressed: held-out set)"
  fi
  return $rc
}

RC=0
while IFS=$'\t' read -r name pset path repo commit note; do
  case "$name" in '#'*|'') continue ;; esac
  case "$SET" in
    all) ;;
    "$pset") ;;
    *) continue;;
  esac
  if [ -n "$ONLY" ]; then case ",$ONLY," in *,"$name",*) ;; *) continue ;; esac; fi
  run_one "$name" "$pset" "$path" "$commit" || { [ $? -eq 77 ] || RC=1; }
done < "$CORPUS_MANIFEST"

echo
echo "=============================================================="
python3 "$HERE/aggregate.py" "$WORK" || RC=1
echo "=============================================================="
exit $RC
