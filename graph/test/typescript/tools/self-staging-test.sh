#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE PROJECT UNDER ANALYSIS IS NOT ONE OF ITS OWN DEPENDENCIES.
#
# In a workspace, `node_modules/<own-name>` is a symlink back to the package being
# analysed. Library discovery finds it exactly like any other dependency and stages it,
# so the mirror and the staged copy are the same source under two roots — and the
# scorer, correctly, treats them as two declarations. Every site whose target lives in
# the project then answers twice:
#
#     SOUND_SUPERSET  helper  lib.ts:1:1   lib.ts:1:1;lib.ts:1:1
#
# One declaration, two answers, hedged instead of exact. Measured end to end on a
# workspace built to have this shape, with NOTHING else changed between the two runs:
#
#     staged   exactness 0.200   decisiveness 0.200
#     skipped  exactness 0.800   decisiveness 1.000
#
# See issue #231.
#
# ── WHAT IS ASSERTED HERE, AND WHY NOT THE END-TO-END RUN ───────────────────
# The predicate, in isolation, because it is the whole fix and because a test that
# needs the parser, the solver and a full evaluation is a test that gets skipped. The
# directory shapes below are real: actual symlinks, actual nesting, actual missing
# paths. Five of the eight assertions are CONTROLS, because a predicate that answers
# "yes" too readily would silently DROP a genuine dependency — the failure mode
# pointing the other way, and the more expensive one.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-staging.sh
. "$HERE/lib-staging.sh"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${SELF_STAGING_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# ── THE PREDICATE MUST EXIST BEFORE ANY OF THIS MEANS ANYTHING ──────────────
# Every control below is of the form "answers no", and a MISSING function also answers
# no — `command not found` returns non-zero. Running this against a tree without the
# fix, five of the nine checks passed vacuously. So existence is asserted first and the
# run stops here, rather than reporting mostly-green for a predicate that is not there.
if ! declare -F is_project_itself >/dev/null 2>&1; then
  echo "  FAIL  is_project_itself is not defined by tools/lib-staging.sh"
  echo "        Every 'answers no' control below would pass vacuously, so this stops here."
  echo "self-staging: FAILED (1 check)"
  exit 1
fi

# A workspace laid out the way a package manager writes one.
mkdir -p "$W/ws/packages/wsp/src" "$W/ws/node_modules" "$W/ws/packages/wsp/dist"
mkdir -p "$W/ws/node_modules/other-dep" "$W/mirror/project/src"
ln -s ../packages/wsp "$W/ws/node_modules/wsp"          # the self-link
ln -s ../packages/wsp "$W/ws/node_modules/wsp-alias"    # a second name for it
PROJ="$W/ws/packages/wsp"
MIRROR="$W/mirror/project"

# 1. THE SELF-LINK. The whole point: a different path, the same directory.
if is_project_itself "$W/ws/node_modules/wsp" "$PROJ" "$MIRROR"; then
  ok 'the workspace self-link is recognised as the project'
else
  bad 'the workspace self-link was NOT recognised — it would be staged as a dependency'
fi

# 2. A SECOND ALIAS for the same package. Nothing about the check should depend on the
#    link being named after the package.
if is_project_itself "$W/ws/node_modules/wsp-alias" "$PROJ" "$MIRROR"; then
  ok 'a differently-named link to the same directory is recognised'
else
  bad 'a differently-named link to the project was not recognised'
fi

# 3. THE MIRROR. Both roots have to be checked: the node_modules search runs over the
#    ORIGINAL tree while the analysed sources are the mirror, and the two are
#    different absolute paths.
if is_project_itself "$MIRROR" "$PROJ" "$MIRROR"; then
  ok 'the mirror root is recognised as the project'
else
  bad 'the mirror root was not recognised — the second of the two roots is unchecked'
fi

# 4. CONTROL — AN ORDINARY DEPENDENCY MUST STILL BE STAGED. This is the expensive
#    direction to get wrong: dropping a real dependency costs recall everywhere, and
#    unlike the duplicate it leaves no visible trace in the score.
if is_project_itself "$W/ws/node_modules/other-dep" "$PROJ" "$MIRROR"; then
  bad 'control: an ORDINARY dependency was called the project — it would not be staged'
else
  ok 'control: an ordinary dependency is not mistaken for the project'
fi

# 5. CONTROL — a SUBDIRECTORY of the project is not the project. That shape is #118's
#    (a package shipping src/ beside dist/) and belongs to src_duplicates_staged_subdir;
#    answering yes here would take it over and skip roots that should be staged.
if is_project_itself "$PROJ/dist" "$PROJ" "$MIRROR"; then
  bad 'control: a SUBDIRECTORY of the project was called the project (that is #118, not this)'
else
  ok 'control: a subdirectory of the project is not the project'
fi

# 6. CONTROL — the PARENT is not the project either.
if is_project_itself "$W/ws/packages" "$PROJ" "$MIRROR"; then
  bad 'control: the project PARENT was called the project'
else
  ok 'control: the parent directory is not the project'
fi

# 7. CONTROL — a path that does not exist answers no, and does not crash. Discovery
#    hands this predicate whatever find_in_nm returned, including nothing.
if is_project_itself "$W/no/such/dir" "$PROJ" "$MIRROR"; then
  bad 'control: a nonexistent directory was called the project'
else
  ok 'control: a nonexistent directory answers no without failing'
fi

# 8. CONTROL — an EMPTY candidate answers no. `d="$(find_in_nm ... || true)"` yields
#    the empty string when nothing was found, and that reaches here verbatim.
if is_project_itself "" "$PROJ" "$MIRROR"; then
  bad 'control: an empty candidate was called the project'
else
  ok 'control: an empty candidate answers no'
fi

# 9. Both discovery sites go through the guard. Patching one and not the other is the
#    obvious way for this to come back — the transitive round resolves package names
#    the same way and reaches the same self-link.
EVAL_SH="$HERE/../run-evaluation.sh"
sites="$(grep -cE '^\s*d="\$\(skip_if_self ' "$EVAL_SH" || true)"
discoveries="$(grep -cE 'find_in_nm "\$pkg"' "$EVAL_SH" || true)"
if [ "$sites" -ge "$discoveries" ] && [ "$sites" -gt 0 ]; then
  ok "lint: all $discoveries package-name discoveries pass through skip_if_self"
else
  bad "lint: $discoveries package-name discoveries but only $sites guarded — the transitive round reaches the same self-link"
fi

if [ "$fail" -ne 0 ]; then
  echo "self-staging: FAILED ($checks checks)"
  exit 1
fi
echo "self-staging: ok ($checks checks)"
