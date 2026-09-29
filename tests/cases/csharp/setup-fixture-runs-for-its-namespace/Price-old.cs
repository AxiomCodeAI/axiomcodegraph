namespace App;

public class WidgetPricer
{
    public int Price(int q) => q * 3;
    public int Tax(int q) => q + 1;
    public int Discount(int q) => q - 1;
}
