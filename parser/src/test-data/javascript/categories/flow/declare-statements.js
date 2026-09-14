/* @flow */
// fixture: flow/declare-statements.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — by the gate's definition (it has 15 statements).
//   RELABELLED 2026-09-12: this file was labelled type-only on purpose, to
//   falsify the `statements.length === 0` predicate, and it did. The Flow
//   out-of-scope ruling then made the falsification moot: the file is now
//   FLOW_EXCLUDED and emits one module row, so whether its statements are
//   "type-only" is not a question the parser ever asks. The argument is kept
//   below as history; the label is now what the gate can check.
// expected provenance: FLOW_REJECTED — and if it is ever PROJECT again, 13
//   NO_BODY method rows come back into the call graph
// syntax floor: not JavaScript at all — Flow's `declare` family, from
//   flow.org/en/docs/libdefs and flow.org/en/docs/types/modules
//
// MEASURED, and it is the reason this fixture exists: under `ScriptKind.JS`
// every declaration below parses with **ZERO diagnostics** — verified, and the
// three Flow `declare` forms that are NOT silent (`declare opaque type`,
// `declare module.exports`, and a variance sigil on a declared property) were
// moved out to recovery-mangling.js so that claim stays true of this file. `declare function`
// becomes a `FunctionDeclaration`, `declare class` a `ClassDeclaration`,
// `declare module` a `ModuleDeclaration`, and `interface` an
// `InterfaceDeclaration` — in a `.js` file, where JavaScript has none of those
// concepts.
//
// So this is the DANGEROUS half of Flow, not the loud half. A file of exact
// object types announces itself with a parse gap per line; this one announces
// nothing, and every row it mints is a confident claim about a program that has
// no runtime existence whatsoever.
//
// ## The specific defect this discriminates
//
// `declare function` has no body, so it mints a method row with
// `bodyPresence = NO_BODY` — and Gate 4 says type-only constructs never reach
// the call graph. Every declaration here is a call TARGET that can never be
// called, because none of it survives to runtime.
//
// I recorded `JsBodyPresence.NO_BODY` in MANIFEST.md Findings 7 as "not
// expressible in JavaScript — there is no `declare`, no ambient signature, no
// bodyless callable". That was **wrong**, and this file is the counter-example:
// it is not expressible in JavaScript and it is reachable from Flow, which the
// corpus contains. Findings 7 is corrected.
//
// ## It discriminates under all three of js-oracle's open rulings
//
//   distinct scriptKind   — parsed as Flow: these are ambient declarations, and
//                           whatever relation holds them, none is a call target
//   explicit rejection    — the file is skipped: ZERO rows, and the absence is
//                           checkable because the names below appear nowhere else
//   emit-with-residual    — rows are minted with no diagnostic to mark them, so
//                           `isTypeOnly` / `bodyPresence` are the ONLY columns
//                           that can carry the fact. If they do not, the call
//                           graph gains **seven** unreachable targets: this file
//                           has 15 statements, 0 diagnostics and 7 bodyless
//                           function declarations (`parse` x3, `stringify`,
//                           `walk`, `load`, `configure`), all measured.
//
// ## The predicate this file breaks
//
// MANIFEST.md Findings 5 proposed, and `js-impl` implemented, a mechanical
// nature gate: `type-only` iff `ts.createSourceFile(...).statements.length === 0`.
// I argued that was EXACT for JavaScript because "there is no erasable
// declaration form here". Flow has one. This file has fifteen statements and
// zero runtime, so the predicate now returns the wrong answer.
//
// The refinement, proposed rather than applied because the gate is not mine.
// Measured on this file: 15 top-level statements, of which **14 carry
// `ts.ModifierFlags.Ambient`** and the fifteenth is the `interface`, which is
// type-only by KIND rather than by modifier. So:
//
//   type-only  iff  every top-level statement either carries ModifierFlags.Ambient
//                   or is an InterfaceDeclaration / TypeAliasDeclaration
//
// The `statements.length === 0` form is still correct for every non-Flow file in
// this corpus, and both type-only fixtures in `cjs/` still satisfy it. This is a
// widening, not a replacement — and if js-oracle rules Flow out of scope it is
// not needed at all, which is the fourth way this file discriminates.


// --- declare function, including the overload set ------------------------------
//
// Flow spells overloads as repeated `declare function` with one name. There is
// no implementation anywhere, in this file or any other — an importer gets the
// runtime export, and these describe it.

declare function parse(input: string): Object;
declare function parse(input: string, reviver: Function): Object;
declare function parse(input: Buffer, encoding: string): Object;

declare function stringify(value: mixed): string;

// A declared generator and a declared async function. Both bodyless.
declare function walk<T>(root: T): Iterator<T>;
declare function load(path: string): Promise<Object>;

// --- declare class ---------------------------------------------------------------
//
// Every member is a signature. `m()` has no body; neither does the constructor.

declare class Emitter {
  constructor(name: string): void;
  emit(event: string, ...args: Array<mixed>): boolean;
  static create(name: string): Emitter;
  listeners: Array<Function>;
}

declare class Subclass extends Emitter {
  extra(): void;
}

// --- declare var / let / const -------------------------------------------------------

declare var __DEV__: boolean;
declare var process: { env: { [string]: string } };

// --- declare type and declare opaque type ------------------------------------------

declare type NodeId = string;

// --- interface, which JavaScript does not have at all ---------------------------------

interface Serializable {
  serialize(): string;
}

// --- declare export, the libdef form -------------------------------------------------

declare export function configure(options: Object): void;
declare export default class Registry {
  register(id: NodeId): void;
}

// --- declare module, which has no JavaScript analogue in any dialect --------------------
//
// A whole module's shape declared from outside it. There is no runtime object,
// no file at './missing-at-runtime', and nothing to import.

declare module 'missing-at-runtime' {
  declare export function helper(): void;
  declare export var version: string;
}
