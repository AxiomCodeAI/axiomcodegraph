using Microsoft.EntityFrameworkCore;

public class Gadget
{
    public int Id { get; set; }
}

public interface IRepository<T>
{
    T Find(int id);
}

public class GadgetRepository : IRepository<Gadget>
{
    public Gadget Find(int id) => new Gadget();
}

public class GadgetStore
{
    public int Count() => 2;
}

public static class Setup
{
    public static GadgetStore Make() => new GadgetStore();

    public static int Report(GadgetStore g) => g.Count();

    public static int Lookup(IRepository<Gadget> repo) => repo.Find(1).Id;

    public static T First<T>(IRepository<T> repo) where T : Gadget => repo.Find(0);
}

public class ShopDb : DbContext
{
    public DbSet<Gadget> Gadgets { get; set; } = null!;
}
