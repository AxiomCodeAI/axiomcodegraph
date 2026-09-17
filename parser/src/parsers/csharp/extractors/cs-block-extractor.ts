import Parser from 'tree-sitter';

import { CsBlockRegistry } from '@/analysis-types/csharp/CsBlockRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsVariableRegistry } from '@/analysis-types/csharp/CsVariableRegistry';
import { CsBlockKind } from '@/enums/csharp/blocks';
import { CsReferenceOwnerKind, CsTypeRefContext } from '@/enums/csharp/type-references';
import {
  CsRefKind,
  CsVariableDeclarationKind,
  CsVariableScopeKind,
} from '@/enums/csharp/variables';
import {
  childOfType,
  childrenOfType,
  endLine,
  hasAnonymousToken,
  namedChildren,
  nodeId,
  startColumn,
  startLine,
} from '@/parsers/csharp/extractors/cs-node';
import { extractTypeReferences } from '@/parsers/csharp/extractors/cs-type-reference-extractor';
import {
  PREPROC_CHAIN_ROOT,
  resolvePreprocBranches,
} from '@/parsers/csharp/extractors/preproc-context';
import { baseTypeName, hasNullableAnnotation, normalizeCSharpIdentifier } from '@/utils/csharp';

/**
 * `cs_block` and `cs_variable` — where a local lives, and what declares it.
 *
 * The two are one walk because a local's scope IS a block. Splitting them means
 * walking the same tree twice and letting the two walks drift, which is exactly
 * how the statement walker's node names drifted from the grammar and took every
 * `foreach` body's calls with them.
 *
 * ## Five of the nine declaration kinds bind in an EXPRESSION
 *
 * `out var n`, `x is Foo f`, `var (a, b) = t`, `is var (a, b)` and `from x in
 * xs` have no `local_declaration_statement` anywhere. A walker reading only
 * statements finds no declaration, and the engine then sees the name used with
 * nothing declaring it. `int.TryParse(s, out var n)` is in every C# codebase
 * written, so this is the common path and not an edge case.
 *
 * ## The descent is TOTAL, for the reason the statement walker's is
 *
 * Naming the containers I know about is how `foreach_statement` got missed: the
 * table said `for_each_statement`, matched nothing, and the loss was invisible
 * because the enclosing method's other statements were all still there. So this
 * walks everything and decides what to EMIT from an explicit map, rather than
 * deciding what to VISIT from one.
 *
 * ## The grammar's FIELDS, not child positions
 *
 * `catch_declaration`, `declaration_expression`, `declaration_pattern`,
 * `from_clause` and `foreach_statement` all expose `name` and `type` as fields.
 * Reading them positionally is what put a parameter's own type into
 * `defaultValueText` once already, because `childForFieldName` and
 * `namedChildren` hand back different wrapper objects for one node.
 */

export interface CsBlockExtractionOptions {
  /** A `block` or an `arrow_expression_clause`. */
  readonly body: Parser.SyntaxNode;
  /** What the body itself is — a method, a constructor, an accessor, a lambda. */
  readonly rootBlockKind: CsBlockKind;
  readonly rootScopeKind: CsVariableScopeKind;
  readonly csModuleLinkHash: string;
  readonly csTypeLinkHash: string;
  readonly csMethodLinkHash: string;
  readonly serviceVersionLinkHash: string;
  /**
   * The symbols this emission compiles under.
   *
   * This walk did not resolve `#if` at all: it descended into EVERY branch, so
   * a local declared in the taken branch and one declared in the branch that
   * was not took both got rows. Two bindings of the same name, one of which is
   * not in the program — and shadowing is exactly what this relation exists to
   * answer, so the answer was wrong wherever a `#if` sat in a body.
   */
  readonly activeSymbols: ReadonlySet<string>;
  readonly typeParametersInScope?: ReadonlyMap<string, string>;
  /**
   * Expression-root hashes by `node.id`, filled by the expression pass.
   *
   * Absent when the caller has not run one, and every link column then stays
   * empty rather than pointing at a row that does not exist.
   */
  readonly rootHashByNodeId?: ReadonlyMap<number, string>;
}

