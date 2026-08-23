import * as path from 'path';

// src/constants/ → src/ → package root. At runtime we run from dist/, so resolve
// the package root and read the (always-present) src/templates from there.
export const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/** Import-rule templates — the relation→CSV import map, parsed by run-souffle.sh. */
export const TEMPLATES_DIR = path.join(PACKAGE_ROOT, 'src', 'templates');

/**
 * The shell executor that runs the Soufflé engine: it stages facts from the raw
 * client/library IR (parsing the .map import map), compiles the .dl program
 * to a native binary (cached by checksum), and solves. Self-contained — the sole
 * reasoning entry point.
 */
export const RUN_SOUFFLE_SH = path.join(PACKAGE_ROOT, 'src', 'pipeline', 'run-souffle.sh');

/** Marker that identifies a library IR module folder (and a client IR dir). */
export const IR_MARKER = 'all-types.csv';
