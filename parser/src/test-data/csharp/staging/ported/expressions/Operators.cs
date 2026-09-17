// Port of the operator half of java/expressions/{ExpressionStatementTests,
// AssignmentExpressionExamples}.java.
// The C#-only operators are here too: `??`, `??=`, `?.`, `?[]`, `^index`,
// `range..`, `is`, `as`, and `>>>` (C# 11).
using System;
using System.Collections.Generic;

namespace Fixtures.Ported.Expressions;

public class OperatorExamples
{
    public int Arithmetic(int a, int b)
    {
        int add = a + b;
        int sub = a - b;
        int mul = a * b;
        int div = a / b;
        int rem = a % b;
        int neg = -a;
        int pos = +a;
        return add + sub + mul + div + rem + neg + pos;
    }

    public bool Comparison(int a, int b)
    {
        return a == b || a != b || a < b || a <= b || a > b || a >= b;
    }

    public bool Logical(bool p, bool q)
    {
        bool and = p && q;
        bool or = p || q;
        bool not = !p;
        bool eagerAnd = p & q;
        bool eagerOr = p | q;
        bool xor = p ^ q;
        return and || or || not || eagerAnd || eagerOr || xor;
    }

    public int Bitwise(int a, int b)
    {
        int and = a & b;
        int or = a | b;
        int xor = a ^ b;
        int complement = ~a;
        int shiftLeft = a << 2;
        int shiftRight = a >> 2;
        int unsignedShiftRight = a >>> 2;
        return and + or + xor + complement + shiftLeft + shiftRight + unsignedShiftRight;
    }

    public int IncrementDecrement(int seed)
    {
        int value = seed;
        int prefixInc = ++value;
        int postfixInc = value++;
        int prefixDec = --value;
        int postfixDec = value--;
        return prefixInc + postfixInc + prefixDec + postfixDec + value;
    }

    public int Ternary(int a, int b)
    {
        int max = a > b ? a : b;
        int nested = a > b ? (a > 0 ? a : 0) : (b > 0 ? b : 0);
        return max + nested;
    }

    // Null-coalescing and null-conditional. No Java form for any of these.
    public int NullHandling(string text, int[] data, Dictionary<string, int> map)
    {
        int length = text?.Length ?? 0;
        int first = data?[0] ?? -1;
        int count = map?.Count ?? 0;
        string chained = text?.Trim()?.ToUpperInvariant() ?? string.Empty;
        int? maybe = text?.Length;
        int unwrapped = maybe.GetValueOrDefault();
        int viaValue = maybe.HasValue ? maybe.Value : 0;
        return length + first + count + chained.Length + unwrapped + viaValue;
    }

    // Type-testing operators.
    public string TypeTests(object value)
    {
        if (value is string)
        {
            return "string";
        }

        if (value is int number)
        {
            return number.ToString();
        }

        string asString = value as string;
        if (asString != null)
        {
            return asString;
        }

        bool notNull = value is not null;
        bool isIntOrLong = value is int or long;
        bool isSmallInt = value is int and < 100;
        return $"{notNull}{isIntOrLong}{isSmallInt}";
    }

    // Index and range operators (C# 8) — no Java form.
    public string IndexAndRange(string text, int[] data)
    {
        char last = text[^1];
        char secondLast = text[^2];
        string head = text[..3];
        string tail = text[3..];
        string middle = text[1..^1];
        string whole = text[..];
        Index index = ^1;
        Range range = 1..4;
        int[] slice = data[range];
        int item = data[index];
        return $"{last}{secondLast}{head}{tail}{middle}{whole}{slice.Length}{item}";
    }

    public int MixedPrecedence(int a, int b, int c)
    {
        return a + b * c - (a + b) / c % a << 1 | b & c ^ a;
    }

    // Every compound assignment form, including `??=`. Two on one line, to
    // prove each gets its own wrapper.
    public int CompoundAssignments(int seed)
    {
        int a = seed;
        int b = seed;

        a += 1; b += 2;

        a -= 1;
        a *= 2;
        a /= 2;
        a %= 3;
        a &= 0xFF;
        a |= 0x0F;
        a ^= 0xF0;
        a <<= 1;
        a >>= 1;
        a >>>= 1;

        string s = null;
        s ??= "defaulted";
        s += "!";

        return a + b + s.Length;
    }

    public void CompoundOnMembersAndElements(int[] data, Dictionary<string, int> map)
    {
        data[0] += 1;
        map["k"] += 1;
        Counter += 1;
        Nested.Counter -= 1;
        this.Counter *= 2;
    }

    public int Counter;

    public OperatorExamples Nested;

    // `checked` and `unchecked` in expression position.
    public int CheckedExpressions(int a, int b)
    {
        int unchecked1 = unchecked(a * b);
        int checkedCast = unchecked((int)4_000_000_000L);
        return unchecked1 + checkedCast;
    }
}
