/**
 * Python fact-table oracle — differential harness.
 *
 * Produces ground truth for any Python file or package from CPython itself and
 * adjudicates a parser's fact set against it.
 *
 *   symtable -> py_scope, py_binding (all 11 Symbol predicates)   EXACT  [Gate 1]
 *   ast      -> structure, spans, attribute writes            CROSS-CHECK [Gate 2]
 *
 * Gate 2 is a second implementation written by the same author as this harness.
 * It detects DISAGREEMENT REQUIRING ADJUDICATION, not correctness. Report it
 * separately from Gate 1; never aggregate the two into one number.
 *
 * Pinned to CPython 3.10.4 by absolute path (Appendix B invariant #10).
 */

export { PINNED_INTERPRETER, EMISSION_REGIME, SPINE_ARITY, SYMBOL_PREDICATES } from './harness/constants';
export {
  assertOracleUsable,
  oracleForFile,
  oracleForSource,
  oracleRawForSource,
  OracleContractError,
  OracleUnavailableError,
} from './harness/oracle-runner';
export { compare, summarise } from './harness/compare';
export {
  runFactInvariants,
  runOracleInvariants,
  invariant5_deterministic,
  invariant11_schemaAgreement,
} from './harness/invariants';
export {
  buildGolden,
  readGolden,
  renderGolden,
  writeGolden,
  assertGoldenMatchesEnvironment,
  sourceMatchesGolden,
} from './harness/golden';
export * from './harness/types';

import { compare, summarise } from './harness/compare';
import { runFactInvariants, runOracleInvariants } from './harness/invariants';
import { oracleForFile, oracleForSource } from './harness/oracle-runner';
import { FactSet, HarnessReport } from './harness/types';

/**
 * The single call other agents need: adjudicate `facts` for one Python file.
 *
 * A report is `passed` only if every invariant holds, the oracle reported no
 * internal errors, and there are zero disagreements. Precision/recall are
 * reported per entity kind; every disagreement is classified.
 */
export function adjudicate(
  input: { filePath: string } | { source: string; virtualPath: string; moduleQname?: string },
  facts: FactSet
): HarnessReport {
  const oracle =
    'filePath' in input
      ? oracleForFile(input.filePath)
      : oracleForSource(input.source, input.virtualPath, input.moduleQname);

  const invariants = [...runFactInvariants(facts), ...runOracleInvariants(oracle)];
  const { scores, disagreements } = compare({ oracle, facts });

  return {
    filePath: 'filePath' in input ? input.filePath : input.virtualPath,
    provenance: oracle.provenance,
    oracleErrors: oracle.errors ?? [],
    invariants,
    scores,
    disagreements,
    passed:
      invariants.every((i) => i.passed) &&
      (oracle.errors ?? []).length === 0 &&
      disagreements.length === 0,
  };
}

/** Human-readable rendering of a report. */
export function formatReport(r: HarnessReport): string {
  const lines: string[] = [];
  lines.push(`${r.passed ? 'PASS' : 'FAIL'}  ${r.filePath}`);
  lines.push(`  interpreter: ${r.provenance.interpreterPath}`);
  lines.push(`  regime:      ${r.provenance.emissionRegime}`);
  for (const i of r.invariants) {
    lines.push(`  ${i.passed ? 'ok  ' : 'FAIL'} #${i.id} ${i.name} (${i.checked} checked)`);
    for (const v of i.violations) lines.push(`         ${v}`);
  }
  lines.push('  ' + summarise(r.scores, r.disagreements).split('\n').join('\n  '));
  if (r.oracleErrors.length) {
    lines.push('  ORACLE INTERNAL ERRORS (harness bug until proven otherwise):');
    for (const e of r.oracleErrors) lines.push(`         ${e.kind}: ${e.detail}`);
  }
  return lines.join('\n');
}
