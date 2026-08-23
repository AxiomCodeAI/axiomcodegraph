#!/bin/bash
# Souffle executor — TEMPLATE-DRIVEN: the relation->CSV import map is parsed from
# client-ir.map / lib.map (single source of truth). Lib is auto-scoped
# to only the signature relations the rules reference (never loads GB-scale bodies).
# Usage: run-souffle.sh --client-ir DIR --library DIR --intermediate DIR --output DIR
set -e
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
TAINT=""      # --taint on → gate lib→lib GROW on client-seeded data flow (dataflow/taint.dl). Also
              # settable via env AXIOM_TAINT_GATING=on. Empty = ungated (default behavior).
while [ $# -gt 0 ]; do case "$1" in
  --client-ir) CLIENT="$2"; shift 2;; --library) LIB="$2"; shift 2;;
  --intermediate) INT="$2"; shift 2;; --output) OUT="$2"; shift 2;;
  --jdk-depth) JDK_DEPTH="$2"; shift 2;;
  --dispatch-cap) DISPATCH_CAP="$2"; shift 2;;
  --lib-depth) LIB_DEPTH="$2"; shift 2;;
  --taint) TAINT="$2"; shift 2;;
  --language) shift 2;; *) shift;; esac; done
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ENG="$SRC/engine"; ENG2="$SRC/engine-ii"; DL="$SRC/souffle"; TPL="$SRC/templates"
INNER="/opt/homebrew/Cellar/souffle/2.5/include/souffle"
FACTS="$INT/souffle-facts"; rm -rf "$FACTS"; mkdir -p "$FACTS" "$OUT"
START_EPOCH=$(date +%s); START_TS=$(date '+%Y-%m-%d %H:%M:%S')

# read an import map (relation<TAB>csv-basename per line), skipping comments (#) and blanks
read_map(){ grep -vE '^[[:space:]]*(#|$)' "$1"; }

