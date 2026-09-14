/**
 * Identifier handling that follows CPython rather than the source bytes.
 */

/**
 * Normalises an identifier the way CPython's tokeniser does.
 *
 * The language reference is explicit: "All identifiers are converted into the
 * normal form NFKC while parsing." Two identifiers that look different in the
 * file can therefore be the SAME NAME to the interpreter --
 * `\u{1D518}\u{1D52B}\u{1D526}\u{1D520}\u{1D52C}\u{1D521}\u{1D522}` is `Unicode`,
 * and the MICRO SIGN U+00B5 is GREEK SMALL LETTER MU U+03BC.
 *
 * Keeping the raw text does not merely miss the link between a definition and
 * its use. It INVENTS one: `Unicode = 1` followed by a reference spelled in
 * mathematical script produced a local binding plus a spurious GLOBAL_IMPLICIT
 * for a global that does not exist, where symtable has a single local. A false
 * edge is worse than a missing one, because a data-flow query that follows it
 * gets a confident wrong answer.
 *
 * The ASCII fast path is not just an optimisation. `String.prototype.normalize`
 * is called on every identifier in every file, and NFKC is a no-op on ASCII, so
 * the scan pays for itself many times over on the overwhelmingly common case.
 */
export function normalizePythonIdentifier(rawName: string): string {
  for (let index = 0; index < rawName.length; index += 1) {
    if (rawName.charCodeAt(index) > 0x7f) {
      return rawName.normalize('NFKC');
    }
  }
  return rawName;
}
