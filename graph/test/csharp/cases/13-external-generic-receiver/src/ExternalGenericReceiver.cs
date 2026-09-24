using System.Collections.Generic;

namespace Cases.ExternalGenericReceiver
{
    public class Bag { public void Clear() { } public string this[int i] => "in-source"; public int Count => 0; }
    public class Basket { public void Clear() { } public void Add(Basket b) { } }

    // Nothing here declares List<T>, Dictionary<K,V> or ICollection<T>, so every call
    // on one of those receivers is external: it must be labelled, not committed to a
    // member of the type ARGUMENT.
    public class Use
    {
        public void OnListOfInt(List<int> items) => items.Clear();
        public void OnListOfBag(List<Bag> bags) => bags.Clear();
        public void OnListOfBasket(List<Basket> baskets) => baskets.Clear();
        public Bag IndexerOnListOfBag(List<Bag> bags) => bags[0];
        public void OnDictionary(Dictionary<string, Bag> map) => map.Clear();
        public void AddOnCollection(ICollection<Basket> baskets, Basket b) => baskets.Add(b);

        // the same receiver reached through a declared return type
        public List<Bag> Make() => new List<Bag>();
        public void OnReturned() => Make().Clear();

        // controls: the element IS a Bag, and in-source receivers still resolve
        public void OnElement(List<Bag> bags) => bags[0].Clear();
        public void OnEachElement(List<Bag> bags) { foreach (var b in bags) b.Clear(); }
        public void OnInSource(Bag b) => b.Clear();
        public string IndexerOnInSource(Bag b) => b[0];
        public int CountOnInSource(Bag b) => b.Count;
    }
}
