package shop;

public class PercentDiscount implements Discount {
    private final int pct;
    public PercentDiscount(int pct) { this.pct = pct; }
    @Override public int apply(int amount) { return round(amount - amount * pct / 100); }
    private static int round(int v) { return v; }   // same-file static, for contrast
}