export interface CsBlockExtractionResult {
  readonly blocks: CsBlockRegistry[];
  readonly variables: CsVariableRegistry[];
  readonly typeReferences: CsTypeReferenceRegistry[];
}

/**
 * The block a statement introduces.
 *
 * `checked_statement` is absent on purpose: one node type spells both `checked`
 * and `unchecked`, so the keyword decides and a map cannot.
 */
const BLOCK_KIND_BY_STATEMENT: ReadonlyMap<string, CsBlockKind> = new Map([
  ['if_statement', CsBlockKind.IF],
  ['for_statement', CsBlockKind.FOR],
  // `foreach_statement`. The underscore matters — see the class comment.
  ['foreach_statement', CsBlockKind.FOREACH],
  ['while_statement', CsBlockKind.WHILE],
  ['do_statement', CsBlockKind.DO],
  ['try_statement', CsBlockKind.TRY],
  ['catch_clause', CsBlockKind.CATCH],
  ['finally_clause', CsBlockKind.FINALLY],
  ['using_statement', CsBlockKind.USING],
  ['lock_statement', CsBlockKind.LOCK],
  ['fixed_statement', CsBlockKind.FIXED],
  ['unsafe_statement', CsBlockKind.UNSAFE],
  ['switch_section', CsBlockKind.SWITCH_SECTION],
  ['labeled_statement', CsBlockKind.LABELED],
]);

/** Statements that own a block and therefore absorb its row. */
const ABSORBS_ITS_BLOCK = new Set([
  ...BLOCK_KIND_BY_STATEMENT.keys(),
  'checked_statement',
  'switch_statement',
]);

interface WalkState {
  readonly depth: number;
  readonly blockHash: string;
  readonly scopeKind: CsVariableScopeKind;
  /** The nearest enclosing `try`, so a catch can name what it guards. */
  readonly tryHash: string;
}

export function extractBlocksAndVariables(
  options: CsBlockExtractionOptions
): CsBlockExtractionResult {
  const result: CsBlockExtractionResult = { blocks: [], variables: [], typeReferences: [] };
  // A WALK ORDINAL scoped to the owning method, not a source position. `if (a)
  // { } else { }` puts two blocks on one line, and the ordinal is what keeps
  // their keys apart without depending on formatting.
  let order = 0;
  let switchSectionIndex = 0;

  const visit = (node: Parser.SyntaxNode, state: WalkState): void => {
    // A `#if` in a body selects STATEMENTS, and a statement in a branch this
    // emission does not take is not in the program — so neither are the locals
    // it declares nor the blocks it opens.
    if (node.type === PREPROC_CHAIN_ROOT) {
      const { branches, bodies } = resolvePreprocBranches(node, options.activeSymbols);
      for (const branch of branches) {
        if (!branch.isActive) {
          continue;
        }
        for (const child of bodies.get(branch.branchIndex) ?? []) {
          visit(child, state);
        }
      }
      return;
    }

    // A FUNCTION BOUNDARY. Its blocks and locals belong to its own method row,
    // and descending would put a callback's locals in the scope of whoever
    // created it. Each is walked by its own `extractBlocksAndVariables` call.
    if (isFunctionBoundary(node)) {
      return;
    }

    let next = state;
    const kind = blockKindFor(node, state.depth, options);
    if (kind !== undefined) {
      const block = new CsBlockRegistry({
        blockKind: kind,
        order,
        nestingDepth: state.depth,
        csTypeLinkHash: options.csTypeLinkHash,
        csMethodLinkHash: options.csMethodLinkHash,
        csModuleLinkHash: options.csModuleLinkHash,
        methodOwnerHash: options.csMethodLinkHash,
        parentContainerHash: state.blockHash,
        catchTypeNames: catchTypeNamesOf(node),
        resourceCount: resourceCountOf(node),
        switchSectionIndex: node.type === 'switch_section' ? switchSectionIndex : 0,
        // `outer: for (…)`. TypeScript emitted the loop and DROPPED the label,
        // and the enum audit is what found it — the value was declared and
        // never emitted, so `goto outer` had no target to name.
        labelName:
          node.type === 'labeled_statement'
            ? normalizeCSharpIdentifier(childOfType(node, 'identifier')?.text ?? '')
            : '',
        isUnsafe: node.type === 'unsafe_statement',
        isChecked: node.type === 'checked_statement' && hasAnonymousToken(node, 'checked'),
        startLine: startLine(node),
        endLine: endLine(node),
        startColumn: startColumn(node),
        endColumn: node.endPosition.column,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      });
      const condition = conditionOf(node);
      if (condition !== undefined) {
        const hash = options.rootHashByNodeId?.get(nodeId(condition));
        if (hash !== undefined) {
          block.setConditionExpressionLinkHash(hash);
        }
      }
      if (kind === CsBlockKind.CATCH || kind === CsBlockKind.FINALLY) {
        block.setTryStatementHash(state.tryHash);
      }
      result.blocks.push(block);
      order += 1;
      if (node.type === 'switch_section') {
        switchSectionIndex += 1;
      }
      next = {
        depth: state.depth + 1,
        blockHash: block.getHash(),
        // The OUTERMOST block keeps the scope the caller named. A method body
        // is a `block` like any other, and letting the generic rule fire would
        // relabel every top-level local `BLOCK` — losing the distinction
        // between a method's own locals and a nested scope's, which is the one
        // thing `scopeKind` exists to record.
        scopeKind:
          state.depth === 0 ? state.scopeKind : (scopeKindFor(node) ?? state.scopeKind),
        tryHash: kind === CsBlockKind.TRY ? block.getHash() : state.tryHash,
      };
    }

    collectDeclarations(node, next, options, result);

    for (const child of namedChildren(node)) {
      visit(child, next);
    }
  };

  visit(options.body, {
    depth: 0,
    blockHash: '',
    scopeKind: options.rootScopeKind,
    tryHash: '',
  });
  return result;
}

