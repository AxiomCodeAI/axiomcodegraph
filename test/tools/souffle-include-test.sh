#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The -I handed to the C++ compiler must be the directory CONTAINING soufflé's `souffle/`, because
# the generated program includes its headers as `souffle/CompiledSouffle.h`.
#
# WHICH directory that is differs by installation, and the old test could not tell them apart: it
# asked whether a directory named `souffle` existed under `include`, which is true on every layout.
# So it returned include/souffle everywhere, and the engine still built on the machine it was
# written on — because Homebrew installs the headers twice and the nested copy makes that path
# work. On a source build or a distro package the same path cannot find the header at all, and the
# engine could not be compiled. See issue #216.
#
# Both layouts are synthesised here from the real header tree, so the assertion is about the
# resolver and not about whichever soufflé this machine happens to have.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
. "$ROOT/src/pipeline/souffle-include.sh"

fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${SOUFFLE_INCLUDE_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# Find a real header tree to build the fixtures from; without one there is nothing to assert.
# QUOTED. find_souffle_include prints one line; an unquoted command substitution word-splits it on
# $IFS, so a prefix containing a space left REAL holding the last word of the path. The header test
# below then failed against that fragment and the gate took its SKIP branch and exited 0 -- erasing
# itself in the one situation it exists for, and letting the #216 defect be reverted with this
# preflight still green. Same defect class as #206. See issue #254.
REAL="$(AXIOM_SOUFFLE_INCLUDE= find_souffle_include 2>/dev/null)"
[ -n "$REAL" ] || { echo "souffle-include: SKIP (no soufflé headers on this machine)"; exit 0; }
# Normalise to the tree that actually holds the headers, whichever candidate matched.
#
# A NON-EMPTY ANSWER THAT HOLDS NO HEADER IS A FAILURE, NOT A SKIP. This used to skip, which is how
# the gate erased itself: with the bootstrap above word-splitting a spaced path, REAL held a
# fragment, the header was not under it, and the whole guard exited 0 having asserted nothing --
# leaving #216 revertible with this preflight green. "No soufflé on this machine" is REAL being
# empty, checked above; anything else means the resolver or this capture is broken. #254.
HDRS="$REAL/souffle"
if [ ! -f "$HDRS/CompiledSouffle.h" ]; then
  echo "  FAIL  the resolver answered '$REAL', which holds no souffle/CompiledSouffle.h."
  echo "        That is a broken resolver or a broken capture of it — not an absent soufflé."
  echo "souffle-include: FAILED"
  exit 1
fi

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# ── layout A: headers once, at include/souffle/ (source build, most distro packages) ──
mkdir -p "$W/std/include"
cp -R "$HDRS" "$W/std/include/souffle"
rm -rf "$W/std/include/souffle/souffle"

# ── layout B: Homebrew — the same tree PLUS a nested second copy at include/souffle/souffle ──
mkdir -p "$W/brew/include"
cp -R "$W/std/include/souffle" "$W/brew/include/souffle"
cp -R "$W/std/include/souffle" "$W/brew/include/souffle/souffle"

probe(){ AXIOM_SOUFFLE_INCLUDE= souffle_include_under "$1"; }

got="$(probe "$W/std")"
[ "$got" = "$W/std/include" ] \
  && ok "standard layout resolves to include/" \
  || bad "standard layout resolved to '${got:-<nothing>}', wanted $W/std/include"

got="$(probe "$W/brew")"
[ "$got" = "$W/brew/include/souffle" ] \
  && ok "Homebrew layout resolves to include/souffle/" \
  || bad "Homebrew layout resolved to '${got:-<nothing>}', wanted $W/brew/include/souffle"

if probe "$W/empty" >/dev/null 2>&1; then bad "a prefix with no headers still resolved"
else ok "a prefix with no headers resolves to nothing"; fi

# ── and the answer must actually COMPILE, which is the only thing the caller cares about ──
# The directory existing is what the old check tested and is exactly what was not sufficient.
if command -v c++ >/dev/null 2>&1; then
  printf '#include "souffle/CompiledSouffle.h"\nint main(){return 0;}\n' > "$W/probe.cpp"
  for layout in std brew; do
    inc="$(probe "$W/$layout")"
    if c++ -std=c++17 -fsyntax-only -w -I "$inc" "$W/probe.cpp" >"$W/cc.log" 2>&1; then
      ok "$layout: the resolved -I compiles souffle/CompiledSouffle.h"
    else
      bad "$layout: the resolved -I ($inc) does NOT compile:"; head -3 "$W/cc.log" | sed 's/^/          /'
    fi
  done
else
  echo "  (no c++ on PATH — compile assertions skipped)"
fi

# ── A PREFIX CONTAINING A SPACE ──────────────────────────────────────────────
# Not hypothetical: this gate skipped green on such a prefix, because it word-split the resolver's
# answer while bootstrapping from it, so the guard erased itself exactly where it was needed. The
# resolver was always correct; only the capture was not. #254.
mkdir -p "$W/pre fix/include"
cp -R "$W/std/include/souffle" "$W/pre fix/include/souffle"
got="$(souffle_include_under "$W/pre fix")"
[ "$got" = "$W/pre fix/include" ] \
  && ok "a prefix containing a space resolves intact" \
  || bad "spaced prefix resolved to '${got:-<nothing>}', wanted $W/pre fix/include"

# ── THE OVERRIDE IS VALIDATED BY THE SAME PROBE ──────────────────────────────
# AXIOM_SOUFFLE_INCLUDE is what someone reaches for when the build is already broken, so it must
# not be the one path with no check behind it. The natural value to set is whatever the resolver
# used to print -- `<prefix>/include/souffle` -- which is one level too deep on a single-copy
# install and otherwise surfaces only as a compiler error deep into a run. #255.
got="$(AXIOM_SOUFFLE_INCLUDE="$W/std/include" find_souffle_include 2>/dev/null)"
[ "$got" = "$W/std/include" ] \
  && ok "a correct override is returned as given" \
  || bad "correct override returned '${got:-<nothing>}'"

got="$(AXIOM_SOUFFLE_INCLUDE="$W/std/include/souffle" find_souffle_include 2>/dev/null)"
[ "$got" = "$W/std/include" ] \
  && ok "an override one level too deep is corrected, not passed through" \
  || bad "override include/souffle on a single-copy install returned '${got:-<nothing>}', wanted $W/std/include"

got="$(AXIOM_SOUFFLE_INCLUDE="$W/std" find_souffle_include 2>/dev/null)"
[ "$got" = "$W/std/include" ] \
  && ok "an override naming the prefix is resolved" \
  || bad "prefix override returned '${got:-<nothing>}'"

got="$(AXIOM_SOUFFLE_INCLUDE="$W/nowhere" find_souffle_include 2>/dev/null)"
[ -z "$got" ] \
  && ok "an override with no headers anywhere near it resolves to nothing" \
  || bad "bogus override returned '$got' instead of nothing"

# ...and it must SAY which variable is wrong, not fail as a bare compiler error later.
AXIOM_SOUFFLE_INCLUDE="$W/nowhere" find_souffle_include 2>"$W/ov.log" >/dev/null
grep -q 'AXIOM_SOUFFLE_INCLUDE' "$W/ov.log" \
  && ok "a bad override names itself on stderr" \
  || { bad "a bad override produced no diagnostic naming the variable:"; sed 's/^/          /' "$W/ov.log"; }

[ "$fail" = 0 ] && echo "souffle-include: ok ($checks checks)" || echo "souffle-include: FAILED"
exit "$fail"
