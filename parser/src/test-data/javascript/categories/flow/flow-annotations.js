/* @flow */
// fixture: flow/flow-annotations.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — and it CANNOT RUN unmodified. Flow's inline
//   annotation syntax is stripped by a build step; Node rejects it.
// expected provenance: FLOW_REJECTED — the pragma is on line 1 and the detector must fire
// syntax floor: ES2015 + Flow INLINE annotation syntax
//
// declaredTypeSource = SYNTACTIC_FLOW, the third value beside NONE and JSDOC.
// The schema measured 64 syntactically annotated parameters in its whole corpus
// and ALL 64 WERE FLOW — so this value does not rest on a hypothesis, it rests
// on the only syntactic annotations that were actually found. Until now it rested
// on no fixture, which is a different problem: an enum value with no fixture
// cannot be told apart from an unimplemented one.
//
// The behaviour the schema names is why the value exists: ts.createSourceFile
// "parses these into real .type nodes where it overlaps TypeScript and
// MIS-PARSES SILENTLY where it does not". Both halves are below. The overlapping
// half looks exactly like TypeScript and must not be recorded as TypeScript; the
// non-overlapping half is Flow-only and is where a TypeScript-shaped reader goes
// wrong without saying so.
//
// Grounded in a Flow-throughout application framework, which is written this way throughout.


// --- the half that OVERLAPS TypeScript ---------------------------------------
//
// Identical spelling, different language. Recording these as TypeScript
// annotations is the mistake declaredTypeSource exists to prevent.

export function resolveAsset(options: Object, type: string, id: string): mixed {
  return options[type] && options[type][id];
}

export const isReserved = (str: string): boolean => str.charCodeAt(0) === 0x24;

export class Dep {
  id: number;
  subs: Array<Object>;
  static target: ?Dep;

  constructor(id: number) {
    this.id = id;
    this.subs = [];
  }

  addSub(sub: Object): void {
    this.subs.push(sub);
  }
}

// --- the half that is FLOW ONLY ----------------------------------------------
//
// None of this is TypeScript. `?T` is Flow's maybe type and means
// `T | null | void`, which TypeScript spells differently; `{| |}` is an exact
// object; `$Shape`, `mixed` and the variance sigils have no TypeScript form.

export function maybeName(name: ?string): string {
  return name == null ? 'anonymous' : name;
}

export function exact(config: {| host: string, port: number |}): string {
  return `${config.host}:${config.port}`;
}

export function shaped(partial: $Shape<{ a: number, b: string }>): mixed {
  return partial;
}

// Variance sigils on properties: `+` covariant (read-only), `-` contravariant.
export type ReadOnlyPoint = { +x: number, +y: number };
export type WriteOnlySink = { -value: string };

// An opaque type alias — Flow's nominal-typing escape hatch, with no
// TypeScript equivalent at all.
export opaque type UserId: string = string;

// A generic with a bound, and Flow's `*` existential type.
export function first<T: { id: string }>(items: Array<T>): ?T {
  return items[0];
}

// Type-only import and export, Flow's spelling.
import type { ComponentOptions } from './flow-pragma.js';
export type { ComponentOptions };

// A function type as a parameter annotation, and a predicate function.
export function apply(fn: (value: number) => string, n: number): string {
  return fn(n);
}
