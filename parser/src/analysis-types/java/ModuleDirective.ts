import { ENTITY_IDENTIFIERS } from '@/constants/entity-constants';
import { ModuleDirectiveKind, ModuleDirectiveModifier } from '@/enums/java/modules';
import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { EntityUtils } from '@/utils/entity-utils';

/**
 * One directive inside a module declaration (JLS 7.7.1 - 7.7.4).
 *
 * A directive that names several targets becomes several rows, one per target, differing only in
 * `targetName` and `position`. `exports com.example.internal to a, b` is two rows; a plain
 * `exports com.example.api` is one row with an empty `targetName`. Keeping the list flat means a
 * consumer joins on a column instead of splitting a delimited string, and an unqualified export
 * is distinguishable from a qualified one by `targetName` being empty rather than by parsing.
 *
 * See {@link ModuleDirectiveKind} for what subject and target mean per kind.
 */
export class ModuleDirective implements EntityIdentifiable {
  private readonly moduleRegistryLinkHash: string;
  private readonly directiveKind: ModuleDirectiveKind;
  private readonly subjectName: string;
  private readonly targetName: string;
  private readonly modifiers: ModuleDirectiveModifier[];
  private readonly position: number;
  private readonly filePath: string;
  private readonly startLine: number;
  private readonly endLine: number;
  private readonly serviceVersionLinkHash: string;
  private moduleDirectiveUniqueHash = '';

  constructor(
    moduleRegistryLinkHash: string,
    directiveKind: ModuleDirectiveKind,
    subjectName: string,
    targetName: string,
    modifiers: ModuleDirectiveModifier[],
    position: number,
    filePath: string,
    startLine: number,
    endLine: number,
    serviceVersionLinkHash: string
  ) {
    if (!moduleRegistryLinkHash || moduleRegistryLinkHash.trim().length === 0) {
      throw new Error('moduleRegistryLinkHash is required');
    }
    if (!directiveKind) {
      throw new Error('directiveKind is required');
    }
    if (!subjectName || subjectName.trim().length === 0) {
      throw new Error('subjectName is required');
    }
    if (position < 0) {
      throw new Error('position must be >= 0');
    }

    this.moduleRegistryLinkHash = moduleRegistryLinkHash;
    this.directiveKind = directiveKind;
    this.subjectName = subjectName;
    this.targetName = targetName;
    this.modifiers = modifiers;
    this.position = position;
    this.filePath = filePath;
    this.startLine = startLine;
    this.endLine = endLine;
    this.serviceVersionLinkHash = serviceVersionLinkHash;

    this.generateHash();
  }

  getModuleRegistryLinkHash(): string {
    return this.moduleRegistryLinkHash;
  }

  getDirectiveKind(): ModuleDirectiveKind {
    return this.directiveKind;
  }

  getSubjectName(): string {
    return this.subjectName;
  }

  getTargetName(): string {
    return this.targetName;
  }

  getModifiers(): ModuleDirectiveModifier[] {
    return this.modifiers;
  }

  getPosition(): number {
    return this.position;
  }

  getStartLine(): number {
    return this.startLine;
  }

  getHash(): string {
    return this.moduleDirectiveUniqueHash;
  }

  generateHash(): void {
    const content =
      this.filePath +
      '||' +
      this.moduleRegistryLinkHash +
      '||' +
      this.directiveKind +
      '||' +
      this.subjectName +
      '||' +
      this.targetName +
      '||' +
      this.position +
      '||' +
      this.startLine;

    this.moduleDirectiveUniqueHash = EntityUtils.generateEntityHash(
      ENTITY_IDENTIFIERS.MODULE_DIRECTIVE,
      content
    );
  }

  getEntryCombined(): string {
    return `java_module_directive[kind=${this.directiveKind}, subject=${this.subjectName}, target=${this.targetName}, modifiers=${this.modifiers.join(',')}, position=${this.position}, line=${this.startLine}, hash=${this.moduleDirectiveUniqueHash}]`;
  }

  toCsv(): string {
    return [
      this.directiveKind,
      this.subjectName,
      this.targetName,
      this.modifiers.join(','),
      this.position.toString(),
      this.filePath,
      this.startLine.toString(),
      this.endLine.toString(),
      this.moduleRegistryLinkHash,
      this.serviceVersionLinkHash,
      this.moduleDirectiveUniqueHash,
    ].join('\t');
  }

  getCsvHeader(): string {
    return [
      'directiveKind',
      'subjectName',
      'targetName',
      'modifiers',
      'position',
      'filePath',
      'startLine',
      'endLine',
      'moduleRegistryLinkHash',
      'serviceVersionLinkHash',
      'moduleDirectiveUniqueHash',
    ].join('\t');
  }
}
