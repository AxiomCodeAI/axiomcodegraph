package shop;

public class Checkout {
    public int settle() { return new Order().total(); }
}
