/**
 * `ref partial struct` — a modifier ORDER the published grammar cannot read.
 *
 * C# lets a declaration's modifiers appear in any order. The grammar does not:
 * it accepts `ref` only as the LAST modifier before the type keyword, so
 *
 *     public ref partial struct FileSystemEntry      ERROR, type lost
 *     public partial ref struct FileSystemEntry      parses
 *     public unsafe ref partial struct X             ERROR, type lost
 *     public unsafe partial ref struct X             parses
 *     public readonly ref partial struct Y           ERROR, type lost
 *     public readonly partial ref struct Y           parses
 *
 * and the loss is the WHOLE TYPE, with every member in it — the declaration
 * never forms, so there is nothing for the members to hang off. 30 types across
 * two codebases (framework-bcl 28, source-generator-A 2), all of them low-level library code
 * where `ref struct` lives.
 *
 * ## This rewrite is invisible, and that is checkable
 *
 * It ROTATES the modifier list: `ref` moves to just before the keyword and the
 * modifiers it jumped over move left by exactly as many characters. Both
 * separators are kept, so the text is the same LENGTH, and the same TOKENS in a
 * different order — which C# says is the same declaration.
 *
 * Nothing in the fact base records modifier ORDER: `readModifiers` collects
 * them into a SET, and the declaration's own span starts at the first modifier,
 * which the rotation does not move. So unlike the semicolon-body rewrite, which
 * adds a character and argues that the character is unobservable, this one
 * changes no position at all.
 *
 * The rewrite is confined to a TYPE HEADER — `ref` followed by modifiers
 * followed by `struct`, `class` or `interface` — so it cannot touch a `ref`
 * return, a `ref` parameter, a `ref` local or a `ref` field, none of which can
 * be followed by a modifier and a type keyword.
 */

/**
 * Modifiers that may precede the type keyword, and which `ref` must move past.
 *
 * An ALLOWLIST, not `\w+`: the pattern has to end at the type keyword, and a
 * bare word match would let a `ref` return type followed by an identifier
 * masquerade as a header — `ref SomeType Method()` is not a declaration this
 * rewrite has any business in.
 */
const TYPE_MODIFIERS = 'partial|readonly|unsafe|new|static|abstract|sealed|public|internal|private|protected|file';

const REF_BEFORE_MODIFIERS = new RegExp(
  `\\bref(\\s+)((?:${TYPE_MODIFIERS})(?:\\s+(?:${TYPE_MODIFIERS}))*)(\\s+)(struct|class|interface)\\b`,
  'g'
);

/**
 * Moves `ref` to the last modifier position in every type header that needs it.
 *
 * The count is returned so a gate can assert the pass is still doing something:
 * when the grammar accepts the order, the count is unchanged and the torture
 * fixture is what reports that the limitation lifted.
 */
export function reorderRefStructModifiers(text: string): {
  readonly text: string;
  readonly count: number;
} {
  let count = 0;
  const rewritten = text.replace(
    REF_BEFORE_MODIFIERS,
    (_match, firstSeparator: string, modifiers: string, lastSeparator: string, keyword: string) => {
      count += 1;
      // MODIFIERS, then the first separator, then `ref`, then the second: the
      // two separators stay where they are in the string, so the length is
      // identical to the character.
      return `${modifiers}${firstSeparator}ref${lastSeparator}${keyword}`;
    }
  );
  return { text: rewritten, count };
}
