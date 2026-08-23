import { SymbolBlockType } from '@/enums/python/scopes';
import { SymbolBlock } from '@/parsers/python/types';

/**
 * CPython's symbol-table flags, verbatim from `Include/internal/pycore_symtable.h`.
 *
 * These are reproduced as literal bit values rather than re-invented because the
 * whole point of this module is to compute what CPython computes. A flag set is
 * accumulated per `(block, name)` in pass 1; pass 2 turns it into one of the
 * {@link SymbolScope} values.
 */
export const SymbolFlags = {
  /** `global x` appeared in this block. */
  DEF_GLOBAL: 1,
  /** The name is assigned to in this block. */
  DEF_LOCAL: 2,
  /** The name is a parameter of this block. */
  DEF_PARAM: 2 << 1,
  /** `nonlocal x` appeared in this block. */
  DEF_NONLOCAL: 2 << 2,
  /** The name is read in this block. */
  USE: 2 << 3,
  /** Free-variable marker used while splicing children's free sets. */
  DEF_FREE: 2 << 4,
  /** A class body's free variable that shadows a class-level binding. */
  DEF_FREE_CLASS: 2 << 5,
  /** The name is bound by an `import` statement. */
  DEF_IMPORT: 2 << 6,
  /** The name carries an annotation. */
  DEF_ANNOT: 2 << 7,
  /** Comprehension iteration variable marker. */
  DEF_COMP_ITER: 2 << 8,
} as const;

/**
 * "Bound" means the name is genuinely established in this block, by any of the
 * three mechanisms that do so. CPython treats these as one test in several
 * places, so it is one constant here too.
 */
export const DEF_BOUND =
  SymbolFlags.DEF_LOCAL | SymbolFlags.DEF_PARAM | SymbolFlags.DEF_IMPORT;

/**
 * The resolved scope of a name, computed in pass 2. CPython's own values.
 */
export const SymbolScope = {
  NONE: 0,
  LOCAL: 1,
  GLOBAL_EXPLICIT: 2,
  GLOBAL_IMPLICIT: 3,
  FREE: 4,
  CELL: 5,
} as const;

export type SymbolScopeValue = (typeof SymbolScope)[keyof typeof SymbolScope];

/** Creates an empty block. Kept in one place so no field is ever forgotten. */
export function createSymbolBlock(init: {
  nodeId: number;
  privateNamePrefix: string;
  blockType: SymbolBlockType;
  scopeKind: PythonScopeKind;
  name: string;
  qualifiedName: string;
  parent: SymbolBlock | null;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  nestingDepth: number;
}): SymbolBlock {
  return {
    ...init,
    children: [],
    scopeOrdinal: 0,
    symbols: new Map(),
    origins: new Map(),
    // ste_nested: set when the immediate parent is nested, or is a function
    // block. A method of a module-level class is therefore NOT nested, while a
    // function inside a function is.
    isNested:
      init.parent !== null &&
      (init.parent.isNested || init.parent.blockType === SymbolBlockType.FUNCTION),
    usesWildcardImport: false,
    declaresGlobal: false,
    declaresNonlocal: false,
    isGenerator: false,
    isCoroutine: false,
    scopes: new Map(),
    hasFree: false,
    hasChildFree: false,
  };
}

/** Adds flags to a name in a block, creating the entry if needed. */
export function addSymbolFlags(block: SymbolBlock, name: string, flags: number): void {
  block.symbols.set(name, (block.symbols.get(name) ?? 0) | flags);
}

/**
 * `SymbolTable.is_optimized()` — true exactly for function blocks.
 *
 * Lambdas and comprehensions are function blocks, so they are optimized too.
 * The Python 2 `exec`-statement de-optimisation that used to complicate this is
 * gone: Python 3's `exec()` is an ordinary function call.
 */
export function isOptimized(block: SymbolBlock): boolean {
  return block.blockType === SymbolBlockType.FUNCTION;
}

/**
 * Pass 2 — CPython's `analyze_block`, transcribed.
 *
 * Pass 1 records only what each block says about each name. It cannot decide
 * scope, because "is this name free?" depends on blocks that have not been
 * visited yet, and "is this local a cell?" depends on whether any *descendant*
 * captures it. So resolution is a separate top-down walk that threads three sets
 * through the tree:
 *
 * - `bound`   — names bound in enclosing **function** scopes, i.e. what a nested
 *               block may capture. Class bodies deliberately do not contribute.
 * - `global`  — names declared `global` somewhere up the chain.
 * - `free`    — names a block or its descendants failed to bind locally and
 *               therefore captured; spliced back up on the way out.
 *
 * The class-body asymmetry is the subtle part and it is load-bearing: a class
 * namespace has **no effect** on names visible in nested functions, so a method
 * cannot see its class's attributes as locals. That is why the `bound` set is
 * populated *before* class variables are added, and why `drop_class_free`
 * exists.
 */
export function analyzeSymbolTable(root: SymbolBlock): void {
  analyzeBlock(root, new Set<string>(), new Set<string>(), new Set<string>());
}

