import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { OraclePayload, OracleProvenance } from './types';

/**
 * Golden files carry their own provenance. Appendix B invariant #10: the
 * environment that produced a golden file must be recoverable FROM the golden
 * file — not from a README, not from whatever is on PATH today.
 */
export interface GoldenFile {
  goldenVersion: 1;
  generatedFrom: {
    interpreterPath: string;
    sysVersion: string;
    emissionRegime: string;
    oracleSchemaVersion: string;
    symbolPredicates: string[];
  };
  sourceSha256: string;
  filePath: string;
  payload: OraclePayload;
}

/** Deterministic serialisation: sorted keys, LF endings, trailing newline. */
export function renderGolden(g: GoldenFile): string {
  return stableStringify(g) + '\n';
}

function stableStringify(value: unknown, indent = 1, depth = 0): string {
  const pad = ' '.repeat(indent * depth);
  const padIn = ' '.repeat(indent * (depth + 1));
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => padIn + stableStringify(v, indent, depth + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    if (keys.length === 0) return '{}';
    const items = keys.map(
      (k) => padIn + JSON.stringify(k) + ': ' + stableStringify(obj[k], indent, depth + 1)
    );
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return JSON.stringify(value);
}

export function buildGolden(
  source: string,
  filePath: string,
  payload: OraclePayload
): GoldenFile {
  return {
    goldenVersion: 1,
    generatedFrom: {
      interpreterPath: payload.provenance.interpreterPath,
      sysVersion: payload.provenance.sysVersion,
      emissionRegime: payload.provenance.emissionRegime,
      oracleSchemaVersion: payload.provenance.oracleSchemaVersion,
      symbolPredicates: payload.provenance.symbolPredicates,
    },
    sourceSha256: crypto.createHash('sha256').update(source, 'utf-8').digest('hex'),
    filePath,
    payload,
  };
}

export function writeGolden(outPath: string, g: GoldenFile): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, renderGolden(g), 'utf-8');
}

export function readGolden(inPath: string): GoldenFile {
  return JSON.parse(fs.readFileSync(inPath, 'utf-8')) as GoldenFile;
}

/**
 * A golden file generated under a different interpreter is not merely stale —
 * it encodes a different emission regime and will fail against a correct parser.
 * Refuse it rather than silently comparing across regimes.
 */
export function assertGoldenMatchesEnvironment(
  g: GoldenFile,
  current: OracleProvenance
): string[] {
  const problems: string[] = [];
  if (g.generatedFrom.emissionRegime !== current.emissionRegime) {
    problems.push(
      `golden was generated under ${g.generatedFrom.emissionRegime}, ` +
        `current interpreter is ${current.emissionRegime} — regenerate, do not compare`
    );
  }
  if (g.generatedFrom.sysVersion !== current.sysVersion) {
    problems.push(
      `interpreter changed:\n  golden : ${g.generatedFrom.sysVersion}\n  current: ${current.sysVersion}`
    );
  }
  if (g.generatedFrom.oracleSchemaVersion !== current.oracleSchemaVersion) {
    problems.push(
      `oracle schema version changed: ${g.generatedFrom.oracleSchemaVersion} -> ${current.oracleSchemaVersion}`
    );
  }
  return problems;
}

export function sourceMatchesGolden(source: string, g: GoldenFile): boolean {
  return crypto.createHash('sha256').update(source, 'utf-8').digest('hex') === g.sourceSha256;
}
