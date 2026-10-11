using Vendor.Ui;

namespace App;

public class OrderHandler
{
    public void Handle() { }
}

public class OrderController
{
    private readonly OrderHandler _h = new OrderHandler();

    public void Detail() { _h.Handle(); }
}

public class OrderPage
{
    private Panel Summary { get; set; } = null!;

    public void Show() { Summary.Open(); }
}
