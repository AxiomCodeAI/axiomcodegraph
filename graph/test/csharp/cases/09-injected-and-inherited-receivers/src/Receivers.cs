// The receiver shapes a SERVICE TREE writes, as opposed to the ones a library does.
//
// The corpus is weighted towards libraries, whose calls are mostly into their own
// source and whose receivers are locals and fields. An application wires its
// collaborators in instead, and every shape below was found by scoring a real
// multi-service subject rather than by reading the language spec: each one was a
// site the engine answered `boundary_lib` -- asserting the target is outside the
// source -- while the target was two files away.
//
// EVERY SHAPE CARRIES ITS CONTROL, and the controls are the point. A fix that types
// more receivers is indistinguishable from one that types them WRONGLY unless
// something pins the answers that were already right: that a local of the same name
// still shadows the member, that a built-in `==` still runs no user code, that an
// extension is still not offered where the type has its own method.
namespace Cases.Receivers;

public interface IRepo { string Get(string id); }
public sealed class Repo : IRepo { public string Get(string id) => id; }

// ── 1. A PRIMARY CONSTRUCTOR PARAMETER ──────────────────────────────────────
// `class Service(IRepo repo)` puts `repo` in scope in every instance member. This is
// constructor injection in current C#, so it is the receiver an application writes
// most, and it is the one the binder had no clause for: a primary constructor's
// parameters belong to the type's PRIMARY_CONSTRUCTOR method, which is neither the
// enclosing method nor a lexically enclosing one.
public sealed class Injected(IRepo repo)
{
    public string Direct() => repo.Get("x");

    // ...and captured by a lambda in the body. A lambda is its own method and is NOT
    // lexically nested inside the constructor, so a walk up the method chain never
    // arrives at one. The binding has to be reached through the TYPE.
    public string Captured()
    {
        System.Func<string> f = () => repo.Get("x");
        return f();
    }
}

// CONTROL: the same call through an ordinary constructor-assigned field. It resolved
// before the primary-constructor clause existed, and must still.
public sealed class InjectedByField
{
    private readonly IRepo _repo;
    public InjectedByField(IRepo repo) => _repo = repo;
    public string Call() => _repo.Get("x");
}

// CONTROL: SHADOWING. A local of the same name wins over the primary constructor's
// parameter, which is the language's rule. Both resolve to the same declaration here
// -- the point is the DISTANCE, which is what keeps a method that declares its own
// `repo` from being retyped by the header. A shape that returned two receiver types
// would make this site multi_inferred, and it is not.
public sealed class ShadowedPrimary(IRepo repo)
{
    public string Local()
    {
        IRepo repo2 = repo;
        return repo2.Get("x");
    }
}

// ── 2. AN INHERITED MEMBER USED UNQUALIFIED ─────────────────────────────────
// The parser binds a name reference to the member it names where syntax settles it,
// and from one file an inherited member is not one of those: the declaration is in
// another file. So the reference arrives at the engine unknown, and nothing offered
// a member for it at all -- member_lookup already walks the chain and was not asked.
public abstract class HandlerBase
{
    public IRepo Store { get; }
    protected HandlerBase(IRepo s) => Store = s;
}
public sealed class DerivedHandler : HandlerBase
{
    public DerivedHandler(IRepo s) : base(s) { }
    public string Call() => Store.Get("x");
}

// The same, where the base ALSO derives from an unstaged library type. This is the
// control for a tempting wrong diagnosis: that the walk is cut short at the library
// boundary. It is not -- the pure-in-source base above failed identically, so the
// walk was not happening at all, and this pins that the boundary is not the cause.
public abstract class LibBackedBase : System.Collections.Generic.List<int>
{
    public IRepo Store { get; }
    protected LibBackedBase(IRepo s) => Store = s;
}
public sealed class LibBackedHandler : LibBackedBase
{
    public LibBackedHandler(IRepo s) : base(s) { }
    public string Call() => Store.Get("x");
}

// A POSITIONAL RECORD's parameter is a property, declared by the header rather than
// by the body that uses it, so it arrives here by the same route.
public record PositionalHandler(IRepo Store)
{
    public string Call() => Store.Get("x");
}

