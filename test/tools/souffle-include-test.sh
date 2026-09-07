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
REAL=""
for c in $(AXIOM_SOUFFLE_INCLUDE= find_souffle_include 2>/dev/null); do REAL="$c"; done
[ -n "$REAL" ] || { echo "souffle-include: SKIP (no soufflé headers on this machine)"; exit 0; }
# Normalise to the tree that actually holds the headers, whichever candidate matched.
HDRS="$REAL/souffle"
[ -f "$HDRS/CompiledSouffle.h" ] || { echo "souffle-include: SKIP (unexpected header tree at $REAL)"; exit 0; }

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

[ "$fail" = 0 ] && echo "souffle-include: ok ($checks checks)" || echo "souffle-include: FAILED"
exit "$fail"
