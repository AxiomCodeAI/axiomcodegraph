#!/bin/bash
# THE VACUOUS-GATE SWEEP.
#
# A check whose SELECTOR is derived from the field it tests passes by having
# nothing to check. It happened here: the IR-completeness gate selected
# extension methods by `isExtension`, which the parser DERIVES from the `this`
# parameter — so a mutation clearing the marker emptied the set before the
# assertion ran, and the gate went green on a broken fact base.
#
# A textual scan found no second instance, but a textual scan cannot see a
# derivation that lives in the PARSER. So this is empirical: every column the
# extractor computes from another column is broken in turn, and the suite must
# report a failure. A column that can be broken with the suite still green has
# no assertion that can see it — which is the same defect wearing different
# clothes.
#
# Each mutation is reverted from a byte copy, never from the git index.
set -u
cd "$(dirname "$0")/../../.."

pass=0
uncovered=0
inert=0

sweep () {
  local label="$1"; shift
  local file="$1"; shift
  local old="$1"; shift
  local new="$1"; shift

  local backup
  backup="$(mktemp)"
  cp "$file" "$backup"

  python3 - "$file" "$old" "$new" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
open(path, 'w').write(s.replace(old, new))
PY

  if cmp -s "$file" "$backup"; then
    echo "INERT      $label  — the pattern no longer matches; this sweep entry is stale"
    inert=$((inert + 1))
    rm -f "$backup"
    return
  fi

  local out
  out=$(npx tsx src/test/csharp-tests.ts 2>&1)
  local total
  total=$(echo "$out" | grep -oE '^[0-9]+/[0-9]+ checks passed' | head -1)
  if echo "$out" | grep -qE '^  FAIL'; then
    local which
    which=$(echo "$out" | grep -B40 '^  FAIL' | grep -E '^[a-z#].*[a-z]$' | tail -1)
    echo "COVERED    $label  -> caught by '$which'  ($total)"
    pass=$((pass + 1))
  else
    echo "UNCOVERED  $label  -> SUITE STILL GREEN ($total)"
    echo "           No assertion can see this column. Either it is unasserted, or the"
    echo "           check that asserts it selects on something derived from it."
    uncovered=$((uncovered + 1))
  fi

  cp "$backup" "$file"
  rm -f "$backup"
}

M=src/parsers/csharp/extractors/cs-member-extractor.ts
T=src/parsers/csharp/extractors/cs-type-extractor.ts
R=src/parsers/csharp/extractors/cs-type-reference-extractor.ts
E=src/parsers/csharp/extractors/cs-expression-extractor.ts
B=src/parsers/csharp/extractors/cs-block-extractor.ts
F=src/parsers/csharp/extractors/cs-fact-extractor.ts

echo "=============================================================================="
echo "DERIVED-COLUMN SWEEP — every column computed from another must be asserted"
echo "=============================================================================="

# cs_method — derived from the modifier set or from how the row was built
sweep "cs_method.isExtension"      "$M" "isExtension: parameters.some((p) => p.isThis)," "isExtension: false,"
sweep "cs_method.isStatic"         "$M" "isStatic: modifiers.has(CsMethodModifier.STATIC)," "isStatic: false,"
sweep "cs_method.isAsync"          "$M" "isAsync: modifiers.has(CsMethodModifier.ASYNC)," "isAsync: false,"
sweep "cs_method.isIterator"       "$M" "isIterator: containsYield(node, options.activeSymbols)," "isIterator: false,"
sweep "cs_method.isAccessor"       "$M" "    isAccessor: true," "    isAccessor: false,"
sweep "cs_method.isPartialDefinition" "$M" "modifiers.has(CsMethodModifier.PARTIAL) && bodyKindOf(node, options.activeSymbols) === CsBodyKind.NONE," "false,"

# cs_property — derived from the accessor list
sweep "cs_property.hasGetter"      "$M" "hasGetter: getter !== undefined," "hasGetter: false,"
sweep "cs_property.setterKind"     "$M" "          ? CsSetterKind.INIT" "          ? CsSetterKind.SET"
# The read moved to `modifiersOf` at fork22, when modifiers under a `#if` had to
# resolve through the taken branch. The sweep entry kept the old text and went
# INERT — it mutated nothing and reported OK about nothing. It went unseen
# because the release gate could not pass a clean scrub and so never reached
# this line's verdict.
sweep "cs_property.isRequired"     "$M" "isRequired: modifiersOf(node, options.activeSymbols).some((m) => m.text.trim() === 'required')," "isRequired: false,"

# cs_field — derived from fieldModifiers
sweep "cs_field.isConst"           "$M" "isConst: modifiers.has(CsFieldModifier.CONST)," "isConst: false,"
sweep "cs_field.isStatic"          "$M" "        modifiers.has(CsFieldModifier.STATIC) || modifiers.has(CsFieldModifier.CONST)," "        false,"
sweep "cs_field.declarationIndex"  "$M" "      declarationIndex," "      declarationIndex: 0,"

