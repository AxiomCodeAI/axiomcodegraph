import { execFileSync } from 'child_process';
import * as path from 'path';

import { PINNED_INTERPRETER } from './constants';

/**
 * Evidence tiers for typeCategory / typeModifier / methodKind / importKind.
 *
 * These are deliberately as distinct as Gate 1 and Gate 2, and must be reported
 * separately for the same reason: aggregating them would let a spec decision
 * inherit the authority of a CPython fact.
 */
export type EvidenceTier =
  /** ast node shape. No name list, no priority, no import. As strong as Gate 1. */
  | 'TIER_1_AST'
  /** inspect on an imported object. Gate 1 WITH A CAVEAT — see below. */
  | 'TIER_2_INTROSPECTION'
  /** Authored by A0, implemented by A3. Author separation, NOT ground truth. */
  | 'TIER_3_SPEC';

export const TIER_CAVEATS: Record<EvidenceTier, string> = {
  TIER_1_AST:
    'Decided by parse-tree shape alone. Same strength as Gate 1.',
  TIER_2_INTROSPECTION:
    'Requires importing the module, which EXECUTES ARBITRARY CODE — stdlib-scoped ' +
    'by hard refusal. Sees the post-decoration runtime object, not the source: a ' +
    'class that fails to import is invisible, @overload stubs are unobservable on ' +
    '3.10, and @typing.final leaves no trace before 3.11.',
  TIER_3_SPEC:
    'A decision procedure authored by A0 and implemented by A3. This buys AUTHOR ' +
    'SEPARATION and nothing else — it is not ground truth, and a wrong premise here ' +
    'stays wrong no matter how many fixtures agree with it.',
};

const INTROSPECT = path.join(__dirname, '..', 'oracle', 'emit_introspection.py');

export interface IntrospectedClass {
  module: string;
  class: string;
  defLine: number | null;
  typeCategoryCandidates: string[];
  categoryCollision: boolean;
  typeModifier: string[];
  methods: {
    name: string;
    descriptorKind: string;
    isAbstract: boolean;
    defLine?: number;
    propertyRoles?: { role: string; defLine: number }[];
  }[];
}

export interface IntrospectionSelfCheck {
  ok: boolean;
  problems: string[];
  capabilityGaps: Record<string, boolean>;
  stdlibRoots: string[];
}

function run(args: string[]): unknown {
  const raw = execFileSync(PINNED_INTERPRETER, [INTROSPECT, ...args], {
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

export function introspectionSelfCheck(): IntrospectionSelfCheck {
  return run(['--selfcheck']) as IntrospectionSelfCheck;
}

/** TIER 2. Stdlib only — the emitter refuses anything else. */
export function introspectModule(mod: string): IntrospectedClass[] | { refused: string } {
  const out = run(['--module', mod]) as { rows?: IntrospectedClass[]; refused?: string };
  return out.refused ? { refused: out.refused } : out.rows ?? [];
}

export function introspectStdlibSample(limit: number): {
  rows: IntrospectedClass[];
  refused: { module: string; reason: string }[];
  importFailed: { module: string; error: string }[];
  modulesTried: number;
} {
  return run(['--stdlib-sample', String(limit)]) as never;
}

/**
 * Which tier answers a given field/value. Used to label a report so a tier-3
 * agreement is never presented as a CPython fact.
 */
export function tierFor(field: string, value?: string): EvidenceTier {
  if (field === 'importKind') {
    return value === 'DYNAMIC' ? 'TIER_3_SPEC' : 'TIER_1_AST';
  }
  if (field === 'typeModifier') {
    if (value === 'FINAL' || value === 'SLOTS') return 'TIER_1_AST';
    if (value === 'CALLABLE_INSTANCE') return 'TIER_3_SPEC';
    return 'TIER_2_INTROSPECTION';
  }
  if (field === 'typeCategory') return 'TIER_2_INTROSPECTION';
  if (field === 'methodKind') {
    const structural = new Set([
      'LAMBDA', 'NESTED_FUNCTION', 'CONSTRUCTOR', 'ALLOCATOR', 'DUNDER_METHOD',
      'GENERATOR', 'ASYNC_FUNCTION', 'ASYNC_GENERATOR', 'FUNCTION',
      'MODULE_INITIALIZER', 'CLASS_INITIALIZER', 'OVERLOAD_STUB',
    ]);
    const descriptor = new Set([
      'STATIC_METHOD', 'CLASS_METHOD', 'PROPERTY_GETTER', 'PROPERTY_SETTER',
      'PROPERTY_DELETER', 'ABSTRACT_METHOD',
    ]);
    if (value && structural.has(value)) return 'TIER_1_AST';
    if (value && descriptor.has(value)) return 'TIER_2_INTROSPECTION';
    return 'TIER_3_SPEC';
  }
  return 'TIER_3_SPEC';
}
