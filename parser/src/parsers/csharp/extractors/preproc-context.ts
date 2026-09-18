import Parser from 'tree-sitter';

import { CsNullableContext } from '@/enums/csharp/modules';
import { allChildren, namedChildren, namedChildrenWithDirectives, TRIVIA_NODE_TYPES } from '@/parsers/csharp/extractors/cs-node';

/**
 * `#if` and `#nullable`, and what "the source" means.
 *
 * ## The problem, stated
 *
 * ```csharp
 * #if NET8_0_OR_GREATER
 *     public void Handle(Span<byte> b) { }
 * #else
 *     public void Handle(byte[] b) { }
 * #endif
 * ```
 *
 * **tree-sitter parses both branches. Roslyn parses one** — whichever the
 * `DefineConstants` of the governing project selects. Emitting the union puts
 * code in the fact base that never compiles together, and every difference from
 * the oracle then reads as a parser defect when it is a difference of question.
 *
 * ## The ruling: option 3
 *
 * One emission per target framework, with `targetFramework` and
 * `defineConstantsKey` in `cs_module`'s primary key — the shape
 * `emissionRegime` already has for `py_module` and `ts_module`. **Rows come from
 * the ACTIVE branch only**, and `cs_preproc_region` records every region with
 * its condition and whether it was taken, so a row's provenance is auditable.
 *
 * 9.4% of corpus files contain a `#if` at all, over 2,091 outermost regions.
 *
 * ## Symbols are an INPUT. Nothing here infers them.
 *
 * No MSBuild, no `dotnet`, no evaluation of a project file's full property
 * graph. The active set is handed in. What this module does supply is the
 * **implicit framework symbols**, which are not written in any `.csproj` and are
 * added by the compiler driver — the table below is verified against the csc
 * command line, not against `dotnet msbuild -getProperty:DefineConstants`, which
 * omits the `_OR_GREATER` symbols because they are added during BUILD rather
 * than at evaluation. That is an official tool returning a short, plausible,
 * wrong answer, and it is recorded here so the next person does not reach for it.
 */

/** A `#if`/`#elif`/`#else` branch and whether this emission takes it. */
export interface PreprocBranch {
  readonly node: Parser.SyntaxNode;
  readonly conditionText: string;
  readonly conditionSymbols: readonly string[];
  readonly isActive: boolean;
  readonly branchIndex: number;
  /**
   * Whether the condition was WORKED OUT, as against defaulting to false.
   *
   * `#else` is trivially evaluated. Everything else that reaches the
   * evaluator's `default` — an expression shape it does not implement — is
   * `false`, and this is the only column that separates that from a symbol
   * genuinely not being defined.
   */
  readonly evaluated: boolean;
}

/**
 * The framework symbols the SDK injects, by target framework moniker.
 *
 * Every `netX.Y` defines `NETX_Y` plus `NETX_Y_OR_GREATER` for itself and every
 * lower version back to `NET5_0`, plus `NETCOREAPP` and its `_OR_GREATER` chain.
 * `netstandard2.0` defines `NETSTANDARD2_0` and its chain. Verified against
 * `/define:` on the csc command line for six TFMs.
 */
const FRAMEWORK_VERSIONS = ['5.0', '6.0', '7.0', '8.0', '9.0', '10.0'] as const;

