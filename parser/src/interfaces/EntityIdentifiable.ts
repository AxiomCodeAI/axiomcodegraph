/**
 * Interface for entities that can be uniquely identified and exported
 */
export interface EntityIdentifiable {
  /**
   * Returns the unique hash identifier for this entity
   * @return Hash value using a hash algorithm defined in the constants
   */
  getHash(): string;

  /**
   * Generates and sets the hash for this entity
   */
  generateHash(): void;

  /**
   * Combines the entries
   * @return The combination of unique entry identifiers except the hash
   */
  getEntryCombined(): string;

  /**
   * Converts the entity to CSV format (tab-separated values)
   * @return Tab-separated string representation of the entity
   */
  toCsv(): string;

  /**
   * Returns the CSV header row for this entity type
   * @return Tab-separated header string with column names
   */
  getCsvHeader(): string;
}
