import { ABSENT, bool, joinHeader, joinRow, keyOf, num, text } from './js-row';

import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import {
  JsBindingRegime,
  JsInitializerKind,
  JsVariableBindingForm,
} from '@/enums/javascript/variables';
import { JsDeclaredTypeSource } from '@/enums/javascript/common';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * Every binding that is not a parameter or a member — schema §3.7, 25 columns.
 *
 * ## Columns 3 and 4 are the whole hoisting model, and they are why this is not
 * `ts_variable` renamed
 *
 * - **`declarationScopeLinkHash`** — where the name is **visible from**.
 * - **`syntacticScopeLinkHash`** — where the declaration is **written**.
 *
 * For `let` and `const` they are equal. For the 3,705 measured `var` bindings
 * they differ whenever the declaration sits inside a block, and **that
 * difference is hoisting**. It is not recoverable from anything else in the fact
 * base: an engine would have to re-implement JavaScript's scoping rules to
 * derive one from the other. Emitting one column and calling it "scope" is §3's
 * defect class — the parts present, the structure absent.
 *
 * Gate 7.3.3 asserts every `VAR_*` binding's declaration scope has
 * `isFunctionScope = true`, so the model is checked rather than assumed and
 * fails loudly if the binder ever regresses to one column.
 *
 * ## `initializerKind = REQUIRE_CALL` is the single largest resolution lever
 *
 * `const x = require('y'); x.foo()` is **34.4% of all oracle declines** —
 * 15,759 sites, the biggest cause by a wide margin. The call is unresolvable to
 * the checker because `x` has no declared type, and perfectly *reconstructable*
 * by an engine: this column plus `importLinkHash` says the name is a module
 * alias, and the import row carries `resolvedFilePath`.
 */
export class JsVariableRegistry implements EntityIdentifiable {
  static readonly ARITY = 25;

  readonly name: string;
  readonly qualifiedName: string;
  readonly bindingRegime: JsBindingRegime;
  /** Where the name is **visible from** — the function scope for a `var`, the block for a `let`. */
  readonly declarationScopeLinkHash: string;
  /** Where the declaration is **written**. Differs from the above for every `var` in a block; that difference IS hoisting. */
  readonly syntacticScopeLinkHash: string;
  readonly hasTemporalDeadZone: boolean;
  readonly bindingForm: JsVariableBindingForm;
  /** For names bound by one destructuring, the root that binds them together. */
  private patternRootVariableLinkHash = ABSENT;
  readonly declaredTypeName: string;
  readonly declaredTypeSource: JsDeclaredTypeSource;
  private typeReferenceLinkHash = ABSENT;
  readonly hasInitializer: boolean;
  private initializerExpressionLinkHash = ABSENT;
  readonly initializerKind: JsInitializerKind;
  private importLinkHash = ABSENT;
  private isReassigned = false;
  readonly ownerMethodLinkHash: string;
  readonly ownerModuleLinkHash: string;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  private isExported = false;

  /** Parity slot, always `false` on parser output. */
  private readonly isExternal = false;
  readonly serviceVersionLinkHash: string;
  private jsVariableUniqueHash = ABSENT;

