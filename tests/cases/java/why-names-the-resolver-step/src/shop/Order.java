package shop;

public class Order {
    public int total() { return subtotal() + 1; }

    int subtotal() { return 2; }
}