// CONTROL: the property declared on the class that uses it. The parser binds this
// one, so it never reaches the inherited clause -- and it resolved before.
public sealed class OwnPropertyHandler
{
    public IRepo Store { get; }
    public OwnPropertyHandler(IRepo s) => Store = s;
    public string Call() => Store.Get("x");
}

// CONTROL: an INHERITED FIELD, which takes the same route as the property and must
// not be typed differently from one.
public abstract class FieldBase { protected IRepo Backing = new Repo(); }
public sealed class FieldDerived : FieldBase
{
    public string Call() => Backing.Get("x");
}

// ── 3. EXTENSION METHODS THE THREE MATCH CLAUSES COULD NOT SEE ──────────────
public static class Ext
{
    // `this object` matches EVERY receiver, and was matched by none: the nominal walk
    // needs a group for `object` that a client-only run does not have, the generic
    // clause needs the `this` parameter to BE a type parameter, and the by-name match
    // needs the receiver to be spelled `object`, which it never is.
    public static string Describe(this object o) => "d";

    public static string Tag(this IRepo r) => "t";                          // in-source `this`
    public static string Note(this System.Text.StringBuilder b) => "n";     // external `this`
}

public sealed class ExtensionReceivers
{
    public string ObjectOnNominal(Repo r) => r.Describe();
    public string ObjectOnExternal(System.Text.StringBuilder b) => b.Describe();
    public string ObjectOnTypeParam<T>(T value) where T : IRepo => value.Describe();

    // An extension with an EXTERNAL `this` type reaches its receiver only by NAME,
    // and a lambda parameter had no receiver type name -- so the same extension
    // resolved on a local and not one line later inside a lambda. The endpoint
    // handler and the registered delegate are written exactly this way.
    public System.Func<System.Text.StringBuilder, string> ExternalInLambda()
        => (System.Text.StringBuilder b) => b.Note();

    // CONTROLS. Each one isolates a single term of the pair above: an external `this`
    // type OUTSIDE a lambda, an in-source `this` type INSIDE one, and the `this
    // string` shape case 02 already pins.
    public string ExternalOutsideLambda(System.Text.StringBuilder b) => b.Note();
    public System.Func<IRepo, string> NominalInLambda() => (IRepo r) => r.Tag();
    public string NominalOnLocal(IRepo r) => r.Tag();
}

// CONTROL: THE GATE STILL HOLDS. A type with its own `Describe` binds to its own and
// is NOT offered the `this object` extension. Widening the match without this would
// make every type that names a method after a common helper ambiguous.
public sealed class HasOwnDescribe
{
    public string Describe() => "own";
    public string Call() => Describe();
}

// ── 4. A USER-DEFINED OPERATOR DECLARED ON A BASE ───────────────────────────
// C# gathers candidate operators from the operand's type AND its base types. Looking
// only at the operand's own type missed every derived operand -- and missed it
// SILENTLY, because a site whose operator is not found is counted in
// known_builtin_operator, the bucket for a site that ran no user code. A miss was
// therefore filed as a correct answer, which is why the built-in control below is
// not decoration.
public class Entity
{
    public int Id;
    public static bool operator ==(Entity? a, Entity? b) => ReferenceEquals(a, b);
    public static bool operator !=(Entity? a, Entity? b) => !(a == b);
    public override bool Equals(object? o) => false;
    public override int GetHashCode() => 0;
}
public sealed class Order : Entity { }

public sealed class OperatorReceivers
{
    public bool DerivedPair(Order a, Order b) => a == b;
    public bool DerivedVsNull(Order a) => a == null;
    public bool DerivedNotEqual(Order a, Order b) => a != b;

    // CONTROL: the operand IS the declaring type. Resolved before the ancestor hop.
    public bool DeclaringType(Entity a, Entity b) => a == b;

    // CONTROL: a built-in `==` on two ints declares no op_Equality anywhere and must
    // stay in known_builtin_operator. If the ancestor hop ever reached `object`,
    // every `==` in the program would resolve to Entity's.
    public bool BuiltIn(int a, int b) => a == b;

    // CONTROL: ARITY still separates the overloads. `Entity` declares `==` at arity
    // 2 and nothing at arity 1, and a unary `-` on it must find nothing rather than
    // take an inherited binary operator that merely carries the same token.
    public bool NotOverloaded(Order a, Order b) => ReferenceEquals(a, b);
}
