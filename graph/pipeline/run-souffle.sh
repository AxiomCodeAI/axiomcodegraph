#!/bin/bash
# Souffle executor — TEMPLATE-DRIVEN: the relation->CSV import map is parsed from
# client-ir.map / lib.map (single source of truth). Lib is auto-scoped
# to only the signature relations the rules reference (never loads GB-scale bodies).
# Usage: run-souffle.sh --client-ir DIR --library DIR --intermediate DIR --output DIR [--language L] [--debug]
#
# OUTPUT LAYOUT — the same in every language (graph/bundle/SCHEMA.md):
#   $OUT/graph.sqlite   the contract: core tables + ext_* tables + the schema catalog
#   $OUT/csv/*.csv      the same core tables as headered text — ONLY with --debug
#                       (or when node has no node:sqlite, so a run always emits something)
#   $OUT/raw/           the per-language Soufflé relations, verbatim — engine-internal;
#                       kept ONLY with --debug (the regression suites score it)
# Soufflé solves into raw/; the bundle stage (graph/bundle/cli.ts) then joins the raw
# relations to the parser IR and writes the database. Without --debug the raw relations are
# deleted once the database is written, so a consumer sees one file: graph.sqlite.
set -e
DEBUG_BUNDLE="${AXIOM_DEBUG:-0}"
JDK_DEPTH=1   # max JDK-hop depth engine-ii expands. FORCED (always applied). Default 1: sinks are
              # known JDK methods (the cwe catalog), so external code reaches a file-op sink at JDK
              # hop 1; deeper JDK expansion only traces internal plumbing (the explosion source).
LIB_DEPTH=""  # max external-lib-hop depth. OPTIONAL — empty = UNCAPPED (dive deep into the client's
              # real deps, no sink catalog there). Set with --lib-depth to bound a runaway library.
DISPATCH_CAP="${DISPATCH_CAP:-20}"   # fan-width cap on virtual dispatch. DEFAULT 20 (measured):
              # on cassandra 6.0-alpha2 it lifts change-impact precision d2 0.782->0.920 and
              # d3 0.569->0.753 at ZERO recall cost against the must-have bytecode set (recall
              # 1.000/0.996/0.988 unchanged), and halves fabricated false positives. Cap 10 is
              # indistinguishable (same d2, +0.006 d3) because after the receiver-subtype gate only
              # 966 of 103k sites still fan wider than 20.
              # TURN IT OFF (--dispatch-cap off) for UNBOUNDED reachability — sink/taint traversal —
              # where a sink behind a wide dispatch would be dropped: entry_reachable falls 21.5%
              # (32,229 -> 25,288) under the cap. Bounded-depth impact queries are unaffected.
LANG_ARG=""   # which rule set under graph/<lang>/ to run. Default java.
TAINT=""      # --taint on → gate lib→lib GROW on client-seeded data flow (dataflow/taint.dl). Also
              # settable via env AXIOM_TAINT_GATING=on. Empty = ungated (default behavior).
while [ $# -gt 0 ]; do case "$1" in
  --client-ir) CLIENT="$2"; shift 2;; --library) LIB="$2"; shift 2;;
  --intermediate) INT="$2"; shift 2;; --output) OUT="$2"; shift 2;;
  --jdk-depth) JDK_DEPTH="$2"; shift 2;;
  --dispatch-cap) DISPATCH_CAP="$2"; shift 2;;
  --lib-depth) LIB_DEPTH="$2"; shift 2;;
  --taint) TAINT="$2"; shift 2;;
  --language) LANG_ARG="$2"; shift 2;;
  # graph.sqlite is the deliverable; csv/*.csv is a debugging view of the same core
  # tables. --debug asks for both. (An older Node with no node:sqlite writes the CSVs
  # regardless, because otherwise the run would produce no consumer-facing output.)
  --debug) DEBUG_BUNDLE=1; shift;;
  # (AXIOM_DEBUG=1 in the environment is the same as --debug — for harnesses that cannot
  # change the invocation.)
  *) shift;; esac; done
