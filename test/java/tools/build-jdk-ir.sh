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
# THE CHECKOUT IS NOT ALL OF THE JDK'S SOURCE. Several classes exist only after a build: the whole
# java.nio buffer family is generated from X-Buffer.java.template, CharsetDecoder/Encoder from
# Charset-X-Coder.java.template, CharacterData* and the VarHandle family likewise — 45 templates in
# all. And the walk below reads share/classes only, so every platform-specific source
# (java.lang.ProcessImpl, sun.nio.fs, sun.nio.ch) is absent too. The installed JDK ships
# lib/src.zip, which contains all of them because it is the source AS BUILT.
#
# Both are used, and the CHECKOUT WINS for any file present in both. That keeps this strictly
# additive: src.zip contributes only what the checkout cannot produce, so no type that the tree
# already had can be lost or replaced by a differently-versioned copy. Measured on java.base:
# +510 types, -0. Which JDK version the platform IR should mirror is a separate question and is
# deliberately not decided here.
SRCZIP="${AXIOM_JDK_SRCZIP:-$(/usr/libexec/java_home 2>/dev/null)/lib/src.zip}"
OUT="${AXIOM_JDK_IR:-/Users/swapnilpaliwal/Documents/AxiomCode/jdk}"
PARSER="${AXIOM_PARSER:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/dist/index.js}"
CHECK=0; FORCE=0; KEEP_STALE=0; ONLY=()
while [ $# -gt 0 ]; do case "$1" in
  --src) SRC="$2"; shift 2;; --out) OUT="$2"; shift 2;; --parser) PARSER="$2"; shift 2;;
  --src-zip) SRCZIP="$2"; shift 2;; --no-src-zip) SRCZIP=""; shift;;
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

