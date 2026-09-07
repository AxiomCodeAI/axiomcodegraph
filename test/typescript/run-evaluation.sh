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
# $3 wins, then $AXIOM_PARSER, then the conventional checkout. The env var matters: the
# fallback is an absolute path into a SHARED checkout whose dist belongs to whoever built
# it last, so a caller that omits $3 silently measured a different parser than the one it
# was told to use. That is how a fixture came to stage 27-column library IR against
# 28-column declarations while the client IR was current.
PARSER_DIST="${3:-${AXIOM_PARSER:-/Users/swapnilpaliwal/Documents/AxiomCode/Parser/dist/index.js}}"
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
# A PRESENT MIRROR MUST BE A COMPLETE ONE, and rsync's STATUS is not the test.
# Two separate things were wrong here. `mkdir -p` ran before rsync, so the
# `[ ! -d "$MIRROR" ]` fast path was satisfied by a directory rsync had not finished
# filling — a partial mirror was therefore permanent and silent, skipped by every later
# run. That is fixed by building at a temporary path and renaming on success.
#
# But the status is the wrong signal to gate on. rsync exits 23 and 24 for benign
# reasons (a single unreadable or vanished file), so treating non-zero as fatal breaks
# healthy projects; and it would not have caught the case that prompted this, where
# rsync exited **0** having copied nothing because the SOURCE tree had been reaped out
# from under it. `/tmp/ts-corpus` is not durable: measured, all nine corpus projects
# lost every source file mid-session with their directories and node_modules left
# standing.
#
# So the gate is a POSTCONDITION. A mirror containing no TypeScript source is not a
# mirror, whatever rsync said, and failing here names the empty source directory instead
# of surfacing four steps downstream as
#   line 200: .../ir/all-typescript-call-sites.csv: No such file or directory
# Part of #149.
# ── THE EXTENDS CHAIN HAS TO COME WITH IT (#240) ─────────────────────────────
# A workspace package's tsconfig almost always begins `"extends": "../../tsconfig.base.json"`,
# and that file is ABOVE the directory being mirrored. The parser then resolves the chain
# against a file that is not there and falls back to each option's DEFAULT — silently, on
# both sides. Measured on a package whose base sets `strict: true`:
#
#   parser over the real package dir : strictBindCallApply=true
#   parser over the mirror           : strictBindCallApply=false
#
# That option is load-bearing since #160: it decides which of lib.es5's two declarations
# of call/apply/bind the compiler answers with, so a defaulted `false` makes the engine
# commit to Function's where the compiler chose CallableFunction's. Note tsConfigPath is
# SET in both cases, so a guard keyed on "does this module have a governing tsconfig"
# does not catch it — the module has one, it just resolved against a missing base.
#
# So the mirror is rooted deep enough to hold the ancestors at the paths they are
# referenced by. tools/tsconfig_chain.mjs computes that with the compiler's own
# resolution (extends may be an array since TS 5.0, and may be a bare package specifier);
# REL is "." for a single-package project, which keeps the flat mirror unchanged.
MIRROR_BASE="$WORK/project"
if [ ! -d "$MIRROR_BASE" ]; then
  node "$HERE/tools/tsconfig_chain.mjs" --plan "$PROJECT" \
       > "$WORK/mirror-plan.txt" 2>"$WORK/mirror-plan.err" || true
  REL="$(awk -F'\t' '$1=="REL"{print $2}' "$WORK/mirror-plan.txt" 2>/dev/null)"
  [ -n "$REL" ] || REL="."

  MIRROR_TMP="$WORK/.project.partial.$$"
  rm -rf "$MIRROR_TMP"; mkdir -p "$MIRROR_TMP/$REL"
  rs=0
  rsync -a --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude 'build' \
        --exclude '*.java' --exclude '*.py' --exclude '*.gradle' --exclude 'pom.xml' \
        --exclude 'build.gradle' --exclude 'settings.gradle' \
        "$PROJECT/" "$MIRROR_TMP/$REL/" 2>/dev/null || rs=$?

  # Configs only, never a config's directory: they are small JSON files, and copying the
  # directory would drag a sibling package's sources into a mirror meant to hold one.
  copied=0
  while IFS="$(printf '\t')" read -r tag src dest; do
    [ "$tag" = "COPY" ] || continue
    [ -n "$dest" ] || continue
    mkdir -p "$MIRROR_TMP/$(dirname "$dest")"
    cp "$src" "$MIRROR_TMP/$dest" 2>/dev/null && copied=$((copied+1))
  done < "$WORK/mirror-plan.txt"
  [ "$copied" -gt 0 ] && echo "   + mirrored $copied ancestor tsconfig(s); project is at ./$REL"

  # A PRESENT MIRROR MUST BE A COMPLETE ONE, and rsync's STATUS is not the test. It exits
  # 23/24 for benign reasons, and it exited 0 having copied nothing when the corpus had
  # been reaped out from under it. The postcondition is what catches both.
  if [ -z "$(find "$MIRROR_TMP/$REL" \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' \
                                       -o -name '*.cts' \) -print -quit 2>/dev/null)" ]; then
    echo "   ! NO TYPESCRIPT SOURCE mirrored from $PROJECT (rsync exit $rs)" >&2
    echo "     The source tree is empty of .ts/.tsx/.mts/.cts. If the corpus lives under" >&2
    echo "     /tmp it may have been reaped — reclone with test/typescript/corpus/fetch.sh." >&2
    rm -rf "$MIRROR_TMP"
    exit 1
  fi
  printf '%s\n' "$REL" > "$MIRROR_TMP/.mirror-rel"
  mv "$MIRROR_TMP" "$MIRROR_BASE"
