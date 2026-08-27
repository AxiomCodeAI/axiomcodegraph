import * as ts from 'typescript';

import { TsDecoratorArgumentRegistry } from
  '@/analysis-types/typescript/TsDecoratorArgumentRegistry';
import { TsDecoratorRegistry } from '@/analysis-types/typescript/TsDecoratorRegistry';
import { TsExpressionRegistry } from '@/analysis-types/typescript/TsExpressionRegistry';
import {
  TsDecoratorArgumentValueType,
  TsDecoratorContext,
  TsDecoratorKind,
  TsDecoratorSemantics,
  TsDecoratorSystem,
} from '@/enums/typescript/decorators';
import { TsReferenceOwnerKind, TsTypeRefContext } from '@/enums/typescript/type-references';
import { nodeId } from '@/parsers/typescript/extractors/ts-binder';
import { unwrapParentheses } from '@/parsers/typescript/extractors/ts-expression-extractor';
import { TsTypeReferenceExtractor } from '@/parsers/typescript/extractors/ts-type-reference-extractor';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Emits `ts_decorator` and `ts_decorator_argument` — schema §4.18, §4.19.
 *
 * ## `decoratorSystem` comes from the GOVERNING tsconfig, per file
 *
 * This is the one correctness item that cannot be got right by reasoning about
 * the source alone, because the source is IDENTICAL under both systems and the
 * facts are not. Standard TC39 decorators and legacy `experimentalDecorators`
 * differ in evaluation order, in what the decorator function receives, and in
 * whether parameter decorators are legal at all — and the only thing that says
 * which one applies is the tsconfig that governs the file.
 *
 * This repository's own corpus proves the point: `annotations/legacy/` sits
 * three directories below `annotations/standard-decorators.ts`, compiles under
 * its own config with `experimentalDecorators: true`, and its facts
 * legitimately differ. A run-wide assumption gets one of the two wrong, and
 * gets it wrong in a way that looks entirely plausible.
 *
 * ## Runs AFTER expressions, on purpose
 *
 * A decorator is an expression that RUNS, so `tsExpressionLinkHash` must point
 * at a row that already exists. That is also why `@Component({...})` produces a
 * `ts_call_site` like any other call: it is one.
 */
export interface DecoratorExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  /** From the tsconfig that governs THIS file. Never a run-wide constant. */
  readonly decoratorSystem: TsDecoratorSystem;
  readonly typeHashByNode: ReadonlyMap<string, string>;
  readonly methodHashByNode: ReadonlyMap<string, string>;
  readonly fieldHashByNode: ReadonlyMap<string, string>;
  readonly parameterHashByNode: ReadonlyMap<string, string>;
  readonly expressionRowByNode: ReadonlyMap<string, TsExpressionRegistry>;
  /**
   * So a decorator can contribute to the TYPE graph as well as the call graph.
   *
   * Java emits `ANNOTATION_TYPE` for the annotation a usage names and
   * `ANNOTATION_PARAM` for types inside its arguments. Both port directly: a
   * decorator names a function or class, and `@Inject(UserRepository)` names a
   * type as a DI token. Without them a decorator is a call with no type edge,
   * and the DI pattern the relation exists to surface is unqueryable from the
   * type side.
   */
  readonly typeReferenceExtractor: TsTypeReferenceExtractor;
}

export interface DecoratorExtractionResult {
  readonly decorators: readonly TsDecoratorRegistry[];
  readonly decoratorArguments: readonly TsDecoratorArgumentRegistry[];
}

