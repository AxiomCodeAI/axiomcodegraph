import * as ts from 'typescript';

import { TsExportRegistry } from '@/analysis-types/typescript/TsExportRegistry';
import { TS_DEFAULT_EXPORT_NAME } from '@/constants/typescript-constants';
import { TsExportedEntityKind, TsExportKind } from '@/enums/typescript/exports';
import { hasModifier, nodeId } from '@/parsers/typescript/extractors/ts-binder';

/**
 * Emits `ts_export` rows — schema §4.13.
 *
 * ## Why this relation is not optional
 *
 * A re-export chain is the ONLY path from an importer to the real declaration.
 * `import { Thing } from "./index"` resolves to a barrel that declares nothing
 * and forwards everything; without export rows, Path 2 stops there. 1,251 export
 * declarations and 86 `export *` were measured, so barrels are the normal shape
 * of a TypeScript package rather than an exception.
 *
 * ## Both forms of exporting, and they are different facts
 *
 * ```ts
 * export class C { }        // INLINE_DECLARATION — declaration and export in one
 * class D { }
 * export { D };             // NAMED_EXPORT — the declaration is elsewhere in the file
 * export { E } from "./m";  // NAMED_EXPORT + isReExport — the declaration is in ANOTHER file
 * ```
 *
 * The first two point at a local declaration through `exportedEntityLinkHash`;
 * the third points at a module through `resolvedSourceModuleLinkHash` and leaves
 * the entity for the engine to find. Recording them alike would make a barrel
 * look as though it declared its own exports.
 */
export interface ExportExtractorOptions {
  readonly sourceFile: ts.SourceFile;
  readonly tsModuleLinkHash: string;
  readonly isDeclarationFile: boolean;
  readonly serviceVersionLinkHash: string;
  /** Declaration name -> its row hash and merge group, for a local export. */
  readonly declarationByName: ReadonlyMap<
    string,
    { hash: string; groupKey: string; kind: TsExportedEntityKind }
  >;
  readonly typeHashByNode: ReadonlyMap<string, string>;
  readonly methodHashByNode: ReadonlyMap<string, string>;
  readonly variableHashByNode: ReadonlyMap<string, string>;
}

