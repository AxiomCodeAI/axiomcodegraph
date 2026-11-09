namespace App
{
    public static class Wire
    {
        public static void Created(string x) { }
        public static void Updated(string x) { }
        public static void OnCreated(string x) { Created(x); }
        public static void OnUpdated(string x) { Updated(x); }

        public static void Connect(Bus bus)
        {
            bus.On(x => Created(x));
            bus.On(x => Updated(x));
            bus.On(OnCreated);
            bus.On(OnUpdated);
        }
    }
}