fi
# The fast path needs REL too, so it is recorded in the mirror rather than recomputed.
REL="$(cat "$MIRROR_BASE/.mirror-rel" 2>/dev/null)"; [ -n "$REL" ] || REL="."
if [ "$REL" = "." ]; then MIRROR="$MIRROR_BASE"; else MIRROR="$MIRROR_BASE/$REL"; fi

# ── and say so when the chain is STILL broken ────────────────────────────────
# Re-resolved against the MIRROR, which is what the parser will read. An `extends` that
# does not resolve here means a compiler option is about to be defaulted, and every rate
# downstream inherits it. Silent on both sides before this.
if node "$HERE/tools/tsconfig_chain.mjs" "$MIRROR" 2>&1 >/dev/null \
     | grep -q '^UNRESOLVED'; then
  echo "   ! MIRRORED tsconfig has an UNRESOLVED extends — compiler options will be" >&2
  echo "     DEFAULTED, and strictBindCallApply among them (see #240):" >&2
  node "$HERE/tools/tsconfig_chain.mjs" "$MIRROR" 2>&1 >/dev/null \
    | sed 's/^/       /' >&2
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

# ── src_duplicates_staged_subdir(packageDir) — is the root a second copy? ────
# A package that ships its TypeScript SOURCE next to its built declarations gets
# staged twice: the root walk descends into `src/` (which the parser does not skip)
# while `dist/` is staged separately below, so every class in the package is declared
# in two staged roots at once. The engine then has two candidates for one name and,
# under prune-only, commits to neither.
#
# The manifest is the authority on which copy is real: if `types` (or the modern
# `exports["."].types`) points into a directory we stage separately, the root's `src/`
# is by the package's own account not the published surface. Both conditions are
# required — a package whose types live in `src/` must keep its root staged.
#
# This is the general form of the `typescript` special case below, which was the same
# defect found one package at a time.
src_duplicates_staged_subdir() {
  [ -d "$1/src" ] || return 1
  [ -n "$(find "$1/src" -name '*.ts' ! -name '*.d.ts' -print -quit 2>/dev/null)" ] || return 1
  python3 - "$1" <<'PYEOF'
import json, sys, re
try:
    m = json.load(open(sys.argv[1] + '/package.json'))
except Exception:
    sys.exit(1)
t = m.get('types') or m.get('typings') or ''
e = m.get('exports')
if isinstance(e, dict) and isinstance(e.get('.'), dict):
    t = e['.'].get('types') or t
sys.exit(0 if isinstance(t, str) and re.match(r'^(\./)?(dist|build|out)/', t) else 1)
PYEOF
}
# Resolve a package the way NODE does — from the IMPORTER's directory, walking up its
# ancestors and looking in each `node_modules`. NM_ROOTS alone is only correct for a
# FLAT install, where every transitive package is hoisted to the top level.
#
# Under pnpm nothing transitive is hoisted: a direct dependency is a symlink at the top
# level, and everything it depends on exists ONLY inside the store, at
# `.pnpm/<name>@<version>/node_modules/<pkg>`. So a package that discovery correctly
# identified is simply not found on disk, and is silently not staged. Measured on one
# corpus project: the test framework's matcher package was named in the discovery list,
# was present in the store, and never staged — 20,224 unresolved call sites against a
# single declaration file, the largest single loss in the whole corpus.
#
# Walking up from the dependent works because `.pnpm/<dep>@<version>` is an ANCESTOR of
# the dependent's own directory, and its `node_modules` holds exactly that dependent's
# resolved dependencies — one version, no ambiguity, no version guessing across the
# store. `.source-root` is the realpath, so the symlink at the top level has already
# been resolved and the walk starts inside the store.
find_from() {  # $1 = dependent directory, $2 = package name
  # PHYSICAL path, not logical. A pnpm top-level entry is a SYMLINK into the store, and
  # `cd` + `pwd` reports the link path — walking up from there stays outside the store
  # and finds nothing. `pwd -P` resolves it so the walk starts where the real files are.
  d="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  [ -n "$d" ] || return 1
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -e "$d/node_modules/$2" ] && { echo "$d/node_modules/$2"; return 0; }
    d="$(dirname "$d")"
  done
  return 1
}
# The mirror needs its own node_modules for BOTH the parser's tsconfig `paths`
# resolution and the oracle's module resolution. A symlink to the real one keeps the
# two toolchains looking at identical bytes.
# EVERY ROOT, NOT THE FIRST. NM_ROOTS above is the whole chain precisely because a
# workspace hoists shared dependencies to the repository root — and then the mirror was
# given a symlink to the FIRST root only, which is the package-local one. On remeda that
# directory holds 2 entries while the repository root holds 972 including `vitest`, so the
# parser could not resolve `vitest` at all: 833 import rows came back UNRESOLVED with an
# empty packageName, discovery reads packageName and therefore found nothing, and the
# project was analysed with 1 staged package. Every `test(...)` and `expect(...)` call in
# it was unresolvable, and none of that was ever the engine.
#
# One symlink cannot express several roots, so the mirror gets a real directory of
# per-package symlinks, filled NEAREST-FIRST so a package-local copy still shadows a
# hoisted one exactly as Node resolves it. Scoped names get their @scope directory.
if [ -n "$NM_ROOTS" ] && [ ! -e "$MIRROR/node_modules" ]; then
  mkdir -p "$MIRROR/node_modules"
  for root in $NM_ROOTS; do
    for entry in "$root"/*; do
      [ -e "$entry" ] || continue
      base="$(basename "$entry")"
      case "$base" in
        .*) continue;;
        @*)  # a scope directory: link the packages inside it, not the scope itself
          mkdir -p "$MIRROR/node_modules/$base"
          for pkg in "$entry"/*; do
            [ -e "$pkg" ] || continue
            t="$MIRROR/node_modules/$base/$(basename "$pkg")"
            [ -e "$t" ] || ln -sfn "$pkg" "$t"
          done;;
        *)
          t="$MIRROR/node_modules/$base"
          [ -e "$t" ] || ln -sfn "$entry" "$t";;
      esac
    done
  done
fi

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
printf '%s\n' "$MIRROR" > "$WORK/ir/.source-root"
CS=$(( $(wc -l < "$WORK/ir/all-typescript-call-sites.csv") - 1 ))
MODS=$(( $(wc -l < "$WORK/ir/all-typescript-modules.csv") - 1 ))
echo "   $MODS modules, $CS call sites"
[ "$CS" -gt 0 ] || { echo "   no TypeScript call sites — is this a TypeScript project?" >&2; exit 1; }

# ── 1b. SCHEMA DRIFT ────────────────────────────────────────────────────────
# Checked before a single rule runs, because the failure it catches is silent and
# total: a relation declared one column short reads a line number as the unique hash,
# and every join on that key then finds nothing, for every row. Measured twice on this
# repository — a variable table and a parameter table each gained two columns, and each
# cost hundreds of resolutions with no warning anywhere. The malformed-row guard in the
# pipeline cannot see it: rows are consistent with their own HEADER, and the header is
# not what drifted.
python3 "$HERE/tools/schema_drift.py" "$WORK/ir" \
  "$REPO/src/typescript/souffle/decls_base.dl" \
  "$REPO/src/typescript/souffle/decls_all.dl" || {
  echo "   ! refusing to measure against a drifted schema" >&2; exit 1; }

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
# ── ONE IR ROOT PER PROGRAM, NOT PER INVOCATION (#230) ──────────────────────
# The parser's contract is one output directory per PROGRAM (parser#74, closed as "give
# each program its own folder — merging is the consumer's job"), and since parser#78 it
# analyses every program under the root. So a single invocation over a package shipping
# several programs analyses them all and publishes ONE, silently — no module rows for the
# rest and no skipped-files entry either. Reproduced on two sibling packages under one
# root: "Found 2 total project(s)", "TypeScript files analysed: 2", one module row.
#
# TRIGGERED BY PROVEN LOSS, NOT DONE SPECULATIVELY. Enumerating sub-programs
# unconditionally is worse than the bug. One corpus dependency carries 143 nested
# package.json files under `dist/compiled/` — vendored bundled JS with no TypeScript in
# them at all — so a speculative fan-out means 143 parser invocations publishing nothing,
# and staging one package under two roots is not harmless: the engine emits both
# declarations, the site goes multi_inferred, and the copy the compiler did not name
# scores as a wrong target. Measured previously on `typescript` and `typescript/lib`:
# WRONG went from 115 to 384.
#
# So the root is staged first, and the parser's own numbers decide whether to look
# further: it reports how many files it analysed, the IR says how many it published, and
# a shortfall means the difference went nowhere. Only then are sub-programs enumerated.
# For every single-program package this is one invocation, exactly as before.
# Sourced rather than inlined so the fixture can test them directly (see
# fixtures/multi-program/run.sh). A predicate that only runs inside a 20-minute pipeline
# is a predicate nobody checks.
# shellcheck source=tools/lib-staging.sh
. "$HERE/tools/lib-staging.sh"

stage_program() { # $1 = source dir, $2 = ir subdir name -> 0 if staged
  local src="$1" name="$2" plog="$WORK/libir/$2.parser.log"
  mkdir -p "$WORK/libir/$name"
  node "$PARSER_DIST" "$src" "lib-$name" false "$WORK/libir/$name" >"$plog" 2>&1 || true
  cat "$plog" >> "$WORK/libir.log" 2>/dev/null || true
  if [ ! -s "$WORK/libir/$name/all-typescript-modules.csv" ]; then
    rm -rf "$WORK/libir/$name"; return 1
  fi
  # WHERE THIS ROOT CAME FROM. A library IR records file paths RELATIVE to the directory
  # it was extracted from while the oracle reports absolute paths, so without this the
  # only identity both sides can compute is the basename — and a basename is not unique.
  printf '%s\n' "$(cd "$src" && pwd)" > "$WORK/libir/$name/.source-root"
  LIBS="${LIBS:+$LIBS,}$WORK/libir/$name"
  echo "   + $name ($(( $(wc -l < "$WORK/libir/$name/all-typescript-modules.csv") - 1 )) modules)"
  return 0
}

add_lib() { # $1 = source dir, $2 = ir subdir name
  local src="$1" name="$2" rel sub sfx sf analysed published progs extra=0
  [ -d "$src" ] || return 1
  [ -d "$WORK/libir/$name" ] && { LIBS="${LIBS:+$LIBS,}$WORK/libir/$name"; return 0; }
  stage_program "$src" "$name" || return 1

  sf="$(lib_shortfall "$WORK/libir/$name" "$WORK/libir/$name.parser.log")" || return 0
  set -- $sf; analysed="$1"; published="$2"
  [ "$analysed" -gt "$published" ] || return 0

  # A shortfall has two very different causes and they must not be reported as one.
  #
  # SIBLING PROGRAMS — separate packages under one root, each with its own manifest —
  # are genuinely lost, and staging them recovers real declarations. That is #230.
  #
  # A DUAL-FORMAT BUILD is not lost. A package shipping `dist/esm` and `dist/cjs` is two
  # programs holding THE SAME declarations in two module formats, and the parser publishing
  # one of them is correct. Measured on this corpus: the only shortfalls observed were this
  # shape, and the two files were byte-identical — so staging both would put every
  # declaration in twice, send the site multi_inferred, and score the copy the compiler did
  # not name as WRONG. Exactly what staging `typescript` and `typescript/lib` separately
  # did: WRONG 115 -> 384.
  #
  # So the fan-out is keyed on a nested MANIFEST, which the dual-format shape does not have,
  # and a shortfall with no sibling manifest is reported as unexplained rather than acted on.
  progs="$(lib_programs "$src")"
  if [ -z "$progs" ]; then
    echo "     ! analysed $analysed files, published $published — $((analysed - published)) went nowhere"
    echo "       no sibling program manifest; if this package ships dist/esm + dist/cjs that is"
    echo "       EXPECTED — the same declarations twice, and one is the right answer. Unpublished:"
    comm -23 \
      <(find "$src" -name node_modules -prune -o \
             \( -name '*.ts' -o -name '*.tsx' -o -name '*.mts' -o -name '*.cts' \) -print 2>/dev/null \
         | sed "s|^$src/||" | sort) \
      <(awk -F'\t' 'NR>1{print $4}' "$WORK/libir/$name/all-typescript-modules.csv" | sort) \
      2>/dev/null | head -3 | sed 's/^/         /'
    return 0
  fi

  echo "     ! analysed $analysed files, published $published — staging sibling programs (#230)"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    sub="$src/$rel"; sfx="__$(printf '%s' "$rel" | tr '/.' '__')"
    [ -d "$sub" ] || continue
    [ -d "$WORK/libir/$name$sfx" ] && continue
    stage_program "$sub" "$name$sfx" && extra=$((extra+1))
    [ "$extra" -ge 32 ] && { echo "     ! stopped after 32 sibling programs"; break; }
  done <<EOF
$progs
EOF
  return 0
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
  # THE REASON IS KEPT, not discarded. This was `2>/dev/null || true`, so when
  # lib-files.mjs died — on a project pinned to TypeScript 7 it dies immediately,
  # that package shipping no JavaScript compiler API — the run did not stop, it got
  # quietly WORSE: the fallback below stages every lib.*.d.ts, which is the failure
  # this very block exists to avoid. The degraded decision was visible and the cause
  # was not, which is the wrong half to hide. See #239.
  ( cd "$MIRROR" && node "$HERE/ground-truth/lib-files.mjs" . ) \
    > "$WORK/libfiles.txt" 2>"$WORK/libfiles.err" || true
  if [ -s "$WORK/libfiles.txt" ]; then
    while IFS= read -r f; do [ -f "$f" ] && cp "$f" "$WORK/tslib-src/"; done < "$WORK/libfiles.txt"
    echo "   (standard library: $(wc -l < "$WORK/libfiles.txt" | tr -d ' ') lib.*.d.ts files in this program)"
  else
    cp "$TSLIB_DIR"/lib.*.d.ts "$WORK/tslib-src/" 2>/dev/null || true
    echo "   ! could not read the program's lib list; staging ALL lib.*.d.ts, which"
    echo "     will put DOM globals into a Node project"
    if [ -s "$WORK/libfiles.err" ]; then
      echo "     because:"
      sed 's/^/       /' "$WORK/libfiles.err"
    else
      echo "     (lib-files.mjs wrote nothing and said nothing — see $WORK/libfiles.err)"
    fi
  fi
  add_lib "$WORK/tslib-src" "tslib" || true
  # The staged directory is a COPY, so the root add_lib recorded points at the copy while
  # the compiler names the ORIGINAL. Same declaration, two absolute paths, and every
  # standard-library target then fails an exact-path comparison. Point it back at the
  # real one — the copy exists only so the parser sees a flat project.
  [ -d "$WORK/libir/tslib" ] && printf '%s\n' "$(cd "$TSLIB_DIR" && pwd)" > "$WORK/libir/tslib/.source-root"
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
      src_duplicates_staged_subdir "$d" || add_lib "$d" "$safe" || true
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
    [ -d "$WORK/libir/tscompiler" ] && printf '%s\n' "$(cd "$TSLIB_DIR" && pwd)" > "$WORK/libir/tscompiler/.source-root"
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
  # Two sources, not one. A package is reached by IMPORT (`import { x } from "pkg"`,
  # packageName on the import row) or by RE-EXPORT (`export { x } from "pkg"`), and
  # the two are disjoint: vitest's dist barrel says `export { expectTypeOf } from
  # "expect-type"` and never imports it, so an import-only scan leaves expect-type
  # unstaged, the re-export's resolvedSourceModuleLinkHash EMPTY, and every
  # `expectTypeOf(...)` in a test suite unresolvable. Export rows carry no
  # packageName column, so the package is cut off the specifier: `@scope/name/sub`
  # -> `@scope/name`, `name/sub` -> `name`. Relative and `node:` specifiers are not
  # packages. Measured on remeda: 7 of 29 unresolved re-export specifiers name a
  # package that is on disk, is a declared dependency, and was never staged.
  # PER STAGED LIBRARY, not over the concatenation. Which library named a package is
  # not bookkeeping — it is the only thing that says WHERE to resolve it from. Reading
  # every library's rows into one list throws that away, and under a non-flat install
  # the package then cannot be found at all.
  : > "$WORK/lib-packages.txt"
  for ldir in "$WORK"/libir/*/; do
    [ -d "$ldir" ] || continue
    from="$(cat "$ldir/.source-root" 2>/dev/null)"
    { awk -F'\t' '$20!="" && $20!="packageName"{print $20}' "$ldir/all-typescript-imports.csv" 2>/dev/null
      awk -F'\t' '$7!="" && $7!="sourceSpecifier" && substr($7,1,1)!="." && substr($7,1,5)!="node:" {
            n=split($7,a,"/")
            if (substr($7,1,1)=="@") { if (n>=2) print a[1]"/"a[2] }
            else print a[1]
          }' "$ldir/all-typescript-exports.csv" 2>/dev/null
    } | sort -u | while IFS= read -r pkg; do
      [ -n "$pkg" ] || continue
      [ "$pkg" = "typescript" ] && continue
      printf '%s\t%s\n' "$pkg" "$from"
    done >> "$WORK/lib-packages.txt"
  done

  # One line per (package, resolve-from) pair, deduped. A package named by two
  # libraries is resolved from the first that can see it, which under pnpm is the one
  # that actually depends on it.
  # Redirect, never a pipe: `add_lib` appends to LIBS, and a pipeline would run the
  # loop in a subshell where every staged library is discarded on exit.
  sort -u "$WORK/lib-packages.txt" > "$WORK/lib-packages.sorted"
  while IFS="$(printf '\t')" read -r pkg from; do
    [ -n "$pkg" ] || continue
    safe="$(printf '%s' "$pkg" | tr '/@' '__')"
    [ -d "$WORK/libir/$safe" ] && continue
    # The importer's own directory first (correct under any layout), then the
    # project-level roots as the flat-install fallback.
    d=""
    [ -n "$from" ] && d="$(find_from "$from" "@types/$pkg" || true)"
    [ -z "$d" ] && d="$(find_in_nm "@types/$pkg" || true)"
    [ -n "$d" ] && { add_lib "$d" "types_$safe" || true; }
    d=""
    [ -n "$from" ] && d="$(find_from "$from" "$pkg" || true)"
    [ -z "$d" ] && d="$(find_in_nm "$pkg" || true)"
    if [ -n "$d" ]; then
      src_duplicates_staged_subdir "$d" || add_lib "$d" "$safe" || true
      for sub in dist build out; do
        [ -d "$d/$sub" ] && { add_lib "$d/$sub" "${safe}_$sub" || true; }
      done
      true
    fi
  done < "$WORK/lib-packages.sorted"
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
# The roots the PARSER used, read straight off the IR. The oracle and envelope emit each
# file relative to the longest of these, so their paths are the same strings the scorer
# sees on the IR side. Without it a workspace repository joined ZERO sites.
ROOTS_FILE="$WORK/parser-project-roots.txt"
awk -F'\t' 'NR>1 && $5!=""{print $5}' "$WORK/ir/all-typescript-modules.csv" 2>/dev/null \
  | sort -u > "$ROOTS_FILE" || true