function isFunctionBoundary(node: Parser.SyntaxNode): boolean {
  return (
    node.type === 'lambda_expression' ||
    node.type === 'anonymous_method_expression' ||
    node.type === 'local_function_statement'
  );
}

/**
 * The block a node introduces, or nothing.
 *
 * A bare `block` is worth a row only when it is not already the body of
 * something that got one — otherwise `if (a) { }` produces an IF and an
 * ANONYMOUS over the same braces, and the second says nothing the first did
 * not. The one exception is an `if`'s ALTERNATIVE, which is a different scope
 * from its consequence and the only way `ELSE` is ever emitted. The grammar has
 * no `else_clause`; `if` binds both branches as fields — except under fork
 * rule 16, where an `else` the preceding `if` could not take because a `#if`
 * stood between them is an `else_fragment` statement of its own, and ITS
 * `alternative` is an ELSE block too: `if (a) {…}\n#if X\n else {…}\n#endif`
 * has the same two scopes as the unguarded form.
 */
function blockKindFor(
  node: Parser.SyntaxNode,
  depth: number,
  options: CsBlockExtractionOptions
): CsBlockKind | undefined {
  if (depth === 0) {
    // An expression body is not a block and gets no row. Its locals — an
    // `out var` in an arrow-bodied member — carry an empty scope link rather
    // than one pointing at a block that does not exist.
    return node.type === 'block' ? options.rootBlockKind : undefined;
  }
  if (node.type === 'checked_statement') {
    return hasAnonymousToken(node, 'checked') ? CsBlockKind.CHECKED : CsBlockKind.UNCHECKED;
  }
  if (node.type === 'switch_section' && isSectionOutsideTheProgram(node, options.activeSymbols)) {
    // Fork rule 21's label form: `case A:\n#if X\n case B:\n#endif\n stmts` is
    // a section whose only label is under a `#if`. When the branch is not
    // taken and no statement follows, the section is not in the program —
    // a block row for it would be a scope Roslyn does not have.
    return undefined;
  }
  const named = BLOCK_KIND_BY_STATEMENT.get(node.type);
  if (named !== undefined) {
    return named;
  }
  if (node.type !== 'block') {
    return undefined;
  }
  const parent = node.parent;
  if (parent === null) {
    return CsBlockKind.ANONYMOUS;
  }
  if (parent.type === 'if_statement' || parent.type === 'else_fragment') {
    const alternative = parent.childForFieldName('alternative');
    // `node.id`, never `===`. Two wrappers for one node are not the same
    // object, and the identity comparison that assumed they were is a defect
    // this parser has already paid for once.
    return alternative !== null && alternative.id === node.id
      ? CsBlockKind.ELSE
      : undefined;
  }
  if (ABSORBS_ITS_BLOCK.has(parent.type)) {
    return undefined;
  }
  return CsBlockKind.ANONYMOUS;
}

