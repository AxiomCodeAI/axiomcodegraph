#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A SELF-LINK MUST POINT AT THE MIRROR, NOT BACK OUT OF IT.
#
# The mirror gets a directory of per-package symlinks into the ORIGINAL node_modules
# roots. For an ordinary dependency that is right — there is one copy of it. For a
# workspace SELF-LINK it is not: `node_modules/<own-name>` resolves to the package
# being analysed, so the link led back OUT of the mirror to the original tree.
# TypeScript resolves symlinks to their realpath, so a file importing its own package
# by name was adjudicated against the original while the engine's IR is the mirror:
#
#     src/selfref.ts  helper()
#         oracle  <original>/packages/wsp/src/lib.ts:1:1
#         engine  <mirror>/project/src/lib.ts:1:1
#
# Same file, same line, same column, different root — so the two cannot join, and the
# site scored WRONG while both sides had named the same declaration.
#
# Measured end to end on a workspace built to that shape, changing nothing else:
#
#     self-link -> original    exactness 0.800   1 WRONG
#     self-link -> mirror      exactness 1.000   0 WRONG
#
# See issue #293. It was invisible until #231, which removed a duplicate that had been
# supplying an original-rooted answer and turning the mismatch into a hedge.
#
# ── THE CONTROLS ARE THE EXPENSIVE HALF ─────────────────────────────────────
# Redirecting a link that should NOT be redirected points a real dependency at the
# project, which would make every one of its declarations resolve to the wrong tree.
# So four of the seven assertions check that ordinary packages, scoped packages, and
# an already-existing link are left exactly as they were.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-staging.sh
. "$HERE/lib-staging.sh"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${MIRROR_SELFLINK_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# Every "answers no" assertion below would also pass if the function were missing, so
# existence is checked first and the run stops here rather than reporting mostly-green.
if ! declare -F link_into_mirror >/dev/null 2>&1; then
  echo "  FAIL  link_into_mirror is not defined by tools/lib-staging.sh"
  echo "        The controls below would pass vacuously, so this stops here."
  echo "mirror-selflink: FAILED (1 check)"
  exit 1
fi

# A workspace, and a mirror of its package, laid out as the harness builds them.
mkdir -p "$W/ws/packages/wsp/src" "$W/ws/node_modules/@scope" "$W/mirror/project/src"
mkdir -p "$W/ws/node_modules/ordinary-dep" "$W/ws/node_modules/@scope/scoped-dep"
ln -s ../packages/wsp "$W/ws/node_modules/wsp"
PROJ="$W/ws/packages/wsp"
MIRROR="$W/mirror/project"
NM="$W/mirror/project/node_modules"
mkdir -p "$NM/@scope"

resolves_to() { cd "$1" 2>/dev/null && pwd -P; }

# 1. THE SELF-LINK is redirected at the mirror, so resolution stays inside the tree
#    being analysed.
link_into_mirror "$W/ws/node_modules/wsp" "$NM/wsp" "$PROJ" "$MIRROR"
if [ "$(resolves_to "$NM/wsp")" = "$(resolves_to "$MIRROR")" ]; then
  ok 'the self-link resolves to the MIRROR'
else
  bad "the self-link resolves to $(resolves_to "$NM/wsp"), not the mirror — a self-import is adjudicated outside the analysed tree"
fi

# 2. CONTROL — AN ORDINARY DEPENDENCY IS UNTOUCHED. Redirecting this one would point a
#    real package at the project and mis-resolve every declaration in it.
link_into_mirror "$W/ws/node_modules/ordinary-dep" "$NM/ordinary-dep" "$PROJ" "$MIRROR"
if [ "$(resolves_to "$NM/ordinary-dep")" = "$(resolves_to "$W/ws/node_modules/ordinary-dep")" ]; then
  ok 'control: an ordinary dependency still points at the original'
else
  bad "control: an ordinary dependency was redirected to $(resolves_to "$NM/ordinary-dep")"
fi

# 3. CONTROL — a SCOPED dependency likewise. The scope branch is a separate code path.
link_into_mirror "$W/ws/node_modules/@scope/scoped-dep" "$NM/@scope/scoped-dep" "$PROJ" "$MIRROR"
if [ "$(resolves_to "$NM/@scope/scoped-dep")" = "$(resolves_to "$W/ws/node_modules/@scope/scoped-dep")" ]; then
  ok 'control: a scoped dependency still points at the original'
else
  bad "control: a scoped dependency was redirected to $(resolves_to "$NM/@scope/scoped-dep")"
fi

# 4. CONTROL — AN EXISTING LINK IS NEVER REPLACED. The loop fills NEAREST-FIRST so a
#    package-local copy shadows a hoisted one exactly as Node resolves it; clobbering
#    would invert that.
mkdir -p "$W/ws/near/pkg" "$W/ws/far/pkg"
ln -s "$W/ws/near/pkg" "$NM/shadowed"
link_into_mirror "$W/ws/far/pkg" "$NM/shadowed" "$PROJ" "$MIRROR"
if [ "$(resolves_to "$NM/shadowed")" = "$(resolves_to "$W/ws/near/pkg")" ]; then
  ok 'control: an existing link is left alone, so nearest-first shadowing survives'
else
  bad 'control: an existing link was overwritten — hoisted now shadows package-local'
fi

# 5. CONTROL — with NO roots given the source is used verbatim. Callers that do not
#    know a project root must not have their links quietly rewritten.
link_into_mirror "$W/ws/node_modules/ordinary-dep" "$NM/noroots"
if [ "$(resolves_to "$NM/noroots")" = "$(resolves_to "$W/ws/node_modules/ordinary-dep")" ]; then
  ok 'control: with no roots supplied the source is linked verbatim'
else
  bad 'control: a link was rewritten even though no project root was supplied'
fi

# 6. A link named differently from the package still redirects — the test is the
#    resolved directory, not the link's name.
ln -s ../packages/wsp "$W/ws/node_modules/wsp-alias"
link_into_mirror "$W/ws/node_modules/wsp-alias" "$NM/wsp-alias" "$PROJ" "$MIRROR"
if [ "$(resolves_to "$NM/wsp-alias")" = "$(resolves_to "$MIRROR")" ]; then
  ok 'a differently-named link to the project is redirected too'
else
  bad 'a differently-named link to the project was not redirected'
fi

# 7. Both branches of the real loop pass the roots. Passing them in the plain branch
#    and forgetting the scoped one is the obvious way for half this to come back.
EVAL_SH="$HERE/../run-evaluation.sh"
calls="$(grep -cE 'link_into_mirror .*"\$PROJECT" "\$MIRROR"' "$EVAL_SH" || true)"
total="$(grep -cE '(^|[^_[:alnum:]])link_into_mirror[[:space:]]+"' "$EVAL_SH" || true)"
if [ "$calls" -eq "$total" ] && [ "$total" -gt 0 ]; then
  ok "lint: all $total link_into_mirror calls pass the project and mirror roots"
else
  bad "lint: $total link_into_mirror calls but only $calls pass both roots — one branch would link out of the mirror"
fi

if [ "$fail" -ne 0 ]; then
  echo "mirror-selflink: FAILED ($checks checks)"
  exit 1
fi
echo "mirror-selflink: ok ($checks checks)"