SRC="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=portable-stat.sh
. "$SRC/pipeline/portable-stat.sh"
# Rules are PER-LANGUAGE and live under graph/<lang>/; the executor itself is shared.
LANG_ARG="${LANG_ARG:-java}"
ENG="$SRC/$LANG_ARG/engine"; ENG2="$SRC/$LANG_ARG/engine-ii"; DL="$SRC/$LANG_ARG/souffle"; TPL="$SRC/$LANG_ARG/templates"
[ -d "$ENG" ] || { echo "no rule set for --language=$LANG_ARG (looked in $ENG)" >&2; exit 1; }
# shellcheck source=souffle-include.sh
. "$SRC/pipeline/souffle-include.sh"
INNER="$(find_souffle_include)"
# Assert the HEADER, not the directory: `[ -d ]` is the test #216 established cannot tell the two
# install layouts apart, so it would pass a path that then fails at the compiler.
if [ -z "$INNER" ] || [ ! -f "$INNER/souffle/CompiledSouffle.h" ]; then
  echo "❌ soufflé headers not found. Install soufflé, or set AXIOM_SOUFFLE_INCLUDE." >&2
  echo "   macOS: brew install souffle     Debian/Ubuntu: apt-get install souffle" >&2
  exit 1
fi
FACTS="$INT/souffle-facts"; rm -rf "$FACTS"; mkdir -p "$FACTS" "$OUT"
# raw/ is OWNED: wiped per run so a relation that left the manifest cannot linger from an
# earlier run and be mistaken for this one's output.
RAW="$OUT/raw"; rm -rf "$RAW"; mkdir -p "$RAW"
# Shared, machine-scoped cache root. Holds BOTH project-independent artefacts: the
# compiled engine binary, and the staged library signature facts. Default in-repo so a
# checkout is self-contained (.souffle-cache/ is gitignored); point AXIOM_SOUFFLE_CACHE
# at a shared dir to amortise it across clones.
CACHE_ROOT="${AXIOM_SOUFFLE_CACHE:-$SRC/../.souffle-cache}"; mkdir -p "$CACHE_ROOT"
START_EPOCH=$(date +%s); START_TS=$(date '+%Y-%m-%d %H:%M:%S')

# read an import map (relation<TAB>csv-basename per line), skipping comments (#) and blanks
read_map(){ grep -vE '^[[:space:]]*(#|$)' "$1"; }

# Library roots: --library is a comma-separated list of IR roots (each with jdk-style
# module sub-folders, or a flat IR dir). The caller (TS) controls which folders/libraries
# are loaded; staging concatenates each relation across every module of every root.
IFS=',' read -ra LIB_ROOTS <<< "$LIB"
# lib_modules ROOT -> the module dirs to stage from (the root itself if it holds the IR,
# else its immediate sub-folders — mirrors how the JDK ships sharded modules).
# Staging config is PER-LANGUAGE (IR marker + which relations are signatures vs bodies).
# Keeping it here would hardcode Java's entity set into a shared executor.
[ -f "$TPL/staging.conf" ] || { echo "missing $TPL/staging.conf for --language=$LANG_ARG" >&2; exit 1; }
. "$TPL/staging.conf"

