namespace Shop;

public class Pricer
{
    public int Price(int q) => q * 2;
    public int Tax(int q) => q / 10;
    public int Audit(int q) => q;
    public int Sweep(int q) => q + 1;
}
