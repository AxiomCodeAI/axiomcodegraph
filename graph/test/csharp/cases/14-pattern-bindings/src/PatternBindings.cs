using System.Collections.Generic;

namespace Cases.PatternBindings
{
    public class Shape { public virtual double Area() => 0; }
    public class Circle : Shape { public override double Area() => 3; public double Radius() => 1; }
    public class Square : Shape { public override double Area() => 4; }

    // An in-source map whose own indexer takes a position, over an unstaged base whose
    // indexer takes the key. `map[key]` binds to the base's.
    public class Key { }
    public interface IOrderedMap<K, V> : IDictionary<K, V> { KeyValuePair<K, V> this[int index] { get; } }

    public class Use
    {
        // an is-pattern binds a local of the pattern's type
        public double OnIs(object o) { if (o is Circle c) return c.Radius(); return 0; }
        public double OnIsBase(object o) { if (o is Shape s) return s.Area(); return 0; }
        public double OnNegated(object o) { if (o is not Circle c) return 0; return c.Radius(); }

        // a switch statement's case pattern and a switch expression arm
        public double OnSwitch(Shape s)
        {
            switch (s)
            {
                case Circle c: return c.Radius();
                case Square q: return q.Area();
                default: return 0;
            }
        }
        public double OnSwitchExpression(Shape s) => s switch { Circle c => c.Radius(), _ => 0 };

        // an external type in the pattern is labelled, not left a blind spot
        public void OnExternal(object o) { if (o is List<Circle> cs) cs.Clear(); }

        // a pattern binding that exposes an indexer the unstaged base may also declare
        public string OnMapByKey(object o, Key k) { if (o is IOrderedMap<Key, string> m) return m[k]; return ""; }
        public string OnMapByKeyParameter(IOrderedMap<Key, string> m, Key k) => m[k];

        // control: the same calls on a parameter already resolve
        public double OnParameter(Circle c) => c.Radius();
    }
}
