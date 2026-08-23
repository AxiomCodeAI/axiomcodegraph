import Parser from 'tree-sitter';

import {
  PyMethodRegistry,
  PyModuleRegistry,
  PyTypeParameterRegistry,
  PyTypeRegistry,
} from '@/analysis-types/python';
import { PythonExpressionOwnerKind } from '@/enums/python/expressions';
import {
  PythonTypeParameterKind,
  PythonTypeParameterVariance,
} from '@/enums/python/type-parameters';

export interface PythonTypeParameterInput {
  module: PyModuleRegistry;
  rootNode: Parser.SyntaxNode;
  filePath: string;
  serviceVersionLinkHash: string;
  types: PyTypeRegistry[];
  methods: PyMethodRegistry[];
  typeHashByNodeId: Map<number, string>;
  methodHashByNodeId: Map<number, string>;
  scopeHashByNodeId: Map<number, string>;
}

/**
 * Extracts PEP 695 type parameters — the `T` in `class Box[T]`.
 *
 * Only the 3.12 SYNTAX produces rows. On 3.11 and earlier a `TypeVar` is a
 * runtime assignment rather than a declaration, and §2.20 puts those in
 * `py_binding` with `targetEntityKind=TYPE_VAR` — a different fact, correctly
 * modelled differently.
 *
 * Three things tree-sitter 0.21 does that the grammar reference does not warn
 * about, each verified against the tree rather than assumed:
 *
 * 1. `type_parameter` is NOT unique to PEP 695. `Dict[str, int]` uses the same
 *    node under `generic_type`, so a blind search for it would report every
 *    subscript generic in the file as a declared parameter. Only a DIRECT child
 *    of a class, function or type-alias statement counts.
 * 2. `*Ts` and `**P` both parse to `splat_type` with no distinction between
 *    them. A TypeVarTuple stands for a SEQUENCE of types and a ParamSpec for a
 *    whole parameter LIST, so the two are told apart by reading the source text.
 * 3. PEP 696 defaults — `class B[T = int]` — do NOT parse at all in 0.21; the
 *    tree carries an ERROR node. `defaultText` is therefore always empty here,
 *    and the failure is not hidden: it surfaces as a `py_parse_gap` ERROR_NODE
 *    row, which is exactly what that relation is for.
 */
export class PythonTypeParameterExtractor {
  extract(input: PythonTypeParameterInput): PyTypeParameterRegistry[] {
    const parameters: PyTypeParameterRegistry[] = [];
    const typeByHash = new Map(input.types.map(t => [t.getHash(), t]));
    const methodByHash = new Map(input.methods.map(m => [m.getHash(), m]));

    const worklist: Parser.SyntaxNode[] = [input.rootNode];
    while (worklist.length > 0) {
      const node = worklist.shift()!;
      const owner = this.ownerOf(node, input, typeByHash, methodByHash);
      if (owner) {
        for (const list of this.declaredParameterLists(node)) {
          this.emitFrom(list, owner, input, parameters);
        }
      }
      for (let index = 0; index < node.namedChildCount; index += 1) {
        const child = node.namedChild(index);
        if (child && !child.isExtra) {
          worklist.push(child);
        }
      }
    }
    return parameters;
  }

  /**
   * The `type_parameter` lists that DECLARE parameters on this node.
   *
   * A direct child for a class or function. A TYPE ALIAS is different and the
   * difference is easy to miss: `type Alias[T] = list[T]` nests its parameters
   * under `type > generic_type`, so a direct-child rule finds none and the alias
   * silently contributes nothing.
   *
   * The rule stays strict everywhere else, because `type_parameter` is NOT
   * unique to PEP 695 — `Dict[str, int]` uses the same node under
   * `generic_type` — so an unrestricted search would report every subscript
   * generic in the file as a declared parameter.
   */
  private declaredParameterLists(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
    const found: Parser.SyntaxNode[] = [];
    for (let index = 0; index < node.namedChildCount; index += 1) {
      const child = node.namedChild(index);
      if (!child || child.isExtra) {
        continue;
      }
      if (child.type === 'type_parameter') {
        found.push(child);
        continue;
      }
      // The alias shape only, and only its FIRST `type` child. A
      // `type_alias_statement` has two: the left side `Alias[T]`, which
      // DECLARES, and the right side `list[T]`, which USES. Both are
      // `generic_type` with a `type_parameter` under them, so descending into
      // both reported every alias parameter twice.
      if (node.type === 'type_alias_statement' && child.type === 'type' && found.length === 0 && index === 0) {
        const generic = child.namedChild(0);
        if (generic?.type === 'generic_type') {
          for (let inner = 0; inner < generic.namedChildCount; inner += 1) {
            const candidate = generic.namedChild(inner);
            if (candidate?.type === 'type_parameter') {
              found.push(candidate);
            }
          }
        }
      }
    }
    return found;
  }