export function implicitFrameworkSymbols(targetFramework: string): string[] {
  const tfm = targetFramework.trim().toLowerCase();
  const symbols = new Set<string>();

  const netMatch = /^net(\d+)\.(\d+)$/.exec(tfm);
  if (netMatch !== null) {
    const major = Number(netMatch[1]);
    const minor = Number(netMatch[2]);
    symbols.add(`NET${major}_${minor}`);
    symbols.add('NETCOREAPP');
    symbols.add('NET');
    for (const version of FRAMEWORK_VERSIONS) {
      const [vMajor, vMinor] = version.split('.').map(Number);
      if (vMajor! < major || (vMajor === major && vMinor! <= minor)) {
        symbols.add(`NET${vMajor}_${vMinor}_OR_GREATER`);
      }
    }
    // netcoreapp lineage: every net5.0+ TFM is also "3.1 or greater", and so on.
    for (const version of ['1.0', '1.1', '2.0', '2.1', '2.2', '3.0', '3.1']) {
      const [vMajor, vMinor] = version.split('.').map(Number);
      symbols.add(`NETCOREAPP${vMajor}_${vMinor}_OR_GREATER`);
    }
    return [...symbols].sort();
  }

  const standardMatch = /^netstandard(\d+)\.(\d+)$/.exec(tfm);
  if (standardMatch !== null) {
    const major = Number(standardMatch[1]);
    const minor = Number(standardMatch[2]);
    symbols.add('NETSTANDARD');
    symbols.add(`NETSTANDARD${major}_${minor}`);
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2.0', '2.1']) {
      const [vMajor, vMinor] = version.split('.').map(Number);
      if (vMajor! < major || (vMajor === major && vMinor! <= minor)) {
        symbols.add(`NETSTANDARD${vMajor}_${vMinor}_OR_GREATER`);
      }
    }
    return [...symbols].sort();
  }

  const frameworkMatch = /^net(\d)(\d)(\d?)$/.exec(tfm);
  if (frameworkMatch !== null) {
    symbols.add('NETFRAMEWORK');
    symbols.add(`NET${frameworkMatch[1]}${frameworkMatch[2]}${frameworkMatch[3] ?? ''}`);
    return [...symbols].sort();
  }

  // `unspecified`, or a TFM shape not in the table. Returning nothing is the
  // honest answer: guessing would make `#if NET8_0_OR_GREATER` take a branch on
  // no evidence, and a wrong branch is worse than a named absence.
  return [];
}

/**
 * Evaluates a C# preprocessor expression against the active symbol set.
 *
 * The grammar for a `#if` condition is deliberately tiny — identifiers, `true`,
 * `false`, `!`, `&&`, `||`, `==`, `!=`, parentheses. There is no arithmetic and
 * no `#if VERSION > 3`, so this is a complete evaluator rather than a subset.
 */
/**
 * A condition's value AND whether the parser could actually work it out.
 *
 * The two are separate because `false` has two causes that are not the same
 * fact: the symbol is not defined, or the expression is something this
 * evaluator does not implement. Collapsing them makes an unevaluated branch
 * indistinguishable from a genuinely inactive one, and there is then no way to
 * count what the parser is missing.
 *
 * ONE implementation, with {@link evaluateCondition} delegating to it: a second
 * "is this evaluable" predicate written alongside would drift from the
 * evaluator the first time either changed.
 */
export interface ConditionVerdict {
  readonly value: boolean;
  readonly evaluated: boolean;
}

export function evaluateConditionDetailed(
  node: Parser.SyntaxNode | undefined,
  activeSymbols: ReadonlySet<string>
): ConditionVerdict {
  if (node === undefined) {
    return { value: false, evaluated: false };
  }
  switch (node.type) {
    case 'identifier':
      return { value: activeSymbols.has(node.text), evaluated: true };
    case 'boolean_literal':
      return { value: node.text === 'true', evaluated: true };
    case 'true':
      return { value: true, evaluated: true };
    case 'false':
      return { value: false, evaluated: true };
    case 'parenthesized_expression': {
      const inner = namedChildren(node)[0];
      return evaluateConditionDetailed(inner, activeSymbols);
    }
    case 'unary_expression': {
      // `unary_expression`, NOT `prefix_unary_expression`: the preprocessor has
      // its own tiny expression grammar and reuses neither the node type nor
      // the operator set of the C# one. `!` is the only operator it admits.
      const operand = evaluateConditionDetailed(
        node.childForFieldName('argument') ?? undefined,
        activeSymbols
      );
      return { value: !operand.value, evaluated: operand.evaluated };
    }
    case 'binary_expression': {
      const operands = namedChildren(node);
      const operator = allChildren(node).find((c) => !c.isNamed)?.type ?? '';
      const left = evaluateConditionDetailed(operands[0], activeSymbols);
      const right = evaluateConditionDetailed(operands[1], activeSymbols);
      const evaluated = left.evaluated && right.evaluated;
      switch (operator) {
        case '&&':
          return { value: left.value && right.value, evaluated };
        case '||':
          return { value: left.value || right.value, evaluated };
        case '==':
          return { value: left.value === right.value, evaluated };
        case '!=':
          return { value: left.value !== right.value, evaluated };
        default:
          return { value: false, evaluated: false };
      }
    }
    default:
      return { value: false, evaluated: false };
  }
}

export function evaluateCondition(
  node: Parser.SyntaxNode | undefined,
  activeSymbols: ReadonlySet<string>
): boolean {
  return evaluateConditionDetailed(node, activeSymbols).value;
}

