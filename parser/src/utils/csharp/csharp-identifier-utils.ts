/**
 * Identifier handling that follows the C# COMPILER rather than the source bytes.
 *
 * Same hazard as Python's NFKC normalisation, and the same consequence: two
 * spellings that are one name to the compiler are two strings to a parser that
 * keeps the raw text. That does not merely miss the link between a declaration
 * and its use — it INVENTS one, because the use looks like a reference to
 * something undeclared. A false edge is worse than a missing one, since a query
 * that follows it gets a confident wrong answer.
 *
 * C# has three ways to spell one identifier, and the grammar hands back all
 * three verbatim.
 */

/**
 * The C# spelling rules this normalises, from the language specification.
 *
 * 1. **`@` prefix — a verbatim identifier.** `@class` IS the identifier
 *    `class`, spelled so a keyword can be used as a name. `§6.4.3`: "the
 *    prefix `@` is not part of the identifier". Interop code and generated code
 *    are full of it, and `@this`, `@event`, `@operator` are ordinary parameter
 *    names in wrappers over other languages.
 *
 * 2. **Unicode escapes.** `Abc` IS `Abc`. `§6.4.2` allows
 *    `\uXXXX` and `\UXXXXXXXX` anywhere in an identifier, including the first
 *    character. Rare in hand-written code, present in generated code and in
 *    obfuscated code.
 *
 * 3. **Formatting characters are ignored.** A zero-width joiner inside an
 *    identifier is not part of it.
 *
 * NFC, not NFKC — and the difference is not pedantry. C# normalises identifiers
 * to Formatting Form C; Python uses NFKC. NFKC would fold `ﬁ` to `fi` and the
 * MICRO SIGN to GREEK SMALL LETTER MU, which is right for Python and **wrong
 * for C#**: those are distinct identifiers to Roslyn, and folding them would
 * merge two declarations the compiler keeps apart.
 */
export function normalizeCSharpIdentifier(rawName: string): string {
  if (rawName === '') {
    return rawName;
  }

  let name = rawName;

  // 1. The verbatim prefix is not part of the identifier.
  if (name.charCodeAt(0) === 0x40 /* @ */) {
    name = name.slice(1);
  }

  // 2. Unicode escapes. The scan is guarded because a backslash cannot appear
  //    in an identifier any other way, so the overwhelming majority of names
  //    skip the replace entirely.
  if (name.includes('\\')) {
    name = decodeUnicodeEscapes(name);
  }

  // 3. NFC, and only when there is something to normalise. `normalize` is
  //    called on every identifier in every file and is a no-op on ASCII, so the
  //    scan pays for itself many times over on the common case.
  for (let index = 0; index < name.length; index += 1) {
    if (name.charCodeAt(index) > 0x7f) {
      return stripFormattingCharacters(name.normalize('NFC'));
    }
  }
  return name;
}

/**
 * `\uXXXX` and `\UXXXXXXXX`, decoded.
 *
 * Malformed escapes are left ALONE rather than dropped. A parser that silently
 * deleted `\u00` from an identifier would produce a name that matches nothing
 * and looks deliberate; leaving it makes the oddity visible in the row.
 */
function decodeUnicodeEscapes(name: string): string {
  return name.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (whole, short, long) => {
    const hex = (short ?? long) as string | undefined;
    if (hex === undefined) {
      return whole;
    }
    const codePoint = Number.parseInt(hex, 16);
    // Above the Unicode maximum, or a lone surrogate: not a character, so the
    // escape is not one either.
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) {
      return whole;
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      return whole;
    }
    return String.fromCodePoint(codePoint);
  });
}

/** Cf-class characters, which C# permits in an identifier and ignores. */
const FORMATTING_CHARACTERS = /[­؀-؅؜۝܏᠎​-‏‪-‮⁠-⁤⁦-⁯﻿]/g;

function stripFormattingCharacters(name: string): string {
  return FORMATTING_CHARACTERS.test(name) ? name.replace(FORMATTING_CHARACTERS, '') : name;
}

/**
 * Whether a name was written with the verbatim `@` prefix.
 *
 * Worth keeping separately from the normalised form: `@class` tells a reader
 * that the name collides with a keyword, which is why generated code chose it,
 * and the normalised `class` alone would look like a parse error.
 */
export function isVerbatimIdentifier(rawName: string): boolean {
  return rawName.charCodeAt(0) === 0x40;
}

/**
 * The C# keywords a verbatim identifier exists to escape.
 *
 * Used only to explain a name, never to reject one: a parser that refused an
 * identifier because it looked like a keyword would be enforcing a rule the
 * grammar already enforced, and would be wrong for every contextual keyword.
 */
export const CSHARP_RESERVED_KEYWORDS: ReadonlySet<string> = new Set([
  'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch', 'char', 'checked',
  'class', 'const', 'continue', 'decimal', 'default', 'delegate', 'do', 'double', 'else',
  'enum', 'event', 'explicit', 'extern', 'false', 'finally', 'fixed', 'float', 'for',
  'foreach', 'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is', 'lock',
  'long', 'namespace', 'new', 'null', 'object', 'operator', 'out', 'override', 'params',
  'private', 'protected', 'public', 'readonly', 'ref', 'return', 'sbyte', 'sealed', 'short',
  'sizeof', 'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw', 'true',
  'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe', 'ushort', 'using', 'virtual',
  'void', 'volatile', 'while',
]);