function analyzeBlock(
  block: SymbolBlock,
  bound: Set<string>,
  free: Set<string>,
  global: Set<string>
): void {
  const local = new Set<string>();
  const scopes = new Map<string, SymbolScopeValue>();
  const newGlobal = new Set<string>();
  const newFree = new Set<string>();
  const newBound = new Set<string>();

  // A class namespace has no effect on names visible in nested functions, so
  // the sets handed to children are populated BEFORE the class's own variables
  // are analysed below.
  if (block.blockType === SymbolBlockType.CLASS) {
    for (const name of global) {
      newGlobal.add(name);
    }
    for (const name of bound) {
      newBound.add(name);
    }
  }

  for (const [name, flags] of block.symbols) {
    analyzeName(block, scopes, name, flags, bound, local, free, global);
  }

  if (block.blockType !== SymbolBlockType.CLASS) {
    // Only a function's locals are visible to nested scopes.
    if (block.blockType === SymbolBlockType.FUNCTION) {
      for (const name of local) {
        newBound.add(name);
      }
    }
    for (const name of bound) {
      newBound.add(name);
    }
    for (const name of global) {
      newGlobal.add(name);
    }
  } else {
    // `__class__` is implicitly available to methods that use `super()` or
    // reference it directly.
    newBound.add('__class__');
  }

  for (const child of block.children) {
    // Each child gets its own copies: these sets are consumed by every block
    // enclosed by this one, and a child must not mutate its siblings' view.
    const childFree = new Set<string>();
    analyzeBlock(child, new Set(newBound), childFree, new Set(newGlobal));
    for (const name of childFree) {
      newFree.add(name);
    }
    if (child.hasFree || child.hasChildFree) {
      block.hasChildFree = true;
    }
  }

  if (block.blockType === SymbolBlockType.FUNCTION) {
    analyzeCells(scopes, newFree);
  } else if (block.blockType === SymbolBlockType.CLASS) {
    dropClassFree(block, newFree);
  }

  updateSymbols(block, scopes, bound, newFree, block.blockType === SymbolBlockType.CLASS);

  // Propagate this block's unresolved free names to the caller.
  for (const name of newFree) {
    free.add(name);
  }

  block.scopes = scopes;
}

/**
 * CPython's `analyze_name`. The order of these tests is the specification —
 * `global` beats `nonlocal` beats a local binding beats capture beats an
 * enclosing `global` beats the implicit-global fallback.
 */
function analyzeName(
  block: SymbolBlock,
  scopes: Map<string, SymbolScopeValue>,
  name: string,
  flags: number,
  bound: Set<string>,
  local: Set<string>,
  free: Set<string>,
  global: Set<string>
): void {
  if (flags & SymbolFlags.DEF_GLOBAL) {
    scopes.set(name, SymbolScope.GLOBAL_EXPLICIT);
    global.add(name);
    bound.delete(name);
    return;
  }

  if (flags & SymbolFlags.DEF_NONLOCAL) {
    // A `nonlocal` with no binding in any enclosing scope is a SyntaxError in
    // CPython. We record the declared intent rather than throwing: rejecting the
    // file would lose every other fact in it, and the engine can see the
    // NONLOCAL binding with no target.
    scopes.set(name, SymbolScope.FREE);
    block.hasFree = true;
    free.add(name);
    return;
  }

  if (flags & DEF_BOUND) {
    scopes.set(name, SymbolScope.LOCAL);
    local.add(name);
    global.delete(name);
    return;
  }

  // Not bound here: if an enclosing function scope binds it, this is a capture.
  if (bound.has(name)) {
    scopes.set(name, SymbolScope.FREE);
    block.hasFree = true;
    free.add(name);
    return;
  }

  // An enclosing `global` declaration makes it global; otherwise the fallback
  // is the module namespace, which is also where builtins are found.
  scopes.set(name, SymbolScope.GLOBAL_IMPLICIT);
}

/**
 * `analyze_cells` — a local that some descendant captured is not a frame slot
 * but a closure cell.
 *
 * This is why pass 2 cannot be merged into pass 1: the promotion depends on
 * children that pass 1 has not yet reached.
 */
function analyzeCells(scopes: Map<string, SymbolScopeValue>, free: Set<string>): void {
  for (const [name, scope] of scopes) {
    if (scope !== SymbolScope.LOCAL) {
      continue;
    }
    if (!free.has(name)) {
      continue;
    }
    scopes.set(name, SymbolScope.CELL);
    free.delete(name);
  }
}

/**
 * `drop_class_free` — a class body does not provide closure cells, so a name a
 * method captured must keep travelling outward past the class.
 */
function dropClassFree(block: SymbolBlock, free: Set<string>): void {
  if (free.delete('__class__')) {
    block.hasFree = true;
  }
}

/**
 * `update_symbols` — writes the resolved scopes back, then records the free
 * variables the children could not resolve.
 *
 * The second loop is what makes a captured name appear as a `FREE` symbol in
 * every intermediate scope between the capture and the binding, which is how
 * `nonlocal count` two levels down still resolves to one binding.
 */
function updateSymbols(
  block: SymbolBlock,
  scopes: Map<string, SymbolScopeValue>,
  bound: Set<string>,
  free: Set<string>,
  isClassBlock: boolean
): void {
  for (const name of free) {
    const existing = block.symbols.get(name);
    if (existing !== undefined) {
      // A free variable in a method whose name is also a class-level binding.
      if (isClassBlock && existing & (DEF_BOUND | SymbolFlags.DEF_GLOBAL)) {
        block.symbols.set(name, existing | SymbolFlags.DEF_FREE_CLASS);
      }
      // Already a cell, or already free in this scope — nothing to add.
      continue;
    }
    if (!bound.has(name)) {
      // Not free in this scope either; it keeps travelling outward.
      continue;
    }
    // Propagate the new free symbol up the lexical stack.
    block.symbols.set(name, SymbolFlags.DEF_FREE);
    scopes.set(name, SymbolScope.FREE);
  }
}