# ── Does a parser revision range touch JAVA extraction? ─────────────────────────────────
# The parser is shared, and most commits to it are for another front end. Rebuilding a
# ~2 GB platform IR for a TypeScript fix costs 40 minutes and changes nothing: verified by
# extracting the same tree at two revisions either side of a TS-only bump and finding every
# Java relation byte-identical.
#
# The test is an EXCLUSION, not an inclusion, and the polarity is deliberate: a path is
# ignorable only if it is provably specific to another language or to non-code. ANYTHING
# ELSE — shared extraction, hashing, CSV writing, the entry point, build config, or a path
# added after this was written — counts as Java-affecting and forces the rebuild. Guessing
# "not Java" wrongly produces a stale IR that reports itself current, which is the failure
# this whole stamp exists to prevent; guessing "Java" wrongly costs time only.
java_affecting(){                       # $1 = old rev, $2 = new rev
  local files
  files="$(git -C "$PARSER_REPO" diff --name-only "$1".."$2" 2>/dev/null)" || return 0
  [ -z "$files" ] && return 1
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      */typescript/*|*/python/*|*/gradle/*|*typescript*|*python*|*gradle*) ;;
      src/test-data/*|src/test/*|*.md|.github/*|.gitignore) ;;
      *) return 0 ;;                    # unrecognised -> assume it affects Java
    esac
  done <<EOF
$files
EOF
  return 1
}
if [ "$CHECK" = 1 ]; then
  have="$(cat "$STAMP" 2>/dev/null | head -1 || echo '(none)')"
  echo "jdk IR at $OUT"
  echo "  built by parser : $have"
  echo "  parser now      : $PARSER_REV"
  [ "$have" = "$PARSER_REV" ] && { echo "  UP TO DATE"; exit 0; }
  if [ -n "$have" ] && [ "$have" != "(none)" ] && ! java_affecting "$have" "$PARSER_REV"; then
    echo "  UP TO DATE for Java — the revisions differ but nothing between them touches Java"
    echo "  extraction, so the tree is still valid. Re-run without --check to advance the stamp."
    exit 0
  fi
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
# A RUN IN PROGRESS is marked separately from a finished one, so an interrupted run can resume
# instead of discarding 60-odd completed modules. The staleness guarantee is unchanged: only a
# partial marker for THIS parser revision protects the tree; anything else is still deleted.
PARTIAL="$OUT/.parser-revision.partial"
STAMPED="$(head -1 "$STAMP" 2>/dev/null || echo '')"
[ -z "$STAMPED" ] && STAMPED="$(head -1 "$PARTIAL" 2>/dev/null || echo '')"
if [ -d "$OUT" ] && [ "$STAMPED" != "$PARSER_REV" ] && [ "$KEEP_STALE" = 0 ]; then
  if [ -n "$STAMPED" ] && [ -f "$STAMP" ] && ! java_affecting "$STAMPED" "$PARSER_REV"; then
    # Nothing between the two revisions touches Java extraction, so the tree is unchanged in
    # substance. Advance the stamp rather than spend 40 minutes reproducing it byte for byte,
    # and record where it came from so the claim is auditable.
    printf "%s\n%s\n" "$PARSER_REV" \
      "revalidated $(date -u +%Y-%m-%dT%H:%M:%SZ): built at $STAMPED, and $STAMPED..$PARSER_REV touches no Java extraction path" > "$STAMP"
    echo "jdk IR at $OUT is still valid: $STAMPED..$PARSER_REV touches no Java extraction path"
    echo "stamp advanced to $PARSER_REV — nothing rebuilt"
    exit 0
  fi
  echo "!! jdk IR at $OUT was built by parser ${STAMPED:-'(unstamped)'}, now $PARSER_REV — DELETING and regenerating"
  rm -rf "$OUT"
fi

mkdir -p "$OUT"
printf '%s\n' "$PARSER_REV" > "$PARTIAL"
# Unpacked once, not per module: it is one 45 MB zip and 69 module trees.
ZIPDIR=""
if [ -n "$SRCZIP" ] && [ -f "$SRCZIP" ]; then
  ZIPDIR="$(mktemp -d)"; trap 'rm -rf "$ZIPDIR"' EXIT
  if unzip -qq -o "$SRCZIP" -d "$ZIPDIR" >/dev/null 2>&1; then
    echo "src.zip    : $SRCZIP  ($(find "$ZIPDIR" -name '*.java' | wc -l | tr -d ' ') files, $(ls "$ZIPDIR" | wc -l | tr -d ' ') modules)"
  else
    echo "!! could not unpack $SRCZIP — continuing with the checkout alone" >&2; rm -rf "$ZIPDIR"; ZIPDIR=""
  fi
elif [ -n "$SRCZIP" ]; then
  echo "!! no src.zip at $SRCZIP — every class the JDK GENERATES (java.nio.ByteBuffer and the rest" >&2
  echo "   of the buffer family, CharsetDecoder/Encoder, the VarHandle family) will be MISSING," >&2
  echo "   and so will every platform-specific source outside share/classes. Pass --src-zip, or" >&2
  echo "   --no-src-zip to silence this." >&2
fi
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
  if [ "$FORCE" = 0 ] && [ -f "$dest/all-types.csv" ] && [ "$STAMPED" = "$PARSER_REV" ]; then
    skip=$((skip+1)); continue
  fi
  rm -rf "$dest.tmp"
  # A module whose only source is module-info.java declares no types, so the parser correctly
  # emits nothing. That is EMPTY, not failed — reporting it as a failure makes the exit status
  # useless for spotting a real one.
  if [ "$n" -le 1 ]; then rm -rf "$dest.tmp"; printf "  -- %-24s empty (module-info only)\n" "$m"; empty=$((empty+1)); continue; fi
  # ANNOUNCE THE MODULE BEFORE STARTING IT. The parser writes nothing until it finishes a
  # module and the largest one takes minutes, so reporting only on completion makes a healthy
  # run look dead for its first several minutes — indistinguishable from being hung.
  # The tree actually parsed: the checkout, plus the files only src.zip has. Built under $ZIPDIR so
  # the checkout is never written to, and the checkout's copy always wins.
  src_dir="$cls"; added=0
  if [ -n "$ZIPDIR" ] && [ -d "$ZIPDIR/$m" ]; then
    merged="$ZIPDIR/.merged-$m"; rm -rf "$merged"; mkdir -p "$merged"
    cp -R "$cls/." "$merged/" 2>/dev/null
    while IFS= read -r f; do
      rel="${f#$ZIPDIR/$m/}"
      [ -f "$merged/$rel" ] && continue
      mkdir -p "$merged/$(dirname "$rel")"; cp "$f" "$merged/$rel"; added=$((added+1))
    done < <(find "$ZIPDIR/$m" -name '*.java')
    src_dir="$merged"; n=$((n+added))
  fi
  printf "  .. %-24s %5s files (%s from src.zip) ...\n" "$m" "$n" "$added"
  if node "$PARSER" "$src_dir" "jdk-$m" true "$dest.tmp" >"$OUT/.$m.log" 2>&1 && [ -f "$dest.tmp/all-types.csv" ]; then
    rm -rf "$dest"; mv "$dest.tmp" "$dest"          # atomic: a killed run never leaves a half IR
    [ -n "${merged:-}" ] && rm -rf "$merged" && merged=""
    t=$(( $(wc -l < "$dest/all-types.csv") - 1 )); mm=$(( $(wc -l < "$dest/all-methods.csv") - 1 ))
    ok=$((ok+1))
    printf "  ok %-24s %5s files -> %6s types %7s methods   [%d/%d]\n" \
           "$m" "$n" "$t" "$mm" "$((ok+skip+empty+fail))" "${#MODULES[@]}"
  else
    rm -rf "$dest.tmp"; printf "  FAIL %-22s (see %s)\n" "$m" "$OUT/.$m.log"; fail=$((fail+1))
  fi
done
# ── CANARY: a class the JDK GENERATES must be in the tree ───────────────────────────────────
# The whole point of reading src.zip is that a source checkout cannot produce these. If the union
# silently stops happening — src.zip missing, moved, unreadable, or the merge reverted — every
# number measured against this IR quietly gets worse and nothing says so. java.nio.ByteBuffer is
# the canary: it exists ONLY as X-Buffer.java.template in the checkout, and 981 call sites named it
# across a five-project corpus.
if [ -f "$OUT/java.base/all-types.csv" ]; then
  if ! awk -F'\t' 'NR>1 && $2=="java.nio.ByteBuffer"{found=1} END{exit !found}' "$OUT/java.base/all-types.csv"; then
    echo "!! java.nio.ByteBuffer is NOT in the built java.base IR." >&2
    echo "   It is generated from X-Buffer.java.template and exists in no source checkout, so this" >&2
    echo "   means src.zip was not merged. Every buffer call will resolve to nothing. See --src-zip." >&2
    fail=$((fail+1))
  fi
fi

# The finished stamp is written ONLY when every module succeeded — a partial tree must never
# report itself current. On a partial failure the .partial marker stays, so a re-run resumes.
if [ "$fail" -eq 0 ]; then
  printf "%s\n%s\n" "$PARSER_REV" "built $(date -u +%Y-%m-%dT%H:%M:%SZ) from $SRC" > "$STAMP"
  rm -f "$PARTIAL"
else
  echo "!! $fail module(s) failed — no revision stamp written; --check will report STALE"
fi
echo "───────────────────────────────────────────"
echo "built $ok   up-to-date $skip   empty $empty   failed $fail   -> $OUT (parser $PARSER_REV)"
[ "$fail" -eq 0 ]
