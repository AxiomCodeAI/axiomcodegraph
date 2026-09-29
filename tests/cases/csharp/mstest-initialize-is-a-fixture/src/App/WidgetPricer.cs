namespace App;

public class WidgetPricer
{
    public int Price(int q) => q * 2;
    public int Tax(int q) => q / 10;
    public int Refund(int q) => q;
}
