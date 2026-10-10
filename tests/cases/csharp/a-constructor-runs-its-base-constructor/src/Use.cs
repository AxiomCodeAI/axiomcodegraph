namespace Maps
{
    public static class Use
    {
        public static void Person() { var m = new PersonMap(); }
        public static void Plain() { var m = new PlainMap(); }
        public static void Named() { var m = new NamedMap("n"); }
    }
}