lib_modules(){ if [ -f "$1/$IR_MARKER" ]; then printf '%s\n' "$1"; else for m in "$1"/*/; do [ -d "$m" ] && printf '%s\n' "${m%/}"; done; fi; }

# --- CLIENT: stage EVERY mapped relation, empty when the project has no such file ---
# ALWAYS creating the .facts file (even empty) is what makes the compiled binary
# REUSABLE ACROSS PROJECTS. The program text embeds one .input line per staged
# relation, and the cache key is a hash of that text — so if a project with no XML
# skipped java_xml_element, its program differed from one that has XML and it paid a
# full ~70s C++ recompile. That is per-INPUT-SHAPE, not per-project: the 26-case Java
# suite was falling into many shapes and recompiling for each (132 binaries had
# accumulated in the cache), which is why a suite of tiny projects took ~20 minutes
# to run and ~2 minutes to actually solve.
# An empty relation is semantically identical to an absent one — every rule reading it
# simply derives nothing — so this costs nothing but an empty file per relation.
# (The same trick is already used for LIB_BODY below; this just applies it uniformly.)
CLIENT_INPUTS=""
while IFS=$'\t' read -r rel csv; do
  # A TORN ROW MUST NOT KILL THE WHOLE EVALUATION. Souffle rejects an entire fact file for
  # one malformed line, so a single row cut mid-write — which has been observed repeatedly,
  # deterministically on some inputs — takes down a run of tens of thousands of sites. The
  # header's field count is the contract; a row that does not meet it is dropped and
  # COUNTED, so the loss is visible rather than fatal and never silent.
  if [ -f "$CLIENT/$csv.csv" ]; then awk -F'\t' 'NR==1{n=NF; next} NF==n{print; next} {bad++} END{if(bad>0) printf "  ! dropped %d malformed row(s) from %s\n", bad, FILENAME > "/dev/stderr"}'  "$CLIENT/$csv.csv" > "$FACTS/$rel.facts"
  else : > "$FACTS/$rel.facts"; fi
  CLIENT_INPUTS="$CLIENT_INPUTS$rel"$'\n'
done < <(read_map "$TPL/client-ir.map")

# --- LIB: signature relations, concatenated across every module of every root ---
# CACHED. This concatenation reads the ENTIRE library IR (the JDK alone is 2.0 GB in,
# 456 MB out) and its result depends ONLY on the library roots and the LIB_SIG list —
# never on the client project. Redoing it per run cost 12s of the 19s a five-file test
# project took, i.e. most of the wall time of the whole Java suite was re-copying the
# same unchanged JDK facts 26 times.
# Keyed on the roots plus each module's size+mtime, so a rebuilt or swapped library IR
# misses the cache and re-stages. Built into a .tmp and renamed atomically, so a
# concurrent or aborted run never leaves a half-written set (same discipline as the
# compiled-binary cache below). Files are SYMLINKED into $FACTS: souffle opens them by
# name, and linking keeps the per-run facts dir cheap instead of copying 456 MB again.
LIB_SIG_RELS=""
while IFS=$'\t' read -r rel csv; do
  case " $LIB_SIG " in *" ${rel#lib_} "*) ;; *) continue;; esac
  LIB_SIG_RELS="$LIB_SIG_RELS$rel:$csv"$'\n'
done < <(read_map "$TPL/lib.map")

lib_cache_key(){
  { printf '%s\n' "$LIB" "$LIB_SIG"
    for root in "${LIB_ROOTS[@]}"; do
      while IFS= read -r mod; do
        # The module PATH is part of the key on its own. Metadata can come back empty for reasons
        # that have nothing to do with the library's content, and when it does the key must still
        # change if a module was added or removed — otherwise two different libraries hash alike.
        printf '%s\n' "$mod"
        # -L BECAUSE A MODULE IS ROUTINELY A SYMLINK. find does not descend a symlinked operand
        # without it, and a library root assembled from links — which is how the torture harness
        # stages the stub plus one entry per platform module — then contributed NO file metadata at
        # all. The key collapsed to ($LIB, $LIB_SIG), so the stub-only library and the
        # stub-plus-63-platform-module library at the same path hashed identically and one run was
        # served the other's staged facts. Reproduced on macOS, so it is not the `stat` portability
        # problem: `find dir_symlink -name '*.csv'` simply prints nothing.
        # size+mtime of each module's CSVs — cheap, and changes whenever the IR does.
        # file_ident, NOT `stat -f ... || stat -c ...`: see graph/pipeline/portable-stat.sh. On GNU
        # coreutils `-f` is --file-system, so the BSD form printed a FILESYSTEM report — free-block
        # and inode counters — for each file, and the fallback was unreachable here anyway because
        # find exits 0 whether or not the command it exec'd failed. The key was therefore computed
        # from free space: it did not move when the IR was rebuilt, and it did move when an
        # unrelated file was written elsewhere on the disk.
        find -L "$mod" -maxdepth 1 -name '*.csv' -exec stat "$_STAT_IDENT" {} + 2>/dev/null
      done < <(lib_modules "$root")
    done
  } | sort | sha1_stdin
}
LIBKEY="$(lib_cache_key)"
# CHECK the key rather than trust it: a malformed key collapses distinct libraries onto one cache
# entry, and nothing downstream can detect that — the solve succeeds and the counts look plausible.
case "$LIBKEY" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) echo "library cache key is not a digest (got '$LIBKEY') — refusing to reuse staged facts" >&2
     exit 1;;
esac
LIBDIR="$CACHE_ROOT/libfacts-$LIBKEY"
if [ ! -d "$LIBDIR" ]; then
  echo "▶ staging library signatures (cache miss — this is the 2GB read, done once)..."
  TMPDIR_L="$LIBDIR.tmp.$$"; rm -rf "$TMPDIR_L"; mkdir -p "$TMPDIR_L"
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    rel="${pair%%:*}"; csv="${pair#*:}"
    : > "$TMPDIR_L/$rel.facts"
    for root in "${LIB_ROOTS[@]}"; do
      while IFS= read -r mod; do
        [ -f "$mod/$csv.csv" ] && awk -F'\t' 'NR==1{n=NF; next} NF==n{print; next} {bad++} END{if(bad>0) printf "  ! dropped %d malformed row(s) from %s\n", bad, FILENAME > "/dev/stderr"}'  "$mod/$csv.csv" >> "$TMPDIR_L/$rel.facts"
      done < <(lib_modules "$root")
    done
  done < <(printf '%s' "$LIB_SIG_RELS")
  mv -f "$TMPDIR_L" "$LIBDIR" 2>/dev/null || rm -rf "$TMPDIR_L"
else echo "▶ reusing staged library signatures"; fi

LIB_INPUTS=""
while IFS= read -r pair; do
  [ -n "$pair" ] || continue
  rel="${pair%%:*}"
  if [ -f "$LIBDIR/$rel.facts" ]; then ln -sf "$LIBDIR/$rel.facts" "$FACTS/$rel.facts"
  else : > "$FACTS/$rel.facts"; fi
  LIB_INPUTS="$LIB_INPUTS$rel"$'\n'
done < <(printf '%s' "$LIB_SIG_RELS")
echo "▶ staged $(ls "$FACTS" | wc -l | tr -d ' ') relations (client + full lib signatures from ${#LIB_ROOTS[@]} library root(s))"

# Empty body facts up front so the compiled program has their .input directives; the stage↔solve
# loop fills them per iteration (scoped to the frontier).
for r in $LIB_BODY; do : > "$FACTS/$r.facts"; done

# JDK depth cap — an input fact (NOT a compiled constant), so sweeping it costs no recompile
# (the cache hash covers the program text, not the facts content).
# jdk_max_depth — FORCED input: always written, so the JDK cap is always in effect.
printf '%s\n' "$JDK_DEPTH" > "$FACTS/jdk_max_depth.facts"
# lib_max_depth — OPTIONAL input: the .facts file must EXIST (so its .input directive is generated
# and the program is stable), but it is EMPTY unless --lib-depth was passed → empty relation →
# !lib_capped() → libs expand uncapped. A value here switches on the lib cap.
: > "$FACTS/lib_max_depth.facts"
[ -n "$LIB_DEPTH" ] && printf '%s\n' "$LIB_DEPTH" > "$FACTS/lib_max_depth.facts"
echo "▶ JDK depth cap = $JDK_DEPTH (forced) · lib depth cap = ${LIB_DEPTH:-uncapped}"

# taint_gating — lib→lib expansion is UNGATED by default (sound/complete; taint filters the OUTPUT,
# not the search — see call-edge-generation/calls.dl). The file always exists so its .input directive
# is generated; EMPTY = ungated (the normal case). Opting in with --taint on / env AXIOM_TAINT_GATING=on
# writes "on" → aggressive taint-gated expansion (faster/smaller but RECALL-RISKY; triage only).
: > "$FACTS/taint_gating.facts"
if [ "${TAINT:-${AXIOM_TAINT_GATING:-}}" = "on" ]; then printf 'on\n' > "$FACTS/taint_gating.facts"; fi
echo "▶ taint gating = $( [ -s "$FACTS/taint_gating.facts" ] && echo 'on (opt-in — recall-risky triage)' || echo 'off (default — sound, taint filters output only)' )"

# dispatch_cap — fan-width cap on virtual dispatch (resolution/virtual-dispatch.dl). EMPTY = no cap
# (sound default). Setting --dispatch-cap K / env AXIOM_DISPATCH_CAP=K blocks any dispatch whose
# instantiated-override set is wider than K — defuses the RTA fan-out explosion on large projects
# (sink dispatch is narrow, ≤4 measured; the blow-up is wide fans over ubiquitous methods).
# RECALL-RISKY (a sink behind a >K dispatch is dropped) → opt-in.
: > "$FACTS/dispatch_cap.facts"
CAP_EFF="${AXIOM_DISPATCH_CAP:-$DISPATCH_CAP}"
case "$CAP_EFF" in off|none|no|0|"") CAP_EFF="";; esac
[ -n "$CAP_EFF" ] && printf '%s\n' "$CAP_EFF" > "$FACTS/dispatch_cap.facts"
echo "▶ dispatch cap = $( [ -s "$FACTS/dispatch_cap.facts" ] && echo "$(cat "$FACTS/dispatch_cap.facts") (default; --dispatch-cap off for unbounded reachability)" || echo 'OFF — uncapped/sound (sink & taint traversal)' )"

# engine-ii (lib-frontier forward-chain) is GATED — default OFF so the build is CLIENT-ONLY
# (engine-i) while client-side dispatch precision is stabilized. engine-ii is preserved in the tree
# (and backed up on ~/Desktop) but excluded from the compiled program; re-enable with
# --engine-ii on / AXIOM_ENGINE_II=on. engine/ produces client_calls_lib etc. independently, so
# client-only is a complete, valid solve on its own.
ENGINE_II_MODE="${ENGINE_II:-${AXIOM_ENGINE_II:-off}}"
echo "▶ engine-ii = $( [ "$ENGINE_II_MODE" = "on" ] && echo 'ON (lib frontier included)' || echo 'OFF (client-only — engine-i)' )"

# --- generate combined program ---
PROG="$INT/souffle-program.dl"
{
  echo "#include \"$DL/decls_base.dl\""; echo "#include \"$DL/decls_all.dl\""
  # rfc4180=true: the IR is CSV, not TSV. The parser quotes any field containing a
  # quote, tab or newline and doubles the inner quotes, so reading it as plain TSV hands
  # the rules the ESCAPED text. It only bites where a JOINED column contains a quote --
  # which is why it went unnoticed -- but a string forward reference (`-> "Factory"`)
  # lands squarely on one, and a field carrying a tab would shift every column after it.
  # Souffle parses RFC4180 itself, so this costs one flag rather than a re-encode of
  # GB-scale input.
  for ff in "$FACTS"/*.facts; do r=$(basename "$ff" .facts); printf '.input %s(IO=file, filename="%s.facts", delimiter="\\t", rfc4180=true)\n' "$r" "$r"; done
  for d in projections containment resolution config-resolution expression-resolution call-edge-generation; do
    # [ -f ] guard: a phase directory that is empty (or absent for a language that has
    # not implemented that layer yet) leaves the glob unexpanded, and souffle's C
    # preprocessor then fails on a literal '*.dl' include.
    for f in "$ENG/$d/"*.dl; do [ -f "$f" ] && echo "#include \"$f\""; done
  done
  # engine-ii: the first→third forward-chain engine (mirrors engine/, lib-seeded). Same solve,
  # included AFTER engine/ so it reads engine/'s relations (client_calls_lib seed). Glob its
  # phase subfolders (both nesting levels; globs are space-safe, the repo path has spaces).
  # export/ is doc-only (like engine/export) — skip it.
  if [ "$ENGINE_II_MODE" = "on" ]; then
  for f in "$ENG2/"*/*.dl "$ENG2/"*/*/*.dl; do
    case "$f" in */export/*) continue;; esac
    [ -f "$f" ] && echo "#include \"$f\""
  done
  fi
  # Relative output filenames — the -D at run time supplies the directory. Keeping $OUT out
  # of the program makes the compiled binary independent of the output path (better reuse).
  while IFS=$'\t' read -r pred file; do [ -n "$pred" ] && printf '.output %s(IO=file, filename="%s", delimiter="\\t")\n' "$pred" "$file"; done < <(sort -u "$DL/export_manifest.tsv")
} > "$PROG"

# --- compile once into a PERSISTENT, content-addressed cache (survives inter/ deletion) ---
# What we cache is OUR engine compiled to a native binary (souffle -g turns the .dl rules
# into C++, c++ compiles it) — NOT the souffle tool. It depends only on the engine (rules +
# decls) and is PROJECT-INDEPENDENT (relative .input/.output), so one binary serves every
# project: N concurrent analyses of N different projects all share it. It therefore lives in
# a shared, machine-scoped cache keyed by a content hash — NOT in the per-run intermediate
# (which the pipeline/parser wipes). The hash covers $PROG + every #included decls/engine
# .dl, so any rule/decl change → new hash → new binary; unchanged → instant reuse. Default
# ~/.cache/AxiomCode-Souffle (XDG-aware); delete it to force a clean rebuild, or override
# with AXIOM_SOUFFLE_CACHE.
# Default IN-REPO so a checkout is self-contained and nothing is written outside it
# (.souffle-cache/ is gitignored). Content-addressed, so branches sharing rule text share the
# binary; a fresh clone rebuilds once. Point AXIOM_SOUFFLE_CACHE at a shared machine-scoped
# dir to amortise that across clones.
CACHE_DIR="$CACHE_ROOT"
NEW="$(cat "$PROG" "$DL/decls_base.dl" "$DL/decls_all.dl" "$ENG"/*/*.dl "$ENG"/*/*/*.dl "$ENG2"/*/*.dl "$ENG2"/*/*/*.dl 2>/dev/null | shasum | cut -d' ' -f1)"
BIN="$CACHE_DIR/souffle-engine-$NEW"
if [ ! -x "$BIN" ]; then
  echo "▶ compiling souffle program (cache miss)..."
  # Generate C++. souffle's "No rules/facts defined" warnings (for the intentionally
  # unstaged lib-body relations — inert paths) aren't silenced by -w, so filter those 3-
  # line blocks from stderr; on a real failure, dump the full log and fail. c++ -w
  # silences the deprecation warnings in souffle's own headers. Compile to a .tmp then
  # atomically rename, so a concurrent/aborted run never leaves a half-written binary.
  if ! souffle -g "$INT/souffle-program.cpp" "$PROG" 2> "$INT/.souffle-gen.log"; then
    cat "$INT/.souffle-gen.log" >&2; exit 1
  fi
  awk '/No rules\/facts defined/{skip=2;next} skip>0{skip--;next} {print}' "$INT/.souffle-gen.log" >&2
  # Platform-conditional compile flags. On Cygwin the COFF object format caps a single
  # object at 32768 sections, and soufflé's generated translation unit for this rule set
  # (338 relations, 42 .dl files → a 5.6 MB binary) blows past it. -Wa,-mbig-obj lifts the
  # cap. Reported working upstream, though on soufflé 1.5.1 — untested here on 2.5.
  CXX_PLATFORM=""
  case "$(uname -s)" in CYGWIN*) CXX_PLATFORM="-Wa,-mbig-obj";; esac
  c++ -std=c++17 -O3 -march=native -w $CXX_PLATFORM -I "$INNER" "$INT/souffle-program.cpp" -o "$BIN.tmp.$$"
  mv -f "$BIN.tmp.$$" "$BIN"
else echo "▶ reusing cached binary"; fi
# --- STAGE↔SOLVE loop: solve → stage the bodies of methods reached so far → re-solve, until
#     reachable_method stops growing. Soufflé loads facts up front and can't fetch bodies mid-
#     solve, so the driver feeds them in reachability order. Each round loads the bodies of ALL
#     types the frontier has reached (owner types of reachable_method) — re-staged every round so
#     a method that only becomes reachable later (e.g. an RTA-dispatched override) still has its
#     body present to expand. Filter cols (1-based): lib_method owner-type=8 hash=22; expression
#     owner-type=5; local-var method=14; block method=10.
# EVERY NAME BELOW USED TO BE JAVA'S, WRITTEN INTO A SHARED EXECUTOR (#375). The frontier
# CSV, the columns of the lib method facts, the body CSVs and the relations they fill were
# all hardcoded, so a Python run read a frontier that is never written, measured it empty
# and broke out of the loop before staging a single row — leaving all eight of its
# LIB_BODY relations created-empty and never filled, silently, on every run. They now come
# from the per-language staging.conf, with Java's values unchanged.
#
# THE KEY IS PER-RELATION because the languages disagree about it for a real reason. Java
# keys expression rows on the owning TYPE, since every Java body lives in one. Python keys
# on the MODULE: 16% of its functions are module-level and every closure is nested, so a
# type-keyed filter stages nothing for a module-level library function — which is exactly
# the decorator shape #375 is about.
stage_lib_bodies(){ # $1 = frontier csv -> (re)stage the bodies its reach implies
  cut -f"$LIB_FRONTIER_COL" "$1" | sort -u > "$INT/frontier_methods.txt"
  awk -F'\t' -v mc="$LIB_METHOD_COL" -v sc="$LIB_SCOPE_COL" \
      'NR==FNR{r[$1]=1;next} ($mc in r){print $sc}' \
      "$INT/frontier_methods.txt" "$FACTS/$LIB_METHOD_FACTS.facts" | sort -u > "$INT/reached_scopes.txt"
  awk -F'\t' -v mc="$LIB_METHOD_COL" -v sc="$LIB_SCOPE_COL" \
      'NR==FNR{t[$1]=1;next} ($sc in t){print $mc}' \
      "$INT/reached_scopes.txt" "$FACTS/$LIB_METHOD_FACTS.facts" | sort -u > "$INT/reached_methods.txt"
  for entry in $LIB_BODY_MAP; do : > "$FACTS/${entry%%:*}.facts"; done
  for root in "${LIB_ROOTS[@]}"; do
    while IFS= read -r mod; do
      for entry in $LIB_BODY_MAP; do
        rel="${entry%%:*}"; rest="${entry#*:}"
        csv="${rest%%:*}"; rest="${rest#*:}"
        col="${rest%%:*}"; key="${rest#*:}"
        keyfile="$INT/reached_scopes.txt"; [ "$key" = "method" ] && keyfile="$INT/reached_methods.txt"
        [ -f "$mod/$csv" ] && awk -F'\t' -v c="$col" 'NR==FNR{k[$1]=1;next} FNR>1 && ($c in k)' \
            "$keyfile" "$mod/$csv" >> "$FACTS/$rel.facts"
      done
    done < <(lib_modules "$root")
  done
  return 0   # don't let a missing body CSV on the last module make the fn fail under set -e
}
prev=-1; iter=0
while [ "$iter" -lt 50 ]; do
  iter=$((iter+1))
  echo "▶ solve (iteration $iter)..."
  # AXIOM_SOUFFLE_PROFILE=<file> builds a SEPARATE profiling binary and runs that, so
  # Souffle reports per-rule wall time and tuple counts. Read it with `souffleprof`.
  #
  # It must be compiled, not interpreted. The interpreter aborts on this rule set with
  # "Requested arity not yet supported" — ts_method is 43 columns and the interpreter
  # supports fewer than the compiled backend does. So `-p` goes to CODE GENERATION and
  # the generated program writes the profile itself.
  #
  # Worth the build cost: two plausible explanations for this engine's time on a large
  # project — a per-character path scan and an import fan-out — were both measured and
  # both wrong (the path machinery does all its work in 0.19s; the project with the worse
  # fan is 19x faster). A profile would have said so immediately.
  if [ -n "${AXIOM_SOUFFLE_PROFILE:-}" ]; then
    PBIN="$INT/souffle-profile-bin"
    if [ ! -x "$PBIN" ]; then
      echo "▶ building profiling binary (once per run dir)..."
      souffle -g "$INT/profile-program.cpp" -p "$AXIOM_SOUFFLE_PROFILE" "$PROG" \
        2> "$INT/.souffle-prof-gen.log" || { cat "$INT/.souffle-prof-gen.log" >&2; exit 1; }
      c++ -std=c++17 -O3 -march=native -w -I "$INNER" \
        "$INT/profile-program.cpp" -o "$PBIN" || exit 1
    fi
    echo "▶ solving with profiling -> $AXIOM_SOUFFLE_PROFILE"
    "$PBIN" -F "$FACTS" -D "$RAW" -p "$AXIOM_SOUFFLE_PROFILE"
  else
    "$BIN" -F "$FACTS" -D "$RAW"
  fi
  REACH="$RAW/$LIB_FRONTIER_CSV"
  # Count DISTINCT methods in the frontier column: with a lib cap, a method can hold >1 Pareto
  # (jdk,lib)-depth copy, so raw row count would overstate the frontier and never converge.
  # Staging keys on the same column, so the two can never disagree.
  cur=0; [ -s "$REACH" ] && cur=$(cut -f"$LIB_FRONTIER_COL" "$REACH" | sort -u | wc -l | tr -d ' ')
  fc=0; [ -s "$RAW/external-forward-call.csv" ] && fc=$(wc -l < "$RAW/external-forward-call.csv" | tr -d ' ')
  echo "   reachable_method = $cur, forward_call = $fc"
  # Exact convergence — the frontier stopped growing (safe at any iteration).
  [ "$cur" -eq "$prev" ] && { echo "▶ frontier converged after $iter iteration(s)"; break; }
  # Threshold — the tail adds a handful of methods per costly iteration (Keycloak: iters 13→17
  # added ~90 over ~5 min). Stop when a round grows the frontier by < ~0.3% (delta*300 < cur),
  # but ONLY from iteration 4 on, so the early ramp (13→450→2107→…) is never cut short. The
  # percentage scales with cur, so no fixed floor to misfire while the frontier is small.
  [ "$iter" -ge 4 ] && [ $(( (cur - prev) * 300 )) -lt "$cur" ] && { echo "▶ frontier converged (Δ<0.3%) after $iter iteration(s)"; break; }
  prev=$cur
  [ "$cur" -eq 0 ] && break                        # no client→lib seed → nothing to expand
  stage_lib_bodies "$REACH"
  echo "   staged $(wc -l < "$INT/reached_scopes.txt" | tr -d ' ') reached scope(s), $(cat $(for e in $LIB_BODY_MAP; do printf '%s ' "$FACTS/${e%%:*}.facts"; done) | wc -l | tr -d ' ') body row(s) -> expanding"
done
# Per-run scratch is consumed once the solve finishes — delete the staged facts and the
# generated C++ so nothing bulky lingers in the intermediate. The reusable binary is NOT
# here (it's in the shared cache), and facts must stay per-run (never shared) so concurrent
# analyses of different projects don't collide. Runs only on success (set -e bails earlier
# on failure, leaving the facts for debugging).
rm -rf "$FACTS" "$INT/souffle-program.cpp"
SOLVE_EPOCH=$(date +%s)
echo "Elapsed (solve): $((SOLVE_EPOCH-START_EPOCH))s"

# --- BUNDLE: raw/ + the parser IR -> graph.sqlite + csv/*.csv (graph/bundle/) ---
# The stage is TypeScript. In a development checkout it runs from SOURCE through tsx, so the
# bundle can never be built from a stale dist/ (the failure mode a compiled step invites);
# an installed package has no devDependencies and runs the compiled dist/bundle/cli.js that
# `npm run build` produced. Neither present is a setup error, and says so.
PKG="$SRC/.."
if [ -x "$PKG/node_modules/.bin/tsx" ]; then
  BUNDLE=("$PKG/node_modules/.bin/tsx" "$SRC/bundle/cli.ts")
elif [ -f "$PKG/dist/bundle/cli.js" ]; then
  BUNDLE=(node "$PKG/dist/bundle/cli.js")
else
  echo "❌ bundle stage not runnable: neither node_modules/.bin/tsx nor dist/bundle/cli.js under $PKG" >&2
  echo "   run: npm install   (or npm run build for an installed package)" >&2
  exit 1
fi
ENGINE_COMMIT="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
BUNDLE_FLAGS=(); [ "$DEBUG_BUNDLE" = "1" ] && BUNDLE_FLAGS+=(--debug)
# tsx resolves the `@/` path alias from the tsconfig it finds at the CURRENT directory, so
# a caller running from elsewhere (an evaluation harness under /tmp) got "Cannot find
# module '@/bundle/build'" after a successful solve. Run the bundle from the package root;
# every path handed to it is absolute.
(cd "$PKG" && "${BUNDLE[@]}" --language "$LANG_ARG" --src "$SRC" --client-ir "$CLIENT" --raw "$RAW" --out "$OUT" \
  --library "$LIB" --lib-facts "$LIBDIR" "${BUNDLE_FLAGS[@]}" \
  --meta "engine_commit=$ENGINE_COMMIT" \
  --meta "dispatch_cap=${CAP_EFF:-off}" --meta "jdk_depth=$JDK_DEPTH" --meta "lib_depth=${LIB_DEPTH:-uncapped}" \
  --meta "engine_ii=$ENGINE_II_MODE" --meta "solve_iterations=$iter" --meta "solve_seconds=$((SOLVE_EPOCH-START_EPOCH))")

END_EPOCH=$(date +%s); END_TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "Elapsed: $((END_EPOCH-START_EPOCH))s"
if [ "$DEBUG_BUNDLE" = "1" ]; then
  echo "✅ reasoning complete: $OUT/graph.sqlite · debug: $OUT/csv/ and raw relations in $RAW"
else
  rm -rf "$RAW"
  echo "✅ reasoning complete: $OUT/graph.sqlite   (--debug keeps raw/ and writes csv/*.csv)"
fi
