// Port of java/blocks/{AdvancedExceptionHandling,ComprehensiveExceptionPatterns,
// CustomTypes}.java
//
// NO ANALOGUE — CHECKED EXCEPTIONS. C# has no `throws` clause and no checked
// exceptions of any kind. Java's ThrowsPatterns.java and the THROWS_CLAUSE
// type-reference context have NO port here and none is invented. The nearest
// real-world C# equivalents, which are what this file covers instead, are:
//   * an exception class hierarchy,
//   * `catch (T e) when (filter)` — an exception FILTER, which Java has no
//     form of and which does not unwind the stack when it evaluates false,
//   * XML <exception cref="..."/> documentation, which is advisory only.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.Serialization;

namespace Fixtures.Ported.Blocks;

public class DomainException : Exception
{
    public DomainException()
    {
    }

    public DomainException(string message)
        : base(message)
    {
    }

    public DomainException(string message, Exception inner)
        : base(message, inner)
    {
    }

    public string Code { get; init; } = "E_UNKNOWN";
}

public sealed class NotFoundException : DomainException
{
    public NotFoundException(string entity, object key)
        : base($"{entity} '{key}' was not found")
    {
        Entity = entity;
        Key = key;
    }

    public string Entity { get; }

    public object Key { get; }
}

public sealed class ValidationException : DomainException
{
    public ValidationException(IReadOnlyList<string> failures)
        : base("validation failed")
    {
        Failures = failures;
    }

    public IReadOnlyList<string> Failures { get; }
}

public class ExceptionPatterns
{
    /// <summary>Documented, not enforced.</summary>
    /// <exception cref="NotFoundException">Advisory only — the compiler does
    /// not check it and no caller is obliged to handle it.</exception>
    public string Find(string key)
    {
        if (key.Length == 0)
        {
            throw new NotFoundException("entity", key);
        }

        return key;
    }

    public string TryCatchFinally(string key)
    {
        try
        {
            return Find(key);
        }
        catch (NotFoundException)
        {
            return string.Empty;
        }
        finally
        {
            GC.KeepAlive(key);
        }
    }

    // Ordered catch clauses, most derived first — the C# rule, same as Java's.
    public string OrderedCatches(string key)
    {
        try
        {
            return Find(key);
        }
        catch (NotFoundException e)
        {
            return e.Entity;
        }
        catch (ValidationException e)
        {
            return string.Join(",", e.Failures);
        }
        catch (DomainException e)
        {
            return e.Code;
        }
        catch (Exception e)
        {
            return e.Message;
        }
    }

    // Catch with no type at all — catches everything, including non-CLS
    // exceptions. No Java form.
    public string GeneralCatch()
    {
        try
        {
            throw new InvalidOperationException();
        }
        catch
        {
            return "swallowed";
        }
    }

    // EXCEPTION FILTERS. `when` is evaluated in a first pass, before any
    // unwinding, and a false filter leaves the frame intact. This is the
    // construct that replaces multi-catch and it is not the same thing.
    public string Filters(int status)
    {
        try
        {
            throw new IOException("io", status);
        }
        catch (IOException e) when (e.HResult == 404)
        {
            return "not found";
        }
        catch (IOException e) when (e.HResult >= 500 && e.HResult < 600)
        {
            return "server";
        }
        catch (Exception e) when (Log(e))
        {
            // Log returns false, so this clause never catches — the idiomatic
            // "filter as a side-effecting observer" pattern from real code.
            throw;
        }
        catch (IOException)
        {
            return "other io";
        }
    }

    private static bool Log(Exception e) => false;

    // The Java multi-catch `catch (A | B e)` has NO C# spelling. The real
    // replacement is one clause plus a type test in the filter.
    public string MultiCatchReplacement()
    {
        try
        {
            throw new ArgumentNullException("p");
        }
        catch (Exception e) when (e is ArgumentNullException || e is ArgumentOutOfRangeException)
        {
            return "argument";
        }
    }

    // Rethrow preserving the stack (`throw;`) versus rethrow resetting it
    // (`throw e;`) — a distinction Java does not have, because Java always
    // preserves.
    public void RethrowForms()
    {
        try
        {
            Find(string.Empty);
        }
        catch (DomainException)
        {
            throw;
        }
    }

    public void RethrowResetting()
    {
        try
        {
            Find(string.Empty);
        }
        catch (DomainException e)
        {
            throw e;
        }
    }

    public void WrapAndThrow()
    {
        try
        {
            Find(string.Empty);
        }
        catch (DomainException e)
        {
            throw new InvalidOperationException("wrapped", e);
        }
    }

    // `throw` in EXPRESSION position — C# 7. Java's throw is a statement only.
    public string ThrowExpressions(string value, string fallback)
    {
        string chosen = value ?? throw new ArgumentNullException(nameof(value));
        string other = fallback ?? throw new ArgumentNullException(nameof(fallback));
        return chosen.Length > 0
            ? chosen
            : throw new ValidationException(new[] { "empty" });
    }

    public int ThrowInExpressionBody(int index) =>
        index >= 0 ? index : throw new ArgumentOutOfRangeException(nameof(index));

    // Nested try, try inside catch, try inside finally.
    public string NestedTry(string key)
    {
        try
        {
            try
            {
                return Find(key);
            }
            catch (NotFoundException)
            {
                try
                {
                    return Find("fallback");
                }
                finally
                {
                    GC.KeepAlive(key);
                }
            }
        }
        finally
        {
            try
            {
                GC.KeepAlive(key);
            }
            catch (Exception)
            {
                // deliberately empty
            }
        }
    }

    // try/finally with no catch at all.
    public int TryFinallyOnly(int seed)
    {
        int result = 0;
        try
        {
            result = seed * 2;
        }
        finally
        {
            result += 1;
        }

        return result;
    }

    public AggregateException Aggregate()
    {
        return new AggregateException(
            new NotFoundException("a", 1),
            new ValidationException(new[] { "b" }));
    }
}
