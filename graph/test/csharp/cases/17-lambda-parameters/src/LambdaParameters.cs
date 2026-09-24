// A LAMBDA PARAMETER WITH NO WRITTEN TYPE takes it from the delegate the lambda is
// converted to (#1283).
//
// `ParseFn<ISchema> parse = (schema, value) => schema.I.Size();` -- `schema` is an
// ISchema because ParseFn's parameter 0 is its T and the field closes T with
// ISchema. Before this, every call on an implicitly typed lambda parameter was
// unresolved, while the same body with `(ISchema schema, int value)` written out
// resolved. And a value declared as a constrained type parameter, `T schema where
// T : ISchema`, was unresolved too: nothing read the constraint.
//
// THE SHAPES: a generic delegate declared in source, closed at the field; a
// non-generic one; `Func` and `Action`; a field, a property and a local
// initializer; `=` to a local and a property, `??=` to a field; the branches of
// `?:`; and a delegate closed with a method's own constrained T.
//
// THE CONTROLS: two type arguments of different types, on a declared delegate and
// on `Func`, whose parameters each call the member of the same name on its own
// type -- a rule that crossed positions, or gave every parameter every argument,
// fans `Check` to both and fails; an explicitly typed lambda and an explicitly
// typed method, which resolved before.
//
// NOT HERE: a call THROUGH a delegate (`p(s, 1)`, `schema.I.Run(v)`), which the
// score cannot read (see 11-delegate-fields); tools/assigned-delegate-member-test.sh
// carries those.
using System;

namespace Cases.LambdaParameters;

public interface IInternals
{
    int Size();
}

public interface ISchema
{
    IInternals I { get; }
    int Check();
}

public interface IOther
{
    int Check();
}

public delegate int ParseFn<T>(T schema, int value) where T : ISchema;
public delegate int PlainFn(ISchema schema, int value);
public delegate int PairFn<A, B>(A first, B second);

public class Parsers
{
    public static readonly ParseFn<ISchema> Parse = (schema, value) => schema.I.Size() + value;
    public static readonly PlainFn Plain = (schema, value) => schema.I.Size();
    public static readonly Func<ISchema, int, int> Generic = (schema, value) => schema.I.Size();
    public static readonly Action<ISchema> Act = schema => schema.I.Size();

    public ParseFn<ISchema> Prop { get; set; } = (schema, value) => schema.Check();
    private PlainFn? late;

    public void Configure(bool b)
    {
        late ??= (schema, value) => schema.Check();
        PlainFn local = b ? (s, v) => s.Check() : (s, v) => s.I.Size();
        Func<ISchema, int> f;
        f = s => s.Check();
        Prop = (schema, value) => schema.I.Size();
    }

    // A type parameter's constraint, on a parameter and through a delegate closed with it.
    public static int Constrained<T>(T schema) where T : ISchema => schema.I.Size();

    public static int ClosedWithT<T>(T s) where T : ISchema
    {
        ParseFn<T> p = (schema, value) => schema.Check();
        return s.Check();
    }

    // CONTROL: two arguments of different types must not cross.
    public static readonly PairFn<IOther, ISchema> Pair = (first, second) => first.Check() + second.Check();
    public static readonly Func<IOther, ISchema, int> FuncPair = (o, s) => o.Check() + s.Check();

    // CONTROL: explicitly typed, which resolved before.
    public static readonly PlainFn Explicit = (ISchema schema, int value) => schema.I.Size();
    public static int ParseTyped(ISchema schema, int value) => schema.I.Size();
}
