#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# The program text, and therefore the cache key and the engine id, must be a function of the
# RULES ALONE and not of the environment the shell happens to run in.
#
# It was a function of the locale. The #include lines are assembled from shell globs, and
# bash orders a glob by LC_COLLATE rather than by byte value: a UTF-8 collation ignores
# punctuation, so call-site.dl and callee-resolution.dl swap places against their byte order.
# Same rules, different locale, different hash. CI runs under a C-ish locale and a user
# typically does not, so published engines were refused on the common configuration, with an
# error naming the rules rather than the locale. See issue #895.
#
# THIS CANNOT BE ASSERTED ON macOS ALONE. Its collation behaves like C under both locales, so
# the first attempt to reproduce the defect there found no difference and read as a clean bill
# of health. The test therefore compares the ORDER A GLOB PRODUCES for a fixture built to
# contain a colliding pair, which is checkable everywhere, and only then checks the program
# text itself. A platform that cannot distinguish the two collations reports SKIP for the
# first half rather than passing it silently.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
fail=0; checks=0
ok(){  checks=$((checks+1)); [ -n "${ENGINE_ID_LOCALE_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){ checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

# --- does this machine's libc distinguish the two collations at all? ----------------------
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
( cd "$W" && touch call-site.dl callee-resolution.dl )
order(){ ( cd "$W" && LC_ALL="$1" bash -c 'for f in *.dl; do printf "%s " "$f"; done' ); }
c_order="$(order C)"; u_order="$(order en_US.UTF-8)"
if [ "$c_order" = "$u_order" ]; then
  echo "  skip  this libc collates the fixture identically under C and en_US.UTF-8 (macOS does);"
  echo "        the ordering half of this test cannot run here -- assert it on glibc or MSYS2"
else
  ok "the two collations do differ here, so the guard is meaningful ($c_order/ $u_order)"
fi

# --- the real assertion: the program text does not move with the locale -------------------
# Compared as TEXT rather than as a hash, so a failure names the line that moved instead of
# only reporting two different hashes.
have_lang(){ ls -d "$ROOT/graph/$1/engine" >/dev/null 2>&1; }
for lang in java typescript python javascript csharp; do
  have_lang "$lang" || continue
  a="$W/$lang.C.dl"; b="$W/$lang.U.dl"
  LC_ALL=C            bash "$ROOT/graph/pipeline/run-souffle.sh" --language "$lang" --emit-program "$a" >/dev/null 2>&1
  LC_ALL=en_US.UTF-8  bash "$ROOT/graph/pipeline/run-souffle.sh" --language "$lang" --emit-program "$b" >/dev/null 2>&1
  if [ ! -s "$a" ] || [ ! -s "$b" ]; then
    # --emit-program lands with #478; until then the executor has no way to print the program
    # without solving, and this half cannot run. Skip loudly rather than pass on nothing.
    echo "  skip  $lang: --emit-program produced nothing (needs the emit flag)"
    continue
  fi
  if cmp -s "$a" "$b"; then ok "$lang program text is identical under C and en_US.UTF-8"
  else bad "$lang program text MOVES with the locale: $(diff "$a" "$b" | grep '^[<>]' | head -2 | tr '\n' ' ')"; fi
done

# --- the guard itself, asserted on EVERY platform ------------------------------------------
# The two halves above both skip on a machine that cannot tell the collations apart and on a
# checkout without --emit-program, which is how this test came to report PASS having asserted
# nothing at all. This half runs everywhere: the executor must pin the collation before it
# assembles the program, and it must do so BEFORE the first #include glob, or the pin is
# decoration. Grepping for the mechanism is weaker than measuring the output, but a guard that
# is silently deleted is exactly how the defect returns, and a test that cannot fail anywhere
# is worth less than one that can fail somewhere.
RS="$ROOT/graph/pipeline/run-souffle.sh"
# Scoped to the REGION that assembles the program: from write_program to its first rule glob.
# A bare search for LC_ALL matches the `LC_ALL=C sort` calls elsewhere in the file, which are
# a different guard for a different line, so it reported the pin present after the pin had
# been deleted. That is the same shape of defect this whole test exists for: a check that
# cannot fail is not a check.
wp="$(grep -n 'write_program()' "$RS" | head -1 | cut -d: -f1)"
gl="$(awk -v s="${wp:-1}" 'NR>s && /for f in "\$ENG/ {print NR; exit}' "$RS")"
if [ -z "$wp" ] || [ -z "$gl" ]; then
  bad "cannot locate write_program and its first rule glob in run-souffle.sh; this test no longer measures anything"
else
  # COMMENTS DO NOT COUNT. The guard is described in a comment right above itself, and that
  # comment names LC_ALL, so a naive match reported the pin present after the pin was deleted.
  # Skip comment lines and the `LC_ALL=C sort` calls, which guard a different line.
  pin="$(awk -v a="$wp" -v b="$gl" 'NR>a && NR<b && !/^[[:space:]]*#/ && /LC_(ALL|COLLATE)=C/ && !/sort/ {print NR; exit}' "$RS")"
  if [ -n "$pin" ]; then ok "collation pinned at line $pin, inside write_program (lines $wp-$gl)"
  else bad "no LC_ALL/LC_COLLATE pin between write_program (line $wp) and its first rule glob (line $gl): the program order follows the user's locale (#895)"; fi
fi

[ "$checks" -gt 0 ] || { echo "  FAIL  this test asserted nothing on this machine"; fail=1; }
printf 'engine-id-locale: %d checks, %s\n' "$checks" "$([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail
