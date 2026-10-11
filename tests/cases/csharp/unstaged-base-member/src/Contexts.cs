using Microsoft.EntityFrameworkCore;

namespace App.Widgets;

public class WidgetContext : DbContext
{
    protected override void OnModelCreating(ModelBuilder mb) { }
}
public class AuditContext : DbContext
{
    protected override void OnModelCreating(ModelBuilder mb) { base.OnModelCreating(mb); }
}

public class LocalBase { public virtual void Build() { } }
public class OrderBuilder : LocalBase { public override void Build() { } }
public class UserBuilder : LocalBase { public override void Build() { base.Build(); } }
