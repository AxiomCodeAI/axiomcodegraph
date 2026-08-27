import { ABSENT, bool, commaSet, joinHeader, joinRow, keyOf, num, text } from './ts-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  TsDeclarationSpace,
  TsTypeAccess,
  TsTypeCategory,
  TsTypeModifier,
  TsTypePlacement,
} from '@/enums/typescript/types';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * A type DECLARATION — schema §4.2, 33 columns.
 *
 * Class, interface, enum, type alias, namespace, or class expression. Columns
 * 0–11 mirror `java_type` 0–11 so `type_decl` / `type_lines` port as a rename.
 *
 * **Anonymous structural types are not here.** 21,956 function types and 5,015
 * type literals were measured in the ecosystem corpus; none has a name, a
 * declaration or a merge identity, and they live in the `ts_type_reference`
 * tree instead. Keeping this relation to declarations is what keeps it key-able
 * at all.
 *
 * ## One row per DECLARATION SITE, not per type
 *
 * This is the §3.1 decision and it is stated here because every consumer trips
 * on it: `name -> single entity` is false in TypeScript. 1,986 symbols in the
 * measured corpus have more than one declaration and one has 43, merging
 * crosses declaration kinds (class+interface, function+namespace) and crosses
 * files.
 *
 * So the primary key is the SITE — always unique, always parser-derivable, never
 * needing cross-file knowledge — and {@link declarationGroupKey} is the merged
 * entity's identity. That key is deliberately **not unique**: N declarations of
 * one type produce N rows carrying the same group key, and the engine forms the
 * merged type by grouping on it. A rule that assumes one row per name is wrong
 * by construction, not merely imprecise.
 *
 * There is deliberately no `isPrimaryDeclaration` and no `declarationIndex`:
 * choosing "the" declaration requires seeing all of them, which is cross-file,
 * which a single-file extraction may not do. A column here would be a lie.
 */
export class TsTypeRegistry implements EntityIdentifiable {
  static readonly ARITY = 33;

  readonly name: string;
  readonly qualifiedName: string;
  readonly fileName: string;
  readonly typeCategory: TsTypeCategory;
  readonly typeAccess: TsTypeAccess;
  readonly typeModifiers: ReadonlySet<TsTypeModifier>;
  readonly typePlacement: TsTypePlacement;
  readonly filePath: string;
  readonly baseMservPath: string;
  readonly startLine: number;
  readonly endLine: number;
  private readonly isExternal = false;

  readonly tsModuleLinkHash: string;
  readonly enclosingTypeLinkHash: string;
  readonly enclosingMethodLinkHash: string;
  readonly declarationGroupKey: string;
  readonly mergeScopeKey: string;
  readonly escapedName: string;
  readonly declarationSpaces: ReadonlySet<TsDeclarationSpace>;
  readonly isAmbientDeclaration: boolean;
  readonly isTypeOnly: boolean;
  readonly typeParameterCount: number;
  readonly heritageCount: number;

  /** Own declared members. Back-patched once members are extracted. */
  private memberCount = 0;
  private requiredMemberCount = 0;
  private shapeDigest = ABSENT;
  private aliasTargetReferenceLinkHash = ABSENT;

