import * as path from 'path';

// graph/constants/ → graph/ → package root. At runtime we run from dist/, so resolve
// the package root and read the (always-present) graph/<lang>/templates from there.
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Import-rule templates — the relation→CSV import map, parsed by run-souffle.sh.
 * Per-language: the rule sets live under graph/<lang>/, so the maps do too.
 */
export const templatesDir = (language = 'java'): string =>
  path.join(PACKAGE_ROOT, 'graph', language, 'templates');

/** Java's import maps — the default rule set. */
export const TEMPLATES_DIR = templatesDir('java');

/**
 * The shell executor that runs the Soufflé engine: it stages facts from the raw
 * client/library IR (parsing the .map import map), compiles the .dl program
 * to a native binary (cached by checksum), and solves. Self-contained — the sole
 * reasoning entry point.
 */
export const RUN_SOUFFLE_SH = path.join(PACKAGE_ROOT, 'graph', 'pipeline', 'run-souffle.sh');

/** Marker that identifies a library IR module folder (and a client IR dir). */
export const IR_MARKER = 'all-types.csv';

/**
 * Per-language IR marker. PYTHON'S MARKER IS `-modules`, NOT `-types`: a package
 * of plain functions has no class at all, so a types-based marker skips whole
 * library shards and silently stages nothing. This mirrors `IR_MARKER` in each
 * language's `templates/staging.conf`, and the two must agree.
 */
export const IR_MARKER_BY_LANGUAGE: Record<string, string> = {
  java: 'all-types.csv',
  python: 'all-python-modules.csv',
  typescript: 'all-typescript-modules.csv',
};
