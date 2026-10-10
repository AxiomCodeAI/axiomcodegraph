using System.Collections.Generic;

namespace App;

public static class Use
{
    public static void Block() { using (var r = new Reader()) { } }
    public static void Declared() { using var r = new Reader(); }
    public static void Held(Reader r) { using (r) { } }
    public static void Listed() { var b = new Bag { 1, { 2, 3 } }; }
    public static void Sized() { var b = new Bag { Size = 4 }; }
    public static void Looped(Bag b) { foreach (var x in b) { } }
    public static void Plain(List<int> l) { foreach (var x in l) { } }
}
