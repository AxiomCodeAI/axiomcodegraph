package shop.core;

public final class Format {
    private Format() {}

    public static String formatAmount(long cents) {
        return String.format("$%.2f", cents / 100.0);
    }
}
