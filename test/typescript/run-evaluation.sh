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
TS_MOD="$(find_in_nm typescript || true)"
export TS_MODULE_PATH="$TS_MOD"
TSLIB_DIR="$(find_in_nm typescript/lib || true)"
if [ -n "$TSLIB_DIR" ]; then
  # The global scope. Copied to a flat directory because the parser treats a
  # directory as a project and `typescript/lib` also holds the compiler API, which
  # is a different library with a different reason to be staged.
  mkdir -p "$WORK/tslib-src"
  # ONLY the lib files this project's program actually loads. `target` and `lib` in the
  # tsconfig decide which of the ~110 shipped declaration files are in scope, and
  # staging all of them puts DOM globals into a Node program: `console.log` then
  # resolves to the DOM's Console rather than @types/node's. The compiler already
  # decided; lib-files.mjs reads its answer back.
  ( cd "$MIRROR" && node "$HERE/ground-truth/lib-files.mjs" . ) > "$WORK/libfiles.txt" 2>/dev/null || true
  if [ -s "$WORK/libfiles.txt" ]; then
    while IFS= read -r f; do [ -f "$f" ] && cp "$f" "$WORK/tslib-src/"; done < "$WORK/libfiles.txt"
    echo "   (standard library: $(wc -l < "$WORK/libfiles.txt" | tr -d ' ') lib.*.d.ts files in this program)"
  else
    cp "$TSLIB_DIR"/lib.*.d.ts "$WORK/tslib-src/" 2>/dev/null || true
    echo "   ! could not read the program's lib list; staging ALL lib.*.d.ts, which"
    echo "     will put DOM globals into a Node project"
  fi
  add_lib "$WORK/tslib-src" "tslib" || true
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
      add_lib "$d" "$safe" || true
      # A published package keeps its real declarations in a directory the parser
      # SKIPS BY NAME — `dist`, `build` and `out` are in TS_SKIP_DIRECTORIES. So the
      # package root and those directories can never overlap, and BOTH must be staged:
      # the root holds the shims (vitest ships an `index.d.ts` that re-exports
      # `./dist/index.js`) and dist holds the declarations the shim points at.
      # Measured: staging only the root gave vitest 20 shim modules and no `expect`,
      # `it` or `describe` at all — 1,637 unresolved sites on zustand.
      #
      # Directories the parser does NOT skip (`lib`, `types`, `esm`) are deliberately
      # absent here: the root staging already walked into them, and a second copy of a
      # declaration is scored as a wrong target rather than being harmless.
      for sub in dist build out; do
        [ -d "$d/$sub" ] && { add_lib "$d/$sub" "${safe}_$sub" || true; }
      done
      true
    fi
  done < "$WORK/packages.txt"
  # @types/node is reached by AMBIENT SPECIFIER (`import * as fs from "fs"`), and a
  # builtin import carries no packageName at all — so the loop above never discovers
  # it. Node builtins are the most-called library in any server-side project, so this
  # is not a corner: on the Parser repository the whole `fs`/`path` surface was
  # missing until this was added.
  if grep -q 'BUILTIN_NODE' "$WORK/ir/all-typescript-imports.csv" 2>/dev/null; then
    d="$(find_in_nm "@types/node" || true)"; [ -n "$d" ] && { add_lib "$d" "types_node" || true; }
  fi

  # `typescript` imported as a library (the compiler API) is a separate root from the
  # lib.*.d.ts global scope above.
  if grep -qx 'typescript' "$WORK/packages.txt" 2>/dev/null && [ -n "$TSLIB_DIR" ] && [ -f "$TSLIB_DIR/typescript.d.ts" ]; then
    mkdir -p "$WORK/tsc-src"; cp "$TSLIB_DIR/typescript.d.ts" "$WORK/tsc-src/"
    add_lib "$WORK/tsc-src" "tscompiler"
  fi
fi
# ── 2b. the libraries' OWN dependencies, one transitive round ────────────────
# A modern package presents itself by re-exporting its siblings: vitest's barrel is
# `export * from "@vitest/runner"` and friends, so `it` and `describe` are not in
# vitest at all. The client never imports @vitest/runner, so the client-driven
# discovery above cannot find it, and the barrel exports almost nothing.
#
# One round, not a closure. Two would pull in the whole dependency tree for a
# diminishing return, and the point of staging is to answer client call sites — a
# dependency three hops from anything the client names is not going to.
if [ -n "$NM_ROOTS" ]; then
  echo "▶ staging the libraries' own dependencies (one round)..."
  cat "$WORK"/libir/*/all-typescript-imports.csv 2>/dev/null \
    | awk -F'\t' '$20!="" && $20!="packageName"{print $20}' | sort -u > "$WORK/lib-packages.txt"
  while IFS= read -r pkg; do
    [ -n "$pkg" ] || continue
    [ "$pkg" = "typescript" ] && continue
    safe="$(printf '%s' "$pkg" | tr '/@' '__')"
    [ -d "$WORK/libir/$safe" ] && continue
    d="$(find_in_nm "@types/$pkg" || true)"; [ -n "$d" ] && { add_lib "$d" "types_$safe" || true; }
    d="$(find_in_nm "$pkg" || true)"
    if [ -n "$d" ]; then
      add_lib "$d" "$safe" || true
      for sub in dist build out; do
        [ -d "$d/$sub" ] && { add_lib "$d/$sub" "${safe}_$sub" || true; }
      done
      true
    fi
  done < "$WORK/lib-packages.txt"
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

# ── 6. chains, and the client/library boundary ───────────────────────────────
# score.py adjudicates one site against one declaration and is structurally blind to
# two things: whether the edges still join end to end into a chain, and whether the
# engine's client/library split agrees with the compiler's. Both need the CALLER of each
# site, which the oracle now emits.
echo "▶ chains:"
python3 "$HERE/ground-truth/chain-check.py" \
  "$WORK/ir" "$WORK/out" "$WORK/oracle.tsv" $LIBARGS | tee "$WORK/chains.txt"
