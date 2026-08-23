package shop;

public class PriceCalculator {
    private static final int UNIT = 100;
    int subtotal(int units) { return units * UNIT; }
    static int tax(int amount) { return amount / 10; }
}
