#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GROUND TRUTH from a LIVE SPRING CONTEXT — an independent toolchain, not ours.
#
# Compiles a case's sources against the real Spring jars, boots them in an
# AnnotationConfigApplicationContext, and prints what the CONTAINER resolved
# (tools/spring-oracle/DumpContext.java). tools/spring_oracle_diff.py then scores
# the engine's bean_def / di_edge against it.
#
#   spring_oracle.sh <case-src-dir> <work-dir> <scan-package> [key=value ...]
#
# Jars are taken from the local Maven cache — NO network. If they are absent the
# script exits 77 and the caller SKIPS the oracle rather than failing, matching how
# run-tests.sh treats a missing parser or JDK IR.
#   SPRING_VERSION  Spring Framework version to use (default: highest 6.x cached)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
SRC="$1"; WORK="$2"; PKG="$3"; shift 3
HERE="$(cd "$(dirname "$0")" && pwd)"
M2="${M2_REPO:-$HOME/.m2/repository}"

# Pick a cached Spring Framework version that has every module we need.
pick_version() {
  local v
  for v in $(ls "$M2/org/springframework/spring-context" 2>/dev/null | sort -rV); do
    local ok=1
    for a in spring-context spring-core spring-beans spring-aop spring-expression spring-jcl; do
      [ -f "$M2/org/springframework/$a/$v/$a-$v.jar" ] || ok=0
    done
    [ "$ok" = "1" ] && { echo "$v"; return; }
  done
}
SV="${SPRING_VERSION:-$(pick_version)}"
[ -n "$SV" ] || { echo "no complete Spring Framework in $M2 (offline; nothing to boot)" >&2; exit 77; }

CP=""
for a in spring-context spring-core spring-beans spring-aop spring-expression spring-jcl; do
  CP="$CP:$M2/org/springframework/$a/$SV/$a-$SV.jar"
done
CP="${CP#:}"

mkdir -p "$WORK/classes"
# --release 17: the cached Spring is built for 17, and the local JDK may be much
# newer. Pinning the release keeps the oracle reproducible across machines.
find "$SRC" -name '*.java' > "$WORK/sources.txt"
echo "$HERE/spring-oracle/DumpContext.java" >> "$WORK/sources.txt"
if ! javac --release 17 -nowarn -cp "$CP" -d "$WORK/classes" @"$WORK/sources.txt" 2> "$WORK/javac.log"; then
  echo "javac failed against Spring $SV — see $WORK/javac.log" >&2
  head -20 "$WORK/javac.log" >&2
  exit 1
fi
java -cp "$WORK/classes:$CP" oracle.DumpContext "$PKG" "$@" 2> "$WORK/boot.log"
rc=$?
[ $rc -eq 0 ] || { echo "context failed to start — see $WORK/boot.log" >&2; tail -20 "$WORK/boot.log" >&2; }
exit $rc
