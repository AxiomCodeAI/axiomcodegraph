#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A NAME THAT NAMES TWO MODULES MUST BE REPORTED, NOT RESOLVED SILENTLY.
#
# Library linking joins on QUALIFIED NAME by design — a hash minted by one parse cannot
# match another's — so two modules sharing a name make the join ambiguous and it picks up
# both. That happens WITHIN a tree (a directory that is not a package contributes no
# segment, so alpha/tasks.py and beta/tasks.py are both `tasks`) and ACROSS `--library`
# roots (two independently parsed trees may each hold a `foo`). Neither is a parser defect:
# whether the naming is right depends on how the tree is used, which the parser cannot know.
#
# So the engine owns the other half — NOTICE it. Measured over five open-source projects:
# 38 duplicated module qualified names covering 83 module rows, and on one project 74
# imports of a single name that names FIVE different files, every one resolving to the
# union of all five with nothing saying so. See issue #89.
#
# THIS IS ASSERTED HERE AND NOT AS A CASE because a case compares .edges and .tiers only,
# so a diagnostic EXPORT would be invisible to it — the suite would be green whatever these
# relations said. The controls are the point: an unambiguous tree must produce EMPTY
# exports, or a relation that fires on everything would pass check 1 just as well.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/../Parser/dist/index.js}"
EMPTY_LIB="${AXIOM_EMPTY_LIB:-$(mktemp -d)}"
mkdir -p "$EMPTY_LIB"

if [ ! -f "$PARSER" ]; then
  echo "  SKIP  ambiguous-module: parser not found at $PARSER (set AXIOM_PARSER)"
  exit 0
fi

fail=0; checks=0
ok(){  checks=$((checks+1)); [ -n "${AMBIGUOUS_MODULE_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){ checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# ── the AMBIGUOUS tree: two non-package directories, each holding `tasks.py` ──
mkdir -p "$W/amb/src/alpha" "$W/amb/src/beta"
cat > "$W/amb/src/alpha/tasks.py" <<'EOF'
def run() -> str:
    return "alpha"
EOF
cat > "$W/amb/src/beta/tasks.py" <<'EOF'
def run() -> str:
    return "beta"
EOF
cat > "$W/amb/src/main.py" <<'EOF'
from tasks import run


def call_it() -> str:
    return run()
EOF

# ── the CONTROL tree: the same shape, but the directories ARE packages, so the
#    qualified names differ and nothing is ambiguous ──
mkdir -p "$W/ctl/src/alpha" "$W/ctl/src/beta"
: > "$W/ctl/src/alpha/__init__.py"
: > "$W/ctl/src/beta/__init__.py"
cat > "$W/ctl/src/alpha/tasks.py" <<'EOF'
def run() -> str:
    return "alpha"
EOF
cat > "$W/ctl/src/beta/tasks.py" <<'EOF'
def run() -> str:
    return "beta"
EOF
cat > "$W/ctl/src/main.py" <<'EOF'
from alpha.tasks import run


def call_it() -> str:
    return run()
EOF

solve(){ # $1 = tree dir
  node "$PARSER" "$1/src" ambmod false "$1/ir" > "$1/parse.log" 2>&1 || return 1
  bash "$ROOT/src/pipeline/run-souffle.sh" --language python \
       --client-ir "$1/ir" --library "$EMPTY_LIB" \
       --intermediate "$1/int" --output "$1/out" > "$1/solve.log" 2>&1
}
for t in amb ctl; do
  if ! solve "$W/$t"; then
    echo "  FAIL  ambiguous-module: the $t tree did not solve"
    tail -3 "$W/$t/solve.log" 2>/dev/null | sed 's/^/        /'
    echo "ambiguous-module: FAILED (1 check)"; exit 1
  fi
done

A="$W/amb/out"; C="$W/ctl/out"

# 1. THE DUPLICATED NAME IS REPORTED, WITH ITS MULTIPLICITY.
if grep -qE '^client	tasks	2$' "$A/ambiguous-module-names.csv" 2>/dev/null; then
  ok 'a qualified name shared by two modules is reported, with the count'
else
  bad "the duplicated module name is not reported: $(cat "$A/ambiguous-module-names.csv" 2>/dev/null | tr '\n' ' ')"
fi

# 2. AND THE SITE THAT RESOLVED THROUGH IT IS FLAGGED. Without this the condition is
#    known about the tree but not about any answer that depends on it.
if [ -s "$A/assumption-ambiguous-module-name.csv" ]; then
  ok 'a call site resolved through the ambiguous name is recorded'
else
  bad 'the call site resolved through the ambiguous name is not recorded'
fi

# 3. CONTROL — AN UNAMBIGUOUS TREE REPORTS NOTHING. This is what stops the relation
#    being true of everything, which would pass check 1 for the wrong reason.
if [ -s "$C/ambiguous-module-names.csv" ]; then
  bad "the control tree reports a duplicate: $(cat "$C/ambiguous-module-names.csv" | tr '\n' ' ')"
else
  ok 'control: a tree whose modules have distinct qualified names reports no duplicate'
fi

# 4. CONTROL — AND FLAGS NO SITE.
if [ -s "$C/assumption-ambiguous-module-name.csv" ]; then
  bad 'the control tree flags a site as resolved through an ambiguous name'
else
  ok 'control: the control tree flags no site'
fi

# 5. CONTROL — THE EDGE IS STILL THERE. The diagnostic must not cost an answer: the
#    ambiguous site keeps BOTH candidates, because one of them really is the target and
#    refusing a set that contains the answer trades a wrong label for a lost one.
widest="$(awk -F'\t' '$4!="-" && $4!="" {n[$1]++} END{m=0; for(k in n) if(n[k]>m) m=n[k]; print m+0}' "$A/call-chain-edges.csv" 2>/dev/null)"
if [ "${widest:-0}" -ge 2 ]; then
  ok 'control: the ambiguous site keeps its candidates — this reports, it does not refuse'
else
  bad "the ambiguous site lost its edges (widest site = ${widest:-0}): this reports, it does not refuse"
fi

if [ "$fail" -ne 0 ]; then
  echo "ambiguous-module: FAILED ($checks checks)"
  exit 1
fi
echo "ambiguous-module: ok ($checks checks)"
