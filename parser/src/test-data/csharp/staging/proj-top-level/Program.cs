// TOP-LEVEL STATEMENTS. No namespace, no type, no method declaration — and the
// first eleven statements below are the body of a Main the source never names.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

// Statements at file scope.
Console.WriteLine("start");

// `args` is in scope here and is declared NOWHERE. It is the synthesised
// Main's parameter.
int argumentCount = args.Length;
string joined = string.Join(",", args);

// Local variables at file scope, which are locals of the synthesised Main and
// not fields of anything.
var numbers = new List<int> { 3, 1, 2 };
int total = numbers.Sum();
var sorted = numbers.OrderBy(n => n).ToList();

// A LOCAL FUNCTION at file scope.
int Doubled(int value) => value * 2;

// A lambda at file scope, capturing a file-scope local.
Func<int, int> scale = value => value * total;

// Control flow at file scope.
foreach (int n in sorted)
{
    if (n % 2 == 0)
    {
        Console.WriteLine(Doubled(n));
    }
    else
    {
        Console.WriteLine(scale(n));
    }
}

try
{
    Console.WriteLine(Helper.Describe(total));
}
catch (Exception e)
{
    Console.Error.WriteLine(e.Message);
}

// `await` at file scope makes the synthesised Main async and its return type
// Task<int> — a signature nothing in the file states.
await Task.Delay(1);

// A return at file scope sets the process exit code.
Console.WriteLine($"{argumentCount}{joined}");
return total > 0 ? 0 : 1;

// TYPE DECLARATIONS ARE STILL LEGAL, but only AFTER the last top-level
// statement. Everything below this line is an ordinary declaration in the
// global namespace, and everything above it is a statement in a method that
// does not exist in source. One file, two owners.

static class Helper
{
    public static string Describe(int value) => $"total={value}";
}

record Row(int Id, string Name);

interface IMarker
{
}

enum Kind
{
    A,
    B
}

namespace Nested
{
    // A namespace AFTER top-level statements, in the same file.
    class InNamespace
    {
        public int Value => 1;
    }
}
