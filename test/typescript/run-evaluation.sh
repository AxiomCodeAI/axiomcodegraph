#!/bin/bash
# =============================================================================
# TypeScript engine evaluation — one project, end to end, reproducible.
#
#   parser IR  ->  library IR (discovered, not hand-listed)  ->  engine
#              ->  tsc oracle + CHA/RTA envelope  ->  per-site score
#
# ── WHY LIBRARY DISCOVERY IS PART OF THE HARNESS ─────────────────────────────
# The Java engine's own README names unstaged dependencies as the dominant cause
# of its residual recall gap: 79.8% of unresolved receivers pointed at libraries
# that were not linked in. The same is true here and more sharply, because in
# TypeScript even `string` and `Array` are library declarations — an unstaged
# `lib.es5.d.ts` costs thousands of sites, not a long tail.
#
# So which libraries to stage is NOT a judgement call to be made per run. It is
# derived from the client IR itself: every package the parser's own module
# resolution landed in gets extracted. A dependency that is missing from the
# report is then a fact about the project, not about who ran the script.
#
# ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────────
# It does not install anything. A project whose node_modules is absent is scored
# with whatever it has, and the oracle's own diagnostic count is printed so a
# degraded run is visible rather than quietly weak.
#
# Usage: run-evaluation.sh <project-dir> <work-dir> [<parser-dist>]
# =============================================================================
set -e
PROJECT="$(cd "$1" && pwd)"
WORK="$2"
PARSER_DIST="${3:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/dist/index.js}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
NAME="$(basename "$PROJECT")"

mkdir -p "$WORK"/{ir,libir,int,out}
echo "▶ project: $PROJECT"

# ── 0. a TypeScript-only MIRROR of the project ───────────────────────────────
# The parser assigns ONE language per project and its detector tries Java first, so
# a repository that also contains .java or .py — this engine's own repository, or any
# polyglot tool — is analysed as that language and emits no TypeScript IR at all
# (observed: "no TypeScript call sites" on two of four projects). Mirroring with the
# other languages' sources filtered out makes detection deterministic.
#
# The ORACLE runs on the mirror too, not on the original. That is not a convenience:
# every position in the comparison is relative to the analysed root, and analysing
# one tree while adjudicating another silently mismatches every row.
MIRROR="$WORK/project"
if [ ! -d "$MIRROR" ]; then
  mkdir -p "$MIRROR"
  rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude 'build' \
        --exclude '*.java' --exclude '*.py' --exclude '*.gradle' --exclude 'pom.xml' \
        --exclude 'build.gradle' --exclude 'settings.gradle' \
        "$PROJECT/" "$MIRROR/" 2>/dev/null || true
fi

# EVERY node_modules up the chain, not the first one. A workspace hoists shared
# dependencies to the repository root while keeping package-local ones beside the
# package — measured on remeda, whose own node_modules has no `typescript` at all
# because the workspace root holds it, so a first-match search staged two modules
# instead of the whole standard library.
NM_ROOTS=""
for cand in "$PROJECT/node_modules" "$PROJECT/../node_modules" "$PROJECT/../../node_modules" \
            "$PROJECT/../../../node_modules"; do
  [ -d "$cand" ] && NM_ROOTS="$NM_ROOTS $(cd "$cand" && pwd)"
done
find_in_nm() { for r in $NM_ROOTS; do [ -e "$r/$1" ] && { echo "$r/$1"; return 0; }; done; return 1; }
# The mirror needs its own node_modules for BOTH the parser's tsconfig `paths`
# resolution and the oracle's module resolution. A symlink to the real one keeps the
# two toolchains looking at identical bytes.
FIRST_NM="$(echo $NM_ROOTS | awk '{print $1}')"
[ -n "$FIRST_NM" ] && [ ! -e "$MIRROR/node_modules" ] && ln -sfn "$FIRST_NM" "$MIRROR/node_modules"

