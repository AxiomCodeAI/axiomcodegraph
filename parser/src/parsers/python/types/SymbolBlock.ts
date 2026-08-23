import { PythonBindingOrigin } from '@/enums/python/bindings';
import { PythonScopeKind, SymbolBlockType } from '@/enums/python/scopes';

/**
 * Where a name's binding came from syntactically, accumulated per
 * `(block, name)` alongside the flag set so `py_binding.bindingOrigin`,
 * `bindingCount`, `firstBindingLine` and `lastBindingLine` can all be reported
 * without a second traversal.
 */
export interface SymbolOriginRecord {
  /** Every distinct syntactic form that bound this name in this scope. */
  origins: Set<PythonBindingOrigin>;
  firstLine: number;
  lastLine: number;
  /** Distinct binding *sites* for this name in this scope. */
  bindingCount: number;
  /** Annotation text, when the name was annotated; `''` otherwise. */
  declaredTypeName: string;
}

/**
 * One symbol-table block: a module, class body, function, lambda, or
 * comprehension.
 *
 * ## Why this is a side table and never a property on tree-sitter nodes
 *
 * node-tree-sitter hands out **transient wrapper objects**. Its internal node
 * cache evicts entries, so a property assigned to a node during one traversal is
 * simply gone by the next, and subsequent `.parent` walks return untagged
 * objects. That failure works on small files and breaks silently at scale —
 * the worst possible shape for a bug. Every block therefore keys off `nodeId`
 * (the numeric `node.id`) and all cross-pass state lives here.
 */
export interface SymbolBlock {
  /** `node.id` of the scope-introducing node; the root's id for a module. */
  nodeId: number;
  blockType: SymbolBlockType;
  scopeKind: PythonScopeKind;
  /** symtable's own name: a def/class name, or `lambda`/`listcomp`/`genexpr`/`top`. */
  name: string;
  /** CPython `__qualname__` semantics, including the `<locals>` marker. */
  qualifiedName: string;
  parent: SymbolBlock | null;
  children: SymbolBlock[];
  /** 1-based line of the scope-introducing node; 0 for the module block. */
  startLine: number;
  /** 0-based column. Required for PK uniqueness — two lambdas can share a line. */
  startColumn: number;
  endLine: number;
  endColumn: number;
  nestingDepth: number;
  /** Index among siblings of the same parent, in source order. */
  scopeOrdinal: number;

  /**
   * The private-name mangling prefix in force inside this block — `_Outer` for
   * a block lexically inside `class Outer`, or `''` where no class encloses it.
   *
   * CPython rewrites `__x` to `_Outer__x` for every identifier in a class body
   * **and in every scope nested within it**, however deep:
   *
   * ```python
   * class Outer:
   *     __secret = 1              # binds _Outer__secret
   *     def m(self):
   *         return [__deep for _ in x]   # binds _Outer__deep in the listcomp
   * ```
   *
   * The prefix is the *nearest* enclosing class with leading underscores
   * stripped, which is why it is carried per block rather than recomputed.
   */
  privateNamePrefix: string;

  /** name -> accumulated symbol flags. Insertion-ordered, as CPython's dict is. */
  symbols: Map<string, number>;
  /** name -> syntactic provenance. */
  origins: Map<string, SymbolOriginRecord>;

  /** `SymbolTable.is_nested()`. */
  isNested: boolean;
  /** A `from x import *` occurs directly in this block. */
  usesWildcardImport: boolean;
  /** A `global` statement occurs directly in this block. */
  declaresGlobal: boolean;
  /** A `nonlocal` statement occurs directly in this block. */
  declaresNonlocal: boolean;
  /** Contains a `yield` / `yield from` — ast-derived, not symtable-derived. */
  isGenerator: boolean;
  /** An `async def` — ast-derived. */
  isCoroutine: boolean;

  // ---- pass 2 results ---------------------------------------------------
  /** name -> resolved symbol scope. Empty until the analysis pass runs. */
  scopes: Map<string, number>;
  /** This block references a free variable. */
  hasFree: boolean;
  /** A descendant block references a free variable. */
  hasChildFree: boolean;
}
