using Microsoft.EntityFrameworkCore;

namespace Shop;

public class ShopDbContext : DbContext
{
    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.HasDefaultSchema("shop");
    }
}