export PARSER_PROJECT_ROOTS="$ROOTS_FILE"
if [ -s "$ROOTS_FILE" ]; then
  echo "   (parser project roots: $(wc -l < "$ROOTS_FILE" | tr -d ' '))"
fi

echo "▶ oracle..."
# THE ORACLE IS NOT OPTIONAL. Piping it to `tail -1` used to discard its exit status:
# on a project whose tsconfig the oracle could not find, it printed one line, wrote no
# file, `score.py` then died on the missing oracle with a traceback — and the harness
# still exited 0. Two corpus projects (monorepos, whose tsconfig lives under a workspace
# package rather than at the root) reported success while contributing NOTHING, so any
# average taken across the corpus was silently computed over the projects that happened
# to work.
#
# A missing measurement must never read as a passing one. Exit non-zero, loudly, and
# say which of the two it was: the oracle failing, or the oracle succeeding with nothing
# in it.
if ! ( cd "$MIRROR" && node "$HERE/ground-truth/tsc-oracle.mjs" . "$WORK/oracle.tsv" ) > "$WORK/oracle.log" 2>&1; then
  echo "   ! THE ORACLE FAILED. There is no ground truth for this project, so no number"
  echo "     printed below would be a measurement of anything. Last lines:"
  tail -3 "$WORK/oracle.log" | sed 's/^/       /'
  exit 3
