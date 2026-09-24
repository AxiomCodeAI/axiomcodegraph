#!/bin/bash
# Deliberately break one invariant at a time and confirm the gate that owns it
# reports FAIL. A gate nobody has seen fail is not known to be capable of it.
#
# Every mutation is reverted from a BYTE COPY taken immediately before it, not
# from the git index. The first version used `git checkout --`, which silently
# does nothing for a file that is untracked or staged-but-since-edited — so two
# mutations survived the run and the next check ran against a corrupted parser.
# A restore that can quietly not restore is the same class of defect as a gate
# that can quietly not fail.
set -u
cd "$(dirname "$0")/../../.."

# TWO WAYS TO RUN. With no argument, EVERY control — the release gate's run,
# ~20 minutes, the only run whose tally counts. With `--only <regex>`, the
# controls whose LABEL or TARGET FILE matches — the per-commit run for the
# code a commit touched, a minute or two. A selective run prints a different
# tally line on purpose (`negative-controls (SELECTED ...)`), so the release
# gate, which greps for the full line, cannot be satisfied by one.
#
#   negative-controls.sh --only 'cs-statement-walker|top-level'
#   negative-controls.sh --only "$(git diff --name-only HEAD~1 | paste -sd'|' -)"
ONLY=""
if [ "${1:-}" = "--only" ]; then
  ONLY="${2:?--only needs a regex over labels and file paths}"
fi
SELECTED_COUNT=0

# THIS HARNESS WRITES TO THE WORKING TREE, one mutation at a time, restoring
# from a byte copy after each. No git tree operation may run while it does:
# a `git stash` taken mid-mutation captured one control's edit as if it were
# the developer's, and the harness's restore then wrote the developer's file
# back OVER the stashed tree, so the pop refused. The lock names the pid so the
# collision is a message rather than an archaeology exercise.
LOCK=".negative-controls.lock"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  echo "negative-controls.sh is already running as pid $(cat "$LOCK"); it owns the working tree until it exits"
  exit 2
fi
echo $$ > "$LOCK"
OK_COUNT=0
BAD_COUNT=0
INCONCLUSIVE_COUNT=0
MISCLASSIFIED_COUNT=0

# RESUMABLE, because a 16 GB machine shared with six agents killed three full
# runs at controls 10, 108 and 131, and a partial run is not a tally. Every
# verdict is appended to a run file KEYED BY COMMIT AND TREE as it lands;
# a full run at the same commit and tree skips the controls already decided
# and the tally line says how many runs it was assembled from. Keyed by tree
# as well as commit so a resumption cannot cross a change; a dirty checkout
# has no tree of record and is never resumable. `--fresh` discards the file.
#
# Resumption ASSUMES every control is deterministic, and in C# that assumption
# was false until CS-ORACLE-5: a scaling check's verdict depended on machine
# load. So it is asserted rather than trusted: on resume a SAMPLE of the
# already-decided controls is re-run and must give identical verdicts; one
# difference and the run is not resumable, and the harness says so.
RUN_FILE=".negative-controls.run.jsonl"
RESUME_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
RESUME_TREE="$(git rev-parse --short 'HEAD^{tree}' 2>/dev/null || echo none)"
RESUMABLE=0
RUN_NUMBER=1
DECIDED_FILE="$(mktemp)"
SAMPLE_FILE="$(mktemp)"
SAMPLE_CHECKED=0
SAMPLE_SIZE=0
if [ -z "$ONLY" ]; then
  if [ "${1:-}" = "--fresh" ]; then rm -f "$RUN_FILE"; fi
  if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    echo "note: the checkout has uncommitted changes — no tree of record, this run is not resumable"
    rm -f "$RUN_FILE"
  elif [ -f "$RUN_FILE" ]; then
    if head -n 1 "$RUN_FILE" | grep -q "\"commit\": \"$RESUME_COMMIT\", \"tree\": \"$RESUME_TREE\""; then
      RESUMABLE=1
      RUN_NUMBER=$(( $(grep -c '"kind": "run"' "$RUN_FILE") + 1 ))
      # Decided = OK / BAD / MIS. INCONCLUSIVE is not a verdict and is re-run.
      grep '"kind": "verdict"' "$RUN_FILE" | grep -v '"verdict": "INCONCLUSIVE"' \
        | sed -E 's/.*"label": "((\\.|[^"\\])*)".*"verdict": "([A-Z]+)".*/\3\t\1/' > "$DECIDED_FILE"
      # The determinism sample: every 20th decided control, at least 3, chosen by
      # position so a resumed run re-checks different controls than the last.
      awk -v n="$RUN_NUMBER" 'NR % 20 == (n % 20) || NR <= 3 {print}' "$DECIDED_FILE" > "$SAMPLE_FILE"
      SAMPLE_SIZE=$(wc -l < "$SAMPLE_FILE" | tr -d ' ')
      echo "resuming run $RUN_NUMBER at $RESUME_COMMIT tree $RESUME_TREE: $(wc -l < "$DECIDED_FILE" | tr -d ' ') controls already decided, $SAMPLE_SIZE re-run to assert determinism"
    else
      echo "note: $RUN_FILE is for another commit or tree — starting fresh"
      rm -f "$RUN_FILE"
    fi
  fi
  if [ "$RESUMABLE" -eq 0 ]; then
    RUN_NUMBER=1
  fi
  if [ "$RESUME_COMMIT" != "none" ] && [ -z "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    if [ ! -f "$RUN_FILE" ]; then
      printf '{"kind": "header", "commit": "%s", "tree": "%s"}\n' "$RESUME_COMMIT" "$RESUME_TREE" > "$RUN_FILE"
    fi
    printf '{"kind": "run", "n": %d, "started": "%s"}\n' "$RUN_NUMBER" "$(date +%Y-%m-%dT%H:%M:%S)" >> "$RUN_FILE"
  fi
fi
trap 'rm -f "$LOCK" "$DECIDED_FILE" "$SAMPLE_FILE"' EXIT

# JSON-escape a label for the run file.
json_escape () { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1], end="")'; }

record_verdict () {
  local label="$1" verdict="$2"
  if [ -z "$ONLY" ] && [ -f "$RUN_FILE" ]; then
    printf '{"kind": "verdict", "label": "%s", "verdict": "%s", "run": %d}\n' "$(json_escape "$label")" "$verdict" "$RUN_NUMBER" >> "$RUN_FILE"
  fi
}

# The verdict the run file holds for a label, or empty.
decided_verdict () {
  local label="$1"
  awk -F'\t' -v l="$label" '$2 == l {print $1; exit}' "$DECIDED_FILE"
}

run_break () {
  local label="$1"; shift
  local file="$1"; shift
  local expect="$1"; shift
  local python_patch="$1"; shift
  # OPTIONAL fifth argument: a fragment the named gate's failure text must
  # contain. cs-corpus's third bucket — FIRED-BUT-MISCLASSIFIED: its gate-ifdef
  # saw CS-CORPUS-25's inverted regions and filed them as CONFIG-DISAGREE. A
  # gate that fails under the mutation for some OTHER reason than the defect
  # the control re-applies is that shape: it passes non-vacuity, it fires, and
  # it is still wrong. With a fragment, OK means "failed, and said why".
  local must_say="${1:-}"

  if [ -n "$ONLY" ] && ! printf '%s\n%s\n' "$label" "$file" | grep -Eq -- "$ONLY"; then
    return
  fi
  SELECTED_COUNT=$((SELECTED_COUNT + 1))

  # Already decided in an earlier run at this commit and tree: count it as
  # decided and skip — unless it is in the determinism sample, in which case
  # run it and require the same verdict.
  local previous=""
  local sampled=0
  if [ "$RESUMABLE" -eq 1 ]; then
    previous="$(decided_verdict "$label")"
    if [ -n "$previous" ]; then
      if awk -F'\t' -v l="$label" '$2 == l {found=1} END {exit !found}' "$SAMPLE_FILE"; then
        sampled=1
      else
        case "$previous" in
          OK) OK_COUNT=$((OK_COUNT + 1));;
          BAD) BAD_COUNT=$((BAD_COUNT + 1));;
          MIS) MISCLASSIFIED_COUNT=$((MISCLASSIFIED_COUNT + 1));;
        esac
        echo "..   $label  ->  $previous, decided in an earlier run of this tally"
        return
      fi
    fi
  fi
  local verdict_code=""

  local backup
  backup="$(mktemp)"
  cp "$file" "$backup"

  # The patch must leave a STRING. One control's patch evaluated to None when
  # its pattern went stale; open(p, 'w') had already truncated the file
  # before .write(None) raised, the suite ran on an EMPTY extractor, every
  # gate failed, and the control was counted OK. A file is written only from a
  # string; anything else leaves it untouched and reports "did not apply".
  python3 - "$file" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$python_patch
if isinstance(s, str):
    open(p,'w').write(s)
PY
  if cmp -s "$file" "$backup"; then
    BAD_COUNT=$((BAD_COUNT + 1))
    echo "BAD  $label  ->  the mutation did not apply. The pattern no longer matches;"
    echo "     this control has been silently testing nothing."
    rm -f "$backup"
    record_verdict "$label" BAD
    settle_sample "$label" BAD "$previous" "$sampled"
    return
  fi

  local out
  out=$(npx tsx src/test/csharp-tests.ts 2>&1)
  local verdict
  verdict=$(echo "$out" | awk -v want="$expect" '$0==want{f=1;next} f&&/^  (PASS|FAIL)/{print $1;exit}')
  local total
  total=$(echo "$out" | grep -E '^[0-9]+/[0-9]+ checks passed')
  # A suite that never reached its own tally line did not run to the end: a
  # transform error, an out-of-memory kill, a crash. Whatever the named gate
  # printed before that is not a verdict on the mutation. 26 controls in one
  # full run were counted BAD this way while the machine was killing the
  # suite, and one was counted OK because its gate "failed" on an empty file.
  if [ -z "$total" ]; then
    INCONCLUSIVE_COUNT=$((INCONCLUSIVE_COUNT + 1))
    echo "??   $label  ->  the suite produced no tally line under the mutation — INCONCLUSIVE, not a verdict"
    echo "$out" | grep -E 'ERROR|Error|Killed|heap' | sed 's/^/     | /' | head -3
    cp "$backup" "$file"
    rm -f "$backup"
    record_verdict "$label" INCONCLUSIVE
    return
  fi
  if [ "$verdict" = "FAIL" ]; then
    local said
    said=$(echo "$out" | awk -v want="$expect" '$0==want{f=1;next} f&&/^  (PASS|FAIL)/{exit} f{print}')
    if [ -n "$must_say" ] && ! echo "$said" | grep -qF -- "$must_say"; then
      MISCLASSIFIED_COUNT=$((MISCLASSIFIED_COUNT + 1))
      echo "MIS  $label  ->  '$expect' FAILED, but not for the defect this control re-applies — FIRED-BUT-MISCLASSIFIED   ($total)"
      echo "     expected the failure to say: $must_say"
      echo "$said" | sed 's/^/     | /' | head -4
      verdict_code=MIS
    else
      OK_COUNT=$((OK_COUNT + 1))
      echo "OK   $label  ->  '$expect' correctly reported FAIL   ($total)"
      echo "$said" | sed 's/^/       /' | head -4
      verdict_code=OK
    fi
  else
    BAD_COUNT=$((BAD_COUNT + 1))
    echo "BAD  $label  ->  '$expect' did NOT fail (got '${verdict:-none}').  ($total)"
    echo "     THE GATE IS INCAPABLE OF FAILING, or the mutation did not apply. Both are defects."
    echo "$out" | grep -E '^  [a-z].*(FAIL)' -B4 | sed 's/^/     | /' | head -8
    verdict_code=BAD
  fi
  cp "$backup" "$file"
  rm -f "$backup"
  record_verdict "$label" "$verdict_code"
  settle_sample "$label" "$verdict_code" "$previous" "$sampled"
}

