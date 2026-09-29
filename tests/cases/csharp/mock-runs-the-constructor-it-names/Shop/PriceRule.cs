namespace Shop;

public class PriceRule
{
    public PriceRule(decimal rate) { Rate = rate; }
    public PriceRule(decimal rate, decimal floor) { Rate = rate + floor; }
    public virtual decimal Rate { get; }
    public virtual decimal Apply(decimal a) => a + Fee();
    protected virtual decimal Fee() => 1m;
    protected virtual decimal Levy() => 2m;
    protected virtual System.Threading.Tasks.Task<decimal> Tip() => System.Threading.Tasks.Task.FromResult(0m);
}

public class Coupon
{
    protected virtual decimal Fee() => 3m;
}