/** Every identifier mentioned in a condition, in source order, deduplicated. */
export function conditionSymbols(node: Parser.SyntaxNode | undefined): string[] {
  if (node === undefined) {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.type === 'identifier' && !seen.has(current.text)) {
      seen.add(current.text);
      found.push(current.text);
    }
    for (const child of namedChildren(current)) {
      stack.push(child);
    }
  }
  return found.sort();
}

/**
 * The `#nullable` context in force at each byte offset in a file.
 *
 * Built once per file by scanning the directives in order, then queried by
 * offset. A per-region structure rather than a per-file value because
 * `#nullable` is overridable mid-file and **453 of the 497 directives measured
 * are `disable`** — reading one value for the whole file is wrong in the common
 * case, and wrong invisibly, since the type name does not change.
 */
export class NullableContextMap {
  private readonly transitions: { offset: number; context: CsNullableContext }[] = [];

  constructor(root: Parser.SyntaxNode, fileDefault: CsNullableContext) {
    this.transitions.push({ offset: 0, context: fileDefault });
    const stack = [root];
    const found: { offset: number; context: CsNullableContext }[] = [];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'preproc_nullable') {
        found.push({
          offset: node.startIndex,
          context: readNullableDirective(node, fileDefault),
        });
      }
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child !== null) {
          stack.push(child);
        }
      }
    }
    found.sort((a, b) => a.offset - b.offset);
    this.transitions.push(...found);
  }

  /** The context in force at `offset`. */
  at(offset: number): CsNullableContext {
    let current = this.transitions[0]!.context;
    for (const transition of this.transitions) {
      if (transition.offset > offset) {
        break;
      }
      current = transition.context;
    }
    return current;
  }

  /** How many `#nullable` directives the file carries. */
  get directiveCount(): number {
    return this.transitions.length - 1;
  }
}

function readNullableDirective(
  node: Parser.SyntaxNode,
  fileDefault: CsNullableContext
): CsNullableContext {
  const tokens = allChildren(node)
    .filter((c) => !c.isNamed)
    .map((c) => c.type);
  const setting = tokens[1];
  const target = tokens[2];
  if (setting === 'restore') {
    return fileDefault;
  }
  if (setting === 'disable') {
    // `#nullable disable warnings` leaves ANNOTATIONS in force; only the bare
    // form turns the whole thing off. Collapsing the two would report the
    // annotations as meaningless when the compiler still honours them.
    if (target === 'warnings') {
      return CsNullableContext.ANNOTATIONS;
    }
    if (target === 'annotations') {
      return CsNullableContext.WARNINGS;
    }
    return CsNullableContext.DISABLE;
  }
  if (setting === 'enable') {
    if (target === 'warnings') {
      return CsNullableContext.WARNINGS;
    }
    if (target === 'annotations') {
      return CsNullableContext.ANNOTATIONS;
    }
    return CsNullableContext.ENABLE;
  }
  return fileDefault;
}

/**
 * The branches of one `#if` chain, each with its body and whether it is taken.
 *
 * ## The chain is NESTED in this grammar, not flat
 *
 * `#elif` is a CHILD of the `preproc_if`, and `#else` is a child of the last
 * `#elif`. So a three-branch chain is three levels deep, and a walker that
 * treated `preproc_elif` as a sibling would descend into the `#else` body while
 * believing it was still inside the `#if`. That is the "tree rooted at a
 * non-emitting node" failure from §6 with the sign flipped: not a dropped
 * subtree but a duplicated one, and duplicates DOUBLE.
 *
 * Exactly one branch is active, and possibly none — `#if false` with no `#else`
 * takes nothing, which is how a whole file gets commented out.
 */