export function extractExports(options: ExportExtractorOptions): TsExportRegistry[] {
  const sf = options.sourceFile;
  const out: TsExportRegistry[] = [];
  let position = 0;

  const positionOf = (node: ts.Node): { startLine: number; startColumn: number; endLine: number } => {
    const start = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    const end = sf.getLineAndCharacterOfPosition(node.end);
    return { startLine: start.line + 1, startColumn: start.character + 1, endLine: end.line + 1 };
  };

  const emit = (props: {
    node: ts.Node;
    exportedName: string;
    localName: string;
    exportKind: TsExportKind;
    isTypeOnly: boolean;
    isDefault: boolean;
    sourceSpecifier: string;
    entityKind: TsExportedEntityKind;
    entityHash?: string;
    entityGroupKey?: string;
  }): TsExportRegistry => {
    const where = positionOf(props.node);
    const row = new TsExportRegistry({
      exportedName: props.exportedName,
      localName: props.localName,
      exportKind: props.exportKind,
      isTypeOnly: props.isTypeOnly,
      isDefault: props.isDefault,
      isReExport: props.sourceSpecifier !== '',
      sourceSpecifier: props.sourceSpecifier,
      tsModuleLinkHash: options.tsModuleLinkHash,
      exportedEntityKind: props.entityKind,
      position,
      startLine: where.startLine,
      endLine: where.endLine,
      startColumn: where.startColumn,
      isAmbient: options.isDeclarationFile || hasModifier(props.node, ts.SyntaxKind.DeclareKeyword),
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    if (props.entityHash !== undefined && props.entityHash !== '') {
      row.setExportedEntity(props.entityHash, props.entityGroupKey ?? '');
    }
    out.push(row);
    position += 1;
    return row;
  };

  for (const statement of sf.statements) {
    // `export class C` / `export function f` / `export const x` — declaration and
    // export in one statement, so the entity is right here.
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      emitInlineDeclaration(statement, emit, options, sf);
    }

    if (ts.isExportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier ?? sf)
        ? (statement.moduleSpecifier as ts.StringLiteral).text
        : '';
      const clause = statement.exportClause;

      if (!clause) {
        // `export * from "./m"` — exports a set THIS ROW CANNOT NAME. The engine
        // expands it by joining the source module's exports; 86 measured, so it
        // is a real soundness surface rather than a curiosity.
        emit({
          node: statement,
          exportedName: '',
          localName: '',
          exportKind: statement.isTypeOnly ? TsExportKind.TYPE_ONLY_STAR : TsExportKind.EXPORT_STAR,
          isTypeOnly: statement.isTypeOnly,
          isDefault: false,
          sourceSpecifier: specifier,
          entityKind: TsExportedEntityKind.UNKNOWN,
        });
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        emit({
          node: statement,
          exportedName: clause.name.text,
          localName: '',
          exportKind: TsExportKind.EXPORT_STAR_AS_NAMESPACE,
          isTypeOnly: statement.isTypeOnly,
          isDefault: false,
          sourceSpecifier: specifier,
          entityKind: TsExportedEntityKind.MODULE,
        });
        continue;
      }
      for (const element of clause.elements) {
        const localName = element.propertyName?.text ?? element.name.text;
        const isDefault = element.name.text === TS_DEFAULT_EXPORT_NAME;
        // A re-export names nothing local: the declaration is in the source
        // module and only the chain reaches it.
        const local = specifier === '' ? options.declarationByName.get(localName) : undefined;
        emit({
          node: element,
          exportedName: element.name.text,
          localName,
          exportKind: statement.isTypeOnly || element.isTypeOnly
            ? TsExportKind.TYPE_ONLY_NAMED
            : element.propertyName
              ? TsExportKind.NAMED_ALIAS
              : TsExportKind.NAMED_EXPORT,
          isTypeOnly: statement.isTypeOnly || element.isTypeOnly === true,
          isDefault,
          sourceSpecifier: specifier,
          entityKind: local?.kind ?? TsExportedEntityKind.UNKNOWN,
          entityHash: local?.hash,
          entityGroupKey: local?.groupKey,
        });
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      // `export = X` is the CommonJS whole-module form; `export default <expr>`
      // is an expression with no declaration to point at.
      const isDefaultExport = statement.isExportEquals !== true;
      const named = ts.isIdentifier(statement.expression)
        ? options.declarationByName.get(statement.expression.text)
        : undefined;
      emit({
        node: statement,
        exportedName: isDefaultExport ? TS_DEFAULT_EXPORT_NAME : '',
        localName: ts.isIdentifier(statement.expression) ? statement.expression.text : '',
        exportKind: isDefaultExport
          ? TsExportKind.DEFAULT_EXPRESSION
          : TsExportKind.EXPORT_ASSIGNMENT,
        isTypeOnly: false,
        isDefault: isDefaultExport,
        sourceSpecifier: '',
        entityKind: named?.kind ?? TsExportedEntityKind.EXPRESSION,
        entityHash: named?.hash,
        entityGroupKey: named?.groupKey,
      });
      continue;
    }

    if (ts.isImportEqualsDeclaration(statement)
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      emit({
        node: statement,
        exportedName: statement.name.text,
        localName: statement.name.text,
        exportKind: TsExportKind.EXPORT_IMPORT_EQUALS,
        isTypeOnly: statement.isTypeOnly,
        isDefault: false,
        sourceSpecifier: '',
        entityKind: TsExportedEntityKind.UNKNOWN,
      });
    }
  }
  return out;
}

/**
 * `export class C`, `export function f`, `export const x`, `export default …`.
 *
 * One statement may export several names — `export const a = 1, b = 2` — so a
 * variable statement emits one row per declaration rather than one per statement.
 */
function emitInlineDeclaration(
  statement: ts.Statement,
  emit: (props: {
    node: ts.Node;
    exportedName: string;
    localName: string;
    exportKind: TsExportKind;
    isTypeOnly: boolean;
    isDefault: boolean;
    sourceSpecifier: string;
    entityKind: TsExportedEntityKind;
    entityHash?: string;
    entityGroupKey?: string;
  }) => TsExportRegistry,
  options: ExportExtractorOptions,
  sf: ts.SourceFile
): void {
  const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
  const kind = isDefault ? TsExportKind.DEFAULT_EXPORT : TsExportKind.INLINE_DECLARATION;

  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }
      emit({
        node: declaration,
        exportedName: declaration.name.text,
        localName: declaration.name.text,
        exportKind: kind,
        isTypeOnly: false,
        isDefault,
        sourceSpecifier: '',
        entityKind: TsExportedEntityKind.VARIABLE,
        entityHash: options.variableHashByNode.get(nodeId(declaration, sf)),
      });
    }
    return;
  }

  const name = (statement as { name?: ts.Node }).name;
  const named = name !== undefined && ts.isIdentifier(name) ? name : undefined;
  const exportedName = isDefault
    ? TS_DEFAULT_EXPORT_NAME
    : named?.text ?? '';
  if (exportedName === '') {
    return;
  }
  const id = nodeId(statement, sf);
  const isFunction = ts.isFunctionDeclaration(statement);
  emit({
    node: statement,
    exportedName,
    localName: named?.text ?? '',
    exportKind: kind,
    // `export interface` and `export type` have no runtime existence, so they
    // must create no call-graph edge even though they are exported.
    isTypeOnly: ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement),
    isDefault,
    sourceSpecifier: '',
    entityKind: entityKindOf(statement),
    entityHash: isFunction
      ? options.methodHashByNode.get(id)
      : options.typeHashByNode.get(id),
  });
}

function entityKindOf(statement: ts.Statement): TsExportedEntityKind {
  if (ts.isFunctionDeclaration(statement)) {
    return TsExportedEntityKind.METHOD;
  }
  if (ts.isEnumDeclaration(statement)) {
    return TsExportedEntityKind.ENUM;
  }
  if (ts.isModuleDeclaration(statement)) {
    return TsExportedEntityKind.NAMESPACE;
  }
  if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement)) {
    return TsExportedEntityKind.TYPE;
  }
  return TsExportedEntityKind.UNKNOWN;
}
