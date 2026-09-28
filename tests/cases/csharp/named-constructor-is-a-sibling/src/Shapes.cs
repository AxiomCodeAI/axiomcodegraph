using System.Collections.Generic;
using System.Linq;

namespace Demo
{
    public static class Util { public static void X() { } public static void Y() { } public static void Z() { } }

    public class Box { public Box() { Util.X(); } public void Open() { Util.Y(); } }

    public class Shelf(List<int> items) { public int Count() => items.Count(i => { Util.Z(); return i > 0; }); }

    public class Users
    {
        public void MakeBox() { new Box(); }
        public void OpenBox(Box b) { b.Open(); }
        public void CountShelf(Shelf s) { s.Count(); }
    }
}
