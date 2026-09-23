import Parser from 'tree-sitter';

import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsUsingRegistry } from '@/analysis-types/csharp/CsUsingRegistry';
import { CsUsingKind } from '@/enums/csharp/imports';
import { CsReferenceOwnerKind, CsTypeRefContext } from '@/enums/csharp/type-references';
import { extractTypeReferences } from '@/parsers/csharp/extractors/cs-type-reference-extractor';
import {
  allChildren,
  namedChildren,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import {
  PREPROC_CHAIN_ROOT,
  resolvePreprocBranches,
} from '@/parsers/csharp/extractors/preproc-context';

/**
 * `cs_using` — every namespace and type brought into scope, including the ones
 * with no syntax.
 *
 * ## Engine-critical, and the reason is extension methods
 *
 * `xs.Count()` calls a method declared on a static class the receiver has never
 * heard of, and **whether that method is visible at all depends on which
 * namespaces are imported at the call site.** The three facts that make the
 * edge reconstructable are the `this`-parameter marker
 * (`cs_method_parameter.parameterMode = THIS`), the declaring static class
 * (`cs_method.csTypeLinkHash`), and this relation. Any one missing and the edge
 * cannot be rebuilt.
 *
 * The parser emits all three and **resolves none of them**.
 *
 * ## Four forms, and the fourth is in no file
 *
 * Alias, `using static`, `global using` — and **implicit usings**, injected by
 * the SDK when a project sets `<ImplicitUsings>enable</ImplicitUsings>`. 59
 * projects in the measured corpus do. They appear nowhere in the source and put
 * `System`, `System.Linq` and `System.Collections.Generic` in scope for every
 * file, which is exactly the set `xs.Where(…)` needs.
 *
 * So this extractor is handed them, the same way it is handed
 * `DefineConstants` — by the analyzer, from the governing project's
 * `<ImplicitUsings>` and `<Using>` items (cs-project-config.ts).
 */

export interface CsUsingExtractionOptions {
  readonly root: Parser.SyntaxNode;
  readonly csModuleLinkHash: string;
  readonly serviceVersionLinkHash: string;
  readonly activeSymbols: ReadonlySet<string>;
  /**
   * Namespaces the SDK injects into every file of the governing project.
   *
   * An INPUT. Never inferred. Emitted with `startLine = 0` and `originFile = ''`
   * because there is no file and no line to point at.
   */
  readonly implicitUsings: readonly string[];
}

export function extractUsings(
  options: CsUsingExtractionOptions
): { usings: CsUsingRegistry[]; typeReferences: CsTypeReferenceRegistry[] } {
  const rows: CsUsingRegistry[] = [];
  const typeReferences: CsTypeReferenceRegistry[] = [];
  let position = 0;

  // The SDK's first, so their ordinals are stable regardless of what the file
  // contains — a file gaining a `using` must not re-key the implicit ones.
  for (const namespaceName of options.implicitUsings) {
    rows.push(
      new CsUsingRegistry({
        usingKind: CsUsingKind.IMPLICIT,
        namespaceOrTypeName: namespaceName,
        aliasName: '',
        aliasTargetText: '',
        // Implicit usings ARE global in effect — every file of the project sees
        // them — so a rule filtering on `isGlobal` must find them.
        isGlobal: true,
        isStatic: false,
        isImplicit: true,
        originFile: '',
        csModuleLinkHash: options.csModuleLinkHash,
        position,
        startLine: 0,
        startColumn: 0,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      })
    );
    position += 1;
  }

  for (const node of usingDirectives(options.root, options.activeSymbols)) {
    const row = readUsing(node, position, options);
    rows.push(row);
    // `using Sh = List<int>;` — the alias TARGET is a type expression, and it
    // is the one reference a using directive makes. Owned by the using row
    // (ruling v1.7).
    const aliasNode = node.childForFieldName('name');
    if (aliasNode !== null) {
      const target = namedChildren(node)
        .filter((child) => child.id !== aliasNode.id)
        .pop();
      typeReferences.push(
        ...extractTypeReferences({
          typeNode: target,
          ownerLinkHash: row.getHash(),
          referenceOwnerKind: CsReferenceOwnerKind.USING,
          context: CsTypeRefContext.USING_ALIAS_TARGET,
          serviceVersionLinkHash: options.serviceVersionLinkHash,
        })
      );
    }
    position += 1;
  }

  return { usings: rows, typeReferences };
}

/**
 * Every `using_directive` in the file, from the ACTIVE `#if` branches only.
 *
 * A `using` inside an inactive branch is not in scope, and emitting it would
 * make an extension method appear visible in a configuration where it is not —
 * the direction that INVENTS an edge, which is worse than losing one.
 *
 * A directive may also sit inside a namespace body, where it governs only that
 * namespace. The row is emitted either way; the position is what an engine uses
 * to decide, and the parser does not compute the scope.
 */
function usingDirectives(
  root: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const found: Parser.SyntaxNode[] = [];
  const queue = namedChildren(root);
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(node, activeSymbols);
      const expanded: Parser.SyntaxNode[] = [];
      for (const branch of branches) {
        if (branch.isActive) {
          expanded.push(...(bodies.get(branch.branchIndex) ?? []));
        }
      }
      queue.unshift(...expanded);
      continue;
    }
    if (node.type === 'using_directive') {
      found.push(node);
      continue;
    }
    // Descend into namespaces ONLY, and into their `declaration_list`, because a
    // BLOCK namespace puts its usings there rather than directly on the
    // declaration. Missing that lost every using written inside `namespace N { }`
    // — which is where 1,795 of the corpus's files put them.
    //
    // Namespaces only, and not a generic walk: `using (var x = …)` is a DISPOSAL
    // SCOPE, not an import, and a generic walk would put a variable declaration
    // into the import relation.
    if (
      node.type === 'namespace_declaration' ||
      node.type === 'file_scoped_namespace_declaration' ||
      node.type === 'declaration_list'
    ) {
      queue.unshift(...namedChildren(node));
    }
  }
  return found;
}