# ── 1. client IR ─────────────────────────────────────────────────────────────
# The node_modules symlink MUST exist before this runs. The parser resolves module
# specifiers with the compiler's own resolver, and without node_modules every
# dependency import comes back UNRESOLVED with an empty packageName — which then
# makes the library-discovery step below find nothing to stage. Measured: staging
# fell from five roots to one, and `console.log` resolved into lib.dom instead of
# @types/node because @types/node was never staged.
echo "▶ extracting client IR..."
node "$PARSER_DIST" "$MIRROR" "$NAME" false "$WORK/ir" >"$WORK/parser.log" 2>&1 || {
  echo "   parser failed; see $WORK/parser.log" >&2; exit 1; }
CS=$(( $(wc -l < "$WORK/ir/all-typescript-call-sites.csv") - 1 ))
MODS=$(( $(wc -l < "$WORK/ir/all-typescript-modules.csv") - 1 ))
echo "   $MODS modules, $CS call sites"
[ "$CS" -gt 0 ] || { echo "   no TypeScript call sites — is this a TypeScript project?" >&2; exit 1; }

# ── 2. library IR, DISCOVERED from the client's own resolved imports ─────────
# Two sources, and the first is not optional: TypeScript's own lib.*.d.ts files
# ARE the global scope. Without them `string`, `Array`, `Promise`, `Map` and
# `console` have no declaration anywhere and the receiver of every call on one is
# untyped.
LIBS=""
# Returns 0 when it staged something, 1 when the directory declared nothing. The
# caller uses that to decide whether to look deeper, because staging BOTH a package
# root and its dist/ duplicates every declaration — and a duplicate is not harmless:
# the engine emits both, the site goes multi_inferred, and the copy the compiler did
# not name is scored as a wrong target. Measured on the Parser repository, staging
# `typescript` and `typescript/lib` as separate roots took WRONG from 115 to 384.
add_lib() { # $1 = source dir, $2 = ir subdir name
  local src="$1" name="$2"
  [ -d "$src" ] || return 1
  [ -d "$WORK/libir/$name" ] && { LIBS="${LIBS:+$LIBS,}$WORK/libir/$name"; return 0; }
  mkdir -p "$WORK/libir/$name"
  node "$PARSER_DIST" "$src" "lib-$name" false "$WORK/libir/$name" >>"$WORK/libir.log" 2>&1 || true
  if [ -s "$WORK/libir/$name/all-typescript-modules.csv" ]; then
    LIBS="${LIBS:+$LIBS,}$WORK/libir/$name"
    echo "   + $name ($(( $(wc -l < "$WORK/libir/$name/all-typescript-modules.csv") - 1 )) modules)"
    return 0
  fi
  rm -rf "$WORK/libir/$name"
  return 1
}

echo "▶ staging libraries..."
TSLIB_DIR="$(find_in_nm typescript/lib || true)"
if [ -n "$TSLIB_DIR" ]; then
  # The global scope. Copied to a flat directory because the parser treats a
  # directory as a project and `typescript/lib` also holds the compiler API, which
  # is a different library with a different reason to be staged.
  mkdir -p "$WORK/tslib-src"
  cp "$TSLIB_DIR"/lib.*.d.ts "$WORK/tslib-src/" 2>/dev/null || true
  add_lib "$WORK/tslib-src" "tslib"
else
  echo "   ! no typescript/lib found — the global scope will be EMPTY and every"
  echo "     call on a string, an array or a promise will be unresolved"
fi

