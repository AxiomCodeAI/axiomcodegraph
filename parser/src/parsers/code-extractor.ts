import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';
import { BaseExtractor } from '@/parsers/base-extractor';
import { ParserFactory } from '@/parsers/parser-factory';
import { ProjectLanguage } from '@/types/ProjectInfo';

/**
 * Generic code extractor that delegates to language-specific extractors
 * Coordinates parsing and extraction across different programming languages
 */
export class CodeExtractor {
  private parserFactory: ParserFactory;
  private extractorRegistry: Map<ProjectLanguage, Map<string, BaseExtractor<any>>>;

  constructor(parserFactory?: ParserFactory) {
    this.parserFactory = parserFactory || new ParserFactory();
    this.extractorRegistry = new Map();
  }

  /**
   * Registers an extractor for a specific language and entity type
   * @param language Programming language
   * @param entityType Type of entity (e.g., 'TypeRegistry', 'Method')
   * @param extractor Extractor implementation
   */
  registerExtractor<T extends EntityIdentifiable>(
    language: ProjectLanguage,
    entityType: string,
    extractor: BaseExtractor<T>
  ): void {
    if (!this.extractorRegistry.has(language)) {
      this.extractorRegistry.set(language, new Map());
    }
    this.extractorRegistry.get(language)!.set(entityType, extractor);
  }

  /**
   * Extracts entities from a source file
   * @param language Programming language of the source file
   * @param entityType Type of entity to extract
   * @param filePath Path to the source file
   * @param fileContent Content of the source file
   * @param serviceVersionHash Service version hash
   * @returns Array of extracted entities
   */
  extract<T extends EntityIdentifiable>(
    language: ProjectLanguage,
    entityType: string,
    filePath: string,
    fileContent: string,
    serviceVersionHash: string
  ): T[] {
    const languageExtractors = this.extractorRegistry.get(language);
    if (!languageExtractors) {
      console.warn(`No extractors registered for language: ${language}`);
      return [];
    }

    const extractor = languageExtractors.get(entityType);
    if (!extractor) {
      console.warn(`No extractor registered for ${entityType} in ${language}`);
      return [];
    }

    try {
      return extractor.extract(filePath, fileContent, serviceVersionHash);
    } catch (error) {
      console.error(`Error extracting ${entityType} from ${filePath}:`, error);
      return [];
    }
  }

  /**
   * Gets the extractor for a specific language and entity type
   * @param language Programming language
   * @param entityType Type of entity to extract
   * @returns The extractor instance or undefined
   */
  getExtractor<T extends EntityIdentifiable>(
    language: ProjectLanguage,
    entityType: string
  ): BaseExtractor<T> | undefined {
    const languageExtractors = this.extractorRegistry.get(language);
    if (!languageExtractors) {
      return undefined;
    }
    return languageExtractors.get(entityType);
  }

  /**
   * Extracts entities from multiple files
   * @param language Programming language
   * @param entityType Type of entity to extract
   * @param files Array of file paths and contents
   * @param serviceVersionHash Service version hash
   * @returns Array of all extracted entities
   */
  extractFromFiles<T extends EntityIdentifiable>(
    language: ProjectLanguage,
    entityType: string,
    files: { path: string; content: string }[],
    serviceVersionHash: string
  ): T[] {
    const allEntities: T[] = [];

    for (const file of files) {
      const entities = this.extract<T>(
        language,
        entityType,
        file.path,
        file.content,
        serviceVersionHash
      );
      allEntities.push(...entities);
    }

    return allEntities;
  }

  /**
   * Gets the parser for a specific language
   * @param language Programming language
   * @returns Language parser or undefined
   */
  getParser(language: ProjectLanguage) {
    return this.parserFactory.getParser(language);
  }

  /**
   * Checks if extraction is supported for a language and entity type
   * @param language Programming language
   * @param entityType Type of entity
   * @returns True if supported
   */
  isSupported(language: ProjectLanguage, entityType: string): boolean {
    const languageExtractors = this.extractorRegistry.get(language);
    return languageExtractors?.has(entityType) ?? false;
  }

  /**
   * Gets all registered entity types for a language
   * @param language Programming language
   * @returns Array of entity type names
   */
  getRegisteredEntityTypes(language: ProjectLanguage): string[] {
    const languageExtractors = this.extractorRegistry.get(language);
    return languageExtractors ? Array.from(languageExtractors.keys()) : [];
  }
}
