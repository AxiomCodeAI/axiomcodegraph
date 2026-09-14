import * as ts from 'typescript';

import { JsScopeKind, JsStrictModeSource } from '@/enums/javascript/scopes';
import { JsBindingRegime } from '@/enums/javascript/variables';

/**
 * The binder's data model: a scope tree and a `(scope, name)` table.
 *
 * A deliberate port of `python-symbol-table.ts`, and the choice of model to port
 * is the whole point. `ts-binder.ts` exists to compute **declaration-merge
 * scopes** — TypeScript's problem, where one name legitimately denotes several
 * declarations. JavaScript has no declaration merging, and has instead the
 * problem CPython's symbol table solves: *which binding does this name refer
 * to, given that where a name is visible is not where it is written.*
 *
 * ## Why two scope pointers per binding, and not one
 *
 * ```js
 * function f() {
 *   if (cond) {
 *     var a = 1;        // syntactic: the if-block.  declaration: f's scope.
 *     let b = 2;        // syntactic: the if-block.  declaration: the if-block.
 *   }
 *   return a;           // legal. `a` is visible here; `b` is not.
 * }
 * ```
 *
 * The difference between those two columns **is** hoisting, and it is not
 * recoverable from anything else in the fact base: an engine would have to
 * re-implement JavaScript's scoping rules to derive one from the other. Emitting
 * a single column called "scope" is §3 of `BUILDING-A-PARSER.md` — the parts are
 * present and the structure is absent.
 *
 * ## State discipline
 *
 * **Nothing is stored on a `ts.Node`.** Every map here is keyed on
 * {@link nodeKey}, which is `${kind}:${start}:${end}` — the byte RANGE, never the
 * start offset, because a call and its callee share a start offset constantly
 * and so do a function and its own body. Python learned the same rule from
 * tree-sitter's evicting wrappers; the reason differs and the rule does not.
 */

/** A lexical scope, during the binder pass. */
export interface JsScopeNode {
  /** `${kind}:${start}:${end}` of the node that opens this scope. */
  readonly key: string;
  readonly kind: JsScopeKind;
  readonly parent: JsScopeNode | null;
  readonly depth: number;
  /** `var` hoists to the nearest scope with this set; `let` stops at the nearest block. */
  readonly isFunctionScope: boolean;
  /** False for `ARROW`. That is the whole of lexical `this`. */
  readonly bindsThis: boolean;
  readonly bindsArguments: boolean;
  isStrictMode: boolean;
  strictModeSource: JsStrictModeSource;
  /** `with` makes every name in the body statically unresolvable. */
  hasWithStatement: boolean;
  readonly startLine: number;
  readonly startColumn: number;
  readonly children: JsScopeNode[];
  /**
   * Bindings DECLARED here — that is, whose `declarationScope` is this scope.
   *
   * A `var` written in a block appears in its enclosing function scope's table
   * and not in the block's, which is exactly what makes a lookup from inside the
   * block find it and a lookup from a sibling block find it too.
   */
  readonly bindings: Map<string, JsBinding>;
  /** The function-like node this scope belongs to, for the owner FK. */
  readonly ownerNode: ts.Node | null;
}

/** One name bound in one scope. */
export interface JsBinding {
  readonly name: string;
  readonly regime: JsBindingRegime;
  /** Where the name is VISIBLE FROM. `js_variable.declarationScopeLinkHash`. */
  readonly declarationScope: JsScopeNode;
  /** Where the declaration is WRITTEN. `js_variable.syntacticScopeLinkHash`. */
  readonly syntacticScope: JsScopeNode;
  /** The identifier node that declares it; `null` for an implicit global. */
  readonly declarationNode: ts.Node | null;
  readonly hasTemporalDeadZone: boolean;
  /**
   * First-wins among several declarations of one name.
   *
   * `var x` twice in one function is legal and is ONE binding. Recording the
   * redeclaration count keeps that visible instead of silently discarding the
   * later ones — and it is why this is not an array.
   */
  redeclarationCount: number;
}

/**
 * Node identity: the byte RANGE, plus the kind.
 *
 * §2 of `BUILDING-A-PARSER.md`: *node identity is the byte range, not the start
 * offset.* `${start}` alone collides constantly — a call and its callee, an IIFE's
 * parenthesis and its function, a declaration and its own name. The kind is
 * included because two nodes can share a full range too: a `ParenthesizedExpression`
 * and nothing else, but also an `ExpressionStatement` and its expression when
 * there is no semicolon.
 */
export function nodeKey(node: ts.Node): string {
  return `${node.kind}:${node.getStart()}:${node.end}`;
}

/** The nearest enclosing scope a `var` or hoisted function declaration lands in. */
export function nearestFunctionScope(scope: JsScopeNode): JsScopeNode {
  let current: JsScopeNode = scope;
  while (!current.isFunctionScope && current.parent !== null) {
    current = current.parent;
  }
  return current;
}

