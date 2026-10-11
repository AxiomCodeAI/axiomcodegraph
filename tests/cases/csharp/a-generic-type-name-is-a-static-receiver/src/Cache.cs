namespace N
{
    public static class Cache<T>
    {
        public static T Get(string key) { return default(T); }
        public static Store Shared = new Store();
    }

    public static class Cache
    {
        // a non-generic type of the same name: `Cache.Get` is this one
        public static object Get(string key) { return null; }
    }

    public class Store { public void Touch() { } }

    public class Pair<A, B>
    {
        public static Pair<A, B> Make() { return new Pair<A, B>(); }
        public void Use() { }
    }
}
