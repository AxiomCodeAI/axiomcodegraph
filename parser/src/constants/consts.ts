import * as path from 'path';

/**
 * Hash algorithm used for generating entity hashes
 */
export const HASH_ALGO = 'md5';

/**
 * Directories to exclude when scanning projects or source files
 */
export const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'target',
  'out',
  '__pycache__',
  '.pytest_cache',
  'venv',
  'env',
]);

/**
 * Analysis output configuration.
 *
 * Default location for extracted CSV facts when no explicit `outputDir`
 * (library `outputDir` / positional arg) is supplied. Anchored to the package
 * root — `<packageRoot>/analysis-results` — so it lives *outside* `src/` and is
 * independent of the current working directory. This file resolves to
 * `dist/constants/consts.js` (built) or `src/constants/consts.ts` (tsx), both
 * two levels below the package root.
 */
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
export const ANALYSIS_OUTPUT_DIR = path.join(PACKAGE_ROOT, 'analysis-results');
export const OUTPUT_TYPE_REGISTRY_CSV_FILENAME = 'all-types.csv';
export const OUTPUT_TYPE_PARAMETER_CSV_FILENAME = 'all-type-parameters.csv';
export const OUTPUT_TYPE_REFERENCE_CSV_FILENAME = 'all-type-references.csv';
export const OUTPUT_TYPE_ANNOTATION_CSV_FILENAME = 'all-annotations.csv';
export const OUTPUT_ANNOTATION_ARGUMENT_CSV_FILENAME = 'all-annotation-arguments.csv';
export const OUTPUT_METHOD_REGISTRY_CSV_FILENAME = 'all-methods.csv';
export const OUTPUT_METHOD_PARAMETER_CSV_FILENAME = 'all-method-parameters.csv';
export const OUTPUT_METHOD_TYPE_PARAMETER_CSV_FILENAME = 'all-method-type-parameters.csv';
export const OUTPUT_ENUM_CONSTANT_CSV_FILENAME = 'all-enum-constants.csv';
export const OUTPUT_ENUM_CONSTANT_ARGUMENT_CSV_FILENAME = 'all-enum-constant-arguments.csv';
export const OUTPUT_FIELD_REGISTRY_CSV_FILENAME = 'all-fields.csv';
export const OUTPUT_FIELD_POSITION_CSV_FILENAME = 'all-field-positions.csv';
export const OUTPUT_IMPORT_REGISTRY_CSV_FILENAME = 'all-imports.csv';
export const OUTPUT_EXPRESSION_REFERENCE_CSV_FILENAME = 'all-expressions.csv';
export const OUTPUT_LOCAL_VARIABLE_REGISTRY_CSV_FILENAME = 'all-local-variables.csv';
export const OUTPUT_BLOCK_REGISTRY_CSV_FILENAME = 'all-blocks.csv';
export const OUTPUT_COMMENT_REGISTRY_CSV_FILENAME = 'all-comments.csv';
export const OUTPUT_PROPERTY_KEY_CSV_FILENAME = 'all-property-keys.csv';
export const OUTPUT_PROPERTY_VALUE_SEGMENT_CSV_FILENAME = 'all-property-value-segments.csv';
export const OUTPUT_SKIPPED_JAVA_FILES_CSV_FILENAME = 'skipped-java-files.csv';
export const OUTPUT_SKIPPED_XML_FILES_CSV_FILENAME = 'skipped-xml-files.csv';
export const OUTPUT_SKIPPED_PROPERTIES_FILES_CSV_FILENAME = 'skipped-properties-files.csv';
export const OUTPUT_SERVICE_DESCRIPTOR_CSV_FILENAME = 'all-service-descriptors.csv';
export const OUTPUT_SERVICE_PROVIDER_CSV_FILENAME = 'all-service-providers.csv';
export const OUTPUT_SKIPPED_SERVICES_FILES_CSV_FILENAME = 'skipped-services-files.csv';
export const OUTPUT_SKIPPED_YAML_FILES_CSV_FILENAME = 'skipped-yaml-files.csv';
export const OUTPUT_SKIPPED_GRADLE_FILES_CSV_FILENAME = 'skipped-gradle-files.csv';
export const OUTPUT_XML_ELEMENT_CSV_FILENAME = 'all-xml-elements.csv';
export const OUTPUT_XML_ATTRIBUTE_CSV_FILENAME = 'all-xml-attributes.csv';
export const OUTPUT_XML_VALUE_REFERENCE_CSV_FILENAME = 'all-xml-value-references.csv';
export const OUTPUT_YAML_PROPERTY_CSV_FILENAME = 'all-yaml-properties.csv';
export const OUTPUT_YAML_VALUE_SEGMENT_CSV_FILENAME = 'all-yaml-value-segments.csv';
export const OUTPUT_GRADLE_BLOCK_CSV_FILENAME = 'all-gradle-blocks.csv';
export const OUTPUT_GRADLE_DECLARATION_CSV_FILENAME = 'all-gradle-declarations.csv';
export const OUTPUT_GRADLE_VALUE_REFERENCE_CSV_FILENAME = 'all-gradle-value-references.csv';
export const OUTPUT_GRADLE_SCRIPT_CSV_FILENAME = 'all-gradle-scripts.csv';
export const OUTPUT_GRADLE_DEPENDENCY_COORDINATE_CSV_FILENAME = 'all-gradle-dependency-coordinates.csv';
export const OUTPUT_GRADLE_CATALOG_ENTRY_CSV_FILENAME = 'all-gradle-catalog-entries.csv';
export const OUTPUT_GRADLE_COMMENT_CSV_FILENAME = 'all-gradle-comments.csv';
export const OUTPUT_GRADLE_PARSE_GAP_CSV_FILENAME = 'all-gradle-parse-gaps.csv';