export function extractDecorators(
  options: DecoratorExtractorOptions
): DecoratorExtractionResult {
  const decorators: TsDecoratorRegistry[] = [];
  const decoratorArguments: TsDecoratorArgumentRegistry[] = [];
  const sf = options.sourceFile;

  const emitFor = (node: ts.Node, context: TsDecoratorContext, ownerHash: string,
                   typeHash: string): void => {
    if (ownerHash === '') {
      return;
    }
    let position = 0;
    for (const decorator of ts.getDecorators(node as ts.HasDecorators) ?? []) {
      const expression = unwrapParentheses(decorator.expression);
      const callee = ts.isCallExpression(expression)
        ? unwrapParentheses(expression.expression)
        : expression;
      const startPos = sf.getLineAndCharacterOfPosition(decorator.getStart(sf));
      const endPos = sf.getLineAndCharacterOfPosition(decorator.end);
      const argumentsList = ts.isCallExpression(expression) ? expression.arguments : undefined;

      const row = new TsDecoratorRegistry({
        decoratorName: decoratorNameOf(callee),
        kind: ts.isCallExpression(expression)
          ? TsDecoratorKind.CALL
          : ts.isPropertyAccessExpression(callee)
            ? TsDecoratorKind.MEMBER_EXPRESSION
            : ts.isElementAccessExpression(callee)
              ? TsDecoratorKind.COMPUTED
              : TsDecoratorKind.MARKER,
        context,
        ownerHash,
        tsTypeLinkHash: typeHash,
        // Application ORDER, and it is load-bearing: standard decorators apply
        // bottom-up, so `@a @b` and `@b @a` are different facts.
        position,
        startLine: startPos.line + 1,
        endLine: endPos.line + 1,
        argumentCount: argumentsList?.length ?? 0,
        decoratorSystem: options.decoratorSystem,
        // UNKNOWN, and honestly so. Whether a decorator REPLACES its target
        // depends on whether its implementation returns a value, which is a
        // property of the decorator FUNCTION and not of this application — and
        // that function is usually in another package. Guessing from the use
        // site would be a fact about code this parser has not read.
        decoratorSemantics: TsDecoratorSemantics.UNKNOWN,
        tsExpressionLinkHash:
          options.expressionRowByNode.get(nodeId(expression, sf))?.getHash() ?? '',
        tsModuleLinkHash: options.moduleHash,
        startColumn: startPos.character + 1,
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      });
      decorators.push(row);

      // The type the decorator NAMES — Java's ANNOTATION_TYPE. Links the usage
      // to the declaration that implements it.
      const decoratorTypeNode = synthesiseDecoratorTypeNode(callee);
      if (decoratorTypeNode) {
        options.typeReferenceExtractor.extract(
          decoratorTypeNode,
          TsTypeRefContext.DECORATOR_TYPE,
          {
            ownerHash: row.getHash(),
            ownerKind: TsReferenceOwnerKind.DECORATOR,
            tsTypeLinkHash: typeHash,
            tsModuleLinkHash: options.moduleHash,
          },
          false
        );
      }

      let argumentPosition = 0;
      for (const argument of argumentsList ?? []) {
        emitArgument(argument, row, argumentPosition, decoratorArguments, options);
        argumentPosition += 1;
      }
      position += 1;
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      emitFor(node, TsDecoratorContext.CLASS_DECLARATION,
        options.typeHashByNode.get(nodeId(node, sf)) ?? '',
        options.typeHashByNode.get(nodeId(node, sf)) ?? '');
      const ownerType = options.typeHashByNode.get(nodeId(node, sf)) ?? '';
      for (const member of node.members) {
        const id = nodeId(member, sf);
        if (ts.isPropertyDeclaration(member)) {
          emitFor(member,
            member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AccessorKeyword) === true
              ? TsDecoratorContext.AUTO_ACCESSOR
              : TsDecoratorContext.FIELD_DECLARATION,
            options.fieldHashByNode.get(id) ?? '', ownerType);
        } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
          emitFor(member, TsDecoratorContext.ACCESSOR_DECLARATION,
            options.methodHashByNode.get(id) ?? '', ownerType);
        } else if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
          emitFor(member, TsDecoratorContext.METHOD_DECLARATION,
            options.methodHashByNode.get(id) ?? '', ownerType);
        }
        // Parameter decorators exist ONLY under experimentalDecorators. They are
        // emitted whenever they are present rather than gated on the system
        // token, because their presence is a syntactic fact and a mismatch
        // between the two is exactly the kind of thing a fact base should be
        // able to show rather than silently normalise.
        const parameters = (member as { parameters?: ts.NodeArray<ts.ParameterDeclaration> })
          .parameters;
        for (const parameter of parameters ?? []) {
          emitFor(parameter, TsDecoratorContext.PARAMETER_DECLARATION,
            options.parameterHashByNode.get(nodeId(parameter, sf)) ?? '', ownerType);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);

  return { decorators, decoratorArguments };
}

