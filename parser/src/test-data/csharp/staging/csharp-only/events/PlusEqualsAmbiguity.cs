// HALF TWO — the falsifier for the `+=` ruling.
//
// This file exists to make one thing impossible to get right by accident: the
// parser must decide EVENT_SUBSCRIBE versus COMPOUND_ASSIGNMENT from what the
// left-hand side DECLARES, not from the operator. Every pair below is written
// with the same operator on the same line shapes, and the members differ only
// in whether they were declared with the `event` keyword.
//
// Four traps, in order of how easily a pattern-matching parser falls into them:
//   1. An event and a delegate-typed FIELD of the identical delegate type.
//      `Changed += h` subscribes. `Callback += h` is Delegate.Combine and a
//      plain compound assignment.
//   2. An event and a field with the SAME NAME on two different types.
//   3. Both on ONE LINE, so a line-keyed pairing has to choose.
//   4. `+=` on an int, a string and a property, so the ordinary meaning of the
//      operator is present in the same file and must survive.
using System;

namespace Fixtures.CSharpOnly.Events;

public class SubscriptionAndAssignment
{
    // Declared with `event`: `+=` outside this type is add_Changed(h).
    public event EventHandler Changed;

    // Declared WITHOUT `event`, identical type: `+=` is Delegate.Combine and an
    // ordinary compound assignment to a field.
    public EventHandler Callback;

    // Same again, for a generic delegate.
    public event EventHandler<Payload> Detailed;

    public EventHandler<Payload> DetailedCallback;

    // Same again, for Action.
    public event Action Ping;

    public Action PingCallback;

    // A delegate-typed PROPERTY: `+=` is a getter call, a Combine, and a setter
    // call — three operations, none of them an event subscription.
    public EventHandler CallbackProperty { get; set; }

    // Ordinary arithmetic and string targets, so the plain meaning of `+=` is
    // present in the same file.
    public int Counter;

    public string Log = string.Empty;

    public int CounterProperty { get; set; }

    public int[] Slots = new int[4];

    public void Raise()
    {
        Changed?.Invoke(this, EventArgs.Empty);
        Callback?.Invoke(this, EventArgs.Empty);
        Detailed?.Invoke(this, new Payload(1));
        DetailedCallback?.Invoke(this, new Payload(1));
        Ping?.Invoke();
        PingCallback?.Invoke();
        CallbackProperty?.Invoke(this, EventArgs.Empty);
    }
}

public class PlusEqualsCallSites
{
    private readonly SubscriptionAndAssignment target = new();

    private void Handler(object? sender, EventArgs args)
    {
    }

    private void DetailedHandler(object? sender, Payload payload)
    {
    }

    private void PingHandler()
    {
    }

    // Trap 1 — same operator, same delegate type, different member kind.
    public void EventVersusField()
    {
        target.Changed += Handler;
        target.Callback += Handler;

        target.Changed -= Handler;
        target.Callback -= Handler;

        target.Detailed += DetailedHandler;
        target.DetailedCallback += DetailedHandler;

        target.Ping += PingHandler;
        target.PingCallback += PingHandler;

        target.CallbackProperty += Handler;
        target.CallbackProperty -= Handler;
    }

    // Trap 3 — both on ONE LINE. A parser keyed on (scope, line) must still
    // produce one subscription and one compound assignment, in that order.
    public void BothOnOneLine()
    {
        target.Changed += Handler; target.Callback += Handler;
        target.Counter += 1; target.Changed += Handler;
        target.Changed += Handler; target.Counter += 1;
        target.Log += "a"; target.Callback += Handler;
    }

    // Trap 4 — the ordinary meaning, on every target shape, in the same file.
    public void OrdinaryCompoundAssignment()
    {
        target.Counter += 1;
        target.Counter -= 1;
        target.CounterProperty += 1;
        target.Slots[0] += 1;
        target.Log += "appended";

        int local = 0;
        local += 1;
        local -= 1;

        string text = string.Empty;
        text += "x";

        // A delegate LOCAL, not a member: also Delegate.Combine.
        EventHandler localDelegate = Handler;
        localDelegate += Handler;
        localDelegate -= Handler;

        // A delegate held in an array element and in a dictionary value.
        var slots = new EventHandler[2];
        slots[0] += Handler;

        var map = new System.Collections.Generic.Dictionary<string, EventHandler>();
        map["k"] = null;
        map["k"] += Handler;
    }

    // Trap 2 — the SAME MEMBER NAME, one an event and one a field, on two
    // different types, subscribed in adjacent statements.
    public void SameNameDifferentType(EventShaped withEvent, FieldShaped withField)
    {
        withEvent.Notify += Handler;
        withField.Notify += Handler;
        withEvent.Notify -= Handler;
        withField.Notify -= Handler;
    }

    // A subscription whose right-hand side is not a simple name: a lambda, a
    // constructed delegate, a method group on another object, and a
    // conditional. All four are still subscriptions.
    public void SubscriptionRightHandSides(SubscriptionAndAssignment other, bool flag)
    {
        target.Changed += (sender, args) => { };
        target.Changed += new EventHandler(Handler);
        target.Changed += other.Raise2;
        target.Changed += flag ? Handler : new EventHandler(Handler);
        target.Changed += delegate { };
    }
}

public class EventShaped
{
    public event EventHandler Notify;

    public void Raise() => Notify?.Invoke(this, EventArgs.Empty);
}

public class FieldShaped
{
    public EventHandler Notify;

    public void Raise() => Notify?.Invoke(this, EventArgs.Empty);
}

public static class SubscriptionAndAssignmentExtensions
{
    public static void Raise2(this SubscriptionAndAssignment source, object? sender, EventArgs args)
    {
    }
}
