// Port of java/expressions/CastExpressionExamples.java.
// A cast that invokes USER CODE — an implicit or explicit conversion operator —
// is a call edge wearing a type reference's clothes, and it lives in
// ../../csharp-only/operators/ConversionOperators.cs. Everything here is a
// built-in conversion.
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Expressions;

public class CastExpressionExamples
{
    public void NumericConversions(int i, long l, double d, decimal m, byte b)
    {
        // Explicit narrowing.
        byte narrowed = (byte)i;
        short toShort = (short)i;
        int fromLong = (int)l;
        int fromDouble = (int)d;
        int fromDecimal = (int)m;
        float fromDouble2 = (float)d;

        // Implicit widening — no cast syntax, still a conversion.
        long widened = i;
        double widenedDouble = i;
        decimal widenedDecimal = i;
        int fromByte = b;

        // Checked and unchecked casts differ in behaviour, not in shape.
        int wrapped = unchecked((int)4_000_000_000L);
        _ = narrowed + toShort + fromLong + fromDouble + fromDecimal + (int)fromDouble2
            + (int)widened + (int)widenedDouble + (int)widenedDecimal + fromByte + wrapped;

        try
        {
            long big = 4_000_000_000L;
            int overflowing = checked((int)big);
            _ = overflowing;
        }
        catch (OverflowException)
        {
        }
    }

    public void ReferenceConversions(object value, Receiver receiver)
    {
        // Downcast, upcast, and the two safe forms.
        Receiver down = (Receiver)value;
        object up = receiver;
        Receiver safe = value as Receiver;
        bool test = value is Receiver;
        if (value is Receiver pattern)
        {
            _ = pattern.Seed;
        }

        _ = down.Seed + up.GetHashCode() + (safe?.Seed ?? 0) + (test ? 1 : 0);
    }

    public void BoxingAndUnboxing(int number)
    {
        // Boxing: a value type to object. No Java-visible analogue since Java
        // boxes to a different TYPE (Integer), while C# boxes the same type.
        object boxed = number;
        object explicitlyBoxed = (object)number;
        ValueType asValueType = number;
        IComparable asInterface = number;

        // Unboxing.
        int unboxed = (int)boxed;
        int viaConvert = Convert.ToInt32(boxed);
        _ = unboxed + viaConvert + explicitlyBoxed.GetHashCode()
            + asValueType.GetHashCode() + asInterface.GetHashCode();
    }

    public void NullableConversions(int? maybe, int definite)
    {
        int? lifted = definite;
        int unwrapped = (int)maybe;
        int defaulted = maybe ?? 0;
        int viaValue = maybe.HasValue ? maybe.Value : 0;
        int? castBack = (int?)definite;
        _ = lifted.GetValueOrDefault() + unwrapped + defaulted + viaValue + castBack.GetValueOrDefault();
    }

    public void GenericAndArrayCasts(object value, object[] values)
    {
        List<int> list = (List<int>)value;
        IEnumerable<int> covariantView = list;
        int[] array = (int[])values[0];
        string[] strings = (string[])values[1];
        object[] arrayAsObject = strings;
        IReadOnlyList<int> readOnly = array;
        _ = list.Count + System.Linq.Enumerable.Count(covariantView) + array.Length
            + (arrayAsObject?.Length ?? 0) + readOnly.Count;
    }

    public T CastThroughTypeParameter<T>(object value)
    {
        // The double cast through object is the idiomatic workaround for the
        // absence of a direct conversion from a type parameter.
        return (T)value;
    }

    public TOut ConvertReference<TIn, TOut>(TIn value)
        where TIn : class
        where TOut : class
    {
        return value as TOut;
    }

    // Casts in every syntactic position.
    public void CastPositions(object value, int[] data)
    {
        _ = ((Receiver)value).Seed;
        _ = (int)(object)1;
        _ = (double)data[0] / 2;
        _ = -(int)1.5;
        _ = (int)1.5 + (int)2.5;
        Consume((Receiver)value);
        Receiver local = (Receiver)value;
        _ = local;
        _ = new List<object> { (object)1, (object)"two" };
        _ = value is object ? (Receiver)value : null;
    }

    private void Consume(Receiver receiver)
    {
    }
}
