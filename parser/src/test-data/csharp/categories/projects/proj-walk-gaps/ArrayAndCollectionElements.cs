// CS-CORPUS-2. Array creation emits no expression row at all, and the elements
// of arrays and collection expressions are never walked. 15,188 call sites,
// 24.0% of every call site Roslyn produced and the parser did not.
//
// The controls matter here: object, collection and dictionary initialisers and
// the `= { ... }` field shorthand all walk CORRECTLY, so this is not "the walk
// stops at initialisers" -- it is specifically array_creation,
// implicit array_creation and collection_expression.
using System.Collections.Generic;

namespace Fixtures.WalkGaps
{
    public class Box { public Box() { } public Box(int i) { } }

    public class ArrayAndCollectionElements
    {
        // GAP: explicit array creation with an initialiser
        static object[] ExplicitArray = new object[] { new Box(1), new Box(2) };

        // GAP: implicit array creation
        static object[] ImplicitArray = new[] { (object)new Box(3) };

        // GAP: implicit array of explicit arrays -- the the modern-app corpus and the LINQ corpus shape
        static object[][] Nested = new[] { new object[] { new Box(4) } };

        // GAP: collection expression. The COLLECTION_EXPRESSION wrapper IS
        // emitted and its child is not, which is section 3's defect class
        // exactly: the parts get emitted, the structure does not.
        static object[] CollectionExpression = [new Box(7)];

        // GAP: a collection expression returned from an expression-bodied
        // member. 5,658 call sites in ONE the LINQ corpus file take this shape.
        public static Box[] FromArrowBody() => [new Box(10), new Box(11)];

        // CONTROL: the `= { ... }` array shorthand on a field. Walks correctly.
        static object[] Shorthand = { new Box(5) };

        // CONTROL: collection initialiser. Walks correctly.
        static List<object> CollectionInitialiser = new List<object> { new Box(6) };

        // CONTROL: object initialiser. Walks correctly.
        class Holder { public object? P { get; set; } }
        static Holder ObjectInitialiser = new Holder { P = new Box(8) };

        // CONTROL: dictionary initialiser, both spellings. Walk correctly.
        // They must be SEPARATE declarations: mixing `{ k, v }` with `[k] = v`
        // in one initialiser is CS0747, "invalid initializer member
        // declarator". Written as one and split on the compiler's word.
        static Dictionary<int, object> DictionaryAddForm =
            new Dictionary<int, object> { { 1, new Box(11) } };
        static Dictionary<int, object> DictionaryIndexForm =
            new Dictionary<int, object> { [2] = new Box(12) };

        // CONTROL: a bare object creation.
        static object Plain = new Box(9);
    }
}
