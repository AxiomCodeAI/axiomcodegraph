package shop.orders;

import shop.core.Format;

public final class Invoice {
    private Invoice() {}

    public static String subtotalLabel(long cents) {
        return "Subtotal: " + Format.formatAmount(cents);
    }

    public static String totalLabel(long cents) {
        return "Total: " + Format.formatAmount(cents);
    }
}
