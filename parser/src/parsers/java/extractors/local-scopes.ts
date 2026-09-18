import Parser from 'tree-sitter';

/**
 * Where each local declared in one method body is in scope, by name.
 *
 * `byName` maps a local's name to the byte ranges over which a declaration of that name is in
 * scope; `bodyStartIndex`/`bodyEndIndex` bound the body the ranges were collected from, so a site
 * outside it (another method, a field initializer) is not scored against them. `tree` is carried
 * for the same reason and matters more: byte offsets are per FILE, and the extractor instance is
 * reused across files, so without it a body range from one file can appear to contain a site in
 * the next one.
 */
export interface MethodLocalScopes {
  tree: Parser.Tree;
  bodyStartIndex: number;
  bodyEndIndex: number;
  byName: Map<string, Array<{ startIndex: number; endIndex: number }>>;
}

/**
 * Collects, for every local declared in a method body, the byte range over which it is in scope.
 *
 * `TypeMethodExtractor.collectLocalVariableNames` answers "is this name a local somewhere in this
 * body", which is the question the classifier used to ask. Java asks a narrower one at a use site
 * (JLS 6.3): a local is in scope from its own declarator to the end of the scope that declares it,
 * and nowhere else. The difference shows up twice:
 *
 *   - POSITION. A field read above a same-named local is the field:
 *         if (value == null) { ... }   // the field
 *         long value = 7L;             // the local starts here
 *   - BLOCK SCOPE. A local in a sibling block that has closed is gone:
 *         { int t = 1; }               // `t` ends with this block
 *         use(t);                      // so this is not that local
 *
 * The scope end is the enclosing block for a plain declaration, the loop statement for a `for` or
 * `for`-each header, the catch clause for its parameter, and the `try` body for a resource, which
 * is where each of those bindings ends in Java. A lambda's parameters are recorded over the lambda
 * for the same reason: `(addr, server) -> ...` binds `server` there, and a method that also
 * declares a local `server` somewhere else must not read the parameter as a field. A local class body is not descended into, matching
 * the flat collector; the enclosing block's ranges still cover it, which is right, because an
 * enclosing method's locals ARE in scope inside a local or anonymous class.
 *
 * Java forbids a local from shadowing a local of an enclosing block, so the ranges recorded for
 * one name are disjoint and "inside any range" is an exact test rather than an innermost-wins one.
 */
export function collectLocalScopes(bodyBlock: Parser.SyntaxNode): MethodLocalScopes {
  const byName = new Map<string, Array<{ startIndex: number; endIndex: number }>>();

  const record = (nameNode: Parser.SyntaxNode, startIndex: number, endIndex: number): void => {
    const ranges = byName.get(nameNode.text);
    if (ranges) ranges.push({ startIndex, endIndex });
    else byName.set(nameNode.text, [{ startIndex, endIndex }]);
  };

  const declaratorNames = (declaration: Parser.SyntaxNode): Parser.SyntaxNode[] => {
    const names: Parser.SyntaxNode[] = [];
    for (const child of declaration.children) {
      if (child.type !== 'variable_declarator') continue;
      const nameNode = child.childForFieldName('name');
      if (nameNode) names.push(nameNode);
    }
    return names;
  };

  // `scopeEnd` is where the innermost enclosing scope ends, which is where a local declared
  // directly in it goes out of scope.
  const walk = (node: Parser.SyntaxNode, scopeEnd: number): void => {
    switch (node.type) {
      // A local class or anonymous class body declares its own members, not this method's locals.
      case 'class_body':
        return;

      // A block is a scope: what it declares dies with it, including a lambda's body block.
      case 'block':
      case 'constructor_body':
      case 'switch_block':
        for (const child of node.children) walk(child, node.endIndex);
        return;

      // for (int i = 0; ...) - `i` is scoped to the whole statement, header and body.
      case 'for_statement': {
        const init = node.childForFieldName('init');
        if (init && init.type === 'local_variable_declaration') {
          for (const nameNode of declaratorNames(init)) {
            record(nameNode, nameNode.startIndex, node.endIndex);
          }
        }
        for (const child of node.children) walk(child, node.endIndex);
        return;
      }

      // for (String s : list) - same, and the name precedes the iterated expression.
      case 'enhanced_for_statement': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) record(nameNode, nameNode.startIndex, node.endIndex);
        for (const child of node.children) walk(child, node.endIndex);
        return;
      }

      // catch (E e) - scoped to the clause, not to the rest of the enclosing block.
      case 'catch_clause': {
        const formalParam = node.children.find(c => c.type === 'catch_formal_parameter');
        const nameNode = formalParam?.childForFieldName('name');
        if (nameNode) record(nameNode, nameNode.startIndex, node.endIndex);
        for (const child of node.children) walk(child, node.endIndex);
        return;
      }

      // try (R r = ...) - scoped to the resource list and the try body, NOT to catch or finally.
      case 'try_with_resources_statement': {
        const resources = node.children.find(c => c.type === 'resource_specification');
        const body = node.childForFieldName('body');
        const resourceEnd = (body ?? node).endIndex;
        if (resources) {
          for (const resource of resources.children) {
            if (resource.type !== 'resource') continue;
            const nameNode = resource.childForFieldName('name');
            if (nameNode) record(nameNode, nameNode.startIndex, resourceEnd);
          }
        }
        for (const child of node.children) walk(child, node.endIndex);
        return;
      }

      // (a, b) -> ... - a lambda parameter is in scope over the lambda, and shares the name space
      // a local of the same name lives in. Recorded here so that a name which is a local somewhere
      // else in the method does not lose its lambda parameter reading inside the lambda.
      case 'lambda_expression': {
        const arrow = node.children.find(c => c.type === '->');
        for (const child of node.children) {
          if (child.type === 'identifier') {
            if (arrow && child.startIndex < arrow.startIndex) record(child, node.startIndex, node.endIndex);
          } else if (child.type === 'inferred_parameters') {
            for (const param of child.namedChildren) {
              if (param.type === 'identifier') record(param, node.startIndex, node.endIndex);
            }
          } else if (child.type === 'formal_parameters') {
            for (const param of child.namedChildren) {
              if (param.type !== 'formal_parameter') continue;
              const nameNode = param.childForFieldName('name');
              if (nameNode) record(nameNode, node.startIndex, node.endIndex);
            }
          }
        }
        for (const child of node.children) walk(child, scopeEnd);
        return;
      }

      // int x = 1, y = 2; - each name is in scope from its own declarator to the end of the block.
      case 'local_variable_declaration': {
        for (const nameNode of declaratorNames(node)) {
          record(nameNode, nameNode.startIndex, scopeEnd);
        }
        // an initializer may contain a lambda, whose body block is a scope of its own
        for (const child of node.children) walk(child, scopeEnd);
        return;
      }

      default:
        for (const child of node.children) walk(child, scopeEnd);
    }
  };

  walk(bodyBlock, bodyBlock.endIndex);

  return {
    tree: bodyBlock.tree,
    bodyStartIndex: bodyBlock.startIndex,
    bodyEndIndex: bodyBlock.endIndex,
    byName,
  };
}