/**
 * Java entity type identifiers used for extractor registration
 */
export const JAVA_ENTITY_TYPES = {
  TYPE_REGISTRY: 'TypeRegistry',
  METHOD_REGISTRY: 'MethodRegistry',
  FIELD_REGISTRY: 'FieldRegistry',
  TYPE_PARAMETER: 'TypeParameter',
  METHOD_TYPE_PARAMETER: 'MethodTypeParameter',
  METHOD_PARAMETER: 'MethodParameter',
  TYPE_REFERENCE: 'TypeReference',
  TYPE_ANNOTATION: 'TypeAnnotation',
  ANNOTATION_ARGUMENT: 'AnnotationArgument',
  IMPORT_REGISTRY: 'ImportRegistry',
} as const;

/**
 * Files exceeding this line count are skipped to avoid stack/memory exhaustion.
 */
export const LARGE_FILE_LINE_THRESHOLD = 55_000;

/**
 * File extension constants
 */
export const FILE_EXTENSIONS = {
  JAVA: '.java',
  PYTHON: '.py',
  PYTHON_STUB: '.pyi',
  TYPESCRIPT: '.ts',
  JAVASCRIPT: '.js',
  PROPERTIES: '.properties',
  XML: '.xml',
  YAML: '.yml',
  YAML_LONG: '.yaml',
  GRADLE: '.gradle',
  GRADLE_KTS: '.gradle.kts',
  KOTLIN_SCRIPT: '.kts',
  TOML: '.toml',
} as const;

/**
 * The conventional location of a Gradle version catalog. Gradle also accepts
 * catalogs declared explicitly in settings via
 * `versionCatalogs { create("libs") { from(files("...")) } }`; those are picked
 * up from the settings declaration rather than by path.
 */
export const GRADLE_DEFAULT_VERSION_CATALOG = 'gradle/libs.versions.toml';

/**
 * The directory pair that makes a file a `ServiceLoader` provider-configuration
 * file: a direct child of `services`, itself a direct child of `META-INF`.
 *
 * Matched case-SENSITIVELY, and the case is not a style choice. The JVM looks
 * up the resource path `META-INF/services/<binary-name>` literally, so a
 * directory named `meta-inf` is never read by `ServiceLoader` — treating it as
 * one would report an instantiation that cannot happen. Only direct children
 * count: the format has no notion of a nested provider-configuration file.
 */
export const META_INF_DIR = 'META-INF';
export const SERVICES_DIR = 'services';