/** A stacked label under an untaken `#if`, with nothing after the `#endif`. */
function isSectionOutsideTheProgram(
  node: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): boolean {
  const children = namedChildren(node);
  const first = children[0];
  if (first === undefined || first.type !== PREPROC_CHAIN_ROOT || children.length !== 1) {
    return false;
  }
  const { branches, bodies } = resolvePreprocBranches(first, activeSymbols);
  return branches.every((b) => !b.isActive || (bodies.get(b.branchIndex) ?? []).length === 0);
}

function scopeKindFor(node: Parser.SyntaxNode): CsVariableScopeKind | undefined {
  switch (node.type) {
    case 'catch_clause':
      return CsVariableScopeKind.CATCH_CLAUSE;
    case 'using_statement':
      return CsVariableScopeKind.USING_STATEMENT;
    case 'switch_section':
      return CsVariableScopeKind.SWITCH_SECTION;
    case 'for_statement':
    case 'foreach_statement':
    case 'while_statement':
      return CsVariableScopeKind.LOOP_HEADER;
    case 'block':
      return CsVariableScopeKind.BLOCK;
    default:
      return undefined;
  }
}

/** The expression a block tests, when it tests one. */
function conditionOf(node: Parser.SyntaxNode): Parser.SyntaxNode | undefined {
  switch (node.type) {
    case 'if_statement':
    case 'while_statement':
    case 'do_statement':
      return node.childForFieldName('condition') ?? undefined;
    case 'foreach_statement':
      return node.childForFieldName('right') ?? undefined;
    case 'lock_statement':
      // No field on this node in the grammar. The subject is the child that is
      // an expression rather than the body statement — chosen by KIND, not by
      // position, so a comment or a grammar reordering cannot move it.
      return namedChildren(node).find((child) => !child.type.endsWith('_statement') && child.type !== 'block');
    default:
      return undefined;
  }
}

/**
 * What a `catch` stops.
 *
 * `catch { }` catches everything and names nothing; an empty list is the honest
 * answer, and a placeholder would be a name nothing resolves.
 */
function catchTypeNamesOf(node: Parser.SyntaxNode): string[] {
  if (node.type !== 'catch_clause') {
    return [];
  }
  const declaration = childOfType(node, 'catch_declaration');
  const typeNode = declaration?.childForFieldName('type');
  return typeNode === null || typeNode === undefined ? [] : [typeNode.text];
}

function resourceCountOf(node: Parser.SyntaxNode): number {
  if (node.type !== 'using_statement' && node.type !== 'fixed_statement') {
    return 0;
  }
  const declaration = childOfType(node, 'variable_declaration');
  if (declaration === undefined) {
    // `using (expr)` — one resource, no declaration.
    return 1;
  }
  return childrenOfType(declaration, 'variable_declarator').length;
}

