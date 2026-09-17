import Parser from 'tree-sitter';

import { CsTypeParameterRegistry } from '@/analysis-types/csharp/CsTypeParameterRegistry';
import { CsTypeReferenceRegistry } from '@/analysis-types/csharp/CsTypeReferenceRegistry';
import { CsDeclarationOwnerKind } from '@/enums/csharp/owners';
import {
  CsTypeParameterOwnerKind,
  CsVarianceModifier,
} from '@/enums/csharp/type-parameters';
import {
  CsReferenceOwnerKind,
  CsTypeRefContext,
} from '@/enums/csharp/type-references';
import {
  DeclarationOwner,
  addDeclarationOwner,
} from '@/parsers/csharp/extractors/cs-attribute-extractor';
import { extractTypeReferences } from
  '@/parsers/csharp/extractors/cs-type-reference-extractor';
import { normalizeCSharpIdentifier } from '@/utils/csharp';
import { PREPROC_CHAIN_ROOT, resolvePreprocBranches } from '@/parsers/csharp/extractors/preproc-context';
import {
  allChildren,
  childOfType,
  childrenOfType,
  namedChildren,
  nodeId,
} from '@/parsers/csharp/extractors/cs-node';

/**
 * `cs_type_parameter` — generic parameters and their `where` constraints.
 *
 * Used by both `cs_type` and `cs_method`, with the owner's kind in a column.
 *
 * ## Variance is on the token, not on the `modifier` node
 *
 * `in`/`out` inside a `type_parameter` are ANONYMOUS tokens, the same trap as
 * `ref struct` and `record struct`. A scan of `modifier` children finds nothing
 * and every interface in the corpus reads as invariant — which silently reverses
 * what an engine believes about assignability.
 *
 * ## Constraints are matched to parameters BY NAME
 *
 * `where` clauses are siblings of the parameter list, not children of the
 * parameter, and they may appear in any order or not at all. Matching them
 * positionally would attach `where T : class` to whichever parameter happened to
 * be second. The clause names its parameter and that name is the join.
 */
export interface CsTypeParameterExtractionOptions {
  readonly declarationNode: Parser.SyntaxNode;
  /**
   * The symbols this emission compiles under. A `where` clause may sit under a
   * `#if` between the signature and the body (fork20): `where T : allows ref
   * struct` is C# 13 and guarded at every BCL site. Only the taken branch's
   * clauses constrain the parameter.
   */
  readonly activeSymbols: ReadonlySet<string>;
  readonly ownerLinkHash: string;
  readonly ownerKind: CsTypeParameterOwnerKind;
  readonly serviceVersionLinkHash: string;
  /**
   * Collects the TYPE constraints as references — `where T : IFoo` names IFoo,
   * and a rule asking "which interfaces constrain this parameter" needs the
   * name, not a count. Optional so the two call sites that do not want them
   * need not thread an array through.
   */
  readonly typeReferenceSink?: CsTypeReferenceRegistry[];
  /**
   * `node.id` → this row, so the attribute pass can attach `[My] T` without
   * being threaded through every caller. Optional for the same reason
   * `typeReferenceSink` is.
   */
  readonly declarationOwnerSink?: Map<number, DeclarationOwner[]>;
}

/** Constraint keywords that are not types and are not counted as such. */
const NON_TYPE_CONSTRAINTS = new Set(['class', 'struct', 'notnull', 'unmanaged', 'default']);