export function resolvePreprocBranches(
  ifNode: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>,
  options: { readonly keepDirectives?: boolean } = {}
): { branches: PreprocBranch[]; bodies: Map<number, Parser.SyntaxNode[]> } {
  const branches: PreprocBranch[] = [];
  const bodies = new Map<number, Parser.SyntaxNode[]>();

  let current: Parser.SyntaxNode | undefined = ifNode;
  let index = 0;
  let alreadyTaken = false;
  // Extras — directives and comments — that follow the `#elif` / `#else`
  // child INSIDE the current node. A branch whose body is only directives
  // (`#else` / `#define USE_FALLBACK` / `#endif`) gets an EMPTY `preproc_else`
  // node, and the grammar attaches the directive after it as a sibling under
  // the `#if`. Textually it is after the `#else`, so it belongs to the else
  // branch; read positionally it landed in the `#if` branch, and a top-of-file
  // chain choosing between two `#define`s then defined both.
  //
  // They belong to the LAST branch of the chain, not the NEXT one. An empty
  // `#else` closes its node at the `#else` token, and so does every `#elif`
  // enclosing it, so `#if A … #elif B … #else\n#define Z\n#endif` attaches
  // `#define Z` to the OUTERMOST node — after the `#elif` child. Handing it to
  // the next branch put it in the `#elif` (CS-CORPUS-25's residual: 14 sites
  // where a three-way top-of-file chain defined the else's symbol under the
  // elif and nothing under the else). Deferred to the end of the walk and
  // appended to the last branch's body, in order.
  const trailing: Parser.SyntaxNode[] = [];

  while (current !== undefined) {
    const isElse = current.type === 'preproc_else';
    // The `condition` FIELD, not the first named child: the body's first
    // statement is also a named child, and on an `#else` there is no condition
    // at all — reading position 0 there would evaluate the first statement.
    const condition = isElse ? undefined : (current.childForFieldName('condition') ?? undefined);
    const verdict = isElse
      ? { value: true, evaluated: true }
      : evaluateConditionDetailed(condition, activeSymbols);
    const isActive = !alreadyTaken && verdict.value;
    if (isActive) {
      alreadyTaken = true;
    }

    // The body is every named child that is neither the condition nor the
    // nested continuation. Anonymous `#if`/`#elif`/`#endif` tokens are skipped
    // by taking named children only.
    const body: Parser.SyntaxNode[] = [];
    let next: Parser.SyntaxNode | undefined;
    // Directives are read WITH the children and dropped from the body unless
    // the caller asked to keep them: the file-level symbol walk needs a
    // `#define` written under `#else`; every other consumer of a body is a
    // walk for which a directive is trivia, exactly as for a direct child.
    for (const child of namedChildrenWithDirectives(current)) {
      // `child.id`, never `===`. Two wrappers for one node are different
      // objects, and the identity comparison that assumed otherwise has cost
      // this parser a column already.
      if (condition !== undefined && child.id === condition.id) {
        continue;
      }
      if (child.type === 'preproc_elif' || child.type === 'preproc_else') {
        next = child;
        continue;
      }
      if (next !== undefined) {
        trailing.push(child);
        continue;
      }
      body.push(child);
    }

    branches.push({
      node: current,
      conditionText: condition?.text ?? '',
      conditionSymbols: conditionSymbols(condition),
      isActive,
      branchIndex: index,
      evaluated: verdict.evaluated,
    });
    bodies.set(index, body);

    current = next;
    index += 1;
  }

  // The trailing extras, to the last branch; then trivia out of every body
  // unless the caller reads directives (the file-level symbol walk does).
  if (branches.length > 0) {
    bodies.get(branches.length - 1)!.push(...trailing);
  }
  if (options.keepDirectives !== true) {
    for (const body of bodies.values()) {
      for (let i = body.length - 1; i >= 0; i -= 1) {
        if (TRIVIA_NODE_TYPES.has(body[i]!.type)) {
          body.splice(i, 1);
        }
      }
    }
  }

  return { branches, bodies };
}

/** Node types that introduce a conditional-compilation chain. */
export const PREPROC_CHAIN_ROOT = 'preproc_if';

/**
 * The symbol set a FILE is compiled under: the configuration's symbols, then
 * the file's own `#define` / `#undef` directives applied in order.
 *
 * C# honours `#define` and `#undef` only before the first token of the file
 * (CS1032 otherwise), and only in the branch of a top-of-file `#if` chain that
 * is TAKEN — `#if PLATFORM_A / #define USE_PRIMARY / #else / #define
 * USE_FALLBACK / #endif` defines exactly one of the two, decided by the
 * symbols in force at that point. So the walk is in document order, stops at
 * the first token, and evaluates each chain against the set as amended by the
 * directives above it.
 *
 * Ten files in one stratum carried a file-level `#define` and every region
 * guarded by the symbol was inverted (CS-CORPUS-25): the evaluator read the
 * configuration and never the file. The configuration is the module's KEY;
 * the file's directives are a fact about the file and change nothing in it.
 */
