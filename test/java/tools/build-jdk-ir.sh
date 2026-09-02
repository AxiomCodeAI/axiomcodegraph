#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build the JVM platform library IR — one IR module per JDK module, in the layout
# run-souffle.sh expects for --library (a root whose immediate sub-folders each hold an IR,
# identified by all-types.csv).
#
# RE-RUN THIS WHENEVER THE PARSER CHANGES. Every harness runs the parser's BUILT dist/, and
# no IR is cached across parser revisions, so a JDK IR extracted by an older parser silently
# scores the client against stale library signatures. The stamp file records which parser
# revision produced the tree, and --check reports drift without rebuilding.
#
#   build-jdk-ir.sh [--src DIR] [--out DIR] [--parser FILE] [--check] [--force]
#                   [--keep-stale] [module ...]
#
# RE-RUN IT ON EVERY JAVA PARSER CHANGE. A stale tree is DELETED and regenerated, never patched.
#
# defaults:
#   --src     $AXIOM_JDK_SRC    (a jdk source checkout: <src>/<module>/share/classes)
#   --out     $AXIOM_JDK_IR
#   --parser  $AXIOM_PARSER
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

SRC="${AXIOM_JDK_SRC:-/Users/swapnilpaliwal/Documents/Java-Projects/java/jdk26u/src}"
OUT="${AXIOM_JDK_IR:-/Users/swapnilpaliwal/Documents/AxiomCode/jdk}"
PARSER="${AXIOM_PARSER:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/dist/index.js}"
CHECK=0; FORCE=0; KEEP_STALE=0; ONLY=()
while [ $# -gt 0 ]; do case "$1" in
  --src) SRC="$2"; shift 2;; --out) OUT="$2"; shift 2;; --parser) PARSER="$2"; shift 2;;
  --check) CHECK=1; shift;; --force) FORCE=1; shift;; --keep-stale) KEEP_STALE=1; shift;;
  -h|--help) sed -n '2,20p' "$0"; exit 0;; *) ONLY+=("$1"); shift;; esac; done

[ -d "$SRC" ]  || { echo "no jdk source at $SRC" >&2; exit 1; }
[ -f "$PARSER" ] || { echo "no parser at $PARSER (build it: npm run build)" >&2; exit 1; }

PARSER_REPO="$(cd "$(dirname "$PARSER")/.." && pwd)"
PARSER_REV="$(git -C "$PARSER_REPO" rev-parse --short HEAD 2>/dev/null || echo unknown)"
# THE REBUILD TRAP: dist/ is a build artefact; checking out a parser branch does not update it.
if [ -d "$PARSER_REPO/.git" ]; then
  DIST_T=$(stat -f %m "$PARSER" 2>/dev/null || stat -c %Y "$PARSER")
  HEAD_T=$(git -C "$PARSER_REPO" log -1 --format=%ct 2>/dev/null || echo 0)
  [ "$DIST_T" -lt "$HEAD_T" ] && echo "!! parser dist/ ($(date -r "$DIST_T" 2>/dev/null)) is OLDER than its HEAD commit — run 'npm run build' first" >&2
fi

STAMP="$OUT/.parser-revision"
if [ "$CHECK" = 1 ]; then
  have="$(cat "$STAMP" 2>/dev/null | head -1 || echo '(none)')"
  echo "jdk IR at $OUT"
  echo "  built by parser : $have"
  echo "  parser now      : $PARSER_REV"
  [ "$have" = "$PARSER_REV" ] && { echo "  UP TO DATE"; exit 0; }
  echo "  STALE — re-run without --check"; exit 1
fi

# A module is any <src>/<name>/share/classes. Platform trees (unix/, macosx/) are deliberately
# NOT staged: several of them declare the same qualified name, and a colliding qualified name
# makes every name-keyed rule return all of them.
MODULES=()
while IFS= read -r line; do MODULES+=("$line"); done < <(for d in "$SRC"/*/share/classes; do [ -d "$d" ] || continue; basename "$(dirname "$(dirname "$d")")"; done | sort)
if [ ${#ONLY[@]} -gt 0 ]; then MODULES=("${ONLY[@]}"); fi

# A STALE TREE IS DELETED, NOT PATCHED. The IR is only meaningful as the output of ONE parser
# revision: leaving modules behind from an earlier one produces a tree that is partly current and
# reports itself as current, which is the failure this stamp exists to prevent. A module the new
# revision no longer produces would also survive forever. So when the stamp does not match, the
# whole tree goes. Pass --keep-stale to override (for bisecting a single module).
STAMPED="$(head -1 "$STAMP" 2>/dev/null || echo '')"
if [ -d "$OUT" ] && [ "$STAMPED" != "$PARSER_REV" ] && [ "$KEEP_STALE" = 0 ]; then
  echo "!! jdk IR at $OUT was built by parser ${STAMPED:-'(unstamped)'}, now $PARSER_REV — DELETING and regenerating"
  rm -rf "$OUT"
fi

mkdir -p "$OUT"
echo "jdk source : $SRC"
echo "output     : $OUT"
echo "parser     : $PARSER  ($PARSER_REV)"
echo "modules    : ${#MODULES[@]}"
ok=0; skip=0; fail=0; empty=0
for m in "${MODULES[@]}"; do
  cls="$SRC/$m/share/classes"
  [ -d "$cls" ] || { echo "  ?  $m — no share/classes"; continue; }
  dest="$OUT/$m"
  n=$(find "$cls" -name '*.java' | wc -l | tr -d ' ')
  if [ "$FORCE" = 0 ] && [ -f "$dest/all-types.csv" ] && [ "$(cat "$STAMP" 2>/dev/null | head -1)" = "$PARSER_REV" ]; then
    skip=$((skip+1)); continue
  fi
  rm -rf "$dest.tmp"
  # A module whose only source is module-info.java declares no types, so the parser correctly
  # emits nothing. That is EMPTY, not failed — reporting it as a failure makes the exit status
  # useless for spotting a real one.
  if [ "$n" -le 1 ]; then rm -rf "$dest.tmp"; printf "  -- %-24s empty (module-info only)\n" "$m"; empty=$((empty+1)); continue; fi
  if node "$PARSER" "$cls" "jdk-$m" true "$dest.tmp" >"$OUT/.$m.log" 2>&1 && [ -f "$dest.tmp/all-types.csv" ]; then
    rm -rf "$dest"; mv "$dest.tmp" "$dest"          # atomic: a killed run never leaves a half IR
    t=$(( $(wc -l < "$dest/all-types.csv") - 1 )); mm=$(( $(wc -l < "$dest/all-methods.csv") - 1 ))
    printf "  ok %-24s %5s files -> %6s types %7s methods\n" "$m" "$n" "$t" "$mm"; ok=$((ok+1))
  else
    rm -rf "$dest.tmp"; printf "  FAIL %-22s (see %s)\n" "$m" "$OUT/.$m.log"; fail=$((fail+1))
  fi
done
printf "%s\n%s\n" "$PARSER_REV" "built $(date -u +%Y-%m-%dT%H:%M:%SZ) from $SRC" > "$STAMP"
echo "───────────────────────────────────────────"
echo "built $ok   up-to-date $skip   empty $empty   failed $fail   -> $OUT (parser $PARSER_REV)"
[ "$fail" -eq 0 ]
