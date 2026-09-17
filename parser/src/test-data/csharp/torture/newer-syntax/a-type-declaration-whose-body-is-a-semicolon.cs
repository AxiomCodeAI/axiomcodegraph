// TORTURE: a type declaration whose body is a SEMICOLON (C# 12).
//
// The published grammar has no rule for it. One in a file gives an ERROR
// holding the header and a stray top-level `;`; SEVERAL in a file merge into a
// single class_declaration named after the LAST of them, with the earlier
// declarations as ERROR children of its header and the next real type's `{ }`
// as its body — so the types are not merely unparsed, three of them are
// attributed to a fourth's name.
//
// THE SHIPPED PARSER READS THIS FILE CORRECTLY: cs-semicolon-body.ts rewrites
// the `;` to `{}` before the grammar sees the text, exactly as `#if` blanking
// hands it ordinary C#. This fixture asserts the GRAMMAR still fails it, which
// is what says the rewrite is still needed. `a semicolon is a body` in the gate
// asserts the other half — that the rewrite produces the eleven types.
namespace Acme.Torture;

public interface ILock : IBase;

public sealed class Marker;

public readonly struct Tag;

public class WithCapacity(int capacity);

public interface IBase { }