function emitArgument(
  argument: ts.Expression,
  decorator: TsDecoratorRegistry,
  position: number,
  out: TsDecoratorArgumentRegistry[],
  options: DecoratorExtractorOptions
): void {
  const sf = options.sourceFile;
  const startPos = sf.getLineAndCharacterOfPosition(argument.getStart(sf));
  const endPos = sf.getLineAndCharacterOfPosition(argument.end);
  const expressionHash =
    options.expressionRowByNode.get(nodeId(argument, sf))?.getHash() ?? '';

  if (ts.isObjectLiteralExpression(argument)) {
    // An options object is where framework configuration lives — `@Column({
    // type: "varchar", nullable: true })` — so each property becomes its own
    // NAMED row rather than one opaque blob a rule would have to re-parse.
    let index = 0;
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) {
        index += 1;
        continue;
      }
      const name = property.name.getText(sf).replace(/^["']|["']$/g, '');
      const value = property.initializer;
      out.push(new TsDecoratorArgumentRegistry({
        argumentName: name,
        argumentValue: EntityUtils.normalizeWhitespace(value.getText(sf)),
        valueType: valueTypeOf(value),
        position,
        parentDecoratorHash: decorator.getHash(),
        nestedObjectHash: '',
        arrayIndex: index,
        startLine: sf.getLineAndCharacterOfPosition(property.getStart(sf)).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(property.end).line + 1,
        tsExpressionLinkHash:
          options.expressionRowByNode.get(nodeId(value, sf))?.getHash() ?? '',
        serviceVersionLinkHash: options.serviceVersionLinkHash,
      }));
      index += 1;
    }
    return;
  }

  // A capitalised bare name in a decorator argument is the DI-token pattern —
  // Java's ANNOTATION_PARAM. Emitting it into the type graph is what makes
  // `@Inject(UserRepository)` joinable from the type side rather than only as
  // free text in `argumentValue`.
  if (ts.isIdentifier(argument) && /^[A-Z]/.test(argument.text)) {
    const tokenType = synthesiseDecoratorTypeNode(argument);
    if (tokenType) {
      options.typeReferenceExtractor.extract(
        tokenType,
        TsTypeRefContext.DECORATOR_ARGUMENT_TYPE,
        {
          ownerHash: decorator.getHash(),
          ownerKind: TsReferenceOwnerKind.DECORATOR,
          tsTypeLinkHash: '',
          tsModuleLinkHash: options.moduleHash,
        },
        false
      );
    }
  }

  out.push(new TsDecoratorArgumentRegistry({
    argumentName: '',
    argumentValue: EntityUtils.normalizeWhitespace(argument.getText(sf)),
    valueType: valueTypeOf(argument),
    position,
    parentDecoratorHash: decorator.getHash(),
    nestedObjectHash: '',
    arrayIndex: 0,
    startLine: startPos.line + 1,
    endLine: endPos.line + 1,
    tsExpressionLinkHash: expressionHash,
    serviceVersionLinkHash: options.serviceVersionLinkHash,
  }));
}

/**
 * A type node over the name a decorator uses, borrowing its source range.
 *
 * The decorator's callee is an EXPRESSION, so there is no `TypeNode` in the tree
 * to point at. The synthesised node reuses the original identifiers and their
 * positions, so the emitted row names real source text rather than an empty
 * string at offset zero.
 */
function synthesiseDecoratorTypeNode(callee: ts.Node): ts.TypeNode | undefined {
  if (!ts.isIdentifier(callee) && !ts.isPropertyAccessExpression(callee)) {
    return undefined;
  }
  const name = entityNameOf(callee);
  if (!name) {
    return undefined;
  }
  const node = ts.factory.createTypeReferenceNode(name, undefined) as ts.TypeNode & {
    pos: number; end: number; parent: ts.Node;
  };
  node.pos = callee.pos;
  node.end = callee.end;
  node.parent = callee.parent;
  return node;
}

function entityNameOf(
  expression: ts.Identifier | ts.PropertyAccessExpression
): ts.EntityName | undefined {
  if (ts.isIdentifier(expression)) {
    return expression;
  }
  const left = unwrapParentheses(expression.expression);
  if (!ts.isIdentifier(left) && !ts.isPropertyAccessExpression(left)) {
    return undefined;
  }
  const qualifier = entityNameOf(left);
  if (!qualifier || ts.isPrivateIdentifier(expression.name)) {
    return undefined;
  }
  const qualified = ts.factory.createQualifiedName(qualifier, expression.name) as
    ts.QualifiedName & { pos: number; end: number; parent: ts.Node };
  qualified.pos = expression.pos;
  qualified.end = expression.end;
  qualified.parent = expression.parent;
  return qualified;
}

function decoratorNameOf(callee: ts.Node): string {
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return '';
}

function valueTypeOf(node: ts.Expression): TsDecoratorArgumentValueType {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return TsDecoratorArgumentValueType.STRING;
  }
  if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) {
    return TsDecoratorArgumentValueType.NUMBER;
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return TsDecoratorArgumentValueType.BOOLEAN;
  }
  if (node.kind === ts.SyntaxKind.NullKeyword) {
    return TsDecoratorArgumentValueType.NULL;
  }
  if (ts.isObjectLiteralExpression(node)) {
    return TsDecoratorArgumentValueType.OBJECT;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return TsDecoratorArgumentValueType.ARRAY;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return TsDecoratorArgumentValueType.ARROW;
  }
  if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
    return TsDecoratorArgumentValueType.CALL;
  }
  if (ts.isTemplateExpression(node)) {
    return TsDecoratorArgumentValueType.TEMPLATE;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') {
      return TsDecoratorArgumentValueType.UNDEFINED;
    }
    // A bare capitalised identifier in a decorator argument is overwhelmingly a
    // DI TOKEN — `@Inject(UserRepository)` — which is the pattern this column
    // exists to surface. It is a heuristic and stays labelled as one: the
    // `referencedTypeHash` FK is what carries the claim, and it is filled only
    // when the name actually resolves to a type.
    return /^[A-Z]/.test(node.text)
      ? TsDecoratorArgumentValueType.CLASS_REFERENCE
      : TsDecoratorArgumentValueType.IDENTIFIER;
  }
  if (ts.isPropertyAccessExpression(node)) {
    return TsDecoratorArgumentValueType.IDENTIFIER;
  }
  return TsDecoratorArgumentValueType.UNKNOWN;
}
