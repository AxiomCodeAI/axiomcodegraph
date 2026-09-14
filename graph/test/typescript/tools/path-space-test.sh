#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A PATH CONTAINING A SPACE MUST NOT SILENTLY EMPTY THE LIBRARY STAGING.
#
# `NM_ROOTS` was one space-delimited string iterated unquoted, so a checkout whose path
# contained a space was indistinguishable from two checkouts:
#
#     NM_ROOTS holds: [ /a b/node_modules /plain/node_modules]
#     iterating it:   [/a]  [b/node_modules]  [/plain/node_modules]
#
# Two of those three are not directories, so every lookup through them missed. That is
# not confined to one fixture: `find_in_nm` is how the harness locates EVERY dependency
# it stages, so on such a path the run staged no standard library, no `@types` and no
# dependencies — and then printed a score computed against an empty global scope. A
# plausible number measuring nothing but the harness's inability to find anything.
#
# Measured, same tree, one variable:
#
#     /tmp/nospace      45 lib.*.d.ts staged, gate ok
#     /tmp/with space   none staged, "the global scope will be EMPTY", oracle refused
#
# `LIBARGS` had the identical shape — `${LIBS//,/ }` turns a comma-joined list into a
# space-joined one and then splits it on whitespace — and every entry is under the
# caller-supplied work directory, so it is reachable the same way. See issue #296.
#
# Synthesised directories, no parser, no solver, no compiler: this cannot skip.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-staging.sh
. "$HERE/lib-staging.sh"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${PATH_SPACE_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

if ! declare -F find_in_nm >/dev/null 2>&1; then
  echo "  FAIL  find_in_nm is not defined by tools/lib-staging.sh"
  echo "        A missing function also 'finds nothing', so the checks below would be"
  echo "        indistinguishable from the defect. Stopping here."
  echo "path-space: FAILED (1 check)"
  exit 1
fi

mkdir -p "$W/a b/node_modules/typescript/lib" "$W/a b/node_modules/@types/node"
mkdir -p "$W/plain/node_modules/lodash"

# ── 1-3. lookup through a root whose path contains a space ──────────────────
NM_ROOTS=("$W/a b/node_modules" "$W/plain/node_modules")

got="$(find_in_nm typescript/lib || true)"
if [ "$got" = "$W/a b/node_modules/typescript/lib" ]; then
  ok 'the standard library is found under a root containing a space'
else
  bad "typescript/lib not found under a spaced root (got '${got:-nothing}') — the run would stage an EMPTY global scope"
fi

got="$(find_in_nm "@types/node" || true)"
if [ "$got" = "$W/a b/node_modules/@types/node" ]; then
  ok 'a scoped package is found under a root containing a space'
else
  bad "@types/node not found under a spaced root (got '${got:-nothing}')"
fi

# CONTROL — a root with no space must still work. The fix must not trade one for
# the other, and this is the case every existing checkout relies on.
got="$(find_in_nm lodash || true)"
if [ "$got" = "$W/plain/node_modules/lodash" ]; then
  ok 'control: an ordinary root without a space still resolves'
else
  bad "control: a plain root stopped resolving (got '${got:-nothing}')"
fi

# CONTROL — a miss is still a miss. A function that answered every query would pass
# checks 1-3 while being useless.
if find_in_nm definitely-not-here >/dev/null 2>&1; then
  bad 'control: find_in_nm claimed to find a package that does not exist'
else
  ok 'control: an absent package is still reported as absent'
fi

# CONTROL — no roots at all is a miss, not an error. `NM_ROOTS` is empty on a project
# with no node_modules anywhere, and the callers use `|| true` around this.
NM_ROOTS=()
if find_in_nm typescript >/dev/null 2>&1; then
  bad 'control: find_in_nm found something with NO roots configured'
else
  ok 'control: an empty root list is a clean miss'
fi

# ── 6. THE LINT: no path list may be expanded unquoted ──────────────────────
# The defect is invisible on review — `for r in $NM_ROOTS` is what one writes — so the
# rule is checked over the file rather than the two known sites being patched.
lint_unquoted() { # $1 = file -> offending "line:text"
  grep -nE '(\$NM_ROOTS[^[]|\$LIBARGS[^[]|\$\{NM_ROOTS\}|\$\{LIBARGS\})' "$1" \
    | grep -vE '^[0-9]+:[[:space:]]*#' \
    | grep -vE '\$\{#(NM_ROOTS|LIBARGS)\[@\]\}'
}
EVAL_SH="$HERE/../run-evaluation.sh"
offending="$(lint_unquoted "$EVAL_SH")"
if [ -n "$offending" ]; then
  bad 'a path list is expanded without the array form, so a space in the path splits it:'
  printf '%s\n' "$offending" | sed 's/^/          /'
else
  ok 'lint: every path-list expansion uses the array form'
fi

# ── 7-8. the lint has to discriminate ───────────────────────────────────────
cat > "$W/planted.sh" <<'PEOF'
for r in $NM_ROOTS; do echo "$r"; done
PEOF
if [ -n "$(lint_unquoted "$W/planted.sh")" ]; then
  ok 'control: the lint rejects an unquoted expansion'
else
  bad 'control: the lint did NOT reject an unquoted expansion — it pins nothing'
fi

cat > "$W/clean.sh" <<'PEOF'
for r in "${NM_ROOTS[@]}"; do echo "$r"; done
if [ "${#NM_ROOTS[@]}" -gt 0 ]; then echo yes; fi
python3 score.py ${LIBARGS[@]+"${LIBARGS[@]}"}
# $NM_ROOTS in a comment is prose, not code
PEOF
if [ -z "$(lint_unquoted "$W/clean.sh")" ]; then
  ok 'control: the lint accepts every correct form, including a comment'
else
  bad "control: the lint rejected a CORRECT form — it would block ordinary work:
$(lint_unquoted "$W/clean.sh" | sed 's/^/          /')"
fi

if [ "$fail" -ne 0 ]; then
  echo "path-space: FAILED ($checks checks)"
  exit 1
fi
echo "path-space: ok ($checks checks)"
