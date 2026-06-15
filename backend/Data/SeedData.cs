using Invoice.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Invoice.Api.Data;

public static class SeedData
{
    public const string MockUserId = "00000000-0000-0000-0000-000000000001";

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
        if (!await db.Users.AnyAsync(x => x.Id == MockUserId))
        {
            db.Users.Add(new User
            {
                Id = MockUserId,
                Name = "Usuario demo",
                Email = "demo@local",
                PasswordHash = "mock"
            });
        }

        foreach (var item in InitialCategories)
        {
            if (!await db.Categories.AnyAsync(c => c.UserId == MockUserId && c.Name == item.Name))
            {
                db.Categories.Add(new Category
                {
                    UserId = MockUserId,
                    Name = item.Name,
                    Color = item.Color,
                    Icon = item.Icon
                });
            }
        }

        await db.SaveChangesAsync();
    }
}