export function fileLevelSymbols(
  root: Parser.SyntaxNode,
  configurationSymbols: ReadonlySet<string>
): Set<string> {
  const symbols = new Set(configurationSymbols);
  const apply = (nodes: readonly Parser.SyntaxNode[]): boolean => {
    for (const node of nodes) {
      if (node.type === 'preproc_define' || node.type === 'preproc_undef') {
        // THE SYMBOL, NOT THE REST OF THE LINE.
        //
        // `preproc_arg` is the raw remainder of the directive, and a trailing
        // comment is part of it:
        //
        //     #define READER_WRITER_LOCK_SLIM   // Platform supports ReaderWriterLockSlim
        //
        // gave the symbol `"READER_WRITER_LOCK_SLIM   // Platform supports …"`,
        // which matches no `#if` anywhere. Seven defines in one 3,800-line file
        // were each recorded under a name nothing could reference, so every
        // `#if` guarding them took the WRONG BRANCH — 114 calls attributed to
        // the else arm and 32 emitted from it, with no parse error and no lost
        // row to show for it.
        //
        // A C# preprocessor symbol is an identifier, so the name is the first
        // whitespace-delimited word and a comment can only follow it.
        const symbol =
          namedChildren(node).find((c) => c.type === 'preproc_arg')?.text.trim().split(/[\s/]/)[0] ?? '';
        if (symbol !== '') {
          if (node.type === 'preproc_define') {
            symbols.add(symbol);
          } else {
            symbols.delete(symbol);
          }
        }
        continue;
      }
      if (node.type === PREPROC_CHAIN_ROOT) {
        const { branches, bodies } = resolvePreprocBranches(node, symbols, { keepDirectives: true });
        const taken = branches.find((branch) => branch.isActive);
        if (taken !== undefined && !apply(bodies.get(taken.branchIndex) ?? [])) {
          return false;
        }
        continue;
      }
      if (!TRIVIA_NODE_TYPES.has(node.type)) {
        // The first token. Anything after it is not a file-level directive.
        return false;
      }
    }
    return true;
  };
  // WITH directives: `namedChildren` filters them as trivia, and here they
  // are the facts being read.
  apply(namedChildrenWithDirectives(root));
  return symbols;
}

/**
 * A declaration's HEADER (fork rule 32): `#if NET\n public sealed partial class
 * X<T> : A, B\n#else\n public sealed partial class X<T> : A\n#endif\n { … }` puts
 * a `preproc_if` before the body whose branches each hold one `class_header`
 * (`method_header`, `constructor_header`); the taken branch's is where the
 * name, modifiers, parameters, type parameters, base list and attributes are
 * read. A declaration with no such child is its own header. The body, the
 * span and the identity stay on the declaration node.
 */
export function headerOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  for (const child of namedChildren(node)) {
    if (child.type !== PREPROC_CHAIN_ROOT) {
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    const taken = branches.find((b) => b.isActive);
    const body = taken === undefined ? [] : (bodies.get(taken.branchIndex) ?? []);
    if (body.length === 1 && HEADER_NODE_TYPES.has(body[0]!.type)) {
      return body[0]!;
    }
    // A chain whose branches hold headers but none is taken: the declaration
    // has no header in this program, and no row — an orphaned body is not a
    // member.
    if (namedChildren(child).some((c) => HEADER_NODE_TYPES.has(c.type))) {
      return undefined;
    }
  }
  return node;
}

const HEADER_NODE_TYPES: ReadonlySet<string> = new Set(['class_header', 'method_header', 'constructor_header']);

/**
 * A method's `returns` node through a `#if` (fork22): `private static async\n
 * #if NET\n ValueTask<T>\n#else\n Task<T>\n#endif\n M()` puts a `preproc_if` in
 * the field; the taken branch's one type is the return type. Any other node
 * is returned as is.
 */
export function throughTakenBranch(
  node: Parser.SyntaxNode | null | undefined,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  if (node === null || node === undefined) {
    return undefined;
  }
  if (node.type !== PREPROC_CHAIN_ROOT) {
    return node;
  }
  const { branches, bodies } = resolvePreprocBranches(node, activeSymbols);
  const taken = branches.find((b) => b.isActive);
  const body = taken === undefined ? [] : (bodies.get(taken.branchIndex) ?? []);
  return body.length === 1 ? body[0] : undefined;
}