/** Everything a node declares, in all of the shapes C# has. */
function collectDeclarations(
  node: Parser.SyntaxNode,
  state: WalkState,
  options: CsBlockExtractionOptions,
  result: CsBlockExtractionResult
): void {
  switch (node.type) {
    case 'variable_declaration': {
      emitDeclaration(node, state, options, result);
      break;
    }
    case 'foreach_statement': {
      const left = node.childForFieldName('left');
      // `foreach (var (a, b) in pairs)` binds through a tuple pattern, which
      // has its own case. Reading `left.text` there would name the local
      // "(a, b)".
      if (left !== null && left.type === 'identifier') {
        push(
          {
            nameNode: left,
            typeNode: node.childForFieldName('type'),
            declarationKind: CsVariableDeclarationKind.FOREACH,
            scope: CsVariableScopeKind.LOOP_HEADER,
            initializerNode: node.childForFieldName('right'),
            declarationIndex: 0,
            deconstructionIndex: 0,
            isConst: false,
            anchor: left,
          },
          state,
          options,
          result
        );
      }
      break;
    }
    case 'catch_declaration': {
      push(
        {
          nameNode: node.childForFieldName('name'),
          typeNode: node.childForFieldName('type'),
          declarationKind: CsVariableDeclarationKind.CATCH,
          scope: CsVariableScopeKind.CATCH_CLAUSE,
          initializerNode: undefined,
          declarationIndex: 0,
          deconstructionIndex: 0,
          isConst: false,
          anchor: node,
        },
        state,
        options,
        result
      );
      break;
    }
    case 'declaration_expression': {
      // `out var n`, `out int n`. The binding site is an ARGUMENT LIST, and an
      // engine modelling only return values loses this dataflow entirely.
      //
      // `out var _` and `out int _` bind NOTHING. Measured against Roslyn, out
      // of process: `GetDeclaredSymbol` on the designation returns null and the
      // node is a `DiscardDesignation`, while `var _ = M()` in a DECLARATOR
      // returns an `ILocalSymbol` and later `_` references resolve to it. So
      // the rule is position-specific, and it is the position — not the
      // spelling — that decides.
      //
      // The grammar cannot help here: it hands back a plain `identifier` named
      // `_` in both places, so the node type distinguishes nothing and the
      // ORACLE is what settles it.
      const outName = node.childForFieldName('name');
      if (outName !== null && normalizeCSharpIdentifier(outName.text) === '_') {
        break;
      }
      // THE SAME NODE, TWO DECLARATION KINDS. `(var f, var g) = t` and
      // `foreach ((var k, var v) in xs)` write their bindings as
      // declaration_expressions inside a TUPLE, not inside an argument list —
      // and those are DECONSTRUCTIONS, each with its position in the flattened
      // tuple, exactly as `var (f, g) = t` is. Reading every
      // declaration_expression as `out var` filed them as OUT_VAR with index
      // 0: a correctly-positioned row with the wrong kind.
      const tupleIndex = deconstructionIndexInTuple(node);
      push(
        {
          nameNode: outName,
          typeNode: node.childForFieldName('type'),
          declarationKind:
            tupleIndex === undefined
              ? CsVariableDeclarationKind.OUT_VAR
              : CsVariableDeclarationKind.DECONSTRUCTION,
          // It leaks into the ENCLOSING scope, not a nested one — which is why
          // it is usable on the line after the call.
          scope: CsVariableScopeKind.EXPRESSION,
          initializerNode: undefined,
          declarationIndex: 0,
          deconstructionIndex: tupleIndex ?? 0,
          isConst: false,
          anchor: node,
        },
        state,
        options,
        result
      );
      break;
    }
    case 'declaration_pattern':
    case 'recursive_pattern':
    case 'var_pattern': {
      // `x is Foo f`, `case Foo f:`, `x is Foo { A: 1 } f`, `x is var v`. The
      // `name` field is OPTIONAL — `x is Foo` and `x is Foo _` bind nothing,
      // and the designation may instead be a parenthesized one, which has its
      // own case.
      push(
        {
          nameNode: node.childForFieldName('name'),
          typeNode: node.childForFieldName('type'),
          declarationKind: CsVariableDeclarationKind.PATTERN,
          scope: CsVariableScopeKind.EXPRESSION,
          initializerNode: undefined,
          declarationIndex: 0,
          deconstructionIndex: 0,
          isConst: false,
          anchor: node,
        },
        state,
        options,
        result
      );
      break;
    }
    case 'tuple_pattern':
    case 'parenthesized_variable_designation': {
      emitDeconstruction(node, state, options, result);
      break;
    }
    case 'from_clause': {
      pushRangeVariable(node.childForFieldName('name'), node, state, options, result);
      break;
    }
    case 'query_expression': {
      // `group x by y INTO h` / `select … INTO h` — the continuation's name is
      // a bare identifier child of the QUERY, not of any clause, and it is a
      // range variable over the query so far. It had no row, so `h.Key` in
      // the select after it named a binding that did not exist.
      for (const child of namedChildren(node)) {
        if (child.type === 'identifier') {
          pushRangeVariable(child, node, state, options, result);
        }
      }
      break;
    }
    case 'let_clause':
    case 'join_clause':
    case 'join_into_clause': {
      // `let y = …`, `join x in …`, `into g`. None expose the range variable as
      // a field, and in a `join` the FIRST identifier child is it — the `on a
      // equals b` operands come after and are expressions.
      pushRangeVariable(childOfType(node, 'identifier'), node, state, options, result);
      break;
    }
    default:
      break;
  }
}

