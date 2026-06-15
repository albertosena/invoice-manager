using Invoice.Api.Data;
using Invoice.Api.Models;
using Invoice.Api.Services;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddCors(options =>
{
    options.AddPolicy("frontend", policy =>
        policy.AllowAnyHeader().AllowAnyMethod().WithOrigins(
            "http://localhost:4200",
            "http://localhost:8080",
            "http://127.0.0.1:4200",
            "http://127.0.0.1:8080"));
});

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddHttpClient<ExtractorClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Extractor:BaseUrl"] ?? "http://localhost:8000");
});
builder.Services.AddScoped<CategorizationService>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await WaitForDatabaseAsync(db);
    await SeedData.EnsureSeededAsync(db);
}

const string mockUserId = SeedData.MockUserId;

app.MapPost("/api/invoices/upload", async (
    IFormFile file,
    AppDbContext db,
    ExtractorClient extractor,
    CategorizationService categorization,
    IWebHostEnvironment env,
    CancellationToken cancellationToken) =>
{
    if (file.Length == 0 || !file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest("Envie uma fatura em PDF.");
    }

    var uploadRoot = Path.Combine(env.ContentRootPath, "uploads", "invoices");
    Directory.CreateDirectory(uploadRoot);

    var storedName = $"{Guid.NewGuid():N}{Path.GetExtension(file.FileName)}";
    var filePath = Path.Combine(uploadRoot, storedName);

    await using (var stream = File.Create(filePath))
    {
        await file.CopyToAsync(stream, cancellationToken);
    }

    var invoice = new Invoice.Api.Models.Invoice
    {
        UserId = mockUserId,
        OriginalFileName = file.FileName,
        FilePath = filePath,
        Status = InvoiceStatus.Processing,
        ReferenceMonth = DateTime.UtcNow.Month,
        ReferenceYear = DateTime.UtcNow.Year
    };

    db.Invoices.Add(invoice);
    await db.SaveChangesAsync(cancellationToken);

    try
    {
        var extracted = await extractor.ExtractAsync(filePath, file.FileName, cancellationToken);
        invoice.BankName = extracted.Bank;
        invoice.Status = InvoiceStatus.Completed;

        var transactions = extracted.Transactions.Select(item =>
        {
            var normalized = TextNormalizer.NormalizeDescription(item.Description);
            return new Transaction
            {
                InvoiceId = invoice.Id,
                UserId = mockUserId,
                Date = item.Date,
                Description = item.Description,
                NormalizedDescription = normalized,
                RawCategory = item.RawCategory,
                Amount = item.Amount,
                Type = item.Type
            };
        }).ToList();

        await categorization.ApplyRulesAsync(mockUserId, transactions, cancellationToken);
        db.Transactions.AddRange(transactions);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/invoices/{invoice.Id}", new { invoice.Id, invoice.Status, Transactions = transactions.Count });
    }
    catch (Exception ex)
    {
        invoice.Status = InvoiceStatus.Failed;
        await db.SaveChangesAsync(cancellationToken);
        return Results.Problem($"Falha ao extrair fatura: {ex.Message}");
    }
}).DisableAntiforgery();

app.MapGet("/api/invoices", async (AppDbContext db, CancellationToken cancellationToken) =>
    await db.Invoices
        .OrderByDescending(i => i.CreatedAt)
        .Select(i => new
        {
            i.Id,
            i.BankName,
            i.CardName,
            i.ReferenceMonth,
            i.ReferenceYear,
            i.OriginalFileName,
            i.Status,
            i.CreatedAt,
            TransactionCount = i.Transactions.Count
        })
        .ToListAsync(cancellationToken));

app.MapGet("/api/invoices/{id:guid}", async (Guid id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var invoice = await db.Invoices
        .Where(i => i.Id == id)
        .Select(i => new
        {
            i.Id,
            i.BankName,
            i.CardName,
            i.ReferenceMonth,
            i.ReferenceYear,
            i.OriginalFileName,
            i.FilePath,
            i.Status,
            i.CreatedAt,
            Total = i.Transactions.Sum(t => t.Amount)
        })
        .FirstOrDefaultAsync(cancellationToken);

    return invoice is null ? Results.NotFound() : Results.Ok(invoice);
});

app.MapGet("/api/invoices/{id:guid}/transactions", async (Guid id, AppDbContext db, CancellationToken cancellationToken) =>
    await db.Transactions
        .Where(t => t.InvoiceId == id)
        .OrderBy(t => t.CreatedAt)
        .Select(t => new
        {
            t.Id,
            t.Date,
            t.Description,
            t.NormalizedDescription,
            t.RawCategory,
            t.Amount,
            t.Type,
            t.CategoryId,
            CategoryName = t.Category == null ? null : t.Category.Name
        })
        .ToListAsync(cancellationToken));