export function extractTypeParameters(
  options: CsTypeParameterExtractionOptions
): CsTypeParameterRegistry[] {
  const list = childOfType(options.declarationNode, 'type_parameter_list');
  if (list === undefined) {
    return [];
  }

  const constraints = readConstraintClauses(options.declarationNode, options.activeSymbols);
  const rows: CsTypeParameterRegistry[] = [];
  let position = 0;

  for (const parameter of namedChildren(list)) {
    if (parameter.type !== 'type_parameter') {
      continue;
    }
    const name = normalizeCSharpIdentifier(childOfType(parameter, 'identifier')?.text ?? '');
    const row = new CsTypeParameterRegistry({
      ownerLinkHash: options.ownerLinkHash,
      ownerKind: options.ownerKind,
      position,
      name,
      varianceModifier: varianceOf(parameter),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    const clause = constraints.get(name);
    if (clause !== undefined) {
      row.setConstraints(clause);
      if (options.typeReferenceSink !== undefined) {
        let constraintPosition = 0;
        for (const constraint of clause.typeNodes) {
          options.typeReferenceSink.push(
            ...extractTypeReferences({
              // The constraint node wraps the type; the type is its first child.
              typeNode: namedChildren(constraint)[0] ?? constraint,
              ownerLinkHash: row.getHash(),
              referenceOwnerKind: CsReferenceOwnerKind.TYPE_PARAMETER,
              context: CsTypeRefContext.TYPE_PARAMETER_CONSTRAINT,
              serviceVersionLinkHash: options.serviceVersionLinkHash,
              rootPosition: constraintPosition,
            })
          );
          constraintPosition += 1;
        }
      }
    }
    rows.push(row);
    if (options.declarationOwnerSink !== undefined) {
      addDeclarationOwner(options.declarationOwnerSink, nodeId(parameter), {
        hash: row.getHash(),
        kind: CsDeclarationOwnerKind.TYPE_PARAMETER,
      });
    }
    position += 1;
  }

  return rows;
}

/**
 * `in` / `out`, read from the anonymous tokens the grammar puts them in.
 *
 * Legal only on an interface or a delegate. The parser records what is written
 * and does not enforce that, because a file that violates it is a file that does
 * not compile, and reporting a syntax fact as absent because the program is
 * invalid would hide the reason it is invalid.
 */
function varianceOf(parameter: Parser.SyntaxNode): CsVarianceModifier {
  for (const child of allChildren(parameter)) {
    if (child.isNamed) {
      continue;
    }
    if (child.type === 'in') {
      return CsVarianceModifier.IN;
    }
    if (child.type === 'out') {
      return CsVarianceModifier.OUT;
    }
  }
  return CsVarianceModifier.NONE;
}

interface ConstraintFacts {
  constraintText: string;
  hasStructConstraint: boolean;
  hasClassConstraint: boolean;
  hasNotNullConstraint: boolean;
  hasConstructorConstraint: boolean;
  hasAllowRefStructConstraint: boolean;
  hasUnmanagedConstraint: boolean;
  constraintTypeCount: number;
  typeNodes: Parser.SyntaxNode[];
}

function readConstraintClauses(
  declaration: Parser.SyntaxNode,
  activeSymbols: ReadonlySet<string>
): Map<string, ConstraintFacts> {
  const byParameterName = new Map<string, ConstraintFacts>();

  // Through a `#if`: the declaration's direct clauses, plus those in the
  // taken branch of a `preproc_if` child that holds clauses (fork20).
  const clauses: Parser.SyntaxNode[] = [];
  for (const child of namedChildren(declaration)) {
    if (child.type === 'type_parameter_constraints_clause') {
      clauses.push(child);
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
        if (body.type === 'type_parameter_constraints_clause') {
          clauses.push(body);
        }
      }
    }
  }
  for (const clause of clauses) {
    const rawParameterName = childOfType(clause, 'identifier')?.text;
    if (rawParameterName === undefined) {
      continue;
    }
    // Normalised on BOTH sides of the join, or `where @class : IFoo` matches no
    // parameter and the constraint is silently dropped.
    const parameterName = normalizeCSharpIdentifier(rawParameterName);

    const facts: ConstraintFacts = {
      constraintText: clause.text,
      hasStructConstraint: false,
      hasClassConstraint: false,
      hasNotNullConstraint: false,
      hasConstructorConstraint: false,
      hasAllowRefStructConstraint: false,
      hasUnmanagedConstraint: false,
      constraintTypeCount: 0,
      typeNodes: [],
    };

    // The clause's constraints, and those of a CONTINUATION under a `#if`
    // (`where T : notnull\n#if NET\n , allows ref struct\n#endif`, fork23).
    const constraints: Parser.SyntaxNode[] = [];
    for (const child of namedChildren(clause)) {
      if (child.type === 'type_parameter_constraint') {
        constraints.push(child);
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
          if (body.type === 'constraint_continuation') {
            constraints.push(...childrenOfType(body, 'type_parameter_constraint'));
          }
        }
      }
    }
    for (const constraint of constraints) {
      const text = constraint.text.trim();
      if (childOfType(constraint, 'constructor_constraint') !== undefined) {
        facts.hasConstructorConstraint = true;
        continue;
      }
      if (text === 'class' || text.startsWith('class?')) {
        facts.hasClassConstraint = true;
        continue;
      }
      if (text === 'struct') {
        facts.hasStructConstraint = true;
        continue;
      }
      // `unmanaged` IMPLIES the struct constraint (a blittable value type with
      // no managed references) and adds more: `fixed`, pointer types and
      // `stackalloc` become legal on T. Every structured column read false
      // for it — five booleans, none for unmanaged, and it was excluded from
      // the type count as a keyword — so an engine asking "is T a value type?"
      // read no (CS-ORACLE-6, found by reconciliation: 53 type constraints
      // against 39 + 12 left a remainder of exactly the corpus's 2 unmanaged).
      // BOTH columns are written (v1.15 §3.4.1): the implied fact so no
      // consumer has to know one flag entails another, and the specific fact
      // so `struct` and `unmanaged` are distinguishable.
      if (text === 'unmanaged') {
        facts.hasStructConstraint = true;
        facts.hasUnmanagedConstraint = true;
        continue;
      }
      if (text === 'notnull') {
        facts.hasNotNullConstraint = true;
        continue;
      }
      // C# 13 `allows ref struct`. The fork does not yet parse the `allows`
      // keyword — cs-oracle named it as one of four constructs in the 1.41%
      // grammar residue — so it arrives as an ERROR sibling followed by a
      // `ref struct` constraint. Reading the constraint is what survives the
      // gap; the flag would otherwise be false on every use of it.
      if (text === 'ref struct' || text.startsWith('allows')) {
        facts.hasAllowRefStructConstraint = true;
        continue;
      }
      if (!NON_TYPE_CONSTRAINTS.has(text)) {
        facts.constraintTypeCount += 1;
        facts.typeNodes.push(constraint);
      }
    }

    // Two `where` clauses cannot name the same parameter in legal C#. If one
    // does, the later clause is kept and the earlier is not silently merged
    // into it — merging would invent a constraint set that appears in no source.
    byParameterName.set(parameterName, facts);
  }

  return byParameterName;
}
