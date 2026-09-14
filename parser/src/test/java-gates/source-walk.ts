/**
 * A JAVA PACKAGE IS NOT A TEST DIRECTORY.
 *
 * The source walk prunes a directory whose NAME looks like a test folder. That is a name test
 * applied at every depth, so it also matches package segments — and two of the patterns it used to
 * carry are real, widely-shipped Java packages:
 *
 *   `spec` — `java.security.spec`, `javax.crypto.spec`, `javax.xml.crypto.dsig.spec`;
 *            73 platform source files, dropped silently, with the run reporting no skipped files.
 *   `it`   — the top-level package of every Italian open-source library (`it.unimi.dsi.fastutil`).
 *
 * This gate pins both directions: the names that must survive, and the ones that must still be
 * pruned. A pattern added later that matches a legal Java package fails here.
 */
import { isJavaTestDir } from '@/constants/consts';

/** Segments that ARE Java packages somewhere real, and must never be pruned. */
const MUST_SURVIVE = [
  'spec',      // java.security.spec, javax.crypto.spec
  'it',        // it.unimi.dsi.fastutil
  'util',
  'internal',
  'impl',
  'nio',
  'api',
  'core',
  'testing',   // com.google.common.testing — a shipped package, not a test folder
];

/** Folder names the exclusion was asked for, which must still be pruned. */
const MUST_PRUNE = ['test', 'tests', 'Test', 'TESTS', '__tests__', 'test-utils', 'integration-test', 'integration-tests', 'e2e'];

export function sourceWalkPackages(): string[] {
  const errors: string[] = [];
  for (const name of MUST_SURVIVE) {
    if (isJavaTestDir(name)) errors.push(`"${name}" is a real Java package segment and must not be pruned as a test directory`);
  }
  for (const name of MUST_PRUNE) {
    if (!isJavaTestDir(name)) errors.push(`"${name}" is a test directory and must still be pruned`);
  }
  return errors;
}