fi
tail -1 "$WORK/oracle.log" 2>/dev/null
if [ "$(wc -l < "$WORK/oracle.tsv" 2>/dev/null || echo 0)" -lt 2 ]; then
  echo "   ! THE ORACLE PRODUCED NO ROWS. It found a tsconfig and typechecked, but"
  echo "     resolved zero call sites — an empty ground truth scores every engine answer"
  echo "     as an extra and every gap as nothing. Refusing to report it as a result."
  exit 3
fi

# The envelope is a SECONDARY measurement (the CHA/RTA bound), and score.py runs without
# it. Report a failure rather than aborting on one.
if ! ( cd "$MIRROR" && node --max-old-space-size=6144 "$HERE/ground-truth/tsc-envelope.mjs" . "$WORK/envelope.tsv" ) > "$WORK/envelope.log" 2>&1; then
  echo "   ! the envelope failed; dispatch bounds will be absent from the score"
  tail -2 "$WORK/envelope.log" | sed 's/^/       /'
else
  tail -1 "$WORK/envelope.log" 2>/dev/null
fi

# ── 5. score ─────────────────────────────────────────────────────────────────
LIBARGS=""
for d in ${LIBS//,/ }; do LIBARGS="$LIBARGS --lib=$d"; done
echo "▶ score:"
# `| tee` makes the pipeline's status tee's, which is how a failing ORACLE went unnoticed
# for as long as it did. score.py exits non-zero when it refuses to report (the two sides
# are not describing the same program), so that status has to survive the pipe.
# SCORE_PRODUCTION=1 restricts BOTH SIDES to production code — no test, spec, docs or
# example paths. Opt-in rather than default so an existing caller's numbers do not
# change meaning underneath it, but it is what the corpus runner sets: a repository's
# test tree is routinely larger than the library it tests, and an unfiltered rate is
# then mostly a statement about fixtures.
MISSED_DUMP="$WORK/missed.tsv" SITE_DUMP="$WORK/sites.tsv" python3 "$HERE/ground-truth/score.py" \
  "$WORK/ir" "$WORK/out" "$WORK/oracle.tsv" --envelope="$WORK/envelope.tsv" $LIBARGS \
  ${SCORE_PRODUCTION:+--production} \
  | tee "$WORK/score.txt"
score_rc=${PIPESTATUS[0]}
if [ "$score_rc" -ne 0 ]; then
  echo "   ! scoring refused (exit $score_rc); this run is NOT a measurement"
  exit "$score_rc"
fi

# ── 5b. CONSERVATION, loudly ────────────────────────────────────────────────
# A shortfall here invalidates every rate above it, so it is repeated after the score
# rather than left to be spotted in the header. Measured cause on this corpus: a
# MONOREPO ROOT whose tsconfig lists directories in `include` — the compiler expands
# them, project discovery does not, and the run then scores a few hundred sites out of
# tens of thousands while reporting a perfectly plausible accuracy.
if grep -q '^CONSERVATION LOSS' "$WORK/score.txt" 2>/dev/null; then
  echo "   ⚠ $(grep '^CONSERVATION LOSS' "$WORK/score.txt")"
  echo "     if this project is a monorepo, point the harness at the PACKAGE, not the root"
fi

# ── 6. chains, and the client/library boundary ───────────────────────────────
# score.py adjudicates one site against one declaration and is structurally blind to
# two things: whether the edges still join end to end into a chain, and whether the
# engine's client/library split agrees with the compiler's. Both need the CALLER of each
# site, which the oracle now emits.
echo "▶ chains:"
python3 "$HERE/ground-truth/chain-check.py" \
  "$WORK/ir" "$WORK/out" "$WORK/oracle.tsv" $LIBARGS | tee "$WORK/chains.txt"