/**
 * A `variable_declaration`, whose PARENT says what kind of local it declares.
 *
 * `using (var f = …)` and `fixed (byte* p = …)` hold one of these directly, with
 * no `local_declaration_statement` above it. Keying on the statement would have
 * dropped every resource and every pinned pointer in the corpus.
 */
function emitDeclaration(
  node: Parser.SyntaxNode,
  state: WalkState,
  options: CsBlockExtractionOptions,
  result: CsBlockExtractionResult
): void {
  const parent = node.parent;
  const statement =
    parent !== null && parent.type === 'local_declaration_statement' ? parent : undefined;
  const modifiers =
    statement === undefined
      ? []
      : childrenOfType(statement, 'modifier').map((m) => m.text.trim());

  let declarationKind = CsVariableDeclarationKind.LOCAL;
  let scope = state.scopeKind;
  if (parent !== null && parent.type === 'fixed_statement') {
    declarationKind = CsVariableDeclarationKind.FIXED;
  } else if (parent !== null && parent.type === 'using_statement') {
    declarationKind = CsVariableDeclarationKind.USING;
    scope = CsVariableScopeKind.USING_STATEMENT;
  } else if (statement !== undefined && hasAnonymousToken(statement, 'using')) {
    // `using var f = File.Open(…);` — the declaration form, disposed at the end
    // of the ENCLOSING block rather than a nested one.
    declarationKind = CsVariableDeclarationKind.USING;
  } else if (parent !== null && parent.type === 'for_statement') {
    scope = CsVariableScopeKind.LOOP_HEADER;
  }

  const declaredType = node.childForFieldName('type');
  let index = 0;
  for (const declarator of childrenOfType(node, 'variable_declarator')) {
    const nameNode = declarator.childForFieldName('name');
    // The initializer is a DIRECT CHILD of the declarator, not wrapped in an
    // `equals_value_clause` — that form is used for parameter defaults, and
    // looking for the wrapper dropped every local initializer once already.
    const initializerNode = namedChildren(declarator).find(
      (child) =>
        (nameNode === null || child.id !== nameNode.id) &&
        child.type !== 'bracketed_argument_list' &&
        child.type !== 'tuple_pattern'
    );
    push(
      {
        nameNode,
        typeNode: declaredType,
        declarationKind,
        scope,
        initializerNode,
        declarationIndex: index,
        deconstructionIndex: 0,
        isConst: modifiers.includes('const'),
        isScopedModifier: modifiers.includes('scoped'),
        anchor: declarator,
      },
      state,
      options,
      result
    );
    index += 1;
  }
}

/**
 * `var (a, b) = t` and `is var (a, b)` — ONE node, N bindings.
 *
 * The nesting is flattened here rather than reached by the walk, so
 * `var ((a, b), c)` numbers its three bindings 0, 1, 2 in source order. Letting
 * the outer walk reach the inner pattern would restart the index at zero, and
 * `deconstructionIndex` is the only key component that separates these.
 */
function emitDeconstruction(
  node: Parser.SyntaxNode,
  state: WalkState,
  options: CsBlockExtractionOptions,
  result: CsBlockExtractionResult
): void {
  const parent = node.parent;
  if (parent !== null && parent.type === node.type) {
    // Reached from its own outer pattern, which already flattened it. Emitting
    // again would DOUBLE every binding it holds.
    return;
  }

  let index = 0;
  const flatten = (current: Parser.SyntaxNode): void => {
    for (const element of namedChildren(current)) {
      if (element.type === current.type) {
        flatten(element);
        continue;
      }
      if (element.type !== 'identifier') {
        // A `discard` binds nothing and takes no index — `var (a, _, b)` has
        // two locals.
        continue;
      }
      push(
        {
          nameNode: element,
          typeNode: undefined,
          declarationKind: CsVariableDeclarationKind.DECONSTRUCTION,
          scope: state.scopeKind,
          initializerNode: undefined,
          declarationIndex: 0,
          deconstructionIndex: index,
          isConst: false,
          anchor: element,
        },
        state,
        options,
        result
      );
      index += 1;
    }
  };
  flatten(node);
}