  readonly isExported: boolean;
  readonly hasIndexSignature: boolean;
  readonly startColumn: number;
  readonly endColumn: number;
  readonly serviceVersionLinkHash: string;
  private tsTypeUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    fileName: string;
    typeCategory: TsTypeCategory;
    typeAccess: TsTypeAccess;
    typeModifiers: ReadonlySet<TsTypeModifier>;
    typePlacement: TsTypePlacement;
    filePath: string;
    baseMservPath: string;
    startLine: number;
    endLine: number;
    tsModuleLinkHash: string;
    enclosingTypeLinkHash: string;
    enclosingMethodLinkHash: string;
    declarationGroupKey: string;
    mergeScopeKey: string;
    escapedName: string;
    declarationSpaces: ReadonlySet<TsDeclarationSpace>;
    isAmbientDeclaration: boolean;
    isTypeOnly: boolean;
    typeParameterCount: number;
    heritageCount: number;
    isExported: boolean;
    hasIndexSignature: boolean;
    startColumn: number;
    endColumn: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.fileName = props.fileName;
    this.typeCategory = props.typeCategory;
    this.typeAccess = props.typeAccess;
    this.typeModifiers = props.typeModifiers;
    this.typePlacement = props.typePlacement;
    this.filePath = props.filePath;
    this.baseMservPath = props.baseMservPath;
    this.startLine = props.startLine;
    this.endLine = props.endLine;
    this.tsModuleLinkHash = props.tsModuleLinkHash;
    this.enclosingTypeLinkHash = props.enclosingTypeLinkHash;
    this.enclosingMethodLinkHash = props.enclosingMethodLinkHash;
    this.declarationGroupKey = props.declarationGroupKey;
    this.mergeScopeKey = props.mergeScopeKey;
    this.escapedName = props.escapedName;
    this.declarationSpaces = props.declarationSpaces;
    this.isAmbientDeclaration = props.isAmbientDeclaration;
    this.isTypeOnly = props.isTypeOnly;
    this.typeParameterCount = props.typeParameterCount;
    this.heritageCount = props.heritageCount;
    this.isExported = props.isExported;
    this.hasIndexSignature = props.hasIndexSignature;
    this.startColumn = props.startColumn;
    this.endColumn = props.endColumn;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /**
   * **PK** `TS_TYPE_md5(tsModuleLinkHash ‖ escapedName ‖ mergeScopeKey ‖ startLine ‖ startColumn)`
   *
   * Chained off the module hash, never off a re-derived qualified name — and
   * here that is not a stylistic preference. Two declarations of one merged
   * interface share a qualified name BY DESIGN, so a qualified-name key would
   * collide on precisely the construct this relation exists to represent.
   *
   * `startColumn` is present because a namespace-merged declaration and a class
   * expression can share a line.
   */
  generateHash(): void {
    this.tsTypeUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.TS_TYPE,
      keyOf(
        this.tsModuleLinkHash,
        this.escapedName,
        this.mergeScopeKey,
        this.startLine,
        this.startColumn
      )
    );
  }

  getHash(): string {
    return this.tsTypeUniqueHash;
  }

  /**
   * Records the member shape once members are known.
   *
   * `requiredMemberCount` is separate from `memberCount` because an absent
   * optional member does not break assignability, so it is the number
   * structural-satisfaction pruning actually uses (§3.2).
   *
   * `shapeDigest` is **tier 3**: a pruning aid with no semantic claim. Equal
   * digests make two types candidates for satisfaction; they are never a
   * satisfaction fact. `ts_type_satisfies` is the engine's, adjudicated by the
   * oracle's `isTypeAssignableTo`, and the parser must not pretend otherwise.
   */
  setShape(memberCount: number, requiredMemberCount: number, shapeDigest: string): void {
    this.memberCount = memberCount;
    this.requiredMemberCount = requiredMemberCount;
    this.shapeDigest = shapeDigest;
  }

  setAliasTargetReferenceLinkHash(hash: string): void {
    this.aliasTargetReferenceLinkHash = hash;
  }

  getEntryCombined(): string {
    return `ts_type[name=${this.name}, category=${this.typeCategory}, group=${this.declarationGroupKey}, hash=${this.tsTypeUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        text(this.fileName),
        this.typeCategory,
        this.typeAccess,
        commaSet(this.typeModifiers),
        this.typePlacement,
        text(this.filePath),
        text(this.baseMservPath),
        num(this.startLine),
        num(this.endLine),
        bool(this.isExternal),
        this.tsModuleLinkHash,
        this.enclosingTypeLinkHash,
        this.enclosingMethodLinkHash,
        this.declarationGroupKey,
        text(this.mergeScopeKey),
        text(this.escapedName),
        commaSet(this.declarationSpaces),
        bool(this.isAmbientDeclaration),
        bool(this.isTypeOnly),
        num(this.typeParameterCount),
        num(this.heritageCount),
        num(this.memberCount),
        num(this.requiredMemberCount),
        this.shapeDigest,
        this.aliasTargetReferenceLinkHash,
        bool(this.isExported),
        bool(this.hasIndexSignature),
        num(this.startColumn),
        num(this.endColumn),
        this.serviceVersionLinkHash,
        this.tsTypeUniqueHash,
      ],
      TsTypeRegistry.ARITY,
      'ts_type'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name', 'qualifiedName', 'fileName', 'typeCategory', 'typeAccess', 'typeModifier',
        'typePlacement', 'filePath', 'baseMservPath', 'startLine', 'endLine', 'isExternal',
        'tsModuleLinkHash', 'enclosingTypeLinkHash', 'enclosingMethodLinkHash',
        'declarationGroupKey', 'mergeScopeKey', 'escapedName', 'declarationSpaces',
        'isAmbientDeclaration', 'isTypeOnly', 'typeParameterCount', 'heritageCount',
        'memberCount', 'requiredMemberCount', 'shapeDigest', 'aliasTargetReferenceLinkHash',
        'isExported', 'hasIndexSignature', 'startColumn', 'endColumn',
        'serviceVersionLinkHash', 'tsTypeUniqueHash',
      ],
      TsTypeRegistry.ARITY,
      'ts_type'
    );
  }
}
