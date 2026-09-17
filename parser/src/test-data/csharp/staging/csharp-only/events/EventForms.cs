// HALF TWO — no Java analogue.
//
// An event is a member with two accessors named `add` and `remove`, and the
// only operators that may be applied to it from outside the declaring type are
// `+=` and `-=`. Those are NOT compound assignment: `+=` compiles to a CALL to
// `add_Handler`, and the schema's §2.4 ruling gives it its own expression kind
// (EVENT_SUBSCRIBE / EVENT_UNSUBSCRIBE) with the handler parented as a child.
//
// The falsifying case is in the sibling file PlusEqualsAmbiguity.cs: an event
// and a field in the SAME type, both written with `+=`.
using System;
using System.Collections.Generic;
using System.ComponentModel;

namespace Fixtures.CSharpOnly.Events;

public class Payload : EventArgs
{
    public Payload(int value) => Value = value;

    public int Value { get; }
}

public delegate void PayloadHandler(object sender, Payload payload);

public class EventForms
{
    // FIELD-LIKE event: the compiler synthesises a backing delegate field, an
    // `add` accessor and a `remove` accessor, none of which appear in syntax.
    public event EventHandler Simple;

    public event EventHandler<Payload> Generic;

    public event PayloadHandler CustomDelegate;

    public event Action Parameterless;

    public event Action<int, string> MultiArity;

    // Several events in ONE declaration, sharing a type — the same shape as a
    // multi-declarator field.
    public event EventHandler First, Second, Third;

    // An event with an initialiser: the backing delegate starts non-null, which
    // is the "empty delegate" idiom that removes the null check.
    public event EventHandler AlwaysSubscribed = delegate { };

    public event EventHandler AlwaysSubscribedLambda = (sender, args) => { };

    // MORE EVENT INITIALISERS, because an event initialiser is the only
    // expression position owned by `CsExpressionOwnerKind.EVENT` and the corpus
    // had exactly two of them — too few to discriminate anything. These are a
    // method group, an explicit delegate construction, a combination, a
    // conditional, a static factory call and a null literal.
    private static void NoOp(object? sender, EventArgs args)
    {
    }

    public event EventHandler FromMethodGroup = NoOp;

    public event EventHandler FromConstruction = new EventHandler(NoOp);

    public event EventHandler FromCombination = NoOp + new EventHandler(NoOp);

    public event EventHandler FromConditional = DateTime.UtcNow.Year > 2000 ? NoOp : null;

    public event EventHandler? FromNull = null;

    public event Action FromParameterlessLambda = () => Console.WriteLine();

    public event Action<int> FromTypedLambda = (int value) => Console.WriteLine(value);

    public event EventHandler<Payload> FromGenericLambda = (sender, payload) =>
    {
        Console.WriteLine(payload.Value);
    };

    public event Func<int, int> FromExpressionLambda = value => value * 2 + 1;

    public static event EventHandler StaticFromMethodGroup = NoOp;

    // A STATIC event.
    public static event EventHandler StaticEvent;

    // Accessibility, and the modifiers an event shares with a method.
    protected event EventHandler ProtectedEvent;

    private event EventHandler PrivateEvent;

    internal event EventHandler InternalEvent;

    protected internal event EventHandler ProtectedInternalEvent;

    // An event carrying attributes, including on the accessor methods.
    [Obsolete("use Simple")]
    public event EventHandler Attributed;

    // EXPLICIT ACCESSORS. Now `add` and `remove` are real method bodies and the
    // backing store is whatever the author chooses. This is the form the BCL
    // uses when it wants a dictionary of handlers rather than one field.
    private readonly Dictionary<string, Delegate> handlers = new();

    public event EventHandler WithAccessors
    {
        add
        {
            handlers["WithAccessors"] = Delegate.Combine(
                handlers.TryGetValue("WithAccessors", out Delegate existing) ? existing : null,
                value);
        }

        remove
        {
            handlers["WithAccessors"] = Delegate.Remove(
                handlers.TryGetValue("WithAccessors", out Delegate existing) ? existing : null,
                value);
        }
    }

    // Expression-bodied accessors.
    public event EventHandler ExpressionBodiedAccessors
    {
        add => handlers["e"] = Delegate.Combine(handlers.GetValueOrDefault("e"), value);
        remove => handlers["e"] = Delegate.Remove(handlers.GetValueOrDefault("e"), value);
    }

