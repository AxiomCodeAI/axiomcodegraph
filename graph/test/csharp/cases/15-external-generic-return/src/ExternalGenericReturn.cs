using System.Collections.Generic;
using System.Threading.Tasks;

namespace Cases.ExternalGenericReturn
{
    public class Item { public void Clear() { } public int Count => 0; }

    // In-source methods whose declared return type is an unstaged generic.
    public class Source
    {
        public List<Item> Items() => new List<Item>();
        public Dictionary<string, Item> Map() => new Dictionary<string, Item>();
        public Task<Item> Load() => Task.FromResult(new Item());
    }

    public static class ItemListExtensions
    {
        public static int Total(this List<Item> items) => 0;
    }

    public class Use
    {
        // a `var` local holding the return: every member it reaches is the collection's
        public void OnVar(Source s) { var items = s.Items(); items.Clear(); }
        public int OnVarCount(Source s) { var items = s.Items(); return items.Count; }
        public Item OnVarIndex(Source s) { var items = s.Items(); return items[0]; }
        public void OnVarMap(Source s) { var map = s.Map(); map.Clear(); }

        // the call as the receiver, with no local
        public void OnDirect(Source s) => s.Items().Clear();
        public int OnDirectCount(Source s) => s.Items().Count;
        public Item OnDirectIndex(Source s) => s.Items()[0];

        // controls: the ELEMENT is an Item and still resolves in source
        public void OnElement(Source s) { var items = s.Items(); items[0].Clear(); }
        public void OnEach(Source s) { foreach (var i in s.Items()) i.Clear(); }
        public async Task OnAwait(Source s) { var i = await s.Load(); i.Clear(); }
        // an in-source extension on the unstaged return type still resolves
        public int OnExtension(Source s) => s.Items().Total();
    }
}
