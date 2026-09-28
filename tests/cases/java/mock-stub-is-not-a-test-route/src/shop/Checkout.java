package shop;

public class Checkout {
    private final PriceService prices;

    public Checkout(PriceService prices) {
        this.prices = prices;
    }

    public int total(int id) {
        return prices.price(id) + 1;
    }
}
