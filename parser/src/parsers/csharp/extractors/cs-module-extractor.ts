import * as path from 'path';

import Parser from 'tree-sitter';
import { topLevelStatementsOf } from '@/parsers/csharp/extractors/cs-member-extractor';

import { CsModuleRegistry } from '@/analysis-types/csharp/CsModuleRegistry';
import {
  CSHARP_EMISSION_REGIME,
  CSHARP_GRAMMAR_REGIME,
} from '@/constants/csharp-constants';
import { CsNamespaceStyle, CsNullableContext } from '@/enums/csharp/modules';
import { namedChildren } from '@/parsers/csharp/extractors/cs-node';
import { NullableContextMap } from '@/parsers/csharp/extractors/preproc-context';

/**
 * The governing configuration for one file. **Always an input, never inferred.**
 *
 * `targetFramework` and `defineConstants` are in `cs_module`'s primary key, and
 * a wrong value there silently re-keys the whole file. So they are supplied by
 * the caller — from a `.csproj` reader, or from the pinned defaults — and this
 * extractor does not go looking. No MSBuild, no `dotnet`, no .NET in the
 * process at all: the parser is a Node library that runs on arbitrary customer
 * checkouts and a runtime dependency is a different product.
 */
export interface CsModuleContext {
  readonly targetFramework: string;
  readonly defineConstantsKey: string;
  readonly langVersion: string;
  readonly nullableContextDefault: CsNullableContext;
  readonly projectPath: string;
  readonly assemblyName: string;
  readonly implicitUsingsEnabled: boolean;
}

/** Filename patterns that mark BUILD OUTPUT rather than hand-written source. */
const GENERATED_SUFFIXES = ['.designer.cs', '.g.cs', '.generated.cs', '.g.i.cs'];
const GENERATED_NAMES = ['assemblyinfo.cs', 'assemblyattributes.cs'];

/**
 * Mints one `cs_module` row.
 *
 * ## Minted from the PATH, before the file is parsed
 *
 * Every key component is known from the path and the governing configuration.
 * Nothing here needs the tree. That is deliberate and it is what §1's build
 * order requires: *"mint every module hash up front from PATHS ALONE, before
 * parsing any file"*, so a declaration in file B can key itself under file A's
 * scope without file A having been parsed.
 *
 * With `partial` that is not a convenience. 88 declarations of linq-heavy-A's
 * generated model live in 88 files, and no ordering of those files makes one of
 * them "first".
 */
export function mintModule(options: {
  absoluteFilePath: string;
  filePath: string;
  baseMservPath: string;
  context: CsModuleContext;
  serviceVersionLinkHash: string;
}): CsModuleRegistry {
  const fileName = path.basename(options.filePath);
  const module = new CsModuleRegistry({
    // `name` is the file stem, matching how java_module and py_module name a
    // compilation unit. A C# file's name binds to nothing in the language — a
    // file may declare any number of types with any names — so this is a label
    // and never an identity component beyond the path it came from.
    name: fileName.replace(/\.cs$/i, ''),
    qualifiedName: options.filePath,
    fileName,
    filePath: options.filePath,
    baseMservPath: options.baseMservPath,
    targetFramework: options.context.targetFramework,
    defineConstantsKey: options.context.defineConstantsKey,
    langVersion: options.context.langVersion,
    emissionRegime: CSHARP_EMISSION_REGIME,
    grammarRegime: CSHARP_GRAMMAR_REGIME,
    startLine: 1,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });

  module.setProjectContext({
    projectPath: options.context.projectPath,
    assemblyName: options.context.assemblyName,
    implicitUsingsEnabled: options.context.implicitUsingsEnabled,
  });
  module.setGeneratedOutput(isGeneratedOutput(fileName));
  return module;
}

/**
 * Records what parsing found, without touching the hash.
 *
 * Kept apart from {@link mintModule} for the reason above: a value that arrives
 * only after the tree exists must not be able to change the key, and the way to
 * guarantee that is for it to arrive through a different method.
 */
