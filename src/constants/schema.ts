/**
 * Column counts for every parser IR entity CSV (tab-separated). Single source of
 * truth for building `format=(string, …)` specs in the import templates. All
 * columns are imported as strings (string matching / CONCAT downstream), so only
 * the arity matters here.
 *
 * Counts mirror the parser's output.
 */
export const ENTITY_COLUMNS: Record<string, number> = {
  'all-types.csv': 14,
  'all-type-references.csv': 18,
  'all-type-parameters.csv': 8,
  'all-methods.csv': 22,
  'all-method-parameters.csv': 13,
  'all-method-type-parameters.csv': 10,
  'all-fields.csv': 14,
  'all-field-positions.csv': 3,
  'all-expressions.csv': 25,
  'all-local-variables.csv': 19,
  'all-blocks.csv': 18,
  'all-imports.csv': 11,
  'all-annotations.csv': 13,
  'all-annotation-arguments.csv': 11,
  'all-comments.csv': 10,
  'all-enum-constants.csv': 13,
  'all-property-keys.csv': 14,
  'all-property-value-segments.csv': 12,
  'all-xml-elements.csv': 15,
  'all-xml-attributes.csv': 10,
  'all-xml-value-references.csv': 13,
  'all-yaml-properties.csv': 16,
  'all-yaml-value-segments.csv': 12,
};

/** `format=(string, string, …)` for `n` string columns. */
export function stringFormat(n: number): string {
  return `format=(${Array(n).fill('string').join(', ')})`;
}

/**
 * Required IR blocks — the minimum entities the Java reasoning needs to do
 * anything. If a path is missing these it isn't valid Java IR, so the phase
 * fails fast with a clear message rather than producing empty/garbage output.
 */
// Required IR blocks differ by side:
//   - CLIENT: all-imports is NOT required — a file can have only a package
//     declaration and no imports, so the client may legitimately have none.
//     (Absent optional entities are handled via an empty placeholder at render
//     time, so client_import stays safe when missing.)
//   - JDK: all-imports IS required — the JDK's own imports are needed to resolve
//     its cross-module references during reasoning.
const COMMON_REQUIRED = [
  'all-types.csv',
  'all-methods.csv',
  'all-method-parameters.csv',
  'all-expressions.csv',
] as const;

export const CLIENT_REQUIRED_ENTITIES = COMMON_REQUIRED;
export const JDK_REQUIRED_ENTITIES = [...COMMON_REQUIRED, 'all-imports.csv'] as const;
