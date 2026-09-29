namespace Shop.Core
{
    public static class Format
    {
        public static string FormatAmount(long cents)
        {
            return "$" + (cents / 100.0).ToString("0.00");
        }
    }
}