/**
 * A declaration's `modifier` children — its own, and those of the taken branch
 * of a `preproc_if` child that holds modifiers (fork rule 31): `#if NET\n
 * public\n#else\n internal\n#endif\n sealed class …`. Fifty-seven corpus sites,
 * fifty-three in the BCL; an untaken branch's modifiers are not in the program.
 */
export function modifiersOf(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(node)) {
    if (child.type === 'modifier') {
      out.push(child);
      continue;
    }
    if (child.type !== PREPROC_CHAIN_ROOT) {
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      for (const body of bodies.get(branch.branchIndex) ?? []) {
        if (body.type === 'modifier') {
          out.push(body);
        }
      }
    }
  }
  return out;
}

/**
 * A node's named children, with every `#if` chain among them REPLACED by the
 * bodies of the branch this emission takes.
 *
 * ## Why this is an accessor and not a rule each walk follows
 *
 * cs-oracle verified the grammar: the THEN branch has no wrapper — its members
 * are direct siblings of the condition inside the `preproc_if` — while each
 * `#elif` and the `#else` nest right-recursively inside it. So BOTH branches are
 * descendants of `preproc_if`, and any walk that simply recurses finds both.
 *
 * Six walks did exactly that after the statement walker was fixed: a lambda
 * and a local function in the untaken branch got method rows, `M` reported
 * `isIterator` from a `yield` that is not in the program, and three scope
 * sets held names from code that does not exist. Each walk would have needed
 * the same eight lines. Giving them an accessor that already knows is what
 * makes the seventh walk right by default.
 */
export function activeNamedChildren(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  return collectActiveNamedChildren(node, activeSymbols);
}

/**
 * The first active named child of a type — through a `#if`, so that
 * `class C\n#if X\n : I\n#endif` finds its base list and `M()\n#if X\n => a;
 * \n#else\n => b;\n#endif` finds the body this emission compiles. The fork's
 * grammar puts each of those under a `preproc_if` child of the declaration;
 * a direct `childOfType` looks past it and reports "no base list", "no body".
 */
export function activeChildOfType(
  node: Parser.SyntaxNode,
  type: string,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode | undefined {
  return collectActiveNamedChildren(node, activeSymbols).find((child) => child.type === type);
}

function collectActiveNamedChildren(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode[] {
  const out: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(node)) {
    if (child.type !== PREPROC_CHAIN_ROOT && child.type !== 'preproc_if_in_attribute_list') {
      out.push(child);
      continue;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      // A branch body can itself hold a nested chain; the caller recurses and
      // meets it through this same accessor.
      out.push(...(bodies.get(branch.branchIndex) ?? []));
    }
  }
  return out;
}

/**
 * Where a DECLARATION's span starts, when a `#if` sits in front of it.
 *
 * A `#if` guarding an attribute list becomes the declaration's first CHILD, so
 * the node's own `startPosition` is the `#if` DIRECTIVE line — which is trivia
 * and belongs to no declaration. Roslyn starts a declaration at its first
 * attribute when one is present and at its first modifier otherwise, and a
 * directive is neither.
 *
 * Two cases, and they differ:
 *
 *   #if MODERN        <- the parser said here
 *   [Obsolete]        <- Roslyn says here: the branch is TAKEN, so the
 *   #endif               attribute is part of the program
 *   public void M()
 *
 *   #if LEGACY        <- the parser said here
 *   [Obsolete]           the branch is NOT taken: the whole region is disabled
 *   #endif               text, and the declaration starts at its modifier
 *   public void M()   <- Roslyn says here
 *
 * Returns the node whose position the declaration should use. Falls back to the
 * declaration itself, so a caller can use it unconditionally.
 */
export function declarationSpanStartNode(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Parser.SyntaxNode {
  for (const child of namedChildren(node)) {
    if (child.type !== PREPROC_CHAIN_ROOT && child.type !== 'preproc_if_in_attribute_list') {
      // The first thing that is not a directive — an attribute list, a
      // modifier, the keyword. This is the start.
      return child;
    }
    const { branches, bodies } = resolvePreprocBranches(child, activeSymbols);
    for (const branch of branches) {
      if (!branch.isActive) {
        continue;
      }
      const body = bodies.get(branch.branchIndex) ?? [];
      if (body.length > 0) {
        return body[0]!;
      }
    }
    // No branch taken: the region is disabled text. Keep looking at the
    // siblings after it.
  }
  return node;
}
