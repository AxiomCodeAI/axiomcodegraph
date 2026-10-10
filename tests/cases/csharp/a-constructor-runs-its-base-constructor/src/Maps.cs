using System;

namespace Maps
{
    public abstract class Map
    {
        protected Map() { Register(); }
        protected Map(string name) { Register(); }
        void Register() { }
    }

    public abstract class Map<T> : Map
    {
        // no initializer: runs Map() before its body
        protected Map() { }
    }

    public class PersonMap : Map<string>
    {
        // no initializer, generic base: runs Map<string>() and through it Map()
        public PersonMap() { Console.WriteLine("person"); }
    }

    public class PlainMap : Map<int>
    {
        // no constructor at all: its implicit one runs Map<int>()
    }

    public class NamedMap : Map
    {
        // control: an explicit `: base(name)` runs that constructor, not the parameterless one
        public NamedMap(string name) : base(name) { }
    }

    public class SelfMap : Map
    {
        // control: `: this(..)` delegates; this constructor itself runs no base constructor
        public SelfMap() : this(1) { }
        public SelfMap(int x) { }
    }
}
