namespace App
{
    public class Stock
    {
        public int Count(string sku) { return sku.Length; }
    }

    public class Counter
    {
        private readonly Stock _stock = new Stock();
        private readonly dynamic _meter;

        public Counter(dynamic meter) { _meter = meter; }

        public int Total(string sku) { return _stock.Count(sku); }

        public int Metered(string sku) { return _meter.Count(sku); }
    }
}
