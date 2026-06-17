using Invoice.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Invoice.Api.Data;

public static class SeedData
{
    public const string MockUserId = "00000000-0000-0000-0000-000000000001";
    private const string DemoPasswordHash = "v1.uuPiH4y5bjEWBBWfhTPUug==.0K6SpzVttBqOxyNocVTEdUtSu+DahkWZyr69X1tV2UQ=";

    private static readonly (string Name, string Color, string Icon)[] InitialCategories =
    [
        ("Alimentacao", "#ef4444", "utensils"),
        ("iFood", "#dc2626", "bike"),
        ("Mercado", "#16a34a", "shopping-cart"),
        ("Transporte", "#2563eb", "bus"),
        ("Uber / Mobilidade", "#111827", "car"),
        ("Saude", "#0891b2", "heart-pulse"),
        ("Farmacia", "#0d9488", "pill"),
        ("Assinaturas", "#7c3aed", "repeat"),
        ("Compras", "#f97316", "shopping-bag"),
        ("Casa", "#92400e", "home"),
        ("Lazer", "#db2777", "ticket"),
        ("Educacao", "#4f46e5", "book-open"),
        ("Outros", "#64748b", "tag"),
        ("Credito / Estorno", "#059669", "undo-2")
    ];

    public static async Task EnsureSeededAsync(AppDbContext db)
    {
        var demoUser = await db.Users.FirstOrDefaultAsync(x => x.Id == MockUserId);
        if (demoUser is null)
        {
            db.Users.Add(new User
            {
                Id = MockUserId,
                Name = "Usuario demo",
                Email = "demo@local",
                PasswordHash = DemoPasswordHash
            });
        }
        else if (!demoUser.PasswordHash.StartsWith("v1."))
        {
            demoUser.PasswordHash = DemoPasswordHash;
        }

        foreach (var item in InitialCategories)
        {
            await EnsureCategoryAsync(db, MockUserId, item.Name, item.Color, item.Icon);
        }

        await db.SaveChangesAsync();
    }

    public static async Task EnsureDefaultCategoriesForUserAsync(
        AppDbContext db,
        string userId,
        CancellationToken cancellationToken = default)
    {
        foreach (var item in InitialCategories)
        {
            await EnsureCategoryAsync(db, userId, item.Name, item.Color, item.Icon, cancellationToken);
        }
    }

    private static async Task EnsureCategoryAsync(
        AppDbContext db,
        string userId,
        string name,
        string color,
        string icon,
        CancellationToken cancellationToken = default)
    {
        if (await db.Categories.AnyAsync(c => c.UserId == userId && c.Name == name, cancellationToken))
        {
            return;
        }

        db.Categories.Add(new Category
        {
            UserId = userId,
            Name = name,
            Color = color,
            Icon = icon
        });
    }
}
