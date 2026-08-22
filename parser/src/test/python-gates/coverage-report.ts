/**
 * What A3's gates actually adjudicate, column by column.
 *
 * A0 owns the project coverage meter, and it can only count what it knows
 * about. It currently reads 4 of 29 for py_expression while the widened gate
 * checks ten, and zero for py_field, py_type_base and py_module though gate2
 * compares all three — so the project number is an UNDERSTATEMENT rather than a
 * measurement.
 *
 * This is the declaration from this side: every column A3's gates compare, and
 * against which oracle. It is deliberately a list rather than a computation,
 * because a computed number that nobody can point at a specific check for is how
 * the previous figure drifted.
 *
 * A column counts as adjudicated ONLY if an external oracle states it. A
 * self-test sharing an author with the parser catches regressions and not wrong
 * premises, so those are excluded even where they exist.
 */
interface GateCoverage {
  relation: string;
  oracle: string;
  columns: string[];
}

export const A3_GATE_COVERAGE: readonly GateCoverage[] = [
  {
    relation: 'py_expression',
    oracle: 'CPython ast — diff-expr + diff-expr-complete',
    columns: [
      // Set membership: every ast expression appears exactly once.
      'EXISTENCE',
      'kind',
      'edgeRole',
      'position',
      'depth',
      'parentExpressionHash',
      'nameContext',
      'literalValue',
      'isWrite',
      'isAwaited',
      'isStarred',
    ],
  },
  {
    relation: 'py_call_site',
    oracle: 'CPython ast — diff-calls',
    columns: [
      'EXISTENCE',
      'receiverKind',
      'positionalArgCount',
      'keywordArgCount',
      'hasStarArgs',
      'hasDoubleStarArgs',
      'keywordNames',
      'endLine',
    ],
  },
  {
    relation: 'py_method',
    oracle: 'CPython ast + classifications — diff-decl / gate2',
    columns: [
      'EXISTENCE',
      'endLine',
      'isAsync',
      'posOnlyCount',
      'kwOnlyCount',
      'hasKwArgs',
      'isVarArgs',
      'ownerClass',
      'decoratorCount',
      'isGenerator',
      'methodKind',
    ],
  },
  {
    relation: 'py_method_parameter',
    oracle: 'CPython ast — diff-decl',
    columns: ['EXISTENCE', 'paramName', 'paramKind'],
  },
  {
    relation: 'py_type',
    oracle: 'CPython ast + classifications — gate2',
    columns: ['EXISTENCE', 'endLine', 'baseCount', 'typeModifier'],
  },
  {
    relation: 'py_type_base',
    oracle: 'CPython ast class bases — gate2',
    columns: ['EXISTENCE', 'position', 'baseText', 'keywordName'],
  },
  {
    relation: 'py_field',
    oracle: 'CPython ast attributeWrites — gate2',
    columns: ['EXISTENCE', 'name', 'fieldOrigin', 'ownerTypeName', 'receiverName'],
  },
  {
    relation: 'py_module',
    oracle: 'CPython ast module block — gate2',
    columns: [
      'qualifiedName',
      'hasDunderAll',
      'dunderAllIsStatic',
      'dunderAllNames',
      'emissionRegime',
    ],
  },
  {
    relation: 'py_import',
    oracle: 'oracle classifications — gate2',
    columns: ['importKind'],
  },
];

/** Relations with NO external adjudication at all. Stated, not hidden. */
export const A3_UNADJUDICATED: readonly string[] = [
  'py_block — 17 columns, nothing checks them',
  'py_decorator — 13 columns',
  'py_decorator_argument — 9 columns',
  'py_type_reference — 15 columns',
  'py_field_position — 1 column',
  'py_parse_gap — verified by hand on 3 files, no automated oracle',
];

if (require.main === module) {
  let total = 0;
  console.log('A3 gate coverage — columns adjudicated against an EXTERNAL oracle\n');
  for (const gate of A3_GATE_COVERAGE) {
    const real = gate.columns.filter(c => c !== 'EXISTENCE');
    total += real.length;
    console.log(`  ${gate.relation.padEnd(22)}${String(real.length).padStart(3)}  ${gate.oracle}`);
    console.log(`  ${' '.repeat(22)}     ${real.join(', ')}`);
  }
  console.log(`\n  TOTAL A3-adjudicated columns: ${total}`);
  console.log('\n  NO external adjudication:');
  A3_UNADJUDICATED.forEach(r => console.log(`    ${r}`));
}