# cs_type — derived from typeModifiers or typeCategory
sweep "cs_type.isPartial"          "$T" "isPartial: modifiers.has(CsTypeModifier.PARTIAL)," "isPartial: false,"
sweep "cs_type.isRefLikeStruct"    "$T" "isRefLikeStruct: isRefLikeStruct(node, category)," "isRefLikeStruct: false,"
sweep "cs_type.isFileLocal"        "$T" "    isFileLocal," "    isFileLocal: false,"
sweep "cs_type.hasPrimaryConstructor" "$T" "hasPrimaryConstructor: primaryConstructor !== undefined," "hasPrimaryConstructor: false,"

# cs_type_reference — derived from the shape's kind
sweep "cs_type_reference.isPointer" "$R" "isPointer: shape.kind === CsTypeRefKind.POINTER," "isPointer: false,"
sweep "cs_type_reference.isTuple"   "$R" "isTuple: shape.kind === CsTypeRefKind.TUPLE," "isTuple: false,"
sweep "cs_type_reference.tupleElementCount" "$R" "tupleElementCount: shape.kind === CsTypeRefKind.TUPLE ? shape.children.length : 0," "tupleElementCount: 0,"
sweep "cs_type_reference.arrayRank"  "$R" "    arrayRank: shape.arrayRank," "    arrayRank: 0,"
sweep "cs_type_reference.isNullableAnnotated" "$R" "    isNullableAnnotated: shape.isNullableAnnotated," "    isNullableAnnotated: false,"

# cs_expression / cs_call_site
sweep "cs_expression.isNullForgiving" "$E" "        shape.isNullForgiving = true;" "        shape.isNullForgiving = false;"
sweep "cs_expression.methodReferenceKind" "$E" "          : CsMethodReferenceKind.METHOD_GROUP;" "          : CsMethodReferenceKind.NONE;"
sweep "cs_call_site.outArgumentCount" "$E" "    outArgumentCount: argumentNodes.filter((a) => hasArgumentModifier(a, 'out')).length," "    outArgumentCount: 0,"
# The receiver read itself. `this.M()` exposes `this` through the `expression`
# FIELD as an anonymous token, so namedChildren[0] is the METHOD NAME — 19,832
# linq-heavy-A call sites reported the callee's own name as the receiver type.
sweep "cs_call_site.receiverKind (read by field)" "$E" "      ? receiverOf(callee)" "      ? namedChildren(callee)[0]"

# cs_variable — derived from the declared type, the modifier list or the walk
sweep "cs_variable.isImplicitlyTyped" "$B" "    isImplicitlyTyped: isImplicit," "    isImplicitlyTyped: false,"
sweep "cs_variable.refKind"           "$B" "    refKind: declared.refKind," "    refKind: CsRefKind.NONE,"
sweep "cs_variable.isScoped"          "$B" "    isScoped: declared.isScoped || input.isScopedModifier === true," "    isScoped: false,"
sweep "cs_variable.isConst"           "$B" "        isConst: modifiers.includes('const')," "        isConst: false,"
sweep "cs_variable.scopeDepth"        "$B" "    scopeDepth: state.depth," "    scopeDepth: 0,"
sweep "cs_variable.hasInitializer"    "$B" "    hasInitializer: input.initializerNode !== null && input.initializerNode !== undefined," "    hasInitializer: false,"
sweep "cs_variable.declarationIndex"  "$B" "        declarationIndex: index," "        declarationIndex: 0,"
sweep "cs_variable.deconstructionIndex" "$B" "          deconstructionIndex: index," "          deconstructionIndex: 0,"
sweep "cs_variable.completeTypeName"  "$B" "  const completeTypeName = isImplicit ? '' : declared.typeNode!.text;" "  const completeTypeName = declared.typeNode?.text ?? '';"

# cs_block — derived from the node kind, the keyword or the walk
sweep "cs_block.isChecked"            "$B" "        isChecked: node.type === 'checked_statement' && hasAnonymousToken(node, 'checked')," "        isChecked: false,"
sweep "cs_block.isUnsafe"             "$B" "        isUnsafe: node.type === 'unsafe_statement'," "        isUnsafe: false,"
sweep "cs_block.resourceCount"        "$B" "        resourceCount: resourceCountOf(node)," "        resourceCount: 0,"
sweep "cs_block.nestingDepth"         "$B" "        nestingDepth: state.depth," "        nestingDepth: 0,"
sweep "cs_block.labelName"            "$B" "            ? normalizeCSharpIdentifier(childOfType(node, 'identifier')?.text ?? '')" "            ? ''"
sweep "cs_block.catchTypeNames"       "$B" "        catchTypeNames: catchTypeNamesOf(node)," "        catchTypeNames: [],"
sweep "cs_block.tryStatementHash"     "$B" "        block.setTryStatementHash(state.tryHash);" "        block.setTryStatementHash('');"

# cs_module.parseErrorCount — derived from the gap rows
sweep "cs_module.parseErrorCount"  "$F" "      count: parseGaps.length," "      count: 0,"

echo
echo "=============================================================================="
echo "covered $pass   UNCOVERED $uncovered   inert $inert"
if [ "$uncovered" -gt 0 ] || [ "$inert" -gt 0 ]; then
  echo "An UNCOVERED column has no assertion that can see it. An INERT entry is a"
  echo "stale pattern, which is this sweep failing rather than the parser."
  exit 1
fi
echo "Every derived column is asserted by something that survives its derivation."
echo "=============================================================================="
npx tsx src/test/csharp-tests.ts 2>&1 | tail -2