app.MapDelete("/api/invoices/{id:guid}", async (
    Guid id,
    AppDbContext db,
    IWebHostEnvironment env,
    CancellationToken cancellationToken) =>
{
    var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    if (invoice is null) return Results.NotFound();

    await db.Transactions
        .Where(t => t.InvoiceId == id)
        .ExecuteDeleteAsync(cancellationToken);

    db.Invoices.Remove(invoice);
    await db.SaveChangesAsync(cancellationToken);

    if (!string.IsNullOrWhiteSpace(invoice.FilePath) && File.Exists(invoice.FilePath))
    {
        var uploadRoot = Path.GetFullPath(Path.Combine(env.ContentRootPath, "uploads", "invoices"));
        var savedFile = Path.GetFullPath(invoice.FilePath);
        if (savedFile.StartsWith(uploadRoot, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(savedFile);
        }
    }

    return Results.NoContent();
});

app.MapPatch("/api/transactions/{id:guid}/category", async (
    Guid id,
    UpdateTransactionCategoryRequest request,
    AppDbContext db,
    CategorizationService categorization,
    CancellationToken cancellationToken) =>
{
    var transaction = await db.Transactions.FirstOrDefaultAsync(t => t.Id == id, cancellationToken);
    if (transaction is null) return Results.NotFound();

    await categorization.UpdateTransactionCategoryAsync(mockUserId, transaction, request.CategoryId, request.Mode, request.RulePattern, cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapPost("/api/transactions/bulk-categorize", async (
    BulkCategorizeRequest request,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var transactions = await db.Transactions
        .Where(t => request.TransactionIds.Contains(t.Id))
        .ToListAsync(cancellationToken);

    foreach (var transaction in transactions)
    {
        transaction.CategoryId = request.CategoryId;
    }

    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { Updated = transactions.Count });
});

app.MapGet("/api/categories", async (AppDbContext db, CancellationToken cancellationToken) =>
    await db.Categories.OrderBy(c => c.Name).ToListAsync(cancellationToken));

app.MapPost("/api/categories", async (CategoryRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var category = new Category
    {
        UserId = mockUserId,
        Name = request.Name.Trim(),
        Color = request.Color,
        Icon = request.Icon
    };
    db.Categories.Add(category);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/categories/{category.Id}", category);
});

app.MapPut("/api/categories/{id:guid}", async (Guid id, CategoryRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
    if (category is null) return Results.NotFound();

    category.Name = request.Name.Trim();
    category.Color = request.Color;
    category.Icon = request.Icon;
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapDelete("/api/categories/{id:guid}", async (Guid id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
    if (category is null) return Results.NotFound();

    await db.Transactions
        .Where(t => t.CategoryId == id)
        .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.CategoryId, (Guid?)null), cancellationToken);

    await db.CategorizationRules
        .Where(r => r.CategoryId == id)
        .ExecuteDeleteAsync(cancellationToken);

    db.Categories.Remove(category);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapGet("/api/categorization-rules", async (AppDbContext db, CancellationToken cancellationToken) =>
    await db.CategorizationRules.Include(r => r.Category).OrderBy(r => r.Pattern).ToListAsync(cancellationToken));

app.MapPost("/api/categorization-rules", async (CreateRuleRequest request, AppDbContext db, CancellationToken cancellationToken) =>
{
    var rule = new CategorizationRule
    {
        UserId = mockUserId,
        MatchType = request.MatchType,
        Pattern = request.Pattern,
        NormalizedPattern = TextNormalizer.NormalizeDescription(request.Pattern),
        CategoryId = request.CategoryId
    };
    db.CategorizationRules.Add(rule);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/categorization-rules/{rule.Id}", rule);
});

app.MapDelete("/api/categorization-rules/{id:guid}", async (Guid id, AppDbContext db, CancellationToken cancellationToken) =>
{
    var rule = await db.CategorizationRules.FirstOrDefaultAsync(r => r.Id == id, cancellationToken);
    if (rule is null) return Results.NotFound();

    db.CategorizationRules.Remove(rule);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
});

app.MapGet("/api/dashboard/monthly-summary", async (int? month, int? year, AppDbContext db, CancellationToken cancellationToken) =>
{
    var selectedMonth = month ?? DateTime.UtcNow.Month;
    var selectedYear = year ?? DateTime.UtcNow.Year;
    var transactions = db.Transactions.Where(t =>
        t.Invoice.ReferenceMonth == selectedMonth && t.Invoice.ReferenceYear == selectedYear);

    var debits = await transactions.Where(t => t.Amount > 0).SumAsync(t => t.Amount, cancellationToken);
    var credits = await transactions.Where(t => t.Amount < 0).SumAsync(t => t.Amount, cancellationToken);

    return Results.Ok(new
    {
        Month = selectedMonth,
        Year = selectedYear,
        TotalSpent = debits,
        TotalCredits = credits,
        NetAmount = debits + credits,
        TransactionCount = await transactions.CountAsync(cancellationToken)
    });
});

app.MapGet("/api/dashboard/category-summary", async (int? month, int? year, AppDbContext db, CancellationToken cancellationToken) =>
{
    var selectedMonth = month ?? DateTime.UtcNow.Month;
    var selectedYear = year ?? DateTime.UtcNow.Year;

    return await db.Transactions
        .Where(t => t.Invoice.ReferenceMonth == selectedMonth && t.Invoice.ReferenceYear == selectedYear)
        .GroupBy(t => new { t.CategoryId, CategoryName = t.Category == null ? "Sem categoria" : t.Category.Name })
        .Select(g => new
        {
            g.Key.CategoryId,
            g.Key.CategoryName,
            Total = g.Sum(t => t.Amount),
            Count = g.Count()
        })
        .OrderByDescending(x => x.Total)
        .ToListAsync(cancellationToken);
});

static async Task WaitForDatabaseAsync(AppDbContext db)
{
    for (var attempt = 1; attempt <= 10; attempt++)
    {
        try
        {
            await db.Database.MigrateAsync();
            return;
        }
        catch when (attempt < 10)
        {
            await Task.Delay(TimeSpan.FromSeconds(3));
        }
    }
}

app.Run();

public partial class Program;

public record UpdateTransactionCategoryRequest(Guid CategoryId, string Mode, string? RulePattern);
public record BulkCategorizeRequest(Guid[] TransactionIds, Guid CategoryId);
public record CategoryRequest(string Name, string Color, string Icon);
public record CreateRuleRequest(string MatchType, string Pattern, Guid CategoryId);
