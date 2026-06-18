using Invoice.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Invoice.Api.Data;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Invoice.Api.Models.Invoice> Invoices => Set<Invoice.Api.Models.Invoice>();
    public DbSet<Transaction> Transactions => Set<Transaction>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<CategorizationRule> CategorizationRules => Set<CategorizationRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.Email).IsUnique();
        });

        modelBuilder.Entity<Invoice.Api.Models.Invoice>(entity =>
        {
            entity.ToTable("invoices");
            entity.HasKey(x => x.Id);
            entity.HasMany(x => x.Transactions).WithOne(x => x.Invoice).HasForeignKey(x => x.InvoiceId);
        });

        modelBuilder.Entity<Transaction>(entity =>
        {
            entity.ToTable("transactions");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Amount).HasPrecision(14, 2);
            entity.HasIndex(x => x.NormalizedDescription);
        });

        modelBuilder.Entity<Category>(entity =>
        {
            entity.ToTable("categories");
            entity.HasKey(x => x.Id);
            entity.Property(x => x.MonthlyGoal).HasPrecision(14, 2);
            entity.HasIndex(x => new { x.UserId, x.Name }).IsUnique();
        });

        modelBuilder.Entity<CategorizationRule>(entity =>
        {
            entity.ToTable("categorization_rules");
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => x.NormalizedPattern);
        });
    }
}