function readUsing(
  node: Parser.SyntaxNode,
  position: number,
  options: CsUsingExtractionOptions
): CsUsingRegistry {
  // `global` and `static` are ANONYMOUS tokens, the same trap as `ref struct`.
  const isGlobal = hasKeyword(node, 'global');
  const isStatic = hasKeyword(node, 'static');

  // An ALIAS binds a `name` FIELD; a plain using does not. That is the
  // discriminator, and it is a real field, so `childForFieldName` is safe here.
  const aliasNode = node.childForFieldName('name');
  const aliasName = aliasNode?.text ?? '';
  const isAlias = aliasName !== '';

  // The target is the last named child that is not the alias identifier.
  const target = namedChildren(node)
    .filter((child) => aliasNode === null || child.id !== aliasNode.id)
    .pop();
  const targetText = target?.text ?? '';

  const usingKind = isAlias
    ? isGlobal
      ? CsUsingKind.GLOBAL_ALIAS
      : CsUsingKind.ALIAS
    : isStatic
      ? isGlobal
        ? CsUsingKind.GLOBAL_STATIC
        : CsUsingKind.STATIC
      : isGlobal
        ? CsUsingKind.GLOBAL_NAMESPACE
        : CsUsingKind.NAMESPACE;

  return new CsUsingRegistry({
    usingKind,
    namespaceOrTypeName: targetText,
    aliasName,
    // Kept separately from `namespaceOrTypeName` even though they are the same
    // text today: an alias TARGET may be a constructed generic
    // (`using Sh = List<int>;`), which is a type expression and not a name, and
    // a consumer resolving names must not be handed one.
    aliasTargetText: isAlias ? targetText : '',
    isGlobal,
    isStatic,
    isImplicit: false,
    originFile: '',
    csModuleLinkHash: options.csModuleLinkHash,
    position,
    startLine: startLine(node),
    startColumn: startColumn(node),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
}

function hasKeyword(node: Parser.SyntaxNode, keyword: string): boolean {
  for (const child of allChildren(node)) {
    if (!child.isNamed && child.type === keyword) {
      return true;
    }
  }
  return false;
}
