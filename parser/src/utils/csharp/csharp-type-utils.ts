/**
 * C# type-name knowledge, in one place.
 *
 * These are language facts rather than walk mechanics, and three extractors had
 * grown their own copy of the first two. A second copy of a rule is a second
 * place for it to be wrong, and the copies had already diverged once — the
 * heritage extractor read generic arity off the last segment of a qualified
 * name and the member extractor did not.
 */

/**
 * The predefined type keywords, and the framework types they ALIAS.
 *
 * `int` and `System.Int32` are **the same type**, not two types with a
 * conversion between them. The keyword is a synonym the compiler resolves at
 * parse time, and an engine that treats them as distinct will fail to link a
 * field declared `int` to a method that takes `System.Int32` — which is most of
 * the BCL's own signatures, since the framework is written in the long form.
 *
 * `string` and `object` are the two that catch people: they are reference types
 * whose keyword spelling looks primitive.
 */
export const CSHARP_PREDEFINED_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['bool', 'System.Boolean'],
  ['byte', 'System.Byte'],
  ['sbyte', 'System.SByte'],
  ['char', 'System.Char'],
  ['decimal', 'System.Decimal'],
  ['double', 'System.Double'],
  ['float', 'System.Single'],
  ['int', 'System.Int32'],
  ['uint', 'System.UInt32'],
  ['long', 'System.Int64'],
  ['ulong', 'System.UInt64'],
  ['short', 'System.Int16'],
  ['ushort', 'System.UInt16'],
  ['object', 'System.Object'],
  ['string', 'System.String'],
  ['nint', 'System.IntPtr'],
  ['nuint', 'System.UIntPtr'],
  ['void', 'System.Void'],
  ['dynamic', 'System.Object'],
]);

/** Whether a name is a predefined type keyword. */
export function isPredefinedType(typeName: string): boolean {
  return CSHARP_PREDEFINED_TYPE_ALIASES.has(typeName);
}

/**
 * The framework name a predefined keyword aliases, or `''`.
 *
 * `dynamic` maps to `System.Object` because that is what it IS at runtime — the
 * dynamic-ness is a compiler-inserted call site, not a type. That distinction is
 * why `CsCallKind.DYNAMIC_CALL` is reserved: the TYPE is knowable and the CALL
 * is not.
 */
export function predefinedTypeAlias(typeName: string): string {
  return CSHARP_PREDEFINED_TYPE_ALIASES.get(typeName) ?? '';
}

/**
 * Whether a type is a VALUE type by its keyword alone.
 *
 * Only the keywords — a `struct` declared in source is a value type too, and
 * this cannot see that. It is deliberately narrow: value semantics mean
 * assignment COPIES, so a wrong answer here invents or erases aliasing, and a
 * guess is worse than an absence. The full answer needs the declaration, which
 * `cs_type.typeCategory` has.
 */
export function isPredefinedValueType(typeName: string): boolean {
  return (
    CSHARP_PREDEFINED_TYPE_ALIASES.has(typeName) &&
    typeName !== 'object' &&
    typeName !== 'string' &&
    typeName !== 'dynamic'
  );
}

/**
 * The type name with its arguments, array rank, nullable marker and pointer
 * stars removed. `System.Collections.Generic.List<int>` → the dotted name.
 *
 * Both halves are kept everywhere this is used: the base name is what a `using`
 * scope resolves, and the complete name is what the value IS. In C# that pair is
 * not redundant the way it is in Java — generics are **reified**, so
 * `List<int>` and `List<string>` are distinct runtime types with distinct method
 * tables rather than one erased `List`.
 */