# Library roots: --library is a comma-separated list of IR roots (each with jdk-style
# module sub-folders, or a flat IR dir). The caller (TS) controls which folders/libraries
# are loaded; staging concatenates each relation across every module of every root.
IFS=',' read -ra LIB_ROOTS <<< "$LIB"
# lib_modules ROOT -> the module dirs to stage from (the root itself if it holds the IR,
# else its immediate sub-folders — mirrors how the JDK ships sharded modules).
lib_modules(){ if [ -f "$1/all-types.csv" ]; then printf '%s\n' "$1"; else for m in "$1"/*/; do [ -d "$m" ] && printf '%s\n' "${m%/}"; done; fi; }

# Lib SIGNATURES: staged fully, always. Lib BODIES (expression/local/block) are GB-scale and
# staged SCOPED, on demand, by the stage↔solve loop below — only the bodies of methods the
# engine-ii frontier actually reaches.
LIB_SIG="type type_lines type_reference type_parameter method method_parameter method_type_parameter field field_position import enum_constant"
LIB_BODY="lib_expression lib_local_variable lib_block"

# --- CLIENT: stage all mapped relations present, emit .input ---
CLIENT_INPUTS=""
while IFS=$'\t' read -r rel csv; do
  [ -f "$CLIENT/$csv.csv" ] || continue
  awk 'NR>1' "$CLIENT/$csv.csv" > "$FACTS/$rel.facts"
  CLIENT_INPUTS="$CLIENT_INPUTS$rel"$'\n'
done < <(read_map "$TPL/client-ir.map")

# --- LIB: only signature relations, concatenated across every module of every root ---
LIB_INPUTS=""
while IFS=$'\t' read -r rel csv; do
  case " $LIB_SIG " in *" ${rel#lib_} "*) ;; *) continue;; esac   # signatures only
  : > "$FACTS/$rel.facts"
  for root in "${LIB_ROOTS[@]}"; do
    while IFS= read -r mod; do
      [ -f "$mod/$csv.csv" ] && awk 'NR>1' "$mod/$csv.csv" >> "$FACTS/$rel.facts"
    done < <(lib_modules "$root")
  done
  [ -s "$FACTS/$rel.facts" ] && LIB_INPUTS="$LIB_INPUTS$rel"$'\n' || rm -f "$FACTS/$rel.facts"
done < <(read_map "$TPL/lib.map")
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
  for ff in "$FACTS"/*.facts; do r=$(basename "$ff" .facts); printf '.input %s(IO=file, filename="%s.facts", delimiter="\\t")\n' "$r" "$r"; done
  for d in projections containment resolution expression-resolution call-edge-generation; do
    for f in "$ENG/$d/"*.dl; do echo "#include \"$f\""; done
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
CACHE_DIR="${AXIOM_SOUFFLE_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/AxiomCode-Souffle}"; mkdir -p "$CACHE_DIR"
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
  c++ -std=c++17 -O3 -march=native -w -I "$INNER" "$INT/souffle-program.cpp" -o "$BIN.tmp.$$"
  mv -f "$BIN.tmp.$$" "$BIN"
else echo "▶ reusing cached binary"; fi
# --- STAGE↔SOLVE loop: solve → stage the bodies of methods reached so far → re-solve, until
#     reachable_method stops growing. Soufflé loads facts up front and can't fetch bodies mid-
#     solve, so the driver feeds them in reachability order. Each round loads the bodies of ALL
#     types the frontier has reached (owner types of reachable_method) — re-staged every round so
#     a method that only becomes reachable later (e.g. an RTA-dispatched override) still has its
#     body present to expand. Filter cols (1-based): lib_method owner-type=8 hash=22; expression
#     owner-type=5; local-var method=14; block method=10.
stage_lib_bodies(){ # $1 = reachable_method csv → (re)stage bodies of all reached types
  awk -F'\t' 'NR==FNR{r[$1]=1;next} ($22 in r){print $8}'  "$1" "$FACTS/lib_method.facts" | sort -u > "$INT/reached_types.txt"
  awk -F'\t' 'NR==FNR{t[$1]=1;next} ($8 in t){print $22}' "$INT/reached_types.txt" "$FACTS/lib_method.facts" | sort -u > "$INT/reached_methods.txt"
  : > "$FACTS/lib_expression.facts"; : > "$FACTS/lib_local_variable.facts"; : > "$FACTS/lib_block.facts"
  for root in "${LIB_ROOTS[@]}"; do
    while IFS= read -r mod; do
      [ -f "$mod/all-expressions.csv" ]     && awk -F'\t' 'NR==FNR{t[$1]=1;next} FNR>1 && ($5 in t)'  "$INT/reached_types.txt"   "$mod/all-expressions.csv"    >> "$FACTS/lib_expression.facts"
      [ -f "$mod/all-local-variables.csv" ] && awk -F'\t' 'NR==FNR{m[$1]=1;next} FNR>1 && ($14 in m)' "$INT/reached_methods.txt" "$mod/all-local-variables.csv" >> "$FACTS/lib_local_variable.facts"
      [ -f "$mod/all-blocks.csv" ]          && awk -F'\t' 'NR==FNR{m[$1]=1;next} FNR>1 && ($10 in m)' "$INT/reached_methods.txt" "$mod/all-blocks.csv"          >> "$FACTS/lib_block.facts"
    done < <(lib_modules "$root")
  done
  return 0   # don't let a missing all-blocks.csv on the last module make the fn fail under set -e
}
prev=-1; iter=0
while [ "$iter" -lt 50 ]; do
  iter=$((iter+1))
  echo "▶ solve (iteration $iter)..."
  "$BIN" -F "$FACTS" -D "$OUT"
  REACH="$OUT/external-reachable-method.csv"
  # Count DISTINCT methods (col 1): with a lib cap, a method can hold >1 Pareto (jdk,lib)-depth
  # copy, so raw row count would overstate the frontier and never converge. Staging keys on col 1.
  cur=0; [ -s "$REACH" ] && cur=$(cut -f1 "$REACH" | sort -u | wc -l | tr -d ' ')
  fc=0; [ -s "$OUT/external-forward-call.csv" ] && fc=$(wc -l < "$OUT/external-forward-call.csv" | tr -d ' ')
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
  echo "   staged $(wc -l < "$INT/reached_types.txt" | tr -d ' ') reached types, $(wc -l < "$FACTS/lib_expression.facts" | tr -d ' ') expressions → expanding"
done
# Per-run scratch is consumed once the solve finishes — delete the staged facts and the
# generated C++ so nothing bulky lingers in the intermediate. The reusable binary is NOT
# here (it's in the shared cache), and facts must stay per-run (never shared) so concurrent
# analyses of different projects don't collide. Runs only on success (set -e bails earlier
# on failure, leaving the facts for debugging).
rm -rf "$FACTS" "$INT/souffle-program.cpp"
END_EPOCH=$(date +%s); END_TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "Elapsed: $((END_EPOCH-START_EPOCH))s"
echo "✅ souffle reasoning complete and output written to: $OUT"
