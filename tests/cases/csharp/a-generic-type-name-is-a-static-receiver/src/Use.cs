namespace N
{
    public static class Use
    {
        public static int Typed() { return Cache<int>.Get("x"); }
        public static void Chained() { Pair<int, string>.Make().Use(); }
        public static void Member() { Cache<string>.Shared.Touch(); }
        public static object Plain() { return Cache.Get("y"); }
    }
}