/**
 * Resolves a name from `scope` outward, returning the binding and where it came
 * from.
 *
 * ## Why the answer has two parts
 *
 * `js_expression.bindingResolution` records *which scope* a name came from —
 * `LOCAL`, `CLOSURE`, `MODULE`, `IMPORTED`, `GLOBAL_BUILTIN`, `UNRESOLVED_FREE`
 * — because that is the binder's output and the engine's input. A name resolved
 * in the current scope and the same name resolved three closures up are the same
 * `js_variable` row and two very different facts about the code: the second one
 * means the value outlives its frame.
 *
 * ## What this deliberately does NOT do
 *
 * It does not cross a module boundary. An imported name resolves to its
 * `IMPORT_BINDING` in this module's scope and stops there; following the import
 * to the declaring file is cross-file resolution, which is the engine's work.
 */
export interface NameResolution {
  readonly binding: JsBinding;
  /** How far up the scope chain it was found, in function-scope crossings. */
  readonly functionBoundariesCrossed: number;
  readonly foundIn: JsScopeNode;
}

export function resolveName(
  scope: JsScopeNode,
  name: string
): NameResolution | undefined {
  let current: JsScopeNode | null = scope;
  let crossed = 0;
  while (current !== null) {
    const binding = current.bindings.get(name);
    if (binding !== undefined) {
      return { binding, functionBoundariesCrossed: crossed, foundIn: current };
    }
    if (current.isFunctionScope) {
      crossed += 1;
    }
    current = current.parent;
  }
  return undefined;
}

/**
 * Adds a binding, first-wins.
 *
 * `var x = 1; var x = 2;` in one function is legal and declares ONE name. The
 * first declaration wins the row and the second increments
 * `redeclarationCount`, so the fact that it happened is kept rather than
 * silently dropped — and so two `js_variable` rows are never minted for one
 * binding, which would double the count rather than collide.
 *
 * A `var` is allowed to be redeclared over a function declaration and vice
 * versa; a `let` over anything is a syntax error the runtime rejects, so if it
 * appears the file does not run and recording the first is the honest answer.
 */
export function addBinding(binding: JsBinding): JsBinding {
  const table = binding.declarationScope.bindings;
  const existing = table.get(binding.name);
  if (existing !== undefined) {
    existing.redeclarationCount += 1;
    return existing;
  }
  table.set(binding.name, binding);
  return binding;
}

/**
 * The names JavaScript provides with no declaration anywhere.
 *
 * Used to separate `GLOBAL_BUILTIN` from `UNRESOLVED_FREE`, which are two
 * different reports: the first says the target is in the `lib_*` population, and
 * the second says the parser genuinely does not know. Conflating them would hide
 * a real gap inside a category that is expected to be large.
 *
 * Deliberately **not** exhaustive, and deliberately not read from
 * `lib.*.d.ts`. Reading the lib files would make this a function of an installed
 * TypeScript rather than of the source, and the value it feeds is a coarse
 * classification, not a resolution. The schema's own measurement is the reason
 * it matters at all: 15.3-24.4% of oracle declines are calls whose receiver is a Node
 * builtin with no ambient declarations, which is the `lib_*` population and not
 * a parser gap.
 */
export const GLOBAL_BUILTIN_NAMES: ReadonlySet<string> = new Set([
  // ECMAScript intrinsics.
  'Array', 'ArrayBuffer', 'BigInt', 'Boolean', 'DataView', 'Date', 'Error',
  'EvalError', 'FinalizationRegistry', 'Float32Array', 'Float64Array', 'Function',
  'Int8Array', 'Int16Array', 'Int32Array', 'Intl', 'JSON', 'Map', 'Math',
  'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError',
  'Reflect', 'RegExp', 'Set', 'SharedArrayBuffer', 'String', 'Symbol',
  'SyntaxError', 'TypeError', 'URIError', 'Uint8Array', 'Uint8ClampedArray',
  'Uint16Array', 'Uint32Array', 'WeakMap', 'WeakRef', 'WeakSet',
  'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape',
  'eval', 'globalThis', 'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'unescape',
  'Infinity', 'NaN', 'undefined',
  // The Node and browser ambients that appear in almost every real file. These
  // are the 15.3-24.4% class: present at runtime, described only by @types/node.
  'console', 'process', 'Buffer', 'setTimeout', 'clearTimeout', 'setInterval',
  'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'structuredClone', 'TextDecoder', 'TextEncoder', 'URL', 'URLSearchParams',
  'AbortController', 'AbortSignal', 'Event', 'EventTarget', 'fetch', 'Headers',
  'Request', 'Response', 'window', 'document', 'navigator', 'location',
  'localStorage', 'sessionStorage', 'performance', 'crypto',
  // CommonJS's own ambients. `require` is here so a bare reference to it does
  // not read as an unresolved free name; the CALL is a module edge, handled
  // separately and never as an ordinary call site.
  'require', 'module', 'exports', '__dirname', '__filename',
]);
