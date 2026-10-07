import { WEB_TEXT_LIMIT } from '@/constants/web-constants';
import { CssValueReferenceKind } from '@/enums/css/CssValueReferenceKind';
import { WebUrlKind } from '@/enums/web/WebUrlKind';

import { WebRow, bool, boundedText, num, text } from '../web/web-row';

/**
 * A name a value refers to: a custom property, a file, a keyframes animation, a layer,
 * a container, a font family.
 *
 * Owned by a declaration (`ownerDeclarationLinkHash`) or, for `@import` / `@layer` /
 * `@container` preludes, by the at-rule (`ownerRuleLinkHash`); exactly one is set.
 * `urlKind`, `resolvedFilePath` and `isResolved` are meaningful for URL and IMPORT
 * only and empty otherwise. No link to the declaration or rule the name reaches: that
 * depends on the cascade, and the engine decides it by joining on `name`.
 */
export class CssValueReference extends WebRow {
  static readonly COLUMNS = [
    'referenceKind', 'name', 'fallbackText', 'urlKind', 'resolvedFilePath', 'isResolved', 'position',
    'startLine', 'startColumn', 'ownerDeclarationLinkHash', 'ownerRuleLinkHash', 'stylesheetLinkHash',
    'serviceVersionLinkHash', 'cssValueReferenceUniqueHash',
  ] as const;

  readonly relation = 'css_value_reference';
  readonly columns = CssValueReference.COLUMNS;

  readonly referenceKind: CssValueReferenceKind;
  readonly name: string;
  readonly fallbackText: string;
  readonly urlKind: WebUrlKind | '';
  readonly resolvedFilePath: string;
  readonly isResolved: boolean;
  readonly position: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly ownerDeclarationLinkHash: string;
  readonly ownerRuleLinkHash: string;
  readonly stylesheetLinkHash: string;
  readonly serviceVersionLinkHash: string;

  constructor(props: {
    referenceKind: CssValueReferenceKind; name: string; fallbackText: string; urlKind: WebUrlKind | '';
    resolvedFilePath: string; isResolved: boolean; position: number; startLine: number; startColumn: number;
    ownerDeclarationLinkHash: string; ownerRuleLinkHash: string; stylesheetLinkHash: string;
    serviceVersionLinkHash: string;
  }) {
    super();
    this.referenceKind = props.referenceKind;
    this.name = props.name;
    this.fallbackText = props.fallbackText;
    this.urlKind = props.urlKind;
    this.resolvedFilePath = props.resolvedFilePath;
    this.isResolved = props.isResolved;
    this.position = props.position;
    this.startLine = props.startLine;
    this.startColumn = props.startColumn;
    this.ownerDeclarationLinkHash = props.ownerDeclarationLinkHash;
    this.ownerRuleLinkHash = props.ownerRuleLinkHash;
    this.stylesheetLinkHash = props.stylesheetLinkHash;
    this.serviceVersionLinkHash = props.serviceVersionLinkHash;
    this.generateHash();
  }

  /** **PK** `CSS_VALUE_REFERENCE_md5(ownerDeclarationLinkHash ‖ ownerRuleLinkHash ‖ position)`. */
  generateHash(): void {
    this.hash = WebRow.key('CSS_VALUE_REFERENCE', this.ownerDeclarationLinkHash, this.ownerRuleLinkHash, this.position);
  }

  protected values(): string[] {
    return [
      this.referenceKind, boundedText(this.name, WEB_TEXT_LIMIT), boundedText(this.fallbackText, WEB_TEXT_LIMIT),
      this.urlKind, text(this.resolvedFilePath), bool(this.isResolved), num(this.position), num(this.startLine),
      num(this.startColumn), this.ownerDeclarationLinkHash, this.ownerRuleLinkHash, this.stylesheetLinkHash,
      this.serviceVersionLinkHash, this.hash,
    ];
  }
}
