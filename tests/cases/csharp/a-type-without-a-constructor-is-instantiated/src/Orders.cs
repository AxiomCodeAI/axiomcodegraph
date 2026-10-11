namespace App.Orders;

public interface IClock { DateTime Now(); }
public class SystemClock : IClock { public DateTime Now() => DateTime.UtcNow; }
public class GroundShipper { public GroundShipper() { } public void Ship() { } }
public class NeverBuilt { public int Size() => 0; }
public partial class Ledger { public int Total() => 0; }
public partial class Ledger { public int Count() => 0; }

public class Wiring
{
    private readonly SystemClock _clock = new();
    public IClock Clock() => new SystemClock();
    public GroundShipper Shipper() => new GroundShipper();
    public Ledger Book() => new Ledger();
    public int Named(NeverBuilt n) => n.Size();
}
