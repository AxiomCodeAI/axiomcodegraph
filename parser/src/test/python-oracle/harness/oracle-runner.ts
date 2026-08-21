import { execFileSync } from 'child_process';
import * as fs from 'fs';

import {
  EMISSION_REGIME,
  EXPECTED_VERSION,
  ORACLE_SCRIPT,
  PINNED_INTERPRETER,
  SYMBOL_PREDICATES,
} from './constants';
import { OraclePayload, OracleProvenance } from './types';

export class OracleUnavailableError extends Error {}
export class OracleContractError extends Error {}

let selfCheckDone = false;

/**
 * Verify the interpreter BEFORE trusting anything it says.
 *
 * This runs once per process and is deliberately fatal rather than a warning.
 * A 3.12 interpreter answers every question this harness asks — it just answers
 * some of them differently (PEP 709 inlines comprehensions), so the failure
 * would surface as "the parser is broken" on ~2,000 comprehension scopes.
 */
export function assertOracleUsable(): OracleProvenance {
  if (!fs.existsSync(PINNED_INTERPRETER)) {
    throw new OracleUnavailableError(
      `Pinned interpreter not found: ${PINNED_INTERPRETER}\n` +
        `The oracle refuses to fall back to \`python3\` — see Appendix B invariant #10.`
    );
  }
  if (!fs.existsSync(ORACLE_SCRIPT)) {
    throw new OracleUnavailableError(`Oracle script not found: ${ORACLE_SCRIPT}`);
  }

  const raw = execFileSync(PINNED_INTERPRETER, [ORACLE_SCRIPT, '--selfcheck'], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const result = JSON.parse(raw) as {
    ok: boolean;
    problems: string[];
    provenance: OracleProvenance;
  };

  if (!result.ok) {
    throw new OracleContractError(
      `Pinned interpreter failed self-check:\n  - ${result.problems.join('\n  - ')}`
    );
  }
  const [maj, min] = result.provenance.versionInfo;
  if (maj !== EXPECTED_VERSION[0] || min !== EXPECTED_VERSION[1]) {
    throw new OracleContractError(
      `Interpreter is ${maj}.${min}, expected ${EXPECTED_VERSION.join('.')} for ${EMISSION_REGIME}`
    );
  }
  if (result.provenance.emissionRegime !== EMISSION_REGIME) {
    throw new OracleContractError(
      `Oracle reports regime ${result.provenance.emissionRegime}, harness expects ${EMISSION_REGIME}`
    );
  }
  const preds = result.provenance.symbolPredicates;
  if (preds.length !== SYMBOL_PREDICATES.length ||
      preds.some((p, i) => p !== SYMBOL_PREDICATES[i])) {
    throw new OracleContractError(
      `symtable.Symbol predicate set drifted.\n  oracle:  ${preds.join(',')}\n` +
        `  harness: ${SYMBOL_PREDICATES.join(',')}`
    );
  }

  selfCheckDone = true;
  return result.provenance;
}

function ensureSelfChecked(): void {
  if (!selfCheckDone) assertOracleUsable();
}

/** Ground truth for a source string. `virtualPath` identifies it in the output. */
export function oracleForSource(
  source: string,
  virtualPath: string,
  moduleQname?: string
): OraclePayload {
  ensureSelfChecked();
  const raw = execFileSync(
    PINNED_INTERPRETER,
    [
      ORACLE_SCRIPT,
      '--source-stdin',
      '--virtual-path',
      virtualPath,
      '--module-qname',
      moduleQname ?? virtualPath.replace(/\.py$/, '').replace(/[\\/]/g, '.'),
    ],
    { input: source, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }
  );
  return JSON.parse(raw) as OraclePayload;
}

/** Ground truth for a file on disk. */
export function oracleForFile(filePath: string, moduleQname?: string): OraclePayload {
  ensureSelfChecked();
  const args = [ORACLE_SCRIPT, '--file', filePath];
  if (moduleQname) args.push('--module-qname', moduleQname);
  const raw = execFileSync(PINNED_INTERPRETER, args, {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(raw) as OraclePayload;
}

/** For determinism testing (invariant #5): same input, byte-identical output. */
export function oracleRawForSource(source: string, virtualPath: string): string {
  ensureSelfChecked();
  return execFileSync(
    PINNED_INTERPRETER,
    [ORACLE_SCRIPT, '--source-stdin', '--virtual-path', virtualPath],
    { input: source, encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 }
  );
}

/** Test seam: allow the self-test to reset the once-per-process guard. */
export function __resetSelfCheckForTests(): void {
  selfCheckDone = false;
}
