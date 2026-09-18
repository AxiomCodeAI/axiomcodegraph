// Port of java/annotations/{test-meta-annotations,ValueTypes,User,OldClass,TimedClass}.java
// C# attributes are the closest port in the whole Java set: inert metadata read
// by reflection, exactly like a Java annotation. The declaration form differs —
// a Java @interface declares members as abstract methods, a C# attribute class
// declares them as constructor parameters (positional) and properties (named).
using System;

namespace Fixtures.Ported.Attributes;

/// <summary>Marker attribute: no members at all. Java's @Marker.</summary>
[AttributeUsage(
    AttributeTargets.Class | AttributeTargets.Struct | AttributeTargets.Field
    | AttributeTargets.Method | AttributeTargets.Property | AttributeTargets.Module
    | AttributeTargets.Event,
    Inherited = true)]
public sealed class MarkerAttribute : Attribute
{
}

/// <summary>Single positional value. Java's @SingleValue("x").</summary>
[AttributeUsage(AttributeTargets.All)]
public sealed class SingleValueAttribute : Attribute
{
    public SingleValueAttribute(string value) => Value = value;

    public string Value { get; }
}

/// <summary>
/// Positional plus named members. Java's element-with-default ports to a
/// settable property; a Java annotation element with no default ports to a
/// constructor parameter.
/// </summary>
[AttributeUsage(
    AttributeTargets.Class | AttributeTargets.Method | AttributeTargets.Field
    | AttributeTargets.Assembly,
    AllowMultiple = true,
    Inherited = false)]
public sealed class NamedArgAttribute : Attribute
{
    public NamedArgAttribute(string name)
    {
        Name = name;
    }

    public NamedArgAttribute(string name, int order)
    {
        Name = name;
        Order = order;
    }

    public string Name { get; }

    public int Order { get; set; } = 0;

    public bool Enabled { get; set; } = true;

    public Type Target { get; set; }
}

/// <summary>Every constant-expressible member type an attribute may carry.</summary>
[AttributeUsage(AttributeTargets.All, AllowMultiple = true)]
public sealed class ValueTypesAttribute : Attribute
{
    public ValueTypesAttribute(
        byte b,
        sbyte sb,
        short s,
        ushort us,
        int i,
        uint ui,
        long l,
        ulong ul,
        float f,
        double d,
        char c,
        bool flag,
        string text)
    {
        Byte = b;
        SByte = sb;
        Short = s;
        UShort = us;
        Int = i;
        UInt = ui;
        Long = l;
        ULong = ul;
        Float = f;
        Double = d;
        Char = c;
        Flag = flag;
        Text = text;
    }

    public byte Byte { get; }
    public sbyte SByte { get; }
    public short Short { get; }
    public ushort UShort { get; }
    public int Int { get; }
    public uint UInt { get; }
    public long Long { get; }
    public ulong ULong { get; }
    public float Float { get; }
    public double Double { get; }
    public char Char { get; }
    public bool Flag { get; }
    public string Text { get; }

    public Severity Level { get; set; }
    public int[] Codes { get; set; }
    public string[] Tags { get; set; }
    public Type Handler { get; set; }
    public object Boxed { get; set; }
}

/// <summary>An attribute usable on a type parameter — Java has this too.</summary>
[AttributeUsage(AttributeTargets.GenericParameter)]
public sealed class TypeParamAttribute : Attribute
{
    public TypeParamAttribute(string role) => Role = role;

    public string Role { get; }
}

/// <summary>An attribute usable on a return value and on a parameter.</summary>
[AttributeUsage(AttributeTargets.ReturnValue | AttributeTargets.Parameter)]
public sealed class FlowAttribute : Attribute
{
    public FlowAttribute(string direction) => Direction = direction;

    public string Direction { get; }
}

/// <summary>An attribute that is inherited by derived classes.</summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public class TimedAttribute : Attribute
{
    public int ThresholdMs { get; set; } = 100;
}

/// <summary>Derived attribute class — Java annotations cannot be subclassed.</summary>
[AttributeUsage(AttributeTargets.Class, Inherited = true)]
public sealed class StrictlyTimedAttribute : TimedAttribute
{
    public StrictlyTimedAttribute() => ThresholdMs = 1;
}

/// <summary>Obsolete-style attribute mirroring java @Deprecated on OldClass.</summary>
public enum Severity
{
    Low,
    Medium,
    High
}
