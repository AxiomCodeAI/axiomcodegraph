using FluentValidation;
using FluentValidation.Results;
using FluentValidation.Validators;
using Grpc.Core;
using Grpc.Core.Interceptors;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Migrations;

namespace App.Data;

public class User { public string Name { get; set; } = ""; public List<string> Tags { get; set; } = new(); }
public static class Rules { public static bool NotBlank(string s) => s != ""; public static bool Short(int n) => n < 10; }

public class UserValidator : AbstractValidator<User>
{
    public UserValidator() { RuleFor(u => u.Tags).SetValidator(new MaxCount<User, string>()); }
    protected override bool PreValidate(ValidationContext<User> c, ValidationResult r) => Rules.NotBlank(c.InstanceToValidate.Name);
}
public class MaxCount<T, E> : PropertyValidator<T, List<E>>
{
    public override string Name => "MaxCount";
    public override bool IsValid(ValidationContext<T> c, List<E> items) => Rules.Short(items.Count);
}
public class LoggingInterceptor : Interceptor
{
    public override Task<TResponse> UnaryServerHandler<TRequest, TResponse>(TRequest request,
        ServerCallContext context, UnaryServerMethod<TRequest, TResponse> continuation)
        => continuation(request, context);
}
public class ShopContext(DbContextOptions<ShopContext> o) : DbContext(o)
{
    public DbSet<User> Users => Set<User>();
    protected override void OnModelCreating(ModelBuilder mb) => mb.ApplyConfigurationsFromAssembly(typeof(ShopContext).Assembly);
    protected override void OnConfiguring(DbContextOptionsBuilder b) { }
}
public class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> b) => b.HasKey(u => u.Name);
}
public partial class AddUsers : Migration
{
    protected override void Up(MigrationBuilder mb) { }
    protected override void Down(MigrationBuilder mb) { }
}
public class AuditInterceptor : SaveChangesInterceptor
{
    public override InterceptionResult<int> SavingChanges(DbContextEventData e, InterceptionResult<int> r) => r;
}
public class ShopContextFactory : IDesignTimeDbContextFactory<ShopContext>
{
    public ShopContext CreateDbContext(string[] args) => new(new DbContextOptionsBuilder<ShopContext>().Options);
}
// controls: the same names on a type that derives from nothing the framework calls
public class Plain
{
    public bool IsValid(int n) => Rules.Short(n);
    public void Up(int n) { }
    public void OnModelCreating(int n) { }
    public object CreateDbContext(string[] args) => new();
}
