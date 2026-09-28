#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A line lost while the program is generated or hashed must never yield a DIFFERENT engine id
# with exit 0. That id names the cached binary, so a wrong one turns a warm rebuild into a full
# C++ compile (measured: 2183 s instead of 11 s under load), and a program missing a line under
# the RIGHT id would cache a wrong engine. The loss was a bash 3.2 pipe write interrupted by a
# signal ("printf: write error: Interrupted system call"), unchecked inside a pipeline (#1593).
#
# Each case puts one tool on PATH that silently drops a line of its output (exit 0), the way
# the interrupted write did, and asks for the id. The contract: the id is unchanged, or the
# run fails loudly. Controls: the shims are exercised (a shim that is never called would make
# every case pass on nothing), and the intact id is a digest.
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT="$(d="$(cd "$(dirname "$0")" && pwd)"; while [ "$d" != / ] && { [ ! -f "$d/package.json" ] || [ ! -d "$d/graph" ]; }; do d="$(dirname "$d")"; done; echo "$d")"
RUN="$ROOT/graph/pipeline/run-souffle.sh"
fail=0; checks=0
bad(){ echo "  ✗ $*"; fail=$((fail+1)); }
ok(){ checks=$((checks+1)); }
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# shim NAME AWK-FILTER: a NAME on PATH that runs the real one and filters its output through
# the awk program, logging each call so the test can prove the shim was reached.
shim(){
  local name="$1" filter="$2" real; real="$(command -v "$name")"
  mkdir -p "$W/$name"
  cat > "$W/$name/$name" <<SH
#!/bin/bash
echo "\$*" >> "$W/$name.calls"
"$real" "\$@" | awk '$filter'
exit 0
SH
  chmod +x "$W/$name/$name"
}
# sort: drop one relation name from any list it sorts (the observed loss, simulated)
shim sort '$0 != "dispatch_cap" && $0 != "jdk_max_depth"'
# cat: drop the last line of everything it prints
shim cat '{ if (NR > 1) print prev; prev = $0 }'

for lang in python java; do
  good="$(bash "$RUN" --language "$lang" --print-engine-id 2>/dev/null)"; rc=$?
  case "$good" in [0-9a-f]*) [ "${#good}" -eq 64 ] && [ "$rc" -eq 0 ] && ok || bad "$lang: intact id is not a 64-digit digest ('$good', exit $rc)";;
    *) bad "$lang: intact id is not a digest ('$good', exit $rc)";; esac
  for t in sort cat; do
    : > "$W/$t.calls"
    got="$(PATH="$W/$t:$PATH" bash "$RUN" --language "$lang" --print-engine-id 2>"$W/err")"; rc=$?
    if [ "$rc" -eq 0 ] && [ "$got" != "$good" ]; then
      bad "$lang: a $t that loses a line gave a different id with exit 0 ($got vs $good)"
    else ok; fi
    # the program must come out intact too, or not at all
    rm -f "$W/p.dl"
    PATH="$W/$t:$PATH" bash "$RUN" --language "$lang" --emit-program "$W/p.dl" 2>/dev/null; rc=$?
    bash "$RUN" --language "$lang" --emit-program "$W/ref.dl" 2>/dev/null
    if [ "$rc" -eq 0 ] && ! cmp -s "$W/p.dl" "$W/ref.dl"; then
      bad "$lang: a $t that loses a line emitted a different program with exit 0"
    else ok; fi
  done
done
# control: the cat shim must actually have been on the id path (the sort shim no longer is,
# which is the fix: the program is generated without a pipe through sort)
[ -s "$W/cat.calls" ] && ok || bad "control: the cat shim was never called; the cat cases measured nothing"

[ "$checks" -ge 1 ] || { echo "  ✗ this test asserted nothing"; fail=$((fail+1)); }
if [ "$fail" -eq 0 ]; then echo "engine-id-lost-line: ok ($checks checks: a lost line is refused or harmless)"
else echo "engine-id-lost-line: $fail failure(s)"; exit 1; fi