# A sampled control was re-run: its verdict must equal the recorded one, or
# the assumption resumption rests on is false for this harness on this
# machine, and the tally cannot be assembled from more than one run.
settle_sample () {
  local label="$1" now="$2" before="$3" sampled="$4"
  if [ "$sampled" -ne 1 ]; then return; fi
  SAMPLE_CHECKED=$((SAMPLE_CHECKED + 1))
  if [ "$now" != "$before" ]; then
    echo "=============================================================================="
    echo "NOT RESUMABLE: \"$label\" was $before in an earlier run of this tally and is $now now."
    echo "A control whose verdict changes between runs is not deterministic, and a tally"
    echo "assembled across runs would be a claim about no single machine state. The run"
    echo "file is kept for reading; start again with --fresh, and find out why first."
    echo "=============================================================================="
    exit 3
  fi
}

echo "=============================================================================="
echo "NEGATIVE CONTROLS — each gate must report the defect it owns"
echo "=============================================================================="

# --- C# 14 extension members ---------------------------------------------------
# Stop flattening the block and its members vanish: they belong to the enclosing
# static class, and nothing else walks them. Absent, not wrong — which is still
# a whole construct missing from the fact base.
run_break "name a declaration by its first identifier child instead of its name field" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "a delegate is named by its name field" \
  "s = s.replace(\"  const nameNode = header.childForFieldName('name') ?? childOfType(header, 'identifier');\", \"  const nameNode = childOfType(header, 'identifier');\")" \
  "named after its RETURN TYPE"

# --- a #define is its symbol --------------------------------------------------
# Take the whole remainder of the directive as the symbol name and a define with
# a trailing comment matches no #if. No parse error, no lost row, a full set of
# facts emitted from the WRONG branch.
run_break "trust a misparsed ref-returning assignment as a declaration" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "no phantom locals from a ref-returning assignment" \
  "s = s.replace('      if (isMisparsedCallArgumentTuple(node)) {', '      if (false) {')" \
  "ARGUMENT of a ref-returning call"

# The other direction, and the one that matters more: a detector that fires too
# widely deletes every legitimate deconstruction. Dropping the `var` test is
# exactly that mistake.
run_break "drop the var discriminator, so a real deconstruction reads as a misparse" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "no phantom locals from a ref-returning assignment" \
  "s = s.replace(\"    (typeNode.type !== 'identifier' && typeNode.type !== 'qualified_name')\", '    false')" \
  "must not touch a legitimate declaration"

# --- a call site IS its expression -------------------------------------------
# Take the call site's span from the NODE instead of from the expression row it
# is 1:1 with, and a #if-guarded chain segment's two rows land three lines apart.
# Nothing is lost and no count moves, which is why it survived fourteen sweeps.
run_break "take a call site's span from the node instead of its expression row" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a call site sits where its expression does" \
  "s = s.replace('    startLine: expression.startLine,\n    startColumn: expression.startColumn,', '    startLine: startLine(node),\n    startColumn: startColumn(node),')" \
  "IS an expression"

# --- a directive is not part of the declaration ---------------------------------
# The span: with the helper bypassed, a declaration guarded by a `#if` starts at
# the DIRECTIVE line — trivia that belongs to no declaration.
run_break "stop registering an accessor as a declaration owner" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "an accessor owns its attributes" \
  "s = s.replace('      if (accessor.node !== undefined) {', '      if (false) {')" \
  "accessor attributes emitted"

# --- the expression walk's containers ------------------------------------------
# The array LENGTH hangs under the creation's TYPE, and a type is not an
# expression. Dropping the rank specifiers loses every call in an array size
# while the creation's own row and its type reference stay correct — nothing
# counts short, which is why it survived eleven sweeps.
run_break "drop the rank specifiers from an array creation's children" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "an array length is walked" \
  "s = s.replace('        for (const rank of rankSpecifiersOf(typeNode)) {', '        for (const rank of []) {')" \
  "calls inside an array length were walked"

# --- the source text itself ---------------------------------------------------
# A BOM left in place shifts every column on line 1 by one and NOTHING else, so
# it is invisible on any file whose first line is a `using` or a comment — which
# is most of them. The gate must name the encoding fact rather than go red on a
# count.
run_break "count a UTF-8 BOM as the first character of the program" \
  src/parsers/csharp/csharp-parser.ts \
  "a BOM is not a character" \
  "s = s.replace('  return sourceCode.startsWith(UTF8_BOM) ? sourceCode.slice(UTF8_BOM.length) : sourceCode;', '  return sourceCode;')" \
  "a BOM moved line 1"

run_break "drop ARITY from the declaration group key" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "partial grouping" \
  "s = s.replace('keyOf(declarationScopeKey, \`\${name}\${CSHARP_ARITY_SEPARATOR}\${arity}\`)', 'keyOf(declarationScopeKey, name)')"

run_break "drop the FILE from a file-local type's scope key" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "partial grouping" \
  "s = s.replace('  const scopeKey = isFileLocal', '  const scopeKey = false')"

