#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# A BUILD THAT PRODUCED NO IR MUST NOT STAMP ITSELF CURRENT.
#
# build-jdk-ir.sh writes `.parser-revision` only when nothing failed, and a module counted "empty
# (module-info only)" is deliberately not a failure. So a run in which EVERY module came back empty
# wrote the finished stamp and exited 0: an empty tree asserting it is a complete build, with
# `--check` reporting UP TO DATE. A harness pointed at it stages no platform library and cannot
# even print its own "no platform IR" warning, because the directory exists and looks current.
#
# The way that was hit is a symlinked `share/classes` -- which is how src.zip gets staged into the
# `<mod>/share/classes` shape the script documents -- because `find` does not descend into a
# symlinked start path without `-L`. Both halves are asserted here: that the symlinked module is
# actually built, and that a genuinely empty tree fails instead of stamping. See issue #249.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
PARSER="${AXIOM_PARSER:-$ROOT/parser/dist/index.js}"
[ -f "$PARSER" ] || { echo "jdk-ir-stamp: SKIP (no parser at $PARSER)"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "jdk-ir-stamp: SKIP (no node)"; exit 0; }

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
fail=0; checks=0
ok(){   checks=$((checks+1)); [ -n "${JDK_IR_STAMP_VERBOSE:-}" ] && printf '  ok    %s\n' "$1"; return 0; }
bad(){  checks=$((checks+1)); printf '  FAIL  %s\n' "$1"; fail=1; }

build(){ bash "$HERE/build-jdk-ir.sh" --src "$1" --out "$2" --parser "$PARSER" --no-src-zip; }

# ── a module whose share/classes is a SYMLINK is a real module ───────────────
mkdir -p "$W/real/java.base/java/nio" "$W/sym/src/java.base/share" "$W/sym/out"
cat > "$W/real/java.base/java/nio/ByteBuffer.java" <<'EOF'
package java.nio;
public abstract class ByteBuffer { public abstract byte get(); }
EOF
cat > "$W/real/java.base/java/nio/CharBuffer.java" <<'EOF'
package java.nio;
public abstract class CharBuffer { public abstract char get(); }
EOF
ln -s "$W/real/java.base" "$W/sym/src/java.base/share/classes"

build "$W/sym/src" "$W/sym/out" > "$W/sym.log" 2>&1; rc=$?
if [ -f "$W/sym/out/java.base/all-types.csv" ]; then
  ok "a symlinked share/classes is built, not counted empty"
else
  bad "a symlinked share/classes produced no IR (counted empty):"
  grep -E 'empty|built |modules' "$W/sym.log" | sed 's/^/          /'
fi
[ "$rc" -eq 0 ] && ok "that build exits 0" || bad "a good build exited $rc"

# The report must not under-count. all-types.csv is written with no trailing newline, so a
# `wc -l` - 1 count reported one type fewer than the tree holds, for every module.
want=$(awk 'END{print NR-1}' "$W/sym/out/java.base/all-types.csv" 2>/dev/null || echo 0)
got=$(sed -n 's/.*-> *\([0-9]*\) types.*/\1/p' "$W/sym.log" | head -1)
[ -n "$got" ] && [ "$got" = "$want" ] \
  && ok "the reported type count matches the rows written ($want)" \
  || bad "reported '$got' types, the IR holds $want"

# ── a tree where NOTHING built must fail, and must not stamp ─────────────────
# module-info.java alone declares no types, so the parser correctly emits nothing. That is a
# legitimate empty module -- and a tree of ONLY those has no platform library in it.
mkdir -p "$W/mt/src/java.base/share/classes" "$W/mt/out"
cat > "$W/mt/src/java.base/share/classes/module-info.java" <<'EOF'
module java.base { }
EOF
build "$W/mt/src" "$W/mt/out" > "$W/mt.log" 2>&1; rc=$?
[ "$rc" -ne 0 ] \
  && ok "a run that built nothing exits non-zero" \
  || bad "a run that built nothing exited 0:$(printf '\n')$(grep -E 'built |empty' "$W/mt.log" | sed 's/^/          /')"
[ ! -f "$W/mt/out/.parser-revision" ] \
  && ok "a run that built nothing writes no revision stamp" \
  || bad "an empty tree was stamped current: $(head -1 "$W/mt/out/.parser-revision")"

# ...and --check must then say so, rather than UP TO DATE.
chk="$(bash "$HERE/build-jdk-ir.sh" --src "$W/mt/src" --out "$W/mt/out" --parser "$PARSER" --check 2>&1)"
echo "$chk" | grep -q 'UP TO DATE' \
  && bad "--check reports UP TO DATE on a tree that holds no IR:$(printf '\n')$(echo "$chk" | sed 's/^/          /')" \
  || ok "--check does not report UP TO DATE on a tree that holds no IR"

[ "$fail" = 0 ] && echo "jdk-ir-stamp: ok ($checks checks)" || echo "jdk-ir-stamp: FAILED"
exit "$fail"
