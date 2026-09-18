// Port of java/enums/SimpleStatus.java, widened to every C# enum form.
//
// NO ANALOGUE, IN BOTH DIRECTIONS. A Java enum is a class: it may declare
// constructors, fields, methods, a per-constant body and `implements`. A C#
// enum is a named set of integral constants and can declare NONE of those.
// So Java's enum-constructor / constant-body / interface-implementing enums do
// not port, and are not invented here. What real C# does instead — a `[Flags]`
// bit set, a static lookup table, and extension methods on the enum type — is
// covered instead, and the extension-method half lives in
// ../../csharp-only/extensions/ because it is a C#-only construct.
//
// In the other direction, C# has three enum features Java lacks: an explicit
// underlying type, [Flags] bitwise combination, and explicit numeric values on
// every member including duplicates and computed expressions.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Enums;

/// <summary>The direct port of SimpleStatus: implicit int, sequential values.</summary>
public enum SimpleStatus
{
    Active,
    Inactive
}

public enum OrderState
{
    Created,
    Paid,
    Shipped,
    Delivered,
    Cancelled
}

/// <summary>Explicit values, out of order, with a duplicate — all legal.</summary>
public enum HttpStatus
{
    Ok = 200,
    Created = 201,
    NoContent = 204,
    MovedPermanently = 301,
    Moved = 301,
    BadRequest = 400,
    NotFound = 404,
    ServerError = 500
}

/// <summary>Explicit underlying type — no Java form.</summary>
public enum SmallCode : byte
{
    None = 0,
    First = 1,
    Last = byte.MaxValue
}

public enum WideCode : long
{
    Zero = 0L,
    Huge = 4_000_000_000L
}

public enum SignedCode : sbyte
{
    Negative = -1,
    Zero = 0,
    Positive = 1
}

/// <summary>Members computed from earlier members and from constants.</summary>
public enum ComputedValues
{
    Base = 10,
    Doubled = Base * 2,
    Offset = Doubled + 1,
    FromConst = Limits.Max,
    Negated = -Base
}

internal static class Limits
{
    public const int Max = 99;
}

/// <summary>A bit set. `[Flags]` changes ToString and licenses `|`/`&amp;`/`^`.</summary>
[Flags]
public enum FilePermissions
{
    None = 0,
    Read = 1 << 0,
    Write = 1 << 1,
    Execute = 1 << 2,
    ReadWrite = Read | Write,
    All = Read | Write | Execute
}

/// <summary>An enum nested inside a type, and one with attributes on members.</summary>
public class EnumHost
{
    public enum Nested
    {
        [Obsolete("renamed to Second")]
        First,
        Second
    }

    private Nested current = Nested.Second;

    public Nested Current => current;
}

public class EnumConsumers
{
    // Switch over an enum, with a default that guards for undeclared values —
    // an enum variable may legally hold any value of the underlying type.
    public string Describe(OrderState state)
    {
        switch (state)
        {
            case OrderState.Created:
                return "created";

            case OrderState.Paid:
            case OrderState.Shipped:
                return "in flight";

            case OrderState.Delivered:
                return "done";

            case OrderState.Cancelled:
                return "cancelled";

            default:
                return "unknown";
        }
    }

    // Switch EXPRESSION over an enum, with a discard arm.
    public string DescribeExpression(OrderState state) => state switch
    {
        OrderState.Created => "created",
        OrderState.Paid or OrderState.Shipped => "in flight",
        OrderState.Delivered => "done",
        _ => "unknown"
    };

    // The Java "enum with behaviour" replacement: a static lookup table.
    private static readonly Dictionary<OrderState, int> Weights = new Dictionary<OrderState, int>
    {
        [OrderState.Created] = 0,
        [OrderState.Paid] = 1,
        [OrderState.Shipped] = 2,
        [OrderState.Delivered] = 3,
        [OrderState.Cancelled] = -1
    };

    public int Weight(OrderState state) => Weights[state];

    public bool CanRead(FilePermissions permissions) =>
        (permissions & FilePermissions.Read) == FilePermissions.Read;

    public FilePermissions Grant(FilePermissions current, FilePermissions extra) => current | extra;

    public FilePermissions Revoke(FilePermissions current, FilePermissions removed) => current & ~removed;

    public FilePermissions Toggle(FilePermissions current, FilePermissions flag) => current ^ flag;

    // HasFlag, the reflective form.
    public bool HasWrite(FilePermissions permissions) => permissions.HasFlag(FilePermissions.Write);

    // Enum <-> integral conversions, both directions, and Enum static APIs.
    public int ToNumber(HttpStatus status) => (int)status;

    public HttpStatus FromNumber(int code) => (HttpStatus)code;

    public bool IsKnown(int code) => Enum.IsDefined(typeof(HttpStatus), code);

    public string[] AllNames() => Enum.GetNames(typeof(OrderState));

    public OrderState Parse(string text) => (OrderState)Enum.Parse(typeof(OrderState), text);

    public bool TryParse(string text, out OrderState state) => Enum.TryParse(text, out state);

    // An enum as a generic type argument and as a constraint.
    public TEnum Default<TEnum>() where TEnum : struct, Enum => default;

    public IReadOnlyList<TEnum> Values<TEnum>() where TEnum : struct, Enum =>
        (TEnum[])Enum.GetValues(typeof(TEnum));

    // An enum-typed field with an initialiser, and a nullable enum.
    private OrderState state = OrderState.Created;

    private OrderState? maybeState = null;

    public OrderState State => state;

    public OrderState EffectiveState => maybeState ?? state;
}