run_break "key cs_type on name and arity alone" \
  src/analysis-types/csharp/CsTypeRegistry.ts \
  "PK uniqueness" \
  "s = s.replace('''      keyOf(
        this.csModuleLinkHash,
        this.name,
        this.arity,
        this.declarationScopeKey,
        this.startLine,
        this.startColumn
      )''', '      keyOf(this.name, this.arity)')"

run_break "point containingTypeLinkHash at a hash nothing declares" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "FK integrity" \
  "s = s.replace('    containingTypeLinkHash: scope.containingTypeLinkHash,', '    containingTypeLinkHash: scope.containingTypeLinkHash === \'\' ? \'\' : \'CS_TYPE_deadbeef\',')"

run_break "make one column non-deterministic" \
  src/analysis-types/csharp/CsTypeRegistry.ts \
  "determinism" \
  "s = s.replace('        text(this.csNamespaceName),', '        text(this.csNamespaceName + String(Math.random())),')"

run_break "drop a column from cs_type's toCsv" \
  src/analysis-types/csharp/CsTypeRegistry.ts \
  "arity contract" \
  "s = s.replace('        num(this.attributeCount),\n        bool(this.isExternal),', '        bool(this.isExternal),')"

run_break "emit a kind that is not a declared enum member" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "enum emission audit" \
  "s = s.replace(\"    case 'interface_declaration':\n      return CsTypeCategory.INTERFACE;\", \"    case 'interface_declaration':\n      return 'CONTRACT' as CsTypeCategory;\")"

run_break "classify a record struct as a reference type" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "enum emission audit" \
  "s = s.replace('''      return hasAnonymousToken(node, 'struct')
        ? CsTypeCategory.RECORD_STRUCT
        : CsTypeCategory.RECORD;''', '      return CsTypeCategory.RECORD;')"

run_break "stop honouring the pinned grammar regime" \
  src/constants/csharp-constants.ts \
  "regime pins" \
  "s = s.replace(\"export const CSHARP_GRAMMAR_REGIME = 'ts-cs-0.23.1-npm-blank2';\", \"export const CSHARP_GRAMMAR_REGIME = 'ts-cs-0.23.1-npm-blank2-oops';\")"

run_break "drop targetFramework from the module key" \
  src/analysis-types/csharp/CsModuleRegistry.ts \
  "multi-target keying" \
  "s = s.replace('''      keyOf(
        this.filePath,
        this.baseMservPath,
        this.targetFramework,''', '''      keyOf(
        this.filePath,
        this.baseMservPath,''')"

run_break "lose the implicit framework symbol table" \
  src/parsers/csharp/extractors/preproc-context.ts \
  "#if branch selection" \
  "s = s.replace('export function implicitFrameworkSymbols(targetFramework: string): string[] {', 'export function implicitFrameworkSymbols(targetFramework: string): string[] {\n  if (targetFramework) { return []; }')"

run_break "report a struct base list as BASE_OR_INTERFACE" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace('  if (CANNOT_HAVE_BASE_CLASS.has(category)) {\n    return CsHeritageKind.INTERFACE;\n  }\n', '')"

run_break "read variance from modifier nodes only" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace('    if (child.isNamed) {\n      continue;\n    }', '    if (!child.isNamed) {\n      continue;\n    }')"

run_break "match where-clauses positionally instead of by name" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace('    const clause = constraints.get(name);', '    const clause = [...constraints.values()][position];')"

# `class`, `struct`, `notnull` and `new()` all exit through earlier branches and
# never reach the counting line, so removing the guard changed nothing and this
# control reported BAD on its first run — the harness catching a control that
# was testing nothing. `unmanaged` was the only keyword that reached it, until
# v1.15 gave it an exit of its own and this control went BAD a second time;
# `default` is the only one that reaches it now, and the gate corpus has one.
run_break "count a keyword constraint as a TYPE constraint" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace('      if (!NON_TYPE_CONSTRAINTS.has(text)) {', '      if (true) {')" \
  "was counted as a TYPE constraint"

run_break "emit the base argument_list as a heritage entry" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"    if (entry.type === 'argument_list') {\", \"    if (false) {\")"

run_break "read only the FLAT primary-constructor base shape" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"    const isWrapped = entry.type === 'primary_constructor_base_type';\", '    const isWrapped = false;')"

run_break "treat every class base entry as ambiguous" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace('  return position === 0 ? CsHeritageKind.BASE_OR_INTERFACE : CsHeritageKind.INTERFACE;', '  return CsHeritageKind.BASE_OR_INTERFACE;')"

run_break "declare a grammar read the grammar does not have" \
  src/test/csharp-gates/extractor-grammar-reads.json \
  "grammar reads exist" \
  "s = s.replace('\"name\": \"type_argument_list\"', '\"name\": \"type_arguments\"')"

run_break "make defineConstantsKey order-dependent" \
  src/workflows/csharp/csharp-project-analyzer.ts \
  "defineConstantsKey is canonical" \
  "s = s.replace(\"    [...new Set(symbols)].sort().join(';')\", \"    [...new Set(symbols)].join(';')\")"

run_break "lower-case preprocessor symbols before hashing" \
  src/workflows/csharp/csharp-project-analyzer.ts \
  "defineConstantsKey is canonical" \
  "s = s.replace(\"    [...new Set(symbols)].sort().join(';')\", \"    [...new Set(symbols.map((x) => x.toLowerCase()))].sort().join(';')\")"

run_break "emit two cs_method rows for one accessor" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "accessor 1:1" \
  "s = s.replace('  for (const accessor of accessors) {', '  for (const accessor of [...accessors, ...accessors]) {')"
run_break "drop the owner link from an accessor" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "accessor 1:1" \
  "s = s.replace('    ownerMemberLinkHash: owner,', '    ownerMemberLinkHash: \'\',')"
run_break "call a field-like event one with accessors" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "accessor 1:1" \
  "s = s.replace('        eventKind: CsEventKind.FIELD_LIKE,', '        eventKind: CsEventKind.WITH_ACCESSORS,')"
run_break "lose the getter of an expression-bodied property" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('    if (arrow === undefined) {', '    if (true) {')"
run_break "fold init into set" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('          ? CsSetterKind.INIT', '          ? CsSetterKind.SET')"
run_break "default an interface member to private" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('  return ownerCategory === CsTypeCategory.INTERFACE', '  return false')"
run_break "give an explicit interface impl an accessibility" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('      explicitInterface !== undefined\n        ? CsTypeAccess.NONE\n        : accessOf(modifiers, options.typeCategory),\n    methodModifiers: modifiers,', '      accessOf(modifiers, options.typeCategory),\n    methodModifiers: modifiers,')"
run_break "read only the parameter children, dropping params" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('    if (!child.isNamed && child.type === \'params\') {', '    if (false) {')"
run_break "read scoped only from the modifier list" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('      has(\'scoped\') || isScoped ? CsScopedModifier.SCOPED', '      has(\'scoped\') ? CsScopedModifier.SCOPED')"
run_break "compare parameter children by object identity again" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('    (c) => !excluded.has(c.id) &&', '    (c) => (c as unknown) !== (declaredType as unknown) &&')"
run_break "miss the ref in a ref return" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('  if (returns?.type === \'ref_type\') {', '  if (false) {')"
run_break "stop emitting local functions" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "member semantics" \
  "s = s.replace('    if (current.type === \'local_function_statement\') {', '    if (false) {')"
run_break "flatten the type-reference tree" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('  let childPosition = 0;\n  for (const child of shape.children) {', '  let childPosition = 0;\n  for (const child of []) {')"
run_break "read generic arity off the OUTERMOST qualified name" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      if (last?.type === \'generic_name\') {', '      if (false) {')"
run_break "count array brackets instead of commas plus one" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('          : specifier.text.split(\',\').length;', '          : 1;')"
run_break "give a tuple no element children" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      return base(CsTypeRefKind.TUPLE, current.text, elements);', '      return base(CsTypeRefKind.TUPLE, current.text, []);')"
run_break "wrap a nullable type instead of flagging it" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      isNullableAnnotated = true;', '      isNullableAnnotated = false;')"
run_break "read dynamic as an ordinary named type" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      return current.text === \'dynamic\'', '      return false')"
run_break "treat a type variable as a type name" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      ? input.typeParametersInScope?.get(shape.typeName)', '      ? undefined')"
run_break "lose usings written inside a block namespace" \
  src/parsers/csharp/extractors/cs-using-extractor.ts \
  "using forms" \
  "s = s.replace('      node.type === \'declaration_list\'', '      false')"
run_break "point an implicit using at line 1" \
  src/parsers/csharp/extractors/cs-using-extractor.ts \
  "using forms" \
  "s = s.replace('        startLine: 0,\n        startColumn: 0,', '        startLine: 1,\n        startColumn: 0,')"
run_break "fold 'using static' into a plain namespace using" \
  src/parsers/csharp/extractors/cs-using-extractor.ts \
  "using forms" \
  "s = s.replace('  const isStatic = hasKeyword(node, \'static\');', '  const isStatic = false;')"
run_break "descend into a maximal ERROR node" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "parse gaps are rows" \
  "s = s.replace('      rows.push(gap(node, bucketFor(coveragePercent), byteLength, coveragePercent, options));\n      // The MAXIMAL error is the unit. Descending would count these bytes again\n      // at every level below and push coveragePercent over 100%.\n      continue;', '      rows.push(gap(node, bucketFor(coveragePercent), byteLength, coveragePercent, options));\n      for (const child of allChildren(node)) {\n        rows.push(gap(child, bucketFor(coveragePercent), byteLength, coveragePercent, options));\n      }\n      continue;')"
run_break "walk only named children, so MISSING is unreachable" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "parse gaps are rows" \
  "s = s.replace('    for (const child of allChildren(node)) {\n      depths.set(child.id, depth + 1);\n      stack.push(child);\n    }', '    for (const child of allChildren(node)) {\n      if (!child.isNamed) { continue; }\n      depths.set(child.id, depth + 1);\n      stack.push(child);\n    }')"
run_break "file preprocessor debris as an ordinary grammar error" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "parse gaps are rows" \
  "s = s.replace('      if (node.text.trimStart().startsWith(\'#\')) {', '      if (false) {')"
run_break "count module parse errors separately from the gap rows" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "parse gaps are rows" \
  "s = s.replace('      count: parseGaps.length,', '      count: parseGaps.length + 1,')"
# REMOVED: "prune the gap walk on hasError again".
#
# The defect is real and was measured — on
# System.Private.CoreLib/src/System/Math.cs the zero-width identifier at line
# 219 has hasError TRUE and its PARENT has hasError FALSE, so pruning stops the
# walk one level above the defect. But that shape does NOT reduce to a small
# fixture: every reduction attempted keeps hasError propagating correctly, so
# the control passed and was testing nothing.
#
# Rather than keep a green control that proves nothing, the pruning is gone from
# the extractor and the INVARIANT is gated instead — the suite re-parses the
# corpus and compares rootNode.hasError, which no part of the extractor
# produced, against the presence of a gap row. That catches any mechanism that
# loses a whole file, including this one, without needing to reproduce the shape.

# RETIRED at fork19: "drop the fallback for files with no locatable error" and
# "bucket a self-reporting node as an ordinary error". Both needed an input
# that reaches the fallback — a file with hasError and nothing locatable —
# and the only one there was (a #pragma as the last line with no trailing
# newline) is parsed now. SELF_REPORTING_NODE is RESERVED in the enum audit
# with a zero-row assertion, which is the guard that replaces them: the day an
# input reaches the fallback again, the reservation fails by name, and these
# two controls come back with that input as their fixture.
run_break "trust isMissing instead of zero width" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "parse gaps are rows" \
  "s = s.replace('  return node.isNamed && node.startIndex === node.endIndex;', '  return false;')"
run_break "emit one row per field DECLARATION, not per declarator" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('  for (const declarator of childrenOfType(declaration, \'variable_declarator\')) {\n    const nameNode = declarator.childForFieldName(\'name\');', '  for (const declarator of childrenOfType(declaration, \'variable_declarator\').slice(0, 1)) {\n    const nameNode = declarator.childForFieldName(\'name\');')"
# REMOVED: "drop declarationIndex from the field key".
#
# It could not fail, and the reason is worth keeping. The field PK is
# (csTypeLinkHash, name, declarationIndex, startLine, startColumn) and the row
# uses the DECLARATOR's position, not the declaration's. So `int a, b;` already
# has two distinct keys on position alone, and removing the ordinal changes
# nothing. TWO INDEPENDENT GUARANTEES, and a control that breaks one of them
# proves nothing.
#
# The ordinal stays — the schema requires the column, and defence in depth in a
# primary key is cheap — but the doc comment that called it load-bearing was
# overstating and has been corrected. What IS gated is the outcome: the two
# declarators must have distinct primary keys, asserted directly in
# `fieldsAndEnumMembers`, and PK uniqueness covers the class.

run_break "emit a type reference per declarator" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('    if (declarationIndex === 0) {', '    if (true) {')"
run_break "forget that const is implicitly static" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('        modifiers.has(CsFieldModifier.STATIC) || modifiers.has(CsFieldModifier.CONST),', '        modifiers.has(CsFieldModifier.STATIC),')"
run_break "fold a COMPUTED enum value into a literal" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('        constantValue: isLiteral ? initializer.text : \'\',', '        constantValue: initializer?.text ?? \'\',')"
run_break "call every initialised enum member a literal" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('            : isLiteral\n              ? CsEnumValueKind.LITERAL\n              : CsEnumValueKind.COMPUTED,', '            : CsEnumValueKind.LITERAL,')"
run_break "keep the verbatim @ prefix on an identifier" \
  src/utils/csharp/csharp-identifier-utils.ts \
  "identifier normalisation" \
  "s = s.replace('    name = name.slice(1);', '    name = name;')"
run_break "leave Unicode escapes undecoded" \
  src/utils/csharp/csharp-identifier-utils.ts \
  "identifier normalisation" \
  "s = s.replace('    name = decodeUnicodeEscapes(name);', '    name = name;')"
# Retargeted after f46b4fd replaced the first-`<` cut with stripTypeArguments;
# the full tally at 3561721 found the old pattern testing nothing.
run_break "stop stripping type arguments from the base name" \
  src/utils/csharp/csharp-type-utils.ts \
  "csharp utils" \
  "s = s.replace('  name = stripTypeArguments(name);', '')"

run_break "normalise with NFKC instead of NFC" \
  src/utils/csharp/csharp-identifier-utils.ts \
  "csharp utils" \
  "s = s.replace(\"name.normalize('NFC')\", \"name.normalize('NFKC')\")"
run_break "count nested commas as top-level type arguments" \
  src/utils/csharp/csharp-type-utils.ts \
  "csharp utils" \
  "s = s.replace('    } else if (character === \',\' && depth === 1) {', '    } else if (character === \',\') {')"
run_break "leave a leading scoped/ref on the base type name" \
  src/utils/csharp/csharp-type-utils.ts \
  "csharp utils" \
  "s = s.replace('      name = name.slice(prefix.length);\n      break;', '      break;')"
run_break "skip parenthesised expressions instead of emitting them" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('  [\'parenthesized_expression\', CsExpressionKind.PARENTHESIZED],', '')"
run_break "drop the assignment target/value roles" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      push(node.childForFieldName(\\'left\\') ?? children[0], CsEdgeRole.ASSIGNMENT_TARGET);\n      push(node.childForFieldName(\\'right\\') ?? children[1], CsEdgeRole.ASSIGNMENT_VALUE);', '      push(node.childForFieldName(\\'left\\') ?? children[0], CsEdgeRole.ROOT);\n      push(node.childForFieldName(\\'right\\') ?? children[1], CsEdgeRole.ROOT);')"
run_break "call an event subscription a compound assignment" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('        if (context.eventNamesOnType.has(targetName)) {', '        if (false) {')"
run_break "guess a method group from position alone" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('  return context.methodNamesOnType.has(normalizeCSharpIdentifier(simpleNameOf(node.text)));', '  return true;')"
run_break "put the operator in the kind instead of a column" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      shape.operatorString = operator;', '      shape.operatorString = \'\';')"
run_break "walk a lambda body with the enclosing method as owner" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('  for (const lambda of collectLambdas(body, options.activeSymbols)) {\n    emitLambda(\n      lambda,\n      options,\n      result,\n      expressionResult,\n      parameterNames,\n      scopeAt(lambda, boundaries, body)\n    );\n  }', '')"
run_break "look for a local initializer in the wrong wrapper" \
  src/parsers/csharp/extractors/cs-statement-walker.ts \
  "expression spine" \
  "s = s.replace('    const initializer = namedChildren(declarator).find(', '    const initializer = [].find(')"
run_break "count out arguments as ordinary ones" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    outArgumentCount: argumentNodes.filter((a) => hasArgumentModifier(a, \'out\')).length,', '    outArgumentCount: 0,')"
run_break "emit a query with no clause rows" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "IR completeness" \
  "s = s.replace('  if (shape.kind === CsExpressionKind.QUERY) {', '  if (false) {')"
run_break "leave the clause expressions unparented" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "IR completeness" \
  "s = s.replace('    for (const expression of expressions) {\n      queue.push({', '    for (const expression of []) {\n      queue.push({')"
# The clause LINKS, which were declared, documented as the hop an engine needs
# to desugar a query, and EMPTY on every row in the corpus. The weaker form of
# the check above passed for the wrong reason and could not see it.
run_break "drop the clause source and body links" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "IR completeness" \
  "s = s.replace('  for (const link of deferred) {', '  for (const link of []) {')"
run_break "give a clause an arbitrary position" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "IR completeness" \
  "s = s.replace('      position,\n      // \`join … into g\` is a GROUP JOIN', '      position: position + 5,\n      // \`join … into g\` is a GROUP JOIN')"
run_break "drop the this-parameter marker" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "IR completeness" \
  "s = s.replace(\"    mode,\n    typeName\", \"    mode: CsParameterMode.VALUE,\n    typeName\")"
run_break "read orderby direction from the whole clause" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    let isDescending = false;', \"    let isDescending = allChildren(clause).some((t) => !t.isNamed && t.type === 'descending');\")"
run_break "treat an ordering key as a range variable" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    clauseKind !== CsQueryClauseKind.JOIN\n  ) {\n    return undefined;\n  }\n  return clause.childForFieldName(\\'name\\') ?? childOfType(clause, \\'identifier\\');', '    clauseKind !== CsQueryClauseKind.JOIN\n  ) {\n    return childOfType(clause, \\'identifier\\');\n  }\n  return clause.childForFieldName(\\'name\\') ?? childOfType(clause, \\'identifier\\');')"
# The descent is TOTAL now, so misnaming the statement no longer loses the
# expression — it MISLABELS it. That is section 4's defect and the assertion had
# to change with the fix: the gate checks the foreach collection's rootContext.
run_break "misname foreach in the statement walker" \
  src/parsers/csharp/extractors/cs-statement-walker.ts \
  "expression spine" \
  "s = s.replace('  [\'foreach_statement\', CsRootContext.LOOP_HEADER],', '  [\'for_each_statement\', CsRootContext.LOOP_HEADER],')"
run_break "stop descending into unrecognised statements" \
  src/parsers/csharp/extractors/cs-statement-walker.ts \
  "expression spine" \
  "s = s.replace('      visit(child, context, scopeHere);', '      if (STATEMENT_ROOT_CONTEXT.has(child.type)) { visit(child, context, scopeHere); }')"
run_break "pick a lambda body positionally instead of by field" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('  const body = node.childForFieldName(\'body\') ?? childOfType(node, \'block\');', '  const body = namedChildren(node).find((c) => c.type !== \'parameter_list\' && c.type !== \'modifier\');')"
run_break "stop walking accessor bodies" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('        emitLocalFunctions(accessor.bodyNode, options, result, emitBody(accessor.bodyNode, row, [], options, result));', '')"

# --- cs_block and cs_variable -------------------------------------------------
# Every one of these is a shape that produced right-looking output with a fact
# missing. The gate must name the defect, not merely go red somewhere.
# Reading a pattern's designation POSITIONALLY. Chosen over the catch clause on
# purpose: there, field and position coincide on this grammar, so a control
# mutating it would go green and prove nothing. `o is Exception _` has no `name`
# field at all and its second child is a `discard`, so the positional read
# invents a local named `_`.
run_break "read a pattern's designation positionally instead of by field" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"          nameNode: node.childForFieldName('name'),\n          typeNode: node.childForFieldName('type'),\n          declarationKind: CsVariableDeclarationKind.PATTERN,\", \"          nameNode: namedChildren(node)[1],\n          typeNode: namedChildren(node)[0],\n          declarationKind: CsVariableDeclarationKind.PATTERN,\")"
run_break "collect only statement declarations, not expression ones" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"    case 'declaration_expression': {\", \"    case 'declaration_expression_disabled': {\")"
run_break "drop the deconstruction index" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('          deconstructionIndex: index,', '          deconstructionIndex: 0,')"
run_break "fold ref into the type name instead of a column" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('    if (current.type == \'ref_type\') {', '    if (false) {').replace(\"    if (current.type === 'ref_type') {\", '    if (false) {')"
run_break "lose the scoped lifetime constraint" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('    isScoped: declared.isScoped || input.isScopedModifier === true,', '    isScoped: false,')"
run_break "let the generic block rule relabel the method body scope" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('          state.depth === 0 ? state.scopeKind : (scopeKindFor(node) ?? state.scopeKind),', '          scopeKindFor(node) ?? state.scopeKind,')"
run_break "treat both if branches as one block" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('    return alternative !== null && alternative.id === node.id\n      ? CsBlockKind.ELSE\n      : undefined;', '    return undefined;')"
# NEVER STORE STATE ON A NODE, AND KEY THE SIDE TABLE ON node.id.
#
# Two earlier versions of this control were removed rather than left green,
# and the reason is worth keeping:
#
#   - `alternative === node` instead of `alternative.id === node.id`. Measured
#     on this grammar, `childForFieldName` hands back the SAME wrapper object as
#     `namedChildren`, so `===` happens to work at that site. `node.id` stays,
#     because the wrapper cache evicts and a comparison right on ten files drops
#     rows on ten thousand — but a control that cannot fail is not evidence.
#   - keying the table on the byte RANGE versus the start offset. Only expression
#     ROOTS go in the table, and two roots in one method do not share a start
#     offset, so the mutation was unobservable.
#
# What IS observable is the line. `int plain = 0, second = 1;` puts two locals
# and two different initializers on one line, and a table keyed on the line maps
# both to whichever was written first — the exact shape that made Python's flat
# output unpairable.
run_break "key the expression side table on the line instead of the node" \
  src/parsers/csharp/extractors/cs-node.ts \
  "blocks and locals" \
  "s = s.replace('export function nodeId(node: Parser.SyntaxNode): number {\n  return node.id;', 'export function nodeId(node: Parser.SyntaxNode): number {\n  return node.startPosition.row;')"
run_break "read checked and unchecked as the same block" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"    return hasAnonymousToken(node, 'checked') ? CsBlockKind.CHECKED : CsBlockKind.UNCHECKED;\", '    return CsBlockKind.CHECKED;')"
run_break "drop the label from a labelled statement" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"            ? normalizeCSharpIdentifier(childOfType(node, 'identifier')?.text ?? '')\", \"            ? ''\")"
run_break "forget which try a catch guards" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('        block.setTryStatementHash(state.tryHash);', '        block.setTryStatementHash(\'\');')"
run_break "drop the caught type names" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"  const declaration = childOfType(node, 'catch_declaration');\n  const typeNode = declaration?.childForFieldName('type');\", \"  const declaration = childOfType(node, 'catch_declaration');\n  const typeNode = declaration === undefined ? undefined : declaration.childForFieldName('name');\")"
run_break "walk a lambda body with the enclosing method as owner" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"    node.type === 'lambda_expression' ||\n    node.type === 'anonymous_method_expression' ||\n    node.type === 'local_function_statement'\n  );\", \"    node.type === 'never_matches_anything'\n  );\")"
run_break "stop walking local function bodies" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "blocks and locals" \
  "s = s.replace('  const boundaries = emitBody(node, method, parameters, bodyOptions, result, enclosing);\n  emitLocalFunctions(node, bodyOptions, result, boundaries);', '  emitLocalFunctions(node, bodyOptions, result, new Map());')"
run_break "write var as a type name" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"  const completeTypeName = isImplicit ? '' : declared.typeNode!.text;\", \"  const completeTypeName = declared.typeNode?.text ?? '';\")"
run_break "lose the initializer expression link" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('      variable.setInitializerExpressionLinkHash(hash);', '      variable.setInitializerExpressionLinkHash(\'\');')"
run_break "lose the block condition link" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('          block.setConditionExpressionLinkHash(hash);', '          block.setConditionExpressionLinkHash(\'\');')"
run_break "erase the type argument of a local's reified generic" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('    result.typeReferences.push(...references);', '    result.typeReferences.push(...references.slice(0, 1));')"
run_break "reach a nested tuple pattern twice" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('  if (parent !== null && parent.type === node.type) {\n    // Reached from its own outer pattern, which already flattened it. Emitting\n    // again would DOUBLE every binding it holds.\n    return;\n  }', '')"

# Top-level blocks and locals are owned by <Main>$ (ruling v1.6 §4.0.3), whose
# hash is per file. Handing them an EMPTY owner is the collision that was
# measured at 6 duplicates per relation across two same-shaped Program.cs.
run_break "read every declaration_expression as an out var" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('      const tupleIndex = deconstructionIndexInTuple(node);', '      const tupleIndex = undefined;')"
run_break "push a null-conditional callee whole as the method name" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      } else if (callee?.type === 'conditional_access_expression') {\", \"      } else if (false) {\")"
run_break "read an assignment's operands by position" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      push(node.childForFieldName('left') ?? children[0], CsEdgeRole.ASSIGNMENT_TARGET);\\n      push(node.childForFieldName('right') ?? children[1], CsEdgeRole.ASSIGNMENT_VALUE);\", \"      push(children[0], CsEdgeRole.ASSIGNMENT_TARGET);\\n      push(children[1], CsEdgeRole.ASSIGNMENT_VALUE);\")"
run_break "leave the lambda expression row unlinked from its method row" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('  expressionResult.rowByNodeId?.get(nodeId(node))?.setAnonymousDeclarationHash(method.getHash());', '')"
run_break "miss a lambda that is the whole initializer" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace(\"    input.node.type === 'lambda_expression' || input.node.type === 'anonymous_method_expression'\\n      ? [input.node]\", \"    false\\n      ? [input.node]\")"
run_break "never resolve a reference to its declaration row" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('    if (found !== undefined) {\\n      link.row.setReferencedEntityHash(found.hash);\\n    }', '')"
run_break "resolve a reference to the FIRST declaration of its name instead of the nearest preceding" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('      if (declaration.group === groupOf(link.kind)) {\\n        found = declaration;\\n      }', '      if (declaration.group === groupOf(link.kind) && found === undefined) {\\n        found = declaration;\\n      }')"
run_break "count a query clause's declared name as its first expression" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "IR completeness" \
  "s = s.replace('        (declared === undefined || c.id !== declared.id) &&\\n', '')"
run_break "declare no range variable for an into continuation" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "IR completeness" \
  "s = s.replace(\"        if (child.type === 'identifier') {\\n          pushRangeVariable(child, node, state, options, result);\\n        }\", '')"
run_break "rebuild a heritage row without its type-reference link" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace('  rebuilt.setTypeReferenceLinkHash(row.getTypeReferenceLinkHash());', '')"
run_break "skip the local functions declared in an accessor body" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('        emitLocalFunctions(accessor.bodyNode, options, result, emitBody(accessor.bodyNode, row, [], options, result));', '        emitBody(accessor.bodyNode, row, [], options, result);')"
run_break "miss the inner function of a curried lambda" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      body.type === 'lambda_expression' || body.type === 'anonymous_method_expression'\\n        ? [body]\", \"      false\\n        ? [body]\")"
# Expression-position type references (ruling v1.6 §4.0.5) and the two
# declared-and-never-written links the partition found.
run_break "label an as-expression's type CAST" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      emit(node.childForFieldName('right'), CsTypeRefContext.AS_TYPE);\", \"      emit(node.childForFieldName('right'), CsTypeRefContext.CAST);\")"
run_break "forget the cast's forward link to its type reference" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('        row.setCastTypeReferenceLinkHash(root.getHash());', '')"
run_break "emit the method type arguments under the enclosing method instead of the call" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      ownerLinkHash: row.getHash(),\\n      referenceOwnerKind: CsReferenceOwnerKind.EXPRESSION,', '      ownerLinkHash: context.ownerHash,\\n      referenceOwnerKind: CsReferenceOwnerKind.EXPRESSION,')"
run_break "leave the receiver link on the call site empty" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    callSiteByParentHash.get(pending.parentHash)?.setReceiverExpressionLinkHash(row.getHash());', '')"
run_break "emit no type for a typed lambda parameter" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('    if (row === undefined || facts.typeNode === undefined) {\\n      return;\\n    }\\n    result.typeReferences.push(', '    if (row === undefined || facts.typeNode === undefined || true) {\\n      return;\\n    }\\n    result.typeReferences.push(')"
run_break "give attribute-argument expressions no type-reference sink" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "expression spine" \
  "s = s.replace('      typeReferences: result.typeReferences,\\n    };\\n    extractExpressionTree(', '    };\\n    extractExpressionTree(')"
# The fixture-integrity gate: a fixture cut short must be a NAMED failure, not
# a healthy file with fewer rows. The mutation drops a fixture's closing
# brace and final line, which is what a stray backtick did seven times.
run_break "cut a fixture short" \
  src/test/csharp-tests.ts \
  "every fixture is a fixture" \
  "s = s.replace('    private bool Compute(int n) => n > 0;\\n}\\n\`,', '    private bool Compute(int n) => n > 0;\`,')"
# The line comparison is the only one of the three that sees a file the
# PARSER got short while the text the suite holds is whole: the disk copy is
# written two lines short (braces in the held text still balance, its newline
# is still there). The previous form of this control disabled the comparison
# and expected the gate to fail, which nothing can make happen — a control
# that could not fail, found by the full tally.
run_break "write every fixture to disk two lines short of the text the suite holds" \
  src/test/csharp-tests.ts \
  "every fixture is a fixture" \
  "s = s.replace(\"    await fsp.writeFile(path.join(dir, name), source, 'utf-8');\", \"    await fsp.writeFile(path.join(dir, name), source.split('\\\\n').slice(0, -3).join('\\\\n') + '\\\\n', 'utf-8');\")"
# CS-CORPUS-19: the regression the CS-CORPUS-6 fix introduced, re-applied.
run_break "hand a constructor initializer itself back as its argument list" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('  return isPrimaryBaseArgumentList(node) ? node : undefined;', '  return node;')"
# The three existence-only links promoted to meaning (the link-column risk
# register 1-3): each control points the link at a NEIGHBOURING row, which
# resolves and is wrong — the LINQ shape.
run_break "link a heritage entry to the previous entry's type reference" \
  src/parsers/csharp/extractors/cs-heritage-extractor.ts \
  "heritage and generics" \
  "s = s.replace('      heritageRow.setTypeReferenceLinkHash(root.getHash());\\n    }\\n    typeReferences.push(...references);', '      heritageRow.setTypeReferenceLinkHash((typeReferences[0] ?? root).getHash());\\n    }\\n    typeReferences.push(...references);')"
run_break "link a block to the first expression root in its body instead of its header" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('        const hash = options.rootHashByNodeId?.get(nodeId(condition));', '        const firstBodyRoot = [...(options.rootHashByNodeId?.entries() ?? [])].map(([, h]) => h).pop();\\n        const hash = firstBodyRoot;')"
run_break "own a comment by the declaration AFTER the one it precedes" \
  src/parsers/csharp/extractors/cs-comment-extractor.ts \
  "attributes and comments" \
  "s = s.replace('    if (declaration.startIndex < comment.endIndex) {\\n      continue;\\n    }', '    if (declaration.startIndex < comment.endIndex) {\\n      continue;\\n    }\\n    if (!skippedOne) { skippedOne = true; continue; }').replace('  for (const declaration of declarations) {', '  let skippedOne = false;\\n  for (const declaration of declarations) {')"
# Ruling v1.7 — bare member names. The OVER-classification direction is the
# risk, so the controls push it: a member kind ahead of the local that
# shadows it, and the receiver-dependent name half of x.Foo.
run_break "classify a bare member name ahead of the local that shadows it" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('  if (pending.localNames.has(name)) {\\n    return CsReferencedEntityKind.LOCAL_VARIABLE;\\n  }', '  if (pending.localNames.has(name) && !context.fieldNamesOnType.has(name)) {\\n    return CsReferencedEntityKind.LOCAL_VARIABLE;\\n  }')"
run_break "classify the name half of x.Foo as a member of the enclosing type" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('  if (pending.role !== CsEdgeRole.MEMBER_NAME) {\\n    if (context.eventNamesOnType.has(name)) {', '  if (true) {\\n    if (context.eventNamesOnType.has(name)) {')"
run_break "leave a member reference unlinked from its row" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('    const hash = table.get(link.name);\\n    if (hash !== undefined) {\\n      link.row.setReferencedEntityHash(hash);\\n    }', '')"
# Risk register 4-6 promoted; and the two initializer links that were declared
# and never written. Each control points at a NEIGHBOURING row or unsets it.
run_break "link a typeof attribute argument to the attribute's own type reference" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('        argument.setReferencedTypeReferenceLinkHash(root.getHash());', '        argument.setReferencedTypeReferenceLinkHash((result.typeReferences[0] ?? root).getHash());')"
run_break "link every type variable to the first type parameter in scope" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "type-reference tree" \
  "s = s.replace('      ? input.typeParametersInScope?.get(shape.typeName)', '      ? [...(input.typeParametersInScope?.values() ?? [])][0]')"
run_break "leave a field's initializer link unset" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('    if (fieldInitializer !== \\'\\') {\\n      field.setInitializerExpressionLinkHash(fieldInitializer);\\n    }', '')"
run_break "link a property's initializer to a neighbouring field's row" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('    property.setInitializerExpressionLinkHash(propertyInitializer);', '    property.setInitializerExpressionLinkHash(result.fields[0]?.getHash() ?? propertyInitializer);')"
# Risk register 7: an initializer's call names the type that declares the
# initializer. The first control is the one the old gate could NOT see — with
# no method hop and no type hop, the top-level fallback accepted the module
# hash, so an unset column read as complete.
run_break "leave the type hop off a call with no enclosing method" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    callerTypeLinkHash: context.csTypeLinkHash,', '    callerTypeLinkHash: context.callerMethodLinkHash === \\'\\' ? \\'\\' : context.csTypeLinkHash,')"
run_break "file every type's members under the first type in the file" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "expression spine" \
  "s = s.replace('        csTypeLinkHash: row.getHash(),\\n        typeQualifiedName: row.qualifiedName,', '        csTypeLinkHash: types[0]!.getHash(),\\n        typeQualifiedName: row.qualifiedName,')"
# Risk register 8: member owner columns by name. Filing a nested type's members
# under its ENCLOSING type resolves — and touches no initializer call, so only
# the owner table can see it.
run_break "file a nested type's members under its enclosing type" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "fields and enum members" \
  "s = s.replace('        csTypeLinkHash: row.getHash(),\\n        typeQualifiedName: row.qualifiedName,', '        csTypeLinkHash: scope.containingTypeLinkHash || row.getHash(),\\n        typeQualifiedName: row.qualifiedName,')"
# Risk register 9: an attribute names its OWN type reference.
run_break "link every attribute to the first type reference in the file" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('      attribute.setTypeReferenceLinkHash(root.getHash());', '      attribute.setTypeReferenceLinkHash((result.typeReferences[0] ?? root).getHash());')"
# Risk register 10 and 11: the module's entry-point hop is `<Main>$` itself;
# a field's type link spells the declared type.
run_break "point the module's entry-point hop at the last method in the file" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "expression spine" \
  "s = s.replace('      module.setModuleInitMethodLinkHash(entryPoint.getHash());', '      module.setModuleInitMethodLinkHash(topLevel.methods[topLevel.methods.length - 1]!.getHash());')"
run_break "link a field's type to the previous field's type reference" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('        field.setTypeReferenceLinkHash(root.getHash());', '        field.setTypeReferenceLinkHash((result.typeReferences.find((r) => r.context === CsTypeRefContext.FIELD_TYPE) ?? root).getHash());')"
# Risk register 12: an attribute's type link is the ENCLOSING type. The first
# control prefers the outer type — wrong and resolving only for members of
# nested types; the second is what the code did before, '' for every member.
run_break "file a nested type's attributes under the outer type" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('    const typeHashHere = ownType?.hash ?? enclosingTypeHash;', '    const typeHashHere = enclosingTypeHash || (ownType?.hash ?? \\'\\');')"
run_break "write no type link for a member's attributes" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('      walk(child, typeHashHere);', '      walk(child, ownType === undefined ? typeHashHere : \\'\\');')"
# Risk register 13: a block, a local and an expression name the type that
# contains them. The same mutation as register 7's neighbour control, judged
# against the blocks gate — that gate did not fail under it before.
run_break "file every type's blocks and locals under the first type in the file" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "blocks and locals" \
  "s = s.replace('        csTypeLinkHash: row.getHash(),\\n        typeQualifiedName: row.qualifiedName,', '        csTypeLinkHash: types[0]!.getHash(),\\n        typeQualifiedName: row.qualifiedName,')"
# Registers 14-18: the five INTEGRITY columns, promoted. Each control points
# the link at a row of the right relation that is not the right row.
run_break "own every type parameter by the first type in the file" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "heritage and generics" \
  "s = s.replace('        ownerLinkHash: row.getHash(),', '        ownerLinkHash: types[0]!.getHash(),')"
run_break "own a nested block by its parent block instead of its method" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace('        methodOwnerHash: options.csMethodLinkHash,', '        methodOwnerHash: state.blockHash || options.csMethodLinkHash,')"
run_break "parent every query clause to the first expression in the body" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      csExpressionLinkHash: query.getHash(),\\n      parentQueryLinkHash: query.getHash(),\\n      position,\\n      // \`join', '      csExpressionLinkHash: query.getHash(),\\n      parentQueryLinkHash: (result.expressions[0] ?? query).getHash(),\\n      position,\\n      // \`join')"
run_break "link an attribute argument to the last expression of its own tree" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('      argument.setExpressionLinkHash(root);', '      argument.setExpressionLinkHash(expressionResult.expressions[expressionResult.expressions.length - 1]?.getHash() ?? root);')"
run_break "contain a nested type in its grandparent" \
  src/parsers/csharp/extractors/cs-type-extractor.ts \
  "partial grouping" \
  "s = s.replace('    containingTypeLinkHash: parent.getHash(),', '    containingTypeLinkHash: outer.containingTypeLinkHash,')"
# CS-CORPUS-25: a file's own #define / #undef. The first control is the
# regression re-applied — the evaluator reading the configuration and never
# the file; the other two take the #if branch of the top-of-file chain
# regardless, and ignore #undef.
run_break "give a with-initializer no expression kind" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"  ['with_initializer', CsExpressionKind.ASSIGNMENT],\", '')" \
  "ASSIGNMENT initializer(s) as children, expected 2"
run_break "swap a with-initializer's target and value" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('        push(children[0], CsEdgeRole.INITIALIZER_TARGET);\\n        push(children[1], CsEdgeRole.INITIALIZER_VALUE);', '        push(children[1], CsEdgeRole.INITIALIZER_TARGET);\\n        push(children[0], CsEdgeRole.INITIALIZER_VALUE);')"
# CS-CORPUS-24: the regression re-applied — a non-conditional directive kept
# as a named child, so every positional read after it is off by one.
run_break "compile the gate corpus under a different target framework" \
  src/test/csharp-tests.ts \
  "regime pins" \
  "s = s.replace(\"    targetFrameworks: ['net8.0'],\\n    defineConstants: [],\\n    langVersion: '13.0',\", \"    targetFrameworks: ['net9.0'],\\n    defineConstants: [],\\n    langVersion: '13.0',\")"
run_break "compile the gate corpus with a define the pins do not know" \
  src/test/csharp-tests.ts \
  "regime pins" \
  "s = s.replace(\"    targetFrameworks: ['net8.0'],\\n    defineConstants: [],\\n    langVersion: '13.0',\", \"    targetFrameworks: ['net8.0'],\\n    defineConstants: ['STRAY'],\\n    langVersion: '13.0',\")"
# Containment (cs-oracle's ruling on CS-CORPUS-22, generalised): a parent whose
# span stops early leaves its children outside it. Both controls are mutations
# of a CORRECT emission — non-vacuity, not the originating defect: cs-fixtures
# measured containment at CS-CORPUS-22's own commit and it reads 0 violations
# before and after, because a wrong parse builds a consistent tree. The two
# invariants that DID discriminate (no INITIALIZER under a CAST, no creation
# ending on an identifier character) get their originating-defect control
# below: the grammar cannot be mutated by the harness, so the extractor is
# made to emit what the bad parse emitted.
run_break "end an expression at its type field" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "spans nest" \
  "s = s.replace(\"const spanEnd = spanEndOf(rowNode);\", \"const spanEnd = (rowNode.childForFieldName('type') ?? rowNode).endPosition;\")"
run_break "end a creation at its type name, as the mis-parse did" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "spans nest" \
  "s = s.replace(\"const spanEnd = spanEndOf(rowNode);\", \"const spanEnd = (rowNode.type === 'object_creation_expression' ? (rowNode.childForFieldName('type') ?? rowNode) : rowNode).endPosition;\")" \
  "end on an identifier character"
run_break "end a block at its first statement" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "spans nest" \
  "s = s.replace(\"        endLine: endLine(node),\\n        startColumn: startColumn(node),\\n        endColumn: node.endPosition.column,\", \"        endLine: endLine(node.namedChild(0) ?? node),\\n        startColumn: startColumn(node),\\n        endColumn: (node.namedChild(0) ?? node).endPosition.column,\")"
# CS-CORPUS-27's second half: a type name's generic in a non-last segment
# dropped the segments after it — the regression re-applied.
run_break "cut a type name at its first <" \
  src/utils/csharp/csharp-type-utils.ts \
  "csharp utils" \
  "s = s.replace('  name = stripTypeArguments(name);', '  name = name.indexOf(\\'<\\') >= 0 ? name.slice(0, name.indexOf(\\'<\\')) : name;')" \
  "baseTypeName keeps the nested type after a generic segment"
# CS-ORACLE-2: a discard is not a reference. The first control is the
# regression re-applied (every `_` a NAME_REFERENCE); the second files a
# DECLARED `_` as a discard — the rule's other edge.
run_break "read every _ as a name reference" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      if (node.text === '_' && isDiscardPosition(node) && !nameIsDeclared('_', context, localNames)) {\", \"      if (false) {\")" \
  "expected 5 DISCARD"
run_break "file a declared _ as a discard" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"      if (node.text === '_' && isDiscardPosition(node) && !nameIsDeclared('_', context, localNames)) {\", \"      if (node.text === '_' && isDiscardPosition(node)) {\")" \
  "a declared \`_\` is a variable, not a discard"
# CS-ORACLE-3: many projects into one directory. The first control is the
# regression re-applied — each project publishes its own writers into the
# same names; the second extracts a file reached from two roots twice.
run_break "give every project its own writers into the shared directory" \
  src/workflows/csharp/csharp-project-analyzer.ts \
  "registered front end" \
  "s = s.replace('        summaries.push(await this.analyze({ ...options, rootDir }, shared));', '        summaries.push(await this.analyze({ ...options, rootDir }));')" \
  "have no cs_module row after the many-project run"
run_break "extract a file reached from two roots twice" \
  src/workflows/csharp/csharp-project-analyzer.ts \
  "registered front end" \
  "s = s.replace('        if (context.seen.has(absoluteFilePath)) {', '        if (false) {')" \
  "a file reached from two roots was extracted twice"
# CS-ORACLE-1: `await` is an identifier outside an async context. The first
# control is the regression re-applied (every await_expression an AWAIT);
# the second the other edge — a real await in an async method re-read as an
# identifier.
run_break "cap the expression tree at TypeScript's 32 levels" \
  src/constants/csharp-constants.ts \
  "expression spine" \
  "s = s.replace('export const CSHARP_EXPRESSION_MAX_DEPTH = 256;', 'export const CSHARP_EXPRESSION_MAX_DEPTH = 32;')" \
  "drops its innermost segments SILENTLY"
run_break "file an indexer's init accessor as a set" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "accessor 1:1" \
  "s = s.replace('    property: CsMethodKind.PROPERTY_INIT,\\n    indexer: CsMethodKind.INDEXER_INIT,', '    property: CsMethodKind.PROPERTY_INIT,\\n    indexer: CsMethodKind.INDEXER_SET,')" \
  "an init accessor on an indexer is not a set"
# CS-ORACLE-6: the regression re-applied — `unmanaged` sets no structured column.
run_break "read unmanaged as no constraint at all" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"      if (text === 'unmanaged') {\\n        facts.hasStructConstraint = true;\\n        facts.hasUnmanagedConstraint = true;\\n        continue;\\n      }\", '')" \
  "unmanaged implies the struct constraint"
# v1.15: the implication alone — struct written, unmanaged not — is the half of
# CS-ORACLE-6 that stayed open until the column existed.
run_break "write only the struct implication for unmanaged" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace('        facts.hasUnmanagedConstraint = true;\\n', '')" \
  "unmanaged and struct are indistinguishable"
# v1.15, the other direction: a column that copies the struct flag records nothing.
run_break "set unmanaged for every struct constraint" \
  src/parsers/csharp/extractors/cs-type-parameter-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"      if (text === 'struct') {\\n        facts.hasStructConstraint = true;\", \"      if (text === 'struct') {\\n        facts.hasStructConstraint = true;\\n        facts.hasUnmanagedConstraint = true;\")" \
  "struct does not imply unmanaged"
# A read is not a check: the two links this sweep found empty, and the check
# that now sees the whole class at once.
run_break "leave the enum member's value link unset" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "fields and enum members" \
  "s = s.replace('    if (valueRoot !== \\'\\') {\\n      enumMember.setExpressionLinkHash(valueRoot);\\n    }', '')"
run_break "drop the C# parser from the factory" \
  src/parsers/parser-factory.ts \
  "registered front end" \
  "s = s.replace('    this.registerParser(new CSharpParser());', '')"
run_break "drop the C# detector from the project detector" \
  src/utils/project-detector.ts \
  "registered front end" \
  "s = s.replace('    this.registerDetector(new CSharpDetector());', '')"
run_break "make the C# detector claim any ancestor that contains C#" \
  src/language-detectors/csharp-detector.ts \
  "registered front end" \
  "s = s.replace('      return await this.hasCSharpSource(projectPath, 1);', '      return await this.hasCSharpSource(projectPath, this.MAX_DEPTH);')"
run_break "dispatch no C# project from the entry point" \
  src/extract.ts \
  "registered front end" \
  "s = s.replace('      : csharpAnalyzer.analyzeMany(csharpProjects.map((project) => project.path), {', '      : csharpAnalyzer.analyzeMany([], {')"
run_break "own top-level blocks and locals by nothing" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "PK uniqueness" \
  "s = s.replace('      csMethodLinkHash: entryPointHash,\\n      serviceVersionLinkHash: input.serviceVersionLinkHash,', '      csMethodLinkHash: \\'\\',\\n      serviceVersionLinkHash: input.serviceVersionLinkHash,')"
run_break "own top-level expressions by nothing" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('    ownerHash: entryPointHash,\\n    rootContext: CsRootContext.EXPRESSION_STATEMENT,\\n    serviceVersionLinkHash: input.serviceVersionLinkHash,\\n    callerMethodLinkHash: entryPointHash,', '    ownerHash: entryPointHash,\\n    rootContext: CsRootContext.EXPRESSION_STATEMENT,\\n    serviceVersionLinkHash: input.serviceVersionLinkHash,\\n    callerMethodLinkHash: \\'\\',')"
run_break "synthesise no Program type for a top-level file" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "expression spine" \
  "s = s.replace('  if (topLevelStatementsOf(root).length === 0) {\\n    return undefined;', '  if (topLevelStatementsOf(root).length >= 0) {\\n    return undefined;')"
run_break "give the synthesised Program its own group key" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "expression spine" \
  "s = s.replace('    declarationGroupKey: declarationGroupKey(declarationScopeKey, name, 0),', '    declarationGroupKey: declarationGroupKey(declarationScopeKey + csModuleLinkHash, name, 0),')"
run_break "stop walking top-level statements" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "expression spine" \
  "s = s.replace('  const statements = topLevelStatementsOf(input.root);', '  const statements: Parser.SyntaxNode[] = [];')"
run_break "read a collection expression as the index access the grammar called it" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "a collection expression is not an index" \
  "s = s.replace(\"  if (node.type !== 'element_binding_expression') {\\n    return undefined;\\n  }\\n  if (node.parent?.type === 'conditional_access_expression') {\", \"  if (node.type !== 'element_binding_expression' || node.parent !== null) {\\n    return undefined;\\n  }\\n  if (node.parent?.type === 'conditional_access_expression') {\")" \
  "COLLECTION_EXPRESSION row(s), expected 1"
run_break "take the legal a?[0] for a collection too" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "a collection expression is not an index" \
  "s = s.replace(\"node.parent?.type === 'conditional_access_expression'\", 'false')" \
  "is a null-conditional INDEX access"
run_break "count the inserted identifier of [] as an element" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "a collection expression is not an index" \
  "s = s.replace('    return inner !== undefined && inner.startIndex !== inner.endIndex;', '    return inner !== undefined;')" \
  "element(s), expected 0"
run_break "build the collection's children by hand, skipping the central unwrap" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a collection expression is not an index" \
  "s = s.replace('      const elements = misparsedCollectionExpressionOf(node)?.elements ?? children;', '      const elements = children;')" \
  "naming the empty string"
run_break "keep the parse gap for a shape the parser reads" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "a collection expression is not an index" \
  "s = s.replace('    if (isEmptyCollectionInsertedNode(node)) {\\n      readShapes += 1;\\n      continue;\\n    }', '')" \
  "parse gap row"
run_break "let the fallback report a file whose only error is a shape we read" \
  src/parsers/csharp/extractors/cs-parse-gap-extractor.ts \
  "a collection expression is not an index" \
  "s = s.replace('  if (rows.length === 0 && readShapes > 0) {', '  if (rows.length === 0 && readShapes < 0) {')" \
  "parse gap row"
# ---------------------------------------------------------------------------
# C# 14 extension blocks. The grammar reads `extension(T x) { ... }` as a
# CONSTRUCTOR whose body holds the members as statements, so a declaration_list
# walk sees none of them: 0 methods and 0 properties where three rows belong.
# The pre-parse pass blanks the header and the two braces and hands the grammar
# ordinary C#. Each control below re-applies one half of that.
# ---------------------------------------------------------------------------
run_break "never flatten an extension block" \
  src/parsers/csharp/extractors/cs-extension-block.ts \
  "C# 14 extension members are emitted" \
  "s = s.replace('  if (!EXTENSION_PROBE.test(text)) {', '  if (true) {')" \
  "missing"
run_break "flatten a file whose blocks are not all accounted for" \
  src/parsers/csharp/extractors/cs-extension-block.ts \
  "an unreadable extension block leaves the file alone" \
  "s = s.replace('  if (clean.length + textual.length !== headersInText || headersInText === 0) {', '  if (headersInText === 0) {')" \
  "isExtension"
# The TEXTUAL path is what reads a predefined-type receiver, and nothing else can:
# disabling it must lose the members of such a block, which is the defect the
# path was added for. Without this control the path could be deleted and the
# check above would still pass on its generic-block half alone.
# The REDIRECT is what stops the fabricated comparisons: without it the `<` binary
# emits as itself, the type arguments become value references and the call counts
# the run. Controls the repair rather than the detector, because the detector can
# be present and unused.
run_break "emit the fabricated comparison instead of the creation" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a generic creation in argument position is one argument" \
  "s = s.replace('  if (node.type === \'binary_expression\' && node.parent?.type === \'argument\') {', '  if (false) {')" \
  "BINARY"
# And the GRAFT: with the redirect alone the creation emits with no children, so
# the arguments and initializer the source wrote are lost with the comparison.
run_break "drop the arguments the misparse filed inside the cast" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a generic creation in argument position is one argument" \
  "s = s.replace('      const runPieces = misparsedGenericCreationAtCreationOf(node);', '      const runPieces = undefined;')" \
  "initializer"
run_break "read a one-type-argument generic creation as the comparison chain it looks like" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "a generic creation in argument position is one argument" \
  "s = s.replace(\"  const initializer = tail.childForFieldName('value');\\n  if (initializer === null || initializer.type !== 'initializer_expression') {\", \"  const initializer = tail.childForFieldName('value');\\n  if (initializer !== null || initializer === null) {\")" \
  "BINARY/CAST row"
run_break "drop the type arguments the grammar detached from a creation's type" \
  src/parsers/csharp/extractors/cs-type-reference-extractor.ts \
  "a generic creation in argument position is one argument" \
  "s = s.replace('input.splitTypeArguments ?? []', '[]')" \
  "Reified generics"
run_break "correct a misparsed creation's arguments on its expression row and not on its call site" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a generic creation in argument position is one argument" \
  "s = s.replace('      ? repairedCreationArgumentNodes(creationPieces)\\n', '      ? []\\n')" \
  "on its call site"
run_break "never locate a header the tree did not present" \
  src/parsers/csharp/extractors/cs-extension-block.ts \
  "an unreadable extension block leaves the file alone" \
  "s = s.replace('    const span = textualBlockSpan(text, headerStart);', '    const span = undefined;')" \
  "Zero"
run_break "give a flattened receiver VALUE mode instead of THIS" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "C# 14 extension members are emitted" \
  "s = s.replace('    mode: CsParameterMode.THIS,\n    isThis: true,', '    mode: CsParameterMode.VALUE,\n    isThis: true,')" \
  "not THIS"
run_break "record an extension property as an ordinary property" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "C# 14 extension members are emitted" \
  "s = s.replace('    isExtension: isExtensionMember,', '    isExtension: false,')" \
  "isExtension"
run_break "give an extension property accessor no receiver" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "C# 14 extension members are emitted" \
  "s = s.replace('    isExtension: receiver !== undefined,', '    isExtension: false,')" \
  "get_IsBlank.isExtension"
run_break "parse the file exactly as it ends" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "a pragma at the end is not a gap" \
  "s = s.replace(\"flattened.text.endsWith('\\\\n') ? flattened.text : \", \"true ? flattened.text : \")" \
  "parse gap row"
run_break "read a call the grammar called a lambda as a lambda" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "a call is not a lambda" \
  "s = s.replace('  if (node.type !== \'lambda_expression\') {\\n    return undefined;\\n  }\\n  const children = namedChildren(node);\\n  const callee = children[0];', '  if (node.type !== \'lambda_expression\' || node.parent !== null) {\\n    return undefined;\\n  }\\n  const children = namedChildren(node);\\n  const callee = children[0];')" \
  "call(s) to AssertQuery"
run_break "keep every invented parameter as a parameter" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "a call is not a lambda" \
  "s = s.replace('  const inventedParameter = inventedLambdaParameterOf(node);', '  const inventedParameter = undefined as Parser.SyntaxNode | undefined;')" \
  "named async"
run_break "count a repaired call's arguments from its own node" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a call is not a lambda" \
  "s = s.replace('      ? [...asyncCall.argumentNodes, asyncCall.callee.parent!]', '      ? []')" \
  "argument(s), expected"
run_break "leave a repaired call's span at its callee name" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "a call is not a lambda" \
  "s = s.replace('  if (asyncCallee !== undefined && node.parent !== null) {', '  if (false && node.parent !== null) {')" \
  "lies outside its parent"
run_break "count a statement the recovery ejected past a type as a top-level one" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "a top-level statement precedes every declaration" \
  "s = s.replace('    if (child.type !== \'global_statement\' || seenDeclaration) {', '    if (child.type !== \'global_statement\') {')" \
  "hasTopLevelStatements"
run_break "leave C# 12's semicolon body to the grammar" \
  src/parsers/csharp/extractors/cs-fact-extractor.ts \
  "a semicolon is a body" \
  "s = s.replace('rewriteSemicolonBodies(blanked.text).text', 'blanked.text')" \
  "has NO row"
run_break "leave ref where the modifier list put it" \
  src/parsers/csharp/extractors/cs-modifier-order.ts \
  "ref is not always last" \
  "s = s.replace('  let count = 0;', '  let count = 0;\\n  if (text.length >= 0) { return { text, count }; }')" \
  "has NO row"
run_break "rotate ref past any two words, with no allowlist and no keyword anchor" \
  src/parsers/csharp/extractors/cs-modifier-order.ts \
  "ref is not always last" \
  "s = s.replace('const REF_BEFORE_MODIFIERS = new RegExp(', 'const REF_BEFORE_MODIFIERS = /\\\\bref(\\\\s+)([A-Za-z_][A-Za-z0-9_]*)(\\\\s+)([A-Za-z_][A-Za-z0-9_]*)\\\\b/g; const UNUSED_REGEX = new RegExp(')" \
  "ref RETURN"
# ---------------------------------------------------------------------------
# SIXTEEN CONTROLS WERE REMOVED HERE, and what they were testing is the finding.
#
# Each mutated a path that resolves a `#if` branch from the TREE — descending
# into inactive arms in the type, member and using extractors; taking the
# untaken arm of a chain, a head form or an operator form; reading a `#define`
# from a `preproc_define` node; assembling a region's branches; starting a
# declaration at a guarding directive; counting attributes under a directive —
# plus C# 14's extension-block flattening, whose node type the published grammar
# does not produce at all. Not one of the sixteen could make a gate fail.
#
# The reason is the pre-parse blanking pass: directives and inactive arms are
# whitespace before the grammar sees the text, so there is no directive in the
# tree to resolve and no inactive arm to descend into. Measured over 2,314
# files, the only `preproc_*` nodes that survive are `#region`, `#endregion`,
# `#nullable` and `#pragma`, none of which is conditional. The gate `no preproc
# node survives the pre-parse pass` asserts that, with the survivors as an
# allowlist.
#
# AND THE TREE LAYER IS NOT DEAD CODE — that is the part worth being exact
# about, because the first draft of this comment said it was. Disabling blanking
# and re-running the suite leaves `branch selection in every position` PASSING:
# with directives back in the tree, the old layer resolves the branches
# correctly, exactly as it did before blanking existed. What blanking buys is
# PARSEABILITY — the limitation set went 48 to 19 — not branch correctness. So
# the layer stays, as the deliberate second line the accessor-kind guard below
# is also an instance of, and the controls for it go, because a control that
# cannot fail in the shipped pipeline reports confidence it does not have.
#
# WHAT REPLACES THEM is below. The blanking pass had NO control of its own —
# sixteen guarding the unreachable layer and none guarding the live one — and it
# is the most load-bearing piece of this front end.
# ---------------------------------------------------------------------------
# Disabling blanking is caught by the gate that asserts its property, and by
# the fixture corpus that stops parsing without it — NOT by branch selection,
# which the tree layer still gets right. Naming the gate that actually fails is
# the whole discipline here.
run_break "blank nothing, and let the grammar see both arms" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "no preproc node survives the pre-parse pass" \
  "s = s.replace('  return blankAndReport(source, active).text;', '  return active.size >= 0 ? source : blankAndReport(source, active).text;')" \
  "survived the pre-parse pass"
run_break "keep the untaken arm's code, blanking only the directives" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "branch selection in every position" \
  "s = s.replace('    out.push(insideDeadArm() ? blankOf(line) : line);', '    out.push(line);')" \
  "was emitted"
run_break "take every branch, as a parser with no symbol set must" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "branch selection in every position" \
  "s = s.replace('  const text = condition.trim();', '  const text = condition.trim(); if (active.size >= 0) { return true; }')" \
  "active regions in a file"
# ONE LINE IN, ONE LINE OUT — that is the invariant, and it is not the one the
# first version of this control tried. Replacing the blank with an empty string
# changes nothing observable: a blanked line holds no tokens, so only its byte
# length differs, and line numbers come from the count of newlines. DROPPING the
# line is what moves every line number after it.
run_break "drop an inactive arm's lines instead of blanking them" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "every fixture is a fixture" \
  "s = s.replace('    out.push(insideDeadArm() ? blankOf(line) : line);', '    if (!insideDeadArm()) { out.push(line); }')" \
  "the parser reached line"
run_break "take a #define's whole line as its symbol, comment and all" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "a define is its symbol, not its line" \
  "s = s.replace('([A-Za-z_][A-Za-z0-9_]*)/.exec(text)', '(.*)$/.exec(text)')" \
  "CommentedIsActive"
run_break "report no conditional region at all" \
  src/parsers/csharp/extractors/cs-preproc-blank.ts \
  "cs_preproc_region" \
  "s = s.replace('  return { text: out.join(', '  if (regions.length >= 0) { return { text: out.join(String.fromCharCode(10)), regions: [] }; }\\n  return { text: out.join(')" \
  "region"
# --- the schema chain: document -> .dl -> emitted rows -----------------------
# Column ORDER is the contract with the engine: the `.dl` carries only c0..cN,
# so a reorder loads into Souffle without error and every rule reading past the
# shifted column is silently wrong. Before `emitted headers match the schema
# document` existed, two relations were compared against their own ARITY
# constant and twenty against nothing at all.
run_break "reorder two columns in an emitted header" \
  src/analysis-types/csharp/CsTypeHeritageRegistry.ts \
  "emitted headers match the schema document" \
  "s = s.replace(\"'csTypeLinkHash', 'position', 'heritageText', 'baseTypeName', 'baseTypeArity',\", \"'csTypeLinkHash', 'position', 'baseTypeName', 'heritageText', 'baseTypeArity',\")" \
  "Column ORDER is the contract"
# A column DROPPED from a header cannot reach that gate: `joinHeader(..., ARITY)`
# throws first, and `arity contract`'s own negative control covers that path. So
# the second control here mutates the OTHER end of the chain — the generated
# `.dl` — which is the one an engine reads and which no test compiled.
run_break "let the generated .dl drift from the schema document" \
  src/schema/csharp/decls_base_cs.dl \
  "the schema chain holds" \
  "s = s.replace('.decl cs_type_heritage(c0:symbol,c1:symbol', '.decl cs_type_heritage(c0:symbol')" \
  "differs from the schema document"
# ---------------------------------------------------------------------------
# THIRTY-ONE CONTROLS WERE REMOVED HERE, and what they had in common is the
# finding. Every one of them mutated a FORK-ERA WORKAROUND whose input the
# published grammar no longer produces, so not one could make a gate fail.
#
# Two families:
#
#   TWENTY-SEVEN mutate the tree-based `#if` layer — descending into inactive
#   arms in the type, member, block, statement, using and heritage extractors;
#   the expression forms (`preproc_if` in expression position, the chain, head
#   and operator forms); `#define`/`#undef` read from nodes; region assembly;
#   an orphaned `else` block; a stacked label under an untaken arm. The
#   pre-parse blanking pass means no directive reaches the tree, so there is
#   nothing to resolve and no inactive arm to descend into. `no preproc node
#   survives the pre-parse pass` asserts exactly that, over the gate corpus and
#   all 305 category fixtures, with the four non-conditional survivors as an
#   allowlist.
#
#   FOUR mutate the `await`/async-lambda re-reads. The fork produced an
#   `await_expression` where the source wrote the identifier `await`, and
#   CS-ORACLE-1 built a re-read for it; 0.23.1 reads it as an identifier and
#   handles both async-lambda forms. Verified BY SHAPE, not by `hasError`:
#   `await` as an identifier now yields no `await_expression` at all.
#
# THE WORKAROUNDS STAY, and they are not dead code — with directives back in
# the tree the `#if` layer resolves branches correctly, as it did before
# blanking existed. What blanking buys is parseability, not branch correctness.
# So the code is DORMANT, and `SHAPES_THE_GRAMMAR_NOW_HANDLES` in
# grammar-gate.ts is what says whether it may stay dormant: a grammar
# regression fires that gate and names the file whose control has to come back.
# Without that assertion, deleting these controls would leave a workaround in
# the tree with nothing stating whether it is still needed, and the next bump
# would answer silently.
# ---------------------------------------------------------------------------
run_break "make the grammar-regression predicate always say fine" \
  src/parsers/csharp/grammar-gate.ts \
  "grammar gate" \
  "s = s.replace('  if (!broken) {', '  if (true) {')" \
  "handledShapeRegression accepted a shape"
run_break "read a named argument's value positionally" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    const label = current.childForFieldName(\'name\');', '    const label = null;')"
# The pattern once named the comment test inside namedChildren; after the
# trivia set was factored out it matched namedChildrenWithDirectives instead,
# a function no positional read uses — the mutation applied, to the wrong
# place, and the full tally said so. It now removes 'comment' from the set.
run_break "let a comment shift a positional child index" \
  src/parsers/csharp/extractors/cs-node.ts \
  "expression spine" \
  "s = s.replace(\"export const TRIVIA_NODE_TYPES: ReadonlySet<string> = new Set([\\n  'comment',\", \"export const TRIVIA_NODE_TYPES: ReadonlySet<string> = new Set([\")"
run_break "drop array creations from the expression allowlist" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace(\"  ['array_creation_expression', CsExpressionKind.ARRAY_CREATION],\", '')"
run_break "fold a null-conditional call into an ordinary method call" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      if (callee?.type == \'conditional_access_expression\') {', '      if (false) {').replace(\"      if (callee?.type === 'conditional_access_expression') {\", '      if (false) {')"
run_break "bind a local for an out-discard" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "blocks and locals" \
  "s = s.replace(\"      if (outName !== null && normalizeCSharpIdentifier(outName.text) === '_') {\", '      if (false) {')"

# THE INVERSION. Each of these puts the parser back into the state where the
# fact base names one configuration and contains the other.
run_break "read a callee positionally instead of by field" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "positional reads are declared" \
  "s = s.replace(\"      const callee = node.childForFieldName('function') ?? undefined;\n      shape.typeArgumentCount\", \"      const callee = namedChildren(node)[0];\n      shape.typeArgumentCount\")"

run_break "classify every bare-name call as a delegate invoke" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('      (context.valueMemberNamesOnType.has(name) && !context.methodNamesOnType.has(name))', '      true')"
run_break "never recognise a local function call" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('    if (context.localFunctionNames.has(name)) {', '    if (false) {')"

run_break "parse a file past the ceiling without the callback" \
  src/constants/csharp-constants.ts \
  "parse ceiling" \
  "s = s.replace('export const CSHARP_CALLBACK_PARSE_THRESHOLD = 30_000;', 'export const CSHARP_CALLBACK_PARSE_THRESHOLD = 10_000_000;')"
# CS-CORPUS-16. Put one full-body walk back inside the per-root context builder.
run_break "walk the whole body once per statement root" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "linear in statements per body" \
  "s = s.replace('    localFunctionNames,\n    lambdaParameterNames: new Set(),\n    patternBindingNames,', '    localFunctionNames,\n    lambdaParameterNames: new Set(),\n    patternBindingNames: patternBindingNamesIn(body, options.activeSymbols),')"
# The locals-set copy per root (a second quadratic behind the first) is NOT
# controlled here: its constant is small enough that 2,000 statements cost
# 1.0 s with it and 0.8 s without, inside the gate's noise. The fix stands on
# its measurement (8,000 statements: 13.6 s -> 3.2 s); a control that cannot
# fail at the gate's sizes is not evidence and is not pretended to be.
# CS-CORPUS-14 and -15, and the two found adjudicating them.
run_break "let a delegate lookup miss fall through to DELEGATE_INVOKE" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "adjudicated shapes" \
  "s = s.replace('      return CsCallKind.DELEGATE_INVOKE;\n    }\n    return CsCallKind.FUNCTION_CALL;\n  }', '      return CsCallKind.DELEGATE_INVOKE;\n    }\n    return CsCallKind.DELEGATE_INVOKE;\n  }')"
# REMOVED: "give recovery debris a member kind".
#
# The shape that produced recovery debris — a method whose arrow body is split
# by a #if — is a clean parse under the fork's grammar now
# (preproc_if_in_function_body, preproc_if_in_property_body), and no shape in
# the gate corpus reaches isRecoveryDebris any more. The rule stays as a net
# for recoveries nobody has seen; a control that cannot fail is not evidence
# and is not pretended to be. The day a fixture produces debris again, this
# control comes back with it.
# The fork's grammar puts a #if-wrapped base list or body under a preproc_if
# child of the declaration; a read that does not look through it sees nothing.
run_break "hide the enclosing scope's local functions from a local function body" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "adjudicated shapes" \
  "s = s.replace('  const boundaries = emitBody(node, method, parameters, bodyOptions, result, enclosing);', '  const boundaries = emitBody(node, method, parameters, bodyOptions, result, { localNames: new Set(), localFunctionNames: new Set() });')"
run_break "ignore a single-parameter lambda's parameter" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "adjudicated shapes" \
  "s = s.replace(\"      ? [implicitParameter(parameterNode)]\", '      ? []')"
run_break "make a local function visible from every block in the body, not its own" \
  src/parsers/csharp/extractors/cs-statement-walker.ts \
  "adjudicated shapes" \
  "s = s.replace(\"    if (statement.type === PREPROC_CHAIN_ROOT || statement.type === 'labeled_statement') {\\n      stack.push(...activeNamedChildren(statement, activeSymbols));\\n    }\", \"    stack.push(...activeNamedChildren(statement, activeSymbols));\")"
run_break "walk a lambda body with an empty enclosing scope" \
  src/parsers/csharp/extractors/cs-member-extractor.ts \
  "adjudicated shapes" \
  "s = s.replace('      scopeAt(lambda, boundaries, body)\\n    );\\n  }\\n  return boundaries;', '      undefined\\n    );\\n  }\\n  return boundaries;')"
run_break "emit a primary constructor's base arguments without the invocation" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"  return node.type === 'argument_list' && node.parent?.type === 'base_list';\", \"  return false;\")"
run_break "read the record base invocation's callee as the wrapper's text" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "heritage and generics" \
  "s = s.replace(\"    return node.childForFieldName('type') ?? undefined;\", \"    return node;\")"
# ---------------------------------------------------------------------------
# THE FIVE MISPARSE REPAIRS. Each control reverts ONE HALF of one repair — the
# detector, the span graft, the child substitution or the visit flag — because
# a repair with four moving parts can be right in three of them and the rows
# still be wrong. Two of these reproduce defects that were actually made and
# caught by the gates rather than by reading: the rotation that re-entered
# without its visit flag, and the operand read by position.
# ---------------------------------------------------------------------------
run_break "hang a ?. off the operator, as the grammar did" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "expression spine" \
  "s = s.replace('  return NON_PRIMARY_RECEIVER_WRAPPERS.has(condition.type) ? condition : undefined;', '  return undefined;')" \
  "after an operator has receiver"
run_break "rotate the ?. and leave the operator's span where the grammar ended it" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "spans nest" \
  "s = s.replace('  return rotatedWrapperUnitOf(node)?.endPosition ?? node.endPosition;', '  return node.endPosition;')" \
  "outside their parent"
run_break "read only a direct constant_pattern child, not the combinator's last leaf" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "expression spine" \
  "s = s.replace('function rightmostPatternLeafOf(pattern: Parser.SyntaxNode): Parser.SyntaxNode {', 'function rightmostPatternLeafOf(pattern: Parser.SyntaxNode): Parser.SyntaxNode {\n  if (pattern !== undefined) { return pattern; }')" \
  "PatRight is called 1"
run_break "leave the swallowed boolean tail inside the pattern" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "expression spine" \
  "s = s.replace('  if (node.type !== \'is_pattern_expression\') {\n    return undefined;\n  }\n  const pattern = node.childForFieldName(\'pattern\');\n  if (pattern === null) {\n    return undefined;\n  }\n  const leaf = rightmostPatternLeafOf(pattern);\n  if (leaf.type !== \'constant_pattern\') {', '  if (node.type !== \'is_pattern_expression\') {\n    return undefined;\n  }\n  const pattern = node.childForFieldName(\'pattern\');\n  if (pattern === null) {\n    return undefined;\n  }\n  const leaf = rightmostPatternLeafOf(pattern);\n  if (true || leaf.type !== \'constant_pattern\') {')" \
  "PatRight is called 0"
run_break "leave the conditional inside the relational pattern" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "expression spine" \
  "s = s.replace('  const leaf = rightmostPatternLeafOf(pattern);\n  if (leaf.type !== \'relational_pattern\') {\n    return undefined;\n  }', '  return undefined;')" \
  "NAMEOF row"
run_break "rotate the conditional without the visit flag, so the pair rotate each other" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "expression spine" \
  "s = s.replace('        out.push({ node: swallowedBy, role: CsEdgeRole.CONDITION, isRotatedUnit: true });', '        out.push({ node: swallowedBy, role: CsEdgeRole.CONDITION });')" \
  "NAMEOF row"
run_break "read a repaired creation's arguments from the creation node" \
  src/parsers/csharp/extractors/cs-misparse.ts \
  "spans nest" \
  "s = s.replace('export function misparsedGenericCreationArgumentsOf(\n  creation: Parser.SyntaxNode\n): { readonly argumentsNode: Parser.SyntaxNode; readonly typeTuple: Parser.SyntaxNode } | undefined {', 'export function misparsedGenericCreationArgumentsOf(\n  creation: Parser.SyntaxNode\n): { readonly argumentsNode: Parser.SyntaxNode; readonly typeTuple: Parser.SyntaxNode } | undefined {\n  if (creation !== undefined) { return undefined; }')" \
  "end on an identifier character"
run_break "let a misread tuple TYPE element mint a local" \
  src/parsers/csharp/extractors/cs-block-extractor.ts \
  "expression spine" \
  "s = s.replace('      if (isMisparsedTupleTypeElement(node)) {\n        break;\n      }', '')" \
  "phantom local"
run_break "read a named attribute argument by a field the grammar does not declare" \
  src/parsers/csharp/extractors/cs-attribute-extractor.ts \
  "attributes and comments" \
  "s = s.replace('  const assignment = childOfType(node, \'assignment_expression\');', '  const assignment = undefined as Parser.SyntaxNode | undefined;')" \
  "does not distinguish them"
run_break "read the is-operand by position, so a this-operand yields the pattern" \
  src/parsers/csharp/extractors/cs-expression-extractor.ts \
  "spans nest" \
  "s = s.replace(\"        node.childForFieldName('expression') ?? node.childForFieldName('left') ?? undefined,\", '        children[0],')" \
  "outside their parent"
run_break "give each top-level statement a fresh locals scope" \
  src/parsers/csharp/extractors/cs-statement-walker.ts \
  "expression spine" \
  "s = s.replace('      visit(statement, CsRootContext.UNKNOWN_CONTEXT, listScope);', '      declaredAt.clear();\n      visit(statement, CsRootContext.UNKNOWN_CONTEXT, listScope);')"

echo
echo "=============================================================================="
echo "restored — the suite must be green again"
echo "=============================================================================="
npx tsx src/test/csharp-tests.ts 2>&1 | tail -3
# The tally, as ONE line the release gate reads. `OK` here means the named gate
# FAILED under the mutation; the count of `run_break` calls in this file is the
# number of controls, and a tally short of it means one never reported.
if [ -n "$ONLY" ]; then
  echo "negative-controls (SELECTED $SELECTED_COUNT of $(grep -c '^run_break "' "$0") by '$ONLY'): OK=$OK_COUNT BAD=$BAD_COUNT MISCLASSIFIED=$MISCLASSIFIED_COUNT INCONCLUSIVE=$INCONCLUSIVE_COUNT at $(git rev-parse --short HEAD) on $(date +%Y-%m-%d) — not a release-gate tally"
else
  echo "negative-controls: OK=$OK_COUNT BAD=$BAD_COUNT MISCLASSIFIED=$MISCLASSIFIED_COUNT INCONCLUSIVE=$INCONCLUSIVE_COUNT of $(grep -c '^run_break "' "$0") controls at $(git rev-parse --short HEAD) tree $RESUME_TREE on $(date +%Y-%m-%d) (runs=$RUN_NUMBER; determinism sample $SAMPLE_CHECKED of $SAMPLE_SIZE identical)"
  # A complete tally with no inconclusive control needs no resumption; the run
  # file is removed so the next full run at this commit starts clean.
  if [ "$INCONCLUSIVE_COUNT" -eq 0 ] && [ -f "$RUN_FILE" ]; then rm -f "$RUN_FILE"; fi
fi
# An inconclusive or misclassified control is not a green one: the tally is a
# gate only when every control reached a verdict, and the verdict named the
# defect where a fragment was given.
if [ "$BAD_COUNT" -ne 0 ] || [ "$INCONCLUSIVE_COUNT" -ne 0 ] || [ "$MISCLASSIFIED_COUNT" -ne 0 ]; then exit 1; fi
