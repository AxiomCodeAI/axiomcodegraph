import * as crypto from 'crypto';

import { FactSet, OraclePayload } from '../harness/types';

/**
 * TEST DOUBLE — a "perfect parser", for validating the harness only.
 *
 * This is NOT parser source. It never reads Python source: it transcribes the
 * oracle's own answer into spine-shaped rows, so the harness can be exercised
 * against a fact set that is correct BY CONSTRUCTION. Self-tests then mutate
 * that fact set in specific ways and assert the harness catches each mutation.
 *
 * Without this, the harness could only be tested against a real parser — and a
 * harness first exercised by the thing it is meant to judge is worthless.
 */

const SVC = 'SERVICE_VERSION_' + '0'.repeat(32);

function pk(prefix: string, content: string): string {
  return `${prefix}_${crypto.createHash('md5').update(content, 'utf-8').digest('hex')}`;
}

export interface SynthOptions {
  /** Override the service-version hash (to exercise invariant #4). */
  serviceVersion?: string;
}

export function synthesiseFacts(oracle: OraclePayload, opts: SynthOptions = {}): FactSet {
  const svc = opts.serviceVersion ?? SVC;
  const filePath = oracle.module.filePath;
  const modQname = oracle.module.qualifiedName;

  const modulePk = pk('PY_MODULE', [filePath, '', modQname, oracle.module.emissionRegime, svc].join('||'));

  // ---- py_scope: oracle scopeId is already the frozen PK formula ----------
  const scopeRows: string[][] = [];
  const scopePkById = new Map<string, string>();
  for (const s of oracle.scopes) scopePkById.set(s.scopeId, s.scopeId);

  for (const s of oracle.scopes) {
    const row = new Array(25).fill('');
    row[0] = s.scopeKind;
    row[1] = s.name;
    row[2] = s.qualifiedName;
    row[3] = String(s.nestingDepth);
    row[4] = s.parentScopeId ?? '';
    row[5] = modulePk;
    row[6] = s.scopeKind === 'MODULE' ? 'MODULE' : s.scopeKind === 'CLASS' ? 'TYPE' : 'METHOD';
    row[7] = '';
    row[8] = String(s.isNested);
    row[9] = String(s.isOptimized);
    row[10] = String(s.hasChildren);
    row[11] = String(s.symtableId);
    row[12] = String(s.usesWildcardImport);
    row[13] = 'false';
    row[14] = 'false';
    row[15] = String(s.declaresGlobal);
    row[16] = String(s.declaresNonlocal);
    row[17] = filePath;
    row[18] = String(s.startLine);
    row[19] = String(s.startColumn);
    row[20] = String(s.endLine);
    row[21] = String(s.endColumn);
    row[22] = String(s.scopeOrdinal);
    row[23] = svc;
    row[24] = s.scopeId;
    scopeRows.push(row);
  }

  // ---- py_binding --------------------------------------------------------
  const PREDS = [
    'is_parameter', 'is_local', 'is_global', 'is_nonlocal', 'is_free', 'is_imported',
    'is_assigned', 'is_referenced', 'is_declared_global', 'is_annotated', 'is_namespace',
  ];
  const bindingRows: string[][] = [];
  for (const b of oracle.bindings) {
    const row = new Array(29).fill('');
    row[0] = b.name;
    row[1] = scopePkById.get(b.scopeId) ?? b.scopeId;
    row[2] = b.is_parameter ? 'PARAMETER' : b.is_imported ? 'IMPORTED' : b.is_global ? 'GLOBAL_IMPLICIT' : 'LOCAL';
    row[3] = 'ASSIGNMENT';
    for (let i = 0; i < PREDS.length; i++) row[4 + i] = String(b[PREDS[i]!]);
    row[15] = '1';
    row[16] = '0';
    row[17] = '0';
    row[21] = 'false';
    row[22] = 'NONE';
    row[24] = modulePk;
    row[25] = '';
    row[26] = filePath;
    row[27] = svc;
    row[28] = pk('PY_BINDING', `${row[1]}||${row[0]}`);
    bindingRows.push(row);
  }

  // ---- py_module ---------------------------------------------------------
  const rootScope = oracle.scopes.find((s) => s.nestingDepth === 0);
  const moduleRow = new Array(24).fill('');
  moduleRow[0] = modQname.split('.').pop() ?? modQname;
  moduleRow[1] = modQname;
  moduleRow[2] = filePath.split('/').pop() ?? filePath;
  moduleRow[3] = filePath;
  moduleRow[4] = '';
  moduleRow[5] = 'MODULE';
  moduleRow[6] = '';
  moduleRow[7] = 'false';
  moduleRow[8] = 'false';
  moduleRow[9] = 'PY3';
  moduleRow[10] = oracle.provenance.versionInfo.join('.');
  moduleRow[11] = oracle.module.emissionRegime;
  moduleRow[12] = 'TS_PYTHON3';
  moduleRow[13] = '';
  moduleRow[14] = '';
  moduleRow[15] = 'false';
  moduleRow[16] = String(oracle.module.hasDunderAll);
  moduleRow[17] = String(oracle.module.dunderAllIsStatic);
  moduleRow[18] = oracle.module.dunderAllNames.join(',');
  moduleRow[19] = ''; // moduleInitMethodLinkHash — no py_method in this double
  moduleRow[20] = rootScope?.scopeId ?? '';
  moduleRow[21] = 'false';
  moduleRow[22] = svc;
  moduleRow[23] = modulePk;

  return {
    py_module: [moduleRow],
    py_scope: scopeRows,
    py_binding: bindingRows,
  };
}

/** Deep copy so mutations in one test cannot leak into another. */
export function cloneFacts(f: FactSet): FactSet {
  const out: FactSet = {};
  for (const [k, rows] of Object.entries(f)) out[k] = rows.map((r) => [...r]);
  return out;
}
