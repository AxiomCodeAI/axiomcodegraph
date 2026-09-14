import { EntityIdentifiable } from '@/interfaces/EntityIdentifiable';

/**
 * Base interface for all extractors that parse source code and extract entities
 */
export interface BaseExtractor<T extends EntityIdentifiable> {
  /**
   * Extracts dedicated entities from a source file
   * @param filePath Path to the source file
   * @param fileContent Content of the source file
   * @param serviceVersionHash Hash identifying the service version
   * @returns Array of extracted entities
   */
  extract(filePath: string, fileContent: string, serviceVersionHash: string): T[];
}