/** `A<B<C>>.D<E>` → `A.D`: every balanced `<…>` removed, the path kept. */
function stripTypeArguments(name: string): string {
  let out = '';
  let depth = 0;
  for (const ch of name) {
    if (ch === '<') {
      depth += 1;
    } else if (ch === '>' && depth > 0) {
      depth -= 1;
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out;
}

export function baseTypeName(completeTypeName: string): string {
  let name = completeTypeName.trim();

  // A leading `ref`/`scoped` belongs to the parameter or the return, not to the
  // type name. Leaving it on produces a name no using scope will ever resolve —
  // which is exactly the defect `scoped Span<int>` caused before `scoped_type`
  // was unwrapped.
  for (const prefix of ['scoped ref readonly ', 'scoped ref ', 'ref readonly ', 'ref ', 'scoped ']) {
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
      break;
    }
  }

  // Type-argument lists are removed WHEREVER they sit, keeping the dotted
  // path around them: `Outer<int>.Builder` is `Outer.Builder`. Cutting at the
  // first `<` gave `Outer` — the nested type's name was lost, and the creation
  // `new Outer<int>.Builder(4)` reported a callee named Outer (CS-CORPUS-27's
  // second half, found once the parse was right).
  name = stripTypeArguments(name);
  const bracket = name.indexOf('[');
  if (bracket >= 0) {
    name = name.slice(0, bracket);
  }
  return name.replace(/[?*\s]+$/, '');
}

/**
 * The number of type arguments a written type name carries.
 *
 * Counts at the TOP level only: `Dictionary<string, List<int>>` is arity 2, not
 * 3. Nesting depth is the reference tree's job, and a flat comma count would
 * report 3 and make `Dictionary\`2` unfindable.
 */
export function typeArgumentArity(completeTypeName: string): number {
  const open = completeTypeName.indexOf('<');
  if (open < 0) {
    return 0;
  }
  let depth = 0;
  let arity = 1;
  for (let index = open; index < completeTypeName.length; index += 1) {
    const character = completeTypeName[index];
    if (character === '<') {
      depth += 1;
    } else if (character === '>') {
      depth -= 1;
      if (depth === 0) {
        break;
      }
    } else if (character === ',' && depth === 1) {
      arity += 1;
    }
  }
  return arity;
}

/**
 * The CLR's own spelling of a generic name: `List` with arity 2 is ``List`2``.
 *
 * Backtick, as the runtime writes it. 167 same-name-different-arity collisions
 * were measured in the corpus, and this is what separates them.
 */
export function clrGenericName(baseName: string, arity: number): string {
  return arity === 0 ? baseName : `${baseName}\`${arity}`;
}

/**
 * Whether the written type carries a `?`.
 *
 * The TEXT, not the meaning. `int?` is `Nullable<int>` — a real struct with
 * different layout and boxing — while `string?` is an annotation that erases at
 * runtime and means nothing outside a `#nullable enable` region. This says the
 * marker is present; the owner's `nullableContext` says whether it means
 * anything, and conflating the two is how a nullable-reference analysis ends up
 * reporting findings in files where the feature is switched off.
 */
export function hasNullableAnnotation(completeTypeName: string): boolean {
  return completeTypeName.trimEnd().endsWith('?');
}

/**
 * The namespace part of a dotted name, or `''` for a bare one.
 *
 * Purely syntactic: `A.B.C` yields `A.B`. It does NOT say that `A.B` is a
 * namespace — it may be an outer type, and `A.B.C` may be a nested type. Only
 * resolution can tell those apart, so this is a *candidate* and named as one
 * wherever it is stored.
 */
export function qualifierOf(dottedName: string): string {
  const lastDot = baseTypeName(dottedName).lastIndexOf('.');
  return lastDot < 0 ? '' : baseTypeName(dottedName).slice(0, lastDot);
}

/**
 * The last segment of a dotted name. `A.B.List<int>` → `List`.
 *
 * This is the name an engine matches against a declaration's `name` column,
 * which is never qualified.
 */
export function simpleNameOf(dottedName: string): string {
  const base = baseTypeName(dottedName);
  const lastDot = base.lastIndexOf('.');
  return lastDot < 0 ? base : base.slice(lastDot + 1);
}