function pushRangeVariable(
  nameNode: Parser.SyntaxNode | null | undefined,
  clause: Parser.SyntaxNode,
  state: WalkState,
  options: CsBlockExtractionOptions,
  result: CsBlockExtractionResult
): void {
  push(
    {
      nameNode,
      typeNode: clause.childForFieldName('type'),
      declarationKind: CsVariableDeclarationKind.QUERY_RANGE,
      scope: CsVariableScopeKind.QUERY,
      initializerNode: undefined,
      declarationIndex: 0,
      deconstructionIndex: 0,
      isConst: false,
      anchor: nameNode ?? clause,
    },
    state,
    options,
    result
  );
}

interface PendingVariable {
  readonly nameNode: Parser.SyntaxNode | null | undefined;
  readonly typeNode: Parser.SyntaxNode | null | undefined;
  readonly declarationKind: CsVariableDeclarationKind;
  readonly scope: CsVariableScopeKind;
  readonly initializerNode: Parser.SyntaxNode | null | undefined;
  readonly declarationIndex: number;
  readonly deconstructionIndex: number;
  readonly isConst: boolean;
  /**
   * `scoped` written as a bare MODIFIER rather than a `scoped_type` wrapper.
   *
   * The keyword has two tree shapes, and reading only the wrapper loses the
   * lifetime constraint on every declaration that spells it the other way.
   */
  readonly isScopedModifier?: boolean;
  readonly anchor: Parser.SyntaxNode;
}

function push(
  input: PendingVariable,
  state: WalkState,
  options: CsBlockExtractionOptions,
  result: CsBlockExtractionResult
): void {
  if (input.nameNode === null || input.nameNode === undefined) {
    return;
  }
  // `ref` and `scoped` are STRUCTURE, and they go in columns rather than into
  // the type name: `scoped ref readonly Span<int>` names the type `Span<int>`,
  // and folding the modifiers into the spelling would make it join against
  // nothing.
  const declared = unwrapDeclaredType(input.typeNode);
  // `var` IS NOT A TYPE NAME. Writing it into the type columns puts a
  // pseudo-type into every join keyed on a type name — 96.7% of linq-heavy-A's locals
  // are `var`, so that is not a corner. What the local's type turns out to be
  // is whatever the initialiser produces, which is a resolution outcome and the
  // engine's; `isImplicitlyTyped` says the parser does not know, and the name
  // stays absent rather than being guessed.
  const isImplicit = declared.typeNode === undefined || declared.typeNode.type === 'implicit_type';
  const completeTypeName = isImplicit ? '' : declared.typeNode!.text;

  const variable = new CsVariableRegistry({
    name: normalizeCSharpIdentifier(input.nameNode.text),
    variableTypeName: baseTypeName(completeTypeName),
    completeTypeName,
    potentialQualifiedName: completeTypeName.includes('.') ? baseTypeName(completeTypeName) : '',
    // A documented parity slot, always false. Deciding a bare name is ambiguous
    // needs to know what the using scope holds, and that is resolution.
    isAmbiguous: false,
    isImplicitlyTyped: isImplicit,
    isNullableAnnotated: hasNullableAnnotation(completeTypeName),
    declarationKind: input.declarationKind,
    scopeKind: input.scope,
    scopeDepth: state.depth,
    isConst: input.isConst,
    refKind: declared.refKind,
    isScoped: declared.isScoped || input.isScopedModifier === true,
    csTypeLinkHash: options.csTypeLinkHash,
    csMethodLinkHash: options.csMethodLinkHash,
    csModuleLinkHash: options.csModuleLinkHash,
    hasInitializer: input.initializerNode !== null && input.initializerNode !== undefined,
    deconstructionIndex: input.deconstructionIndex,
    declarationIndex: input.declarationIndex,
    startLine: startLine(input.anchor),
    endLine: endLine(input.anchor),
    startColumn: startColumn(input.anchor),
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  });
  variable.setBlockLinkHash(state.blockHash);

  if (input.initializerNode !== null && input.initializerNode !== undefined) {
    const hash = options.rootHashByNodeId?.get(nodeId(input.initializerNode));
    if (hash !== undefined) {
      variable.setInitializerExpressionLinkHash(hash);
    }
  }

  // The declared type is a REFERENCE, and a reified one: `List<int>` and
  // `List<string>` are distinct runtime types, so the whole tree is kept rather
  // than the erasure.
  if (!isImplicit) {
    const references = extractTypeReferences({
      typeNode: declared.typeNode!,
      ownerLinkHash: variable.getHash(),
      referenceOwnerKind: CsReferenceOwnerKind.VARIABLE,
      context: CsTypeRefContext.LOCAL_VARIABLE,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
      typeParametersInScope: options.typeParametersInScope,
    });
    const root = references[0];
    if (root !== undefined) {
      variable.setTypeReferenceLinkHash(root.getHash());
    }
    result.typeReferences.push(...references);
  }

  result.variables.push(variable);
}

