#!/bin/bash
# Does a package's tsconfig chain survive being mirrored? (#240)
#
# The harness analyses an rsync mirror of the project directory, and a workspace package's
# config almost always extends a base ABOVE that directory. The parser then resolves the
# chain against a file that is not there and falls back to each option's DEFAULT — with no
# error on either side. `strictBindCallApply` is the option that made this a resolution
# defect rather than a diagnostics one: it decides which of lib.es5's two declarations of
# call/apply/bind the compiler answers with.
#
# WHY THIS IS A FIXTURE AND NOT A CASE. Every case under cases/ carries its own
# src/tsconfig.json with nothing to extend, so no case has an ancestor config to lose.
# That is precisely why the defect survived a green 22-case suite.
#
# Usage: run.sh [<work-dir>] [<parser-dist>]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$(cd "$HERE/../.." && pwd)"
WORK="${1:-/tmp/ts-tsconfig-chain}"
PARSER="${2:-${AXIOM_PARSER:-}}"
[ -n "$PARSER" ] && [ -f "$PARSER" ] || { echo "SKIP: no parser (set AXIOM_PARSER)"; exit 77; }

fail=0
rm -rf "$WORK"; mkdir -p "$WORK"
cp -R "$HERE/repo" "$WORK/src-repo"
rm -f "$WORK/src-repo/README.md"
PROJECT="$WORK/src-repo/packages/pkg"

# ── 1. the plan ─────────────────────────────────────────────────────────────
PLAN="$WORK/plan.txt"
node "$TS/tools/tsconfig_chain.mjs" --plan "$PROJECT" > "$PLAN" 2>"$WORK/plan.err"
rel="$(awk -F'\t' '$1=="REL"{print $2}' "$PLAN")"
copies="$(awk -F'\t' '$1=="COPY"{print $3}' "$PLAN" | tr '\n' ' ')"
if [ "$rel" != "packages/pkg" ]; then
  echo "FAIL  plan REL is '$rel', expected 'packages/pkg'"; fail=1
fi
case "$copies" in
  *tsconfig.base.json*) ;;
  *) echo "FAIL  plan does not copy tsconfig.base.json (COPY: $copies)"; fail=1 ;;
esac

# ── the flag, read three ways ───────────────────────────────────────────────
flag() {  # flag <project-dir> <out-dir>
  node "$PARSER" "$1" chainfix false "$2" >/dev/null 2>&1
  awk -F'\t' 'NR>1{print $28}' "$2/all-typescript-modules.csv" 2>/dev/null | sort -u | paste -sd, -
}

# ── 2. mirrored per the plan: the option must SURVIVE ───────────────────────
mkdir -p "$WORK/mirror/$rel"
rsync -a --exclude node_modules --exclude .git "$PROJECT/" "$WORK/mirror/$rel/" 2>/dev/null
while IFS="$(printf '\t')" read -r tag src dest; do
  [ "$tag" = "COPY" ] || continue
  mkdir -p "$WORK/mirror/$(dirname "$dest")"; cp "$src" "$WORK/mirror/$dest"
done < "$PLAN"
got="$(flag "$WORK/mirror/$rel" "$WORK/ir-chained")"
if [ "$got" != "true" ]; then
  echo "FAIL  chained mirror: strictBindCallApply='$got', expected 'true'"
  echo "      the ancestor config was copied but the option still defaulted"
  fail=1
fi

# ── 3. THE DISCRIMINATOR: mirrored flat, it must NOT survive ────────────────
# This is the pre-fix behaviour. If this ever reports `true` the fixture has stopped
# testing anything — either the parser found the base some other way, or the mirror is no
# longer flat — and part 2 passing would mean nothing.
mkdir -p "$WORK/flat"
rsync -a --exclude node_modules --exclude .git "$PROJECT/" "$WORK/flat/" 2>/dev/null
flat="$(flag "$WORK/flat" "$WORK/ir-flat")"
if [ "$flat" != "false" ]; then
  echo "FAIL  flat mirror: strictBindCallApply='$flat', expected 'false'"
  echo "      the fixture is no longer sensitive to the defect it exists for"
  fail=1
fi

# ── 4. and the flat mirror must SAY the chain is broken ─────────────────────
if ! node "$TS/tools/tsconfig_chain.mjs" "$WORK/flat" 2>&1 >/dev/null | grep -q '^UNRESOLVED'; then
  echo "FAIL  flat mirror: an unresolved extends was not reported"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "tsconfig-chain fixture: gate ok (chained=true, flat=false, unresolved reported)"
exit $fail