# Every package the client actually resolved an import into — read off the IR, not
# guessed from package.json, so a transitive type-only dependency is included and an
# unused declared one is not.
if [ -n "$NM_ROOTS" ]; then
  awk -F'\t' 'NR>1 && $20!=""{print $20}' "$WORK/ir/all-typescript-imports.csv" | sort -u > "$WORK/packages.txt"
  while IFS= read -r pkg; do
    [ -n "$pkg" ] || continue
    # `typescript` is staged twice below on purpose — lib.*.d.ts as the global scope,
    # typescript.d.ts as the compiler API — and staging the PACKAGE as well would be a
    # third copy of both. A duplicate declaration is scored as a wrong target, so this
    # skip is worth the special case: it took WRONG on the Parser repository from 384
    # back to 115.
    [ "$pkg" = "typescript" ] && continue
    safe="$(printf '%s' "$pkg" | tr '/@' '__')"
    d="$(find_in_nm "@types/$pkg" || true)"; [ -n "$d" ] && add_lib "$d" "types_$safe"
    d="$(find_in_nm "$pkg" || true)"
    if [ -n "$d" ]; then
      add_lib "$d" "$safe"
      # A published package ships its declarations under dist/ or lib/, and the
      # parser's TypeScript detector SKIPS those directory names as build output —
      # correct for a project, wrong for a library. Measured on vitest: the package
      # root yields 21 shim modules and none of the real declarations, so `expect`,
      # `it` and `describe` are unreachable. Staging the declaration directory as its
      # own root is the harness's job, not the parser's; filed as a defect either way.
      # ONLY when the package root itself declares nothing. Staging both the root
      # and dist/ duplicates every declaration, and a duplicate declaration is not
      # harmless: the engine emits both, the site becomes multi_inferred, and the
      # copy the compiler did not name is scored as a wrong target.
      if ! ls "$d"/*.d.ts >/dev/null 2>&1; then
        for sub in dist lib types esm build out; do
          [ -d "$d/$sub" ] && add_lib "$d/$sub" "${safe}_$sub"
        done
      fi
    fi
  done < "$WORK/packages.txt"
  # `typescript` imported as a library (the compiler API) is a separate root from the
  # lib.*.d.ts global scope above.
  if grep -qx 'typescript' "$WORK/packages.txt" 2>/dev/null && [ -n "$TSLIB_DIR" ] && [ -f "$TSLIB_DIR/typescript.d.ts" ]; then
    mkdir -p "$WORK/tsc-src"; cp "$TSLIB_DIR/typescript.d.ts" "$WORK/tsc-src/"
    add_lib "$WORK/tsc-src" "tscompiler"
  fi
fi
[ -n "$LIBS" ] || echo "   (no libraries staged — every library call will be unresolved)"

# ── 3. solve ─────────────────────────────────────────────────────────────────
echo "▶ solving..."
bash "$REPO/src/pipeline/run-souffle.sh" --language typescript \
  --client-ir "$WORK/ir" ${LIBS:+--library "$LIBS"} \
  --intermediate "$WORK/int" --output "$WORK/out" >"$WORK/solve.log" 2>&1 || {
  echo "   solve failed; see $WORK/solve.log" >&2; tail -20 "$WORK/solve.log" >&2; exit 1; }
grep -E '^Elapsed' "$WORK/solve.log" | tail -1

# ── 4. the oracle, and the dispatch envelope ─────────────────────────────────
# Run from inside the project so module resolution sees the project's own
# node_modules rather than the caller's — measured: running from elsewhere resolved
# @types/node to a DIFFERENT copy, and every position in it was a mismatch.
# The oracle needs a `typescript` it can require. The workspace root usually has one
# even when the package does not, so the harness passes the copy it already found.
TS_MOD="$(find_in_nm typescript || true)"
export TS_MODULE_PATH="$TS_MOD"
echo "▶ oracle..."
( cd "$MIRROR" && node "$HERE/ground-truth/tsc-oracle.mjs" . "$WORK/oracle.tsv" ) 2>&1 | tail -1
( cd "$MIRROR" && node --max-old-space-size=6144 "$HERE/ground-truth/tsc-envelope.mjs" . "$WORK/envelope.tsv" ) 2>&1 | tail -1

# ── 5. score ─────────────────────────────────────────────────────────────────
LIBARGS=""
for d in ${LIBS//,/ }; do LIBARGS="$LIBARGS --lib=$d"; done
echo "▶ score:"
MISSED_DUMP="$WORK/missed.tsv" python3 "$HERE/ground-truth/score.py" \
  "$WORK/ir" "$WORK/out" "$WORK/oracle.tsv" --envelope="$WORK/envelope.tsv" $LIBARGS \
  | tee "$WORK/score.txt"