  constructor(props: {
    name: string;
    qualifiedName: string;
    bindingRegime: JsBindingRegime;
    declarationScopeLinkHash: string;
    syntacticScopeLinkHash: string;
    hasTemporalDeadZone: boolean;
    bindingForm: JsVariableBindingForm;
    declaredTypeName: string;
    declaredTypeSource: JsDeclaredTypeSource;
    hasInitializer: boolean;
    initializerKind: JsInitializerKind;
    ownerMethodLinkHash: string;
    ownerModuleLinkHash: string;
    startLine: number;
    startColumn: number;
    endLine: number;
    serviceVersionLinkHash: string;
  }) {
    this.name = props.name;
    this.qualifiedName = props.qualifiedName;
    this.bindingRegime = props.bindingRegime;
    this.declarationScopeLinkHash = props.declarationScopeLinkHash;
    this.syntacticScopeLinkHash = props.syntacticScopeLinkHash;
    this.hasTemporalDeadZone = props.hasTemporalDeadZone;
    this.bindingForm = props.bindingForm;
    this.declaredTypeName = props.declaredTypeName;
    this.declaredTypeSource = props.declaredTypeSource;
    this.hasInitializer = props.hasInitializer;
    this.initializerKind = props.initializerKind;
    this.ownerMethodLinkHash = props.ownerMethodLinkHash;
    this.ownerModuleLinkHash = props.ownerModuleLinkHash;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.endLine = props.endLine;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  generateHash(): void {
    this.jsVariableUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.JS_VARIABLE,
      keyOf(this.ownerModuleLinkHash, this.declarationScopeLinkHash, this.name, this.startLine, this.startColumn)
    );
  }

  getHash(): string {
    return this.jsVariableUniqueHash;
  }

  setPatternRootVariableLinkHash(hash: string): void {
    this.patternRootVariableLinkHash = hash;
  }
  /** The link as currently set, so a later reference does not displace the declaration's. */
  typeReferenceLinkHashValue(): string {
    return this.typeReferenceLinkHash === ABSENT ? '' : this.typeReferenceLinkHash;
  }

  setTypeReferenceLinkHash(hash: string): void {
    this.typeReferenceLinkHash = hash;
  }
  setInitializerExpressionLinkHash(hash: string): void {
    this.initializerExpressionLinkHash = hash;
  }
  setImportLinkHash(hash: string): void {
    this.importLinkHash = hash;
  }
  /** Read by the IR-completeness measure, which asks whether the hop is present. */
  importLinkHashValue(): string {
    return this.importLinkHash;
  }
  setIsReassigned(value = true): void {
    this.isReassigned = value;
  }
  setIsExported(value = true): void {
    this.isExported = value;
  }

  getEntryCombined(): string {
    return `js_variable[hash=${this.jsVariableUniqueHash}]`;
  }

  toCsv(): string {
    return joinRow(
      [
        text(this.name),
        text(this.qualifiedName),
        this.bindingRegime,
        this.declarationScopeLinkHash,
        this.syntacticScopeLinkHash,
        bool(this.hasTemporalDeadZone),
        this.bindingForm,
        this.patternRootVariableLinkHash,
        text(this.declaredTypeName),
        this.declaredTypeSource,
        this.typeReferenceLinkHash,
        bool(this.hasInitializer),
        this.initializerExpressionLinkHash,
        this.initializerKind,
        this.importLinkHash,
        bool(this.isReassigned),
        this.ownerMethodLinkHash,
        this.ownerModuleLinkHash,
        num(this.startLine),
        num(this.startColumn),
        num(this.endLine),
        bool(this.isExported),
        bool(this.isExternal),
        this.serviceVersionLinkHash,
        this.jsVariableUniqueHash,
      ],
      JsVariableRegistry.ARITY,
      'js_variable'
    );
  }

  getCsvHeader(): string {
    return joinHeader(
      [
        'name',
        'qualifiedName',
        'bindingRegime',
        'declarationScopeLinkHash',
        'syntacticScopeLinkHash',
        'hasTemporalDeadZone',
        'bindingForm',
        'patternRootVariableLinkHash',
        'declaredTypeName',
        'declaredTypeSource',
        'typeReferenceLinkHash',
        'hasInitializer',
        'initializerExpressionLinkHash',
        'initializerKind',
        'importLinkHash',
        'isReassigned',
        'ownerMethodLinkHash',
        'ownerModuleLinkHash',
        'startLine',
        'startColumn',
        'endLine',
        'isExported',
        'isExternal',
        'serviceVersionLinkHash',
        'jsVariableUniqueHash',
      ],
      JsVariableRegistry.ARITY,
      'js_variable'
    );
  }
}