export function recordParsedShape(
  module: CsModuleRegistry,
  root: Parser.SyntaxNode,
  nullableContext: NullableContextMap,
  fileDefault: CsNullableContext,
  /**
   * The gaps `cs_parse_gap` will carry for this file.
   *
   * Passed in rather than recomputed, so `cs_module.parseErrorCount` and the
   * `cs_parse_gap` rows CANNOT DISAGREE. They did: the module counted only
   * `ERROR` and `isMissing` nodes and pruned on `hasError`, while the gap
   * extractor learned that neither test is sufficient. A summary column that
   * contradicts the rows it summarises is worse than not having it, because a
   * consumer will trust whichever it read first.
   */
  errors: { count: number; bytes: number }
): void {
  const namespaces = collectNamespaceDeclarations(root);

  module.setParsedShape({
    namespaceStyle: namespaceStyleOf(root, namespaces),
    // EVERY namespace declared, nested ones included: `namespace A { namespace
    // B { } }` declares two, `A` and `A.B`, and a type in each is in a different
    // namespace. `namespaceStyle` answers the different question of whether the
    // file has one ROOT.
    namespaceCount: namespaces.length,
    // The file's DEFAULT, which is the project's answer unless a directive
    // precedes the first declaration. Every declaration carries its own value
    // from `nullableContext.at()`; this column is the baseline, not a summary.
    nullableContextDefault: nullableContext.at(0) === fileDefault
      ? fileDefault
      : nullableContext.at(0),
    // THE SAME READING the member extractor mints `<Main>$` from and the fact
    // extractor mints the `Program` type from. This column was a THIRD copy of
    // the question and disagreed with the other two: three modules in
    // source-generator-B said true while only two entry points existed, because
    // a `global_statement` ejected by recovery counts here and not there.
    hasTopLevelStatements: topLevelStatementsOf(root).length > 0,
    startLine: 1,
    endLine: root.endPosition.row + 1,
    parseErrorCount: errors.count,
    parseErrorBytes: errors.bytes,
  });
}

/**
 * Every namespace declaration in the file, including nested ones.
 *
 * A walk rather than a scan of the root's children: `namespace A { namespace B
 * { … } }` is legal and both are namespaces, and a scan would count one.
 */
function collectNamespaceDeclarations(root: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const found: Parser.SyntaxNode[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (
      node.type === 'namespace_declaration' ||
      node.type === 'file_scoped_namespace_declaration'
    ) {
      found.push(node);
    }
    for (const child of namedChildren(node)) {
      stack.push(child);
    }
  }
  return found;
}

/**
 * The file's namespace shape.
 *
 * ## `MIXED` means SIBLINGS, not nesting
 *
 * `namespace A { namespace B { … } }` is **one** shape, not two: the file has a
 * single root, `A`, and everything in it is under that root. Calling it `MIXED`
 * would put the ordinary nested-namespace idiom into a bucket the schema sizes
 * at 13 files out of 9,568, and the enum audit is what caught it — the value
 * turned up emitted on the first run against a corpus that contains no mixed
 * file at all.
 *
 * `MIXED` is therefore two SIBLING namespaces at the top of the compilation
 * unit, or both styles in one file. Those are the cases where a consumer
 * reading one namespace name off the module row would attribute types to the
 * wrong one, which is the whole reason the value exists.
 */
function namespaceStyleOf(
  root: Parser.SyntaxNode,
  namespaces: readonly Parser.SyntaxNode[]
): CsNamespaceStyle {
  if (namespaces.length === 0) {
    return CsNamespaceStyle.NONE;
  }
  const topLevel = namedChildren(root).filter(
    (n) =>
      n.type === 'namespace_declaration' || n.type === 'file_scoped_namespace_declaration'
  );
  const styles = new Set(namespaces.map((n) => n.type));
  if (topLevel.length > 1 || styles.size > 1) {
    return CsNamespaceStyle.MIXED;
  }
  return namespaces[0]!.type === 'file_scoped_namespace_declaration'
    ? CsNamespaceStyle.FILE_SCOPED
    : CsNamespaceStyle.BLOCK;
}

/**
 * Whether the file is build output.
 *
 * Provenance, **not a skip**. A `*.g.cs` carries real declarations and real call
 * edges, and it is very often the other half of a `partial` whose hand-written
 * half is beside it. 76.5% of partial identities have exactly one part in
 * source precisely because the generated part is not checked in — so a consumer
 * needs to know which kind of file it is holding.
 */
export function isGeneratedOutput(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    GENERATED_SUFFIXES.some((suffix) => lower.endsWith(suffix)) ||
    GENERATED_NAMES.includes(lower)
  );
}
