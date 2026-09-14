import { JsScopeRegistry } from '@/analysis-types/javascript/JsScopeRegistry';
import { JsScopeNode } from '@/parsers/javascript/extractors/js-symbol-table';
import { ScopeBuildResult } from '@/parsers/javascript/extractors/js-scope-builder';

/**
 * Turns the binder's scope tree into `js_scope` rows.
 *
 * Separate from the builder on purpose: the builder answers *what are the
 * scopes*, and every consumer inside the parser wants that answer as a tree it
 * can walk. This file answers *what rows does the tree emit*, which nothing
 * inside the parser cares about. Keeping them apart is what lets the declaration
 * and expression passes resolve names against a scope without going through a
 * hash.
 *
 * ## Emission order is creation order, and creation order is the walk
 *
 * `ScopeBuildResult.scopes` is in the order the builder opened them — a
 * pre-order traversal of the source. That is deterministic for a given file and
 * independent of hash values, which is what makes two runs byte-identical.
 * Sorting by hash instead would also be deterministic and would scramble the
 * file's structure in the output, making a diff unreadable for no gain.
 *
 * ## A parent's row always precedes its children's
 *
 * A consequence of pre-order, and worth relying on: a consumer streaming the
 * relation can build the tree in one pass without buffering.
 */
export interface ScopeExtractionResult {
  readonly scopes: readonly JsScopeRegistry[];
  /** The registry row for each scope, keyed by the builder's scope key. */
  readonly rowByScopeKey: ReadonlyMap<string, JsScopeRegistry>;
  /** Convenience: the hash of the scope a node sits in. */
  readonly hashOfScope: (scope: JsScopeNode) => string;
}

export function extractScopes(options: {
  readonly build: ScopeBuildResult;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
}): ScopeExtractionResult {
  const rowByScopeKey = new Map<string, JsScopeRegistry>();
  const rows: JsScopeRegistry[] = [];

  for (const scope of options.build.scopes) {
    const row = new JsScopeRegistry({
      scopeKind: scope.kind,
      // The parent's row exists already: pre-order guarantees it, and a `""`
      // here for anything but GLOBAL would be a broken tree rather than a
      // missing optional value.
      parentScopeLinkHash: scope.parent === null
        ? ''
        : rowByScopeKey.get(scope.parent.key)?.getHash() ?? '',
      depth: scope.depth,
      isFunctionScope: scope.isFunctionScope,
      bindsThis: scope.bindsThis,
      bindsArguments: scope.bindsArguments,
      isStrictMode: scope.isStrictMode,
      strictModeSource: scope.strictModeSource,
      hasWithStatement: scope.hasWithStatement,
      ownerModuleLinkHash: options.moduleHash,
      startLine: scope.startLine,
      startColumn: scope.startColumn,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    // Counted from the scope's own table, which holds exactly the bindings whose
    // DECLARATION scope this is. A `var` written in a block is counted in the
    // enclosing function scope and not in the block — which is the whole point,
    // and makes this column a check on the hoisting model rather than a tally of
    // syntax.
    row.setDeclaredBindingCount(scope.bindings.size);
    rows.push(row);
    rowByScopeKey.set(scope.key, row);
  }

  return {
    scopes: rows,
    rowByScopeKey,
    hashOfScope: (scope: JsScopeNode): string =>
      rowByScopeKey.get(scope.key)?.getHash() ?? '',
  };
}