interface DeclaredType {
  readonly typeNode: Parser.SyntaxNode | undefined;
  readonly refKind: CsRefKind;
  readonly isScoped: boolean;
}

/**
 * Peels `scoped` and `ref` off a declared type.
 *
 * `ref var x = ref y` makes `x` an ALIAS — `x = 5` writes through to `y`, and an
 * engine treating it as a copy loses the write. `scoped` has TWO tree shapes, a
 * `scoped_type` wrapper and a bare `modifier`, which is why both are read.
 */
function unwrapDeclaredType(node: Parser.SyntaxNode | null | undefined): DeclaredType {
  let current = node ?? undefined;
  let refKind = CsRefKind.NONE;
  let isScoped = false;
  for (let guard = 0; guard < 4 && current !== undefined; guard += 1) {
    if (current.type === 'scoped_type') {
      isScoped = true;
      current = current.childForFieldName('type') ?? undefined;
      continue;
    }
    if (current.type === 'ref_type') {
      refKind = hasAnonymousToken(current, 'readonly') ? CsRefKind.REF_READONLY : CsRefKind.REF;
      current = current.childForFieldName('type') ?? undefined;
      continue;
    }
    break;
  }
  return { typeNode: current, refKind, isScoped };
}

/**
 * The position of a `declaration_expression` in the FLATTENED tuple it sits
 * in, or `undefined` when it is not in a tuple at all (an `out var` argument).
 *
 * `((var a, var b), var c) = t` binds a=0, b=1, c=2: the tuple is climbed to
 * its outermost `tuple_expression` — through `argument` wrappers, which is how
 * the grammar nests tuple elements — and walked in order counting every
 * binding before this one. A discard (`_`) takes no index, as in
 * {@link emitDeconstruction}.
 */
function deconstructionIndexInTuple(node: Parser.SyntaxNode): number | undefined {
  let outermost: Parser.SyntaxNode | undefined;
  let current: Parser.SyntaxNode | null = node.parent;
  while (current !== null && current.type === 'argument') {
    const tuple: Parser.SyntaxNode | null = current.parent;
    if (tuple === null || tuple.type !== 'tuple_expression') {
      break;
    }
    outermost = tuple;
    current = tuple.parent;
  }
  if (outermost === undefined) {
    return undefined;
  }
  let index = 0;
  let found: number | undefined;
  const walk = (tuple: Parser.SyntaxNode): void => {
    for (const argument of namedChildren(tuple)) {
      // The VALUE of an `argument` has no field in this grammar; the only other
      // named child an argument can have is its `name` label, which is skipped.
      const label: Parser.SyntaxNode | null = argument.type === 'argument' ? argument.childForFieldName('name') : null;
      const element =
        argument.type === 'argument'
          ? namedChildren(argument).find((child) => label === null || child.id !== label.id)
          : argument;
      if (element === undefined || found !== undefined) {
        continue;
      }
      if (element.type === 'tuple_expression') {
        walk(element);
        continue;
      }
      if (element.type === 'declaration_expression') {
        if (element.id === node.id) {
          found = index;
          return;
        }
        const name = element.childForFieldName('name');
        if (name === null || normalizeCSharpIdentifier(name.text) === '_') {
          continue;
        }
        index += 1;
      }
    }
  };
  walk(outermost);
  return found;
}