    // Raising an event. Inside the declaring type the event NAME denotes the
    // backing delegate, so it can be invoked, null-checked and compared — none
    // of which is legal from outside.
    protected virtual void OnSimple()
    {
        Simple?.Invoke(this, EventArgs.Empty);
    }

    protected virtual void OnGeneric(int value)
    {
        EventHandler<Payload> snapshot = Generic;
        if (snapshot != null)
        {
            snapshot(this, new Payload(value));
        }
    }

    protected virtual void OnCustom(int value)
    {
        CustomDelegate?.Invoke(this, new Payload(value));
    }

    protected void OnParameterless() => Parameterless?.Invoke();

    protected void RaiseAlways() => AlwaysSubscribed(this, EventArgs.Empty);

    // Inside the declaring type, `+=` on the event still means subscribe.
    private void SubscribeInternally()
    {
        Simple += OnSelf;
        Simple -= OnSelf;
    }

    private void OnSelf(object sender, EventArgs args)
    {
    }
}

public abstract class EventModifiers
{
    public abstract event EventHandler AbstractEvent;

    public virtual event EventHandler VirtualEvent;

    public event EventHandler Hidden;
}

public class EventOverrides : EventModifiers
{
    public override event EventHandler AbstractEvent;

    public override event EventHandler VirtualEvent;

    public new event EventHandler Hidden;
}

public interface IRaises
{
    event EventHandler Raised;

    event EventHandler<Payload> Detailed;

    static abstract event EventHandler StaticAbstractEvent;
}

public class RaisesImplementation : IRaises
{
    // Implicit implementation.
    public event EventHandler Raised;

    // EXPLICIT INTERFACE event implementation, which must have accessors.
    private EventHandler<Payload> detailed;

    event EventHandler<Payload> IRaises.Detailed
    {
        add => detailed += value;
        remove => detailed -= value;
    }

    public static event EventHandler StaticAbstractEvent;

    public void Raise()
    {
        Raised?.Invoke(this, EventArgs.Empty);
        detailed?.Invoke(this, new Payload(1));
        StaticAbstractEvent?.Invoke(null, EventArgs.Empty);
    }
}

// The INotifyPropertyChanged shape — the single most common event in real C#.
public class Observable : INotifyPropertyChanged
{
    private string name = string.Empty;

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Name
    {
        get => name;
        set
        {
            if (name == value)
            {
                return;
            }

            name = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Name)));
        }
    }
}

public class EventConsumers
{
    private readonly EventForms source = new();

    public void Subscribe()
    {
        // Subscription with a METHOD GROUP — a reference to a method with no
        // call syntax anywhere in the expression.
        source.Simple += OnSimple;
        source.Generic += OnGeneric;
        source.CustomDelegate += OnPayload;

        // Subscription with a lambda and with an anonymous method.
        source.Simple += (sender, args) => Console.WriteLine(sender);
        source.Simple += delegate (object? sender, EventArgs args) { Console.WriteLine(args); };
        source.Parameterless += () => Console.WriteLine();

        // Subscription with an explicitly constructed delegate.
        source.Simple += new EventHandler(OnSimple);

        // Unsubscription, in each of the same forms that can be unsubscribed.
        source.Simple -= OnSimple;
        source.Generic -= OnGeneric;
        source.Simple -= new EventHandler(OnSimple);

        // Static event subscription.
        EventForms.StaticEvent += OnSimple;
        EventForms.StaticEvent -= OnSimple;

        // Subscription to an event with explicit accessors — indistinguishable
        // at the call site from a field-like one.
        source.WithAccessors += OnSimple;
        source.WithAccessors -= OnSimple;

        // Subscription reached through a chain and through a null-conditional.
        Holder holder = new Holder();
        holder.Inner.Simple += OnSimple;
        holder.Inner!.Generic += OnGeneric;
    }

    private void OnSimple(object? sender, EventArgs args)
    {
    }

    private void OnGeneric(object? sender, Payload payload)
    {
    }

    private void OnPayload(object sender, Payload payload)
    {
    }

    private sealed class Holder
    {
        public EventForms Inner { get; } = new();
    }
}
