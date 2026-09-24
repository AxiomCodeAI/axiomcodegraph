using System.Collections.Generic;
using System.Text;

namespace Cases.TargetTypedNewExternal
{
    public class Item { public Item() { } }

    // A target-typed `new(...)` writes no type name: the type comes from where it is
    // written. Where that declared type is unstaged, the construction leaves the source.
    public class Holder
    {
        private readonly List<Item> _items = new();                 // a field
        public Dictionary<string, Item> Map { get; } = new();       // a property
        private List<Item> _later;

        public List<Item> Make() => new();                          // an expression body
        public StringBuilder Build() { return new(16); }            // a return statement
        public int Local() { List<int> xs = new(); return xs.Count; } // an explicit local
        public void Assign() { _later = new(); }                    // an assignment
        public string Keyword() { string s = new('a', 3); return s; } // a keyword alias

        // controls: an in-source target type still resolves to its constructor
        private readonly Item _item = new();
        public Item MakeItem() => new();
    }
}
