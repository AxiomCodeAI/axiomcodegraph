using Shop.Core;

namespace Shop.Orders
{
    public static class Invoice
    {
        public static string SubtotalLabel(long cents)
        {
            return "Subtotal: " + Format.FormatAmount(cents);
        }

        public static string TotalLabel(long cents)
        {
            return "Total: " + Format.FormatAmount(cents);
        }
    }
}