  private ownerOf(
    node: Parser.SyntaxNode,
    input: PythonTypeParameterInput,
    typeByHash: Map<string, PyTypeRegistry>,
    methodByHash: Map<string, PyMethodRegistry>
  ): {
    hash: string;
    name: string;
    qualifiedName: string;
    kind: PythonExpressionOwnerKind;
    scopeHash: string;
  } | null {
    if (node.type === 'class_definition') {
      const hash = input.typeHashByNodeId.get(node.id) ?? '';
      const type = typeByHash.get(hash);
      return {
        hash,
        name: type?.getName() ?? node.childForFieldName('name')?.text ?? '',
        qualifiedName: type?.getQualifiedName() ?? '',
        kind: PythonExpressionOwnerKind.TYPE,
        scopeHash: input.scopeHashByNodeId.get(node.id) ?? '',
      };
    }
    if (node.type === 'function_definition') {
      const hash = input.methodHashByNodeId.get(node.id) ?? '';
      const method = methodByHash.get(hash);
      return {
        hash,
        name: method?.getName() ?? node.childForFieldName('name')?.text ?? '',
        qualifiedName: method?.getQualifiedName() ?? '',
        kind: PythonExpressionOwnerKind.METHOD,
        scopeHash: input.scopeHashByNodeId.get(node.id) ?? '',
      };
    }
    if (node.type === 'type_alias_statement') {
      // `type Alias[T] = list[T]` — the alias is not a py_type or py_method, so
      // the owner is the MODULE. The parameter is still real and still scoped.
      return {
        hash: input.module.getHash(),
        name: this.aliasNameOf(node),
        qualifiedName: `${input.module.getQualifiedName()}.${this.aliasNameOf(node)}`,
        kind: PythonExpressionOwnerKind.MODULE,
        scopeHash: input.scopeHashByNodeId.get(node.id) ?? '',
      };
    }
    return null;
  }

  /**
   * A `type_alias_statement` nests its name inside a `generic_type` when it has
   * parameters, so the name is not a direct `name` field.
   */
  private aliasNameOf(node: Parser.SyntaxNode): string {
    const first = node.namedChild(0);
    if (!first) {
      return '';
    }
    if (first.type === 'identifier') {
      return first.text;
    }
    const inner = first.namedChild(0);
    if (inner?.type === 'identifier') {
      return inner.text;
    }
    if (inner?.type === 'generic_type') {
      return inner.namedChild(0)?.text ?? '';
    }
    return '';
  }

  /** One `type_parameter` list may hold several parameters. */
  private emitFrom(
    list: Parser.SyntaxNode,
    owner: {
      hash: string;
      name: string;
      qualifiedName: string;
      kind: PythonExpressionOwnerKind;
      scopeHash: string;
    },
    input: PythonTypeParameterInput,
    out: PyTypeParameterRegistry[]
  ): void {
    let position = 0;
    for (let index = 0; index < list.namedChildCount; index += 1) {
      const entry = list.namedChild(index);
      if (!entry || entry.isExtra || entry.type === 'ERROR') {
        continue;
      }
      const detail = this.detailOf(entry);
      if (detail.name === '') {
        continue;
      }
      out.push(
        new PyTypeParameterRegistry(
          detail.name,
          position++,
          owner.name,
          owner.qualifiedName,
          input.filePath,
          entry.startPosition.row + 1,
          owner.hash,
          owner.kind,
          detail.bound,
          // PEP 695 removed explicit variance: the checker infers it from usage,
          // so the source genuinely does not say and neither do we.
          PythonTypeParameterVariance.INFERRED,
          // PEP 696 defaults do not parse in tree-sitter 0.21 — the construct
          // becomes an ERROR node, which py_parse_gap records. Left empty rather
          // than guessed.
          '',
          owner.scopeHash,
          detail.kind,
          input.serviceVersionLinkHash
        )
      );
    }
  }

  /** The parameter's name and bound, from whichever shape the entry has. */
  private detailOf(entry: Parser.SyntaxNode): {
    name: string;
    bound: string;
    kind: PythonTypeParameterKind;
  } {
    const inner = entry.type === 'type' ? entry.namedChild(0) : entry;
    if (!inner) {
      return { name: '', bound: '', kind: PythonTypeParameterKind.TYPE_VAR };
    }
    if (inner.type === 'identifier') {
      return { name: inner.text, bound: '', kind: PythonTypeParameterKind.TYPE_VAR };
    }
    if (inner.type === 'splat_type') {
      // `*Ts` and `**P` are the SAME node — the stars are the only difference and
      // they live in the text rather than the tree. A TypeVarTuple stands for a
      // sequence of types and a ParamSpec for a whole parameter list, so reading
      // the text is the only way to keep them apart.
      return {
        name: inner.namedChild(0)?.text ?? '',
        bound: '',
        kind: inner.text.startsWith('**')
          ? PythonTypeParameterKind.PARAM_SPEC
          : PythonTypeParameterKind.TYPE_VAR_TUPLE,
      };
    }
    if (inner.type === 'constrained_type') {
      const nameNode = inner.namedChild(0);
      const boundNode = inner.namedChild(1);
      const named = this.detailOf(nameNode ?? inner);
      return {
        name: named.name,
        bound: boundNode ? boundNode.text.replace(/\s+/g, ' ').trim() : '',
        kind: named.kind,
      };
    }
    return {
      name: inner.text.replace(/\s+/g, ' ').trim(),
      bound: '',
      kind: PythonTypeParameterKind.TYPE_VAR,
    };
  }
}
