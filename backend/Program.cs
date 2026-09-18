using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Invoice.Api.Data;
using Invoice.Api.Models;
using Invoice.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

var jwtKey = builder.Configuration["Jwt:Key"];
if (!builder.Environment.IsDevelopment() &&
    (string.IsNullOrWhiteSpace(jwtKey) || jwtKey.Length < 32))
{
    throw new InvalidOperationException(
        "Jwt:Key must be explicitly configured with at least 32 characters outside Development.");
}

jwtKey ??= "invoice-manager-development-key-change-me";

var defaultConnection = builder.Configuration.GetConnectionString("DefaultConnection");
if (!builder.Environment.IsDevelopment() && string.IsNullOrWhiteSpace(defaultConnection))
{
    throw new InvalidOperationException(
        "ConnectionStrings:DefaultConnection must be explicitly configured outside Development.");
}

builder.Services.AddOpenApi();
builder.Services.AddCors(options =>
{
    var configuredOrigins = builder.Configuration
        .GetSection("Cors:AllowedOrigins")
        .Get<string[]>() ?? [];
    var allowedOrigins = new[]
    {
        "http://localhost:4200",
        "http://localhost:8080",
        "http://127.0.0.1:4200",
        "http://127.0.0.1:8080",
        "https://invoice.albertosena.com"
    }.Concat(configuredOrigins).Distinct().ToArray();

    options.AddPolicy("frontend", policy =>
        policy.AllowAnyHeader().AllowAnyMethod().WithOrigins(allowedOrigins));
});

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "invoice-manager";
var signingKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey));

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtIssuer,
            IssuerSigningKey = signingKey
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseNpgsql(defaultConnection);
    options.ConfigureWarnings(w => w.Ignore(RelationalEventId.PendingModelChangesWarning));
});

builder.Services.AddHttpClient<ExtractorClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["Extractor:BaseUrl"] ?? "http://localhost:8000");
});
builder.Services.AddScoped<CategorizationService>();
builder.Services.AddSingleton<NubankCsvParser>();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("frontend");
app.UseAuthentication();
app.UseAuthorization();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await WaitForDatabaseAsync(db);
    if (app.Environment.IsDevelopment())
    {
        await SeedData.EnsureSeededAsync(db);
    }
    await RepairCategorizationRulePatternsAsync(db);
}

app.MapPost("/api/auth/register", async (
    RegisterRequest request,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var email = NormalizeEmail(request.Email);
    var name = request.Name.Trim();
    var password = request.Password;

    if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(email) || password.Length < 6)
    {
        return Results.BadRequest(new { Detail = "Informe nome, email e senha com pelo menos 6 caracteres." });
    }

    if (await db.Users.AnyAsync(user => user.Email == email, cancellationToken))
    {
        return Results.Conflict(new { Detail = "Ja existe uma conta com este email." });
    }

    var user = new User
    {
        Name = name,
        Email = email,
        PasswordHash = HashPassword(password)
    };

    db.Users.Add(user);
    await SeedData.EnsureDefaultCategoriesForUserAsync(db, user.Id, cancellationToken);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Created("/api/auth/me", CreateAuthResponse(user, jwtIssuer, signingKey));
});

app.MapPost("/api/auth/login", async (
    LoginRequest request,
    AppDbContext db,
    CancellationToken cancellationToken) =>
{
    var email = NormalizeEmail(request.Email);
    var user = await db.Users.FirstOrDefaultAsync(item => item.Email == email, cancellationToken);

    if (user is null || !VerifyPassword(request.Password, user.PasswordHash))
    {
        return Results.Unauthorized();
    }

    return Results.Ok(CreateAuthResponse(user, jwtIssuer, signingKey));
});

app.MapGet("/api/auth/me", (HttpContext context) =>
    Results.Ok(new UserResponse(CurrentUserId(context), CurrentUserName(context), CurrentUserEmail(context))))
    .RequireAuthorization();

app.MapPost("/api/invoices/upload", async (
    IFormFile file,
    AppDbContext db,
    ExtractorClient extractor,
    CategorizationService categorization,
    IWebHostEnvironment env,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);

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

    try
    {
        var extracted = await extractor.ExtractAsync(filePath, file.FileName, cancellationToken);
        var duplicateExists = await db.Invoices.AnyAsync(invoice =>
            invoice.UserId == userId &&
            invoice.ReferenceMonth == extracted.ReferenceMonth &&
            invoice.ReferenceYear == extracted.ReferenceYear,
            cancellationToken);

        if (duplicateExists)
        {
            DeleteUploadedFile(env, filePath);
            return Results.Conflict(new
            {
                Detail = $"Ja existe uma fatura importada para {extracted.ReferenceMonth:00}/{extracted.ReferenceYear}."
            });
        }

        var invoice = new Invoice.Api.Models.Invoice
        {
            UserId = userId,
            OriginalFileName = file.FileName,
            FilePath = filePath,
            Status = InvoiceStatus.Completed,
            ReferenceMonth = extracted.ReferenceMonth,
            ReferenceYear = extracted.ReferenceYear,
            BankName = extracted.Bank
        };

        db.Invoices.Add(invoice);

        var transactions = extracted.Transactions.Select(item =>
        {
            var normalized = TextNormalizer.NormalizeDescription(item.Description);
            return new Transaction
            {
                InvoiceId = invoice.Id,
                UserId = userId,
                Date = item.Date,
                Description = item.Description,
                NormalizedDescription = normalized,
                RawCategory = item.RawCategory,
                Amount = item.Amount,
                Type = item.Type
            };
        }).ToList();

        await categorization.ApplyRulesAsync(userId, transactions, cancellationToken);
        db.Transactions.AddRange(transactions);
        await db.SaveChangesAsync(cancellationToken);

        return Results.Created($"/api/invoices/{invoice.Id}", new { invoice.Id, invoice.Status, Transactions = transactions.Count });
    }
    catch (Exception ex)
    {
        DeleteUploadedFile(env, filePath);
        return Results.Problem($"Falha ao extrair fatura: {ex.Message}");
    }
}).DisableAntiforgery().RequireAuthorization();

app.MapPost("/api/invoices/nubank-csv/preview", async (
    IFormFile file,
    AppDbContext db,
    NubankCsvParser parser,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);

    if (file.Length == 0 || !file.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase))
    {
        return Results.BadRequest(new { Detail = "Envie uma fatura em formato CSV." });
    }

    try
    {
        await using var stream = file.OpenReadStream();
        var parseResult = parser.Parse(stream);

        var existingTransactions = await db.Transactions
            .Where(t => t.UserId == userId)
            .Select(t => new { t.Date, t.NormalizedDescription, t.Amount })
            .ToListAsync(cancellationToken);

        var existingSet = new HashSet<string>(
            existingTransactions.Select(t => $"{t.Date}|{t.NormalizedDescription}|{t.Amount:0.00}"),
            StringComparer.OrdinalIgnoreCase);

        var categories = await db.Categories
            .Where(c => c.UserId == userId)
            .ToListAsync(cancellationToken);

        var rules = await db.CategorizationRules
            .Where(r => r.UserId == userId)
            .ToListAsync(cancellationToken);

        var fallbackCategory = categories.FirstOrDefault(c => c.Name == "Outros");
        var creditCategory = categories.FirstOrDefault(c => c.Name == "Credito / Estorno");

        var duplicateCount = parseResult.DuplicateCount;
        var items = new List<NubankCsvPreviewItemDto>();

        foreach (var row in parseResult.Rows)
        {
            if (row.IsValid && !row.IsDuplicate)
            {
                var dedupeKey = $"{row.Date}|{row.NormalizedDescription}|{row.Amount:0.00}";
                if (existingSet.Contains(dedupeKey))
                {
                    row.IsDuplicate = true;
                    row.DuplicateReason = "Já cadastrada no sistema";
                    duplicateCount++;
                }
            }

            Category? assignedCategory = null;
            if (!string.IsNullOrWhiteSpace(row.Category))
            {
                assignedCategory = categories.FirstOrDefault(c =>
                    string.Equals(c.Name, row.Category, StringComparison.OrdinalIgnoreCase));
            }

            if (assignedCategory is null)
            {
                if (row.Amount < 0 && creditCategory is not null)
                {
                    assignedCategory = creditCategory;
                }
                else
                {
                    var matchedRule = rules.FirstOrDefault(r =>
                        r.MatchType == "contains" &&
                        row.NormalizedDescription.Contains(r.NormalizedPattern, StringComparison.OrdinalIgnoreCase));

                    assignedCategory = matchedRule is not null
                        ? categories.FirstOrDefault(c => c.Id == matchedRule.CategoryId)
                        : fallbackCategory;
                }
            }

            var isPayment = row.Amount < 0 && (
                row.NormalizedDescription.Contains("PAGAMENTO RECEBIDO", StringComparison.OrdinalIgnoreCase) ||
                row.NormalizedDescription.Contains("PAGAMENTO DE FATURA", StringComparison.OrdinalIgnoreCase) ||
                row.NormalizedDescription.Contains("PAGAMENTO EFETUADO", StringComparison.OrdinalIgnoreCase));

            if (isPayment && string.IsNullOrEmpty(row.DuplicateReason))
            {
                row.IsDuplicate = true;
                row.DuplicateReason = "Pagamento de fatura anterior (desmarcado para não distorcer gastos e fatura atual)";
            }

            var isDbDuplicate = row.IsDuplicate && (row.DuplicateReason?.Contains("Já cadastrada") ?? false);
            var shouldSelect = row.IsValid && !isDbDuplicate && !isPayment;

            items.Add(new NubankCsvPreviewItemDto(
                row.LineNumber,
                row.Date,
                row.Description,
                row.NormalizedDescription,
                row.Amount,
                row.Type,
                assignedCategory?.Id,
                assignedCategory?.Name,
                row.IsValid,
                row.ErrorMessage,
                row.IsDuplicate,
                row.DuplicateReason,
                shouldSelect
            ));
        }

        var response = new NubankCsvPreviewResponse(
            file.FileName,
            parseResult.TotalLines,
            parseResult.ValidCount,
            parseResult.InvalidCount,
            duplicateCount,
            parseResult.TotalAmount,
            parseResult.ReferenceMonth,
            parseResult.ReferenceYear,
            "Nubank",
            items
        );

        return Results.Ok(response);
    }
    catch (InvalidOperationException ex)
    {
        return Results.BadRequest(new { Detail = ex.Message });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Falha ao analisar fatura CSV: {ex.Message}");
    }
}).DisableAntiforgery().RequireAuthorization();

app.MapPost("/api/invoices/nubank-csv/confirm", async (
    NubankCsvConfirmRequest request,
    AppDbContext db,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);

    if (request.Transactions == null || request.Transactions.Count == 0)
    {
        return Results.BadRequest(new { Detail = "Nenhuma transação selecionada para importação." });
    }

    if (request.ReferenceMonth < 1 || request.ReferenceMonth > 12 || request.ReferenceYear < 2000)
    {
        return Results.BadRequest(new { Detail = "Mês ou ano de referência inválido." });
    }

    var bankName = string.IsNullOrWhiteSpace(request.BankName) ? "Nubank" : request.BankName.Trim();

    var duplicateExists = await db.Invoices.AnyAsync(invoice =>
        invoice.UserId == userId &&
        invoice.BankName == bankName &&
        invoice.ReferenceMonth == request.ReferenceMonth &&
        invoice.ReferenceYear == request.ReferenceYear,
        cancellationToken);

    if (duplicateExists)
    {
        return Results.Conflict(new
        {
            Detail = $"Já existe uma fatura do {bankName} importada para {request.ReferenceMonth:00}/{request.ReferenceYear}."
        });
    }

    var invoice = new Invoice.Api.Models.Invoice
    {
        UserId = userId,
        OriginalFileName = string.IsNullOrWhiteSpace(request.OriginalFileName) ? "nubank.csv" : request.OriginalFileName,
        FilePath = "",
        Status = InvoiceStatus.Completed,
        ReferenceMonth = request.ReferenceMonth,
        ReferenceYear = request.ReferenceYear,
        BankName = bankName,
        CardName = string.IsNullOrWhiteSpace(request.CardName) ? "Nubank" : request.CardName.Trim()
    };

    db.Invoices.Add(invoice);

    var transactions = request.Transactions.Select(item =>
    {
        var normalized = string.IsNullOrWhiteSpace(item.NormalizedDescription)
            ? TextNormalizer.NormalizeDescription(item.Description)
            : item.NormalizedDescription;

        return new Transaction
        {
            InvoiceId = invoice.Id,
            UserId = userId,
            Date = item.Date,
            Description = item.Description,
            NormalizedDescription = normalized,
            RawCategory = "",
            Amount = item.Amount,
            Type = item.Amount < 0 ? "credito" : "debito",
            CategoryId = item.CategoryId
        };
    }).ToList();

    db.Transactions.AddRange(transactions);
    await db.SaveChangesAsync(cancellationToken);

    return Results.Created($"/api/invoices/{invoice.Id}", new NubankCsvConfirmResponse(
        invoice.Id,
        invoice.Status,
        transactions.Count,
        request.IgnoredCount,
        request.RejectedCount
    ));
}).RequireAuthorization();

app.MapGet("/api/invoices", async (AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    return await db.Invoices
        .Where(i => i.UserId == userId)
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
        .ToListAsync(cancellationToken);
}).RequireAuthorization();

app.MapGet("/api/invoices/{id:guid}", async (Guid id, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var invoice = await db.Invoices
        .Where(i => i.Id == id && i.UserId == userId)
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
}).RequireAuthorization();

app.MapGet("/api/invoices/{id:guid}/transactions", async (Guid id, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    return await db.Transactions
        .Where(t => t.InvoiceId == id && t.UserId == userId)
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
        .ToListAsync(cancellationToken);
}).RequireAuthorization();

app.MapDelete("/api/invoices/{id:guid}", async (
    Guid id,
    AppDbContext db,
    IWebHostEnvironment env,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var invoice = await db.Invoices.FirstOrDefaultAsync(i => i.Id == id && i.UserId == userId, cancellationToken);
    if (invoice is null) return Results.NotFound();

    await db.Transactions
        .Where(t => t.InvoiceId == id && t.UserId == userId)
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
}).RequireAuthorization();

app.MapPatch("/api/transactions/{id:guid}/category", async (
    Guid id,
    UpdateTransactionCategoryRequest request,
    AppDbContext db,
    CategorizationService categorization,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var transaction = await db.Transactions.FirstOrDefaultAsync(t => t.Id == id && t.UserId == userId, cancellationToken);
    if (transaction is null) return Results.NotFound();

    var categoryExists = await db.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
    if (!categoryExists) return Results.BadRequest(new { Detail = "Categoria invalida." });

    await categorization.UpdateTransactionCategoryAsync(userId, transaction, request.CategoryId, request.Mode, request.RulePattern, cancellationToken);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapPost("/api/transactions/bulk-categorize", async (
    BulkCategorizeRequest request,
    AppDbContext db,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var categoryExists = await db.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
    if (!categoryExists) return Results.BadRequest(new { Detail = "Categoria invalida." });

    var transactions = await db.Transactions
        .Where(t => t.UserId == userId && request.TransactionIds.Contains(t.Id))
        .ToListAsync(cancellationToken);

    foreach (var transaction in transactions)
    {
        transaction.CategoryId = request.CategoryId;
    }

    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { Updated = transactions.Count });
}).RequireAuthorization();

app.MapGet("/api/categories", async (AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    return await db.Categories.Where(c => c.UserId == userId).OrderBy(c => c.Name).ToListAsync(cancellationToken);
}).RequireAuthorization();

app.MapPost("/api/categories", async (CategoryRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var category = new Category
    {
        UserId = CurrentUserId(context),
        Name = request.Name.Trim(),
        Color = request.Color,
        Icon = request.Icon,
        MonthlyGoal = Math.Max(0, request.MonthlyGoal)
    };
    db.Categories.Add(category);
    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/categories/{category.Id}", category);
}).RequireAuthorization();

app.MapPut("/api/categories/{id:guid}", async (Guid id, CategoryRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId, cancellationToken);
    if (category is null) return Results.NotFound();

    category.Name = request.Name.Trim();
    category.Color = request.Color;
    category.Icon = request.Icon;
    category.MonthlyGoal = Math.Max(0, request.MonthlyGoal);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/api/categories/{id:guid}", async (Guid id, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var category = await db.Categories.FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId, cancellationToken);
    if (category is null) return Results.NotFound();

    await db.Transactions
        .Where(t => t.UserId == userId && t.CategoryId == id)
        .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.CategoryId, (Guid?)null), cancellationToken);

    await db.CategorizationRules
        .Where(r => r.UserId == userId && r.CategoryId == id)
        .ExecuteDeleteAsync(cancellationToken);

    db.Categories.Remove(category);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/categorization-rules", async (AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    return await db.CategorizationRules
        .Where(r => r.UserId == userId)
        .Include(r => r.Category)
        .OrderBy(r => r.Pattern)
        .ToListAsync(cancellationToken);
}).RequireAuthorization();

app.MapPost("/api/categorization-rules", async (CreateRuleRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var categoryExists = await db.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
    if (!categoryExists) return Results.BadRequest(new { Detail = "Categoria invalida." });

    var pattern = request.Pattern.Trim();
    var normalizedPattern = TextNormalizer.NormalizeDescription(pattern);
    if (string.IsNullOrWhiteSpace(normalizedPattern))
    {
        return Results.BadRequest(new { Detail = "Informe um texto identificador valido." });
    }

    if (normalizedPattern.Length < 3)
    {
        return Results.BadRequest(new { Detail = "Informe um texto identificador mais especifico." });
    }

    var rule = await db.CategorizationRules.FirstOrDefaultAsync(r =>
        r.UserId == userId &&
        r.NormalizedPattern == normalizedPattern,
        cancellationToken);

    if (rule is null)
    {
        rule = new CategorizationRule
        {
            UserId = userId,
            MatchType = request.MatchType,
            Pattern = pattern,
            NormalizedPattern = normalizedPattern,
            CategoryId = request.CategoryId
        };
        db.CategorizationRules.Add(rule);
    }
    else
    {
        rule.MatchType = request.MatchType;
        rule.Pattern = pattern;
        rule.NormalizedPattern = normalizedPattern;
        rule.CategoryId = request.CategoryId;
    }

    await db.Transactions
        .Where(t => t.UserId == userId && t.NormalizedDescription.Contains(normalizedPattern))
        .ExecuteUpdateAsync(setters => setters.SetProperty(t => t.CategoryId, request.CategoryId), cancellationToken);

    await db.SaveChangesAsync(cancellationToken);
    return Results.Created($"/api/categorization-rules/{rule.Id}", rule);
}).RequireAuthorization();

app.MapPut("/api/categorization-rules/{id:guid}", async (
    Guid id,
    CreateRuleRequest request,
    AppDbContext db,
    HttpContext context,
    CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var rule = await db.CategorizationRules.FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId, cancellationToken);
    if (rule is null) return Results.NotFound();

    var categoryExists = await db.Categories.AnyAsync(c => c.Id == request.CategoryId && c.UserId == userId, cancellationToken);
    if (!categoryExists) return Results.BadRequest(new { Detail = "Categoria invalida." });

    rule.MatchType = request.MatchType;
    rule.Pattern = request.Pattern.Trim();
    rule.NormalizedPattern = TextNormalizer.NormalizeDescription(request.Pattern);
    rule.CategoryId = request.CategoryId;
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapDelete("/api/categorization-rules/{id:guid}", async (Guid id, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var rule = await db.CategorizationRules.FirstOrDefaultAsync(r => r.Id == id && r.UserId == userId, cancellationToken);
    if (rule is null) return Results.NotFound();

    db.CategorizationRules.Remove(rule);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/dashboard/monthly-summary", async (int? month, int? year, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var selectedMonth = month ?? DateTime.UtcNow.Month;
    var selectedYear = year ?? DateTime.UtcNow.Year;
    var transactions = db.Transactions.Where(t =>
        t.UserId == userId &&
        t.Invoice.ReferenceMonth == selectedMonth &&
        t.Invoice.ReferenceYear == selectedYear);

    var debits = await transactions.Where(t => t.Amount > 0).SumAsync(t => t.Amount, cancellationToken);
    var credits = await transactions.Where(t => t.Amount < 0).SumAsync(t => t.Amount, cancellationToken);
    var txList = await transactions
        .Select(t => new { t.CategoryId, CategoryName = t.Category == null ? "" : t.Category.Name })
        .ToListAsync(cancellationToken);
    var totalCount = txList.Count;
    var uncategorizedCount = txList.Count(t => !t.CategoryId.HasValue || t.CategoryName.Equals("Outros", StringComparison.OrdinalIgnoreCase));
    var categorizedCount = totalCount - uncategorizedCount;
    var categorizedPercentage = totalCount > 0 ? Math.Round(((decimal)categorizedCount / totalCount) * 100m, 1) : 0m;

    var overallGoal = await db.MonthlyGoals.FirstOrDefaultAsync(g =>
        g.UserId == userId &&
        g.Year == selectedYear &&
        g.Month == selectedMonth &&
        g.CategoryId == null, cancellationToken);

    return Results.Ok(new
    {
        Month = selectedMonth,
        Year = selectedYear,
        TotalSpent = debits,
        TotalCredits = credits,
        NetAmount = debits + credits,
        TransactionCount = totalCount,
        MonthlyGoal = overallGoal?.Amount ?? 0m,
        CategorizedCount = categorizedCount,
        UncategorizedCount = uncategorizedCount,
        CategorizedPercentage = categorizedPercentage
    });
}).RequireAuthorization();

app.MapGet("/api/dashboard/category-summary", async (int? month, int? year, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var selectedMonth = month ?? DateTime.UtcNow.Month;
    var selectedYear = year ?? DateTime.UtcNow.Year;

    var totals = await db.Transactions
        .Where(t =>
            t.UserId == userId &&
            t.Invoice.ReferenceMonth == selectedMonth &&
            t.Invoice.ReferenceYear == selectedYear)
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

    var categories = await db.Categories
        .Where(c => c.UserId == userId)
        .Select(c => new { c.Id, c.Name, c.MonthlyGoal })
        .ToListAsync(cancellationToken);

    var categoryGoals = categories.ToDictionary(c => c.Id, c => c.MonthlyGoal);
    var rows = totals
        .Select(item => new CategorySummaryResponse(
            item.CategoryId,
            item.CategoryName,
            item.Total,
            item.Count,
            item.CategoryId.HasValue ? categoryGoals.GetValueOrDefault(item.CategoryId.Value) : 0))
        .ToList();

    var categoriesWithTransactions = rows.Select(row => row.CategoryId).ToHashSet();
    rows.AddRange(categories
        .Where(category => category.MonthlyGoal > 0 && !categoriesWithTransactions.Contains(category.Id))
        .Select(category => new CategorySummaryResponse(category.Id, category.Name, 0, 0, category.MonthlyGoal)));

    return rows
        .OrderByDescending(row => row.Total)
        .ThenBy(row => row.CategoryName)
        .ToList();
}).RequireAuthorization();

app.MapGet("/api/dashboard/month-comparison", async (int? month, int? year, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var today = DateTime.UtcNow;
    var currentMonth = month ?? today.Month;
    var currentYear = year ?? today.Year;
    var previous = new DateTime(currentYear, currentMonth, 1).AddMonths(-1);

    var current = await BuildMonthSummaryAsync(db, userId, currentMonth, currentYear, cancellationToken);
    var previousSummary = await BuildMonthSummaryAsync(db, userId, previous.Month, previous.Year, cancellationToken);
    var difference = current.NetAmount - previousSummary.NetAmount;
    var percentage = previousSummary.NetAmount == 0
        ? (decimal?)null
        : Math.Round((difference / Math.Abs(previousSummary.NetAmount)) * 100, 2);

    return Results.Ok(new
    {
        Current = current,
        Previous = previousSummary,
        Difference = difference,
        Percentage = percentage
    });
}).RequireAuthorization();

app.MapGet("/api/goals", async (int? month, int? year, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var selectedMonth = month ?? DateTime.UtcNow.Month;
    var selectedYear = year ?? DateTime.UtcNow.Year;

    var overallGoal = await db.MonthlyGoals
        .FirstOrDefaultAsync(g => g.UserId == userId && g.Year == selectedYear && g.Month == selectedMonth && g.CategoryId == null, cancellationToken);

    var categoryGoals = await db.MonthlyGoals
        .Include(g => g.Category)
        .Where(g => g.UserId == userId && g.Year == selectedYear && g.Month == selectedMonth && g.CategoryId != null)
        .ToListAsync(cancellationToken);

    var transactions = db.Transactions.Where(t =>
        t.UserId == userId &&
        t.Invoice.ReferenceMonth == selectedMonth &&
        t.Invoice.ReferenceYear == selectedYear);

    var debits = await transactions.Where(t => t.Amount > 0).SumAsync(t => t.Amount, cancellationToken);
    var credits = await transactions.Where(t => t.Amount < 0).SumAsync(t => t.Amount, cancellationToken);
    var netSpent = GoalCalculationService.CalculateNetSpent(debits, credits);
    var overallGoalAmount = overallGoal?.Amount ?? 0m;
    var available = GoalCalculationService.CalculateAvailable(overallGoalAmount, netSpent);
    var percentageUsed = GoalCalculationService.CalculatePercentage(overallGoalAmount, netSpent);
    var projection = GoalCalculationService.CalculateProjection(netSpent, selectedYear, selectedMonth, DateTime.UtcNow);
    var status = GoalCalculationService.DetermineStatus(overallGoalAmount, percentageUsed);

    var categorySpending = await transactions
        .Where(t => t.CategoryId != null)
        .GroupBy(t => t.CategoryId!.Value)
        .Select(g => new { CategoryId = g.Key, Total = g.Sum(t => t.Amount) })
        .ToDictionaryAsync(x => x.CategoryId, x => x.Total, cancellationToken);

    var categoryGoalResponses = categoryGoals.Select(cg =>
    {
        var spent = categorySpending.GetValueOrDefault(cg.CategoryId!.Value, 0m);
        var catAvailable = GoalCalculationService.CalculateAvailable(cg.Amount, spent);
        var catPct = GoalCalculationService.CalculatePercentage(cg.Amount, spent);
        var catStatus = GoalCalculationService.DetermineStatus(cg.Amount, catPct);
        return new
        {
            Id = cg.Id,
            CategoryId = cg.CategoryId!.Value,
            CategoryName = cg.Category?.Name ?? "Categoria",
            CategoryColor = cg.Category?.Color ?? "#64748b",
            CategoryIcon = cg.Category?.Icon ?? "tag",
            Amount = cg.Amount,
            Spent = spent,
            Available = catAvailable,
            Percentage = catPct,
            Status = catStatus
        };
    }).OrderBy(x => x.CategoryName).ToList();

    var history = new List<object>();
    for (var i = 1; i <= 6; i++)
    {
        var histDate = new DateTime(selectedYear, selectedMonth, 1).AddMonths(-i);
        var hMonth = histDate.Month;
        var hYear = histDate.Year;

        var hGoal = await db.MonthlyGoals.FirstOrDefaultAsync(g =>
            g.UserId == userId && g.Year == hYear && g.Month == hMonth && g.CategoryId == null, cancellationToken);

        var hDebits = await db.Transactions.Where(t =>
            t.UserId == userId && t.Invoice.ReferenceMonth == hMonth && t.Invoice.ReferenceYear == hYear && t.Amount > 0)
            .SumAsync(t => t.Amount, cancellationToken);
        var hCredits = await db.Transactions.Where(t =>
            t.UserId == userId && t.Invoice.ReferenceMonth == hMonth && t.Invoice.ReferenceYear == hYear && t.Amount < 0)
            .SumAsync(t => t.Amount, cancellationToken);
        var hNet = GoalCalculationService.CalculateNetSpent(hDebits, hCredits);

        if (hGoal != null || hNet > 0 || hCredits < 0)
        {
            var hGoalAmount = hGoal?.Amount ?? 0m;
            var diff = hGoalAmount - hNet;
            var hStatus = hGoalAmount > 0
                ? (hNet <= hGoalAmount ? "cumprida" : "ultrapassada")
                : "sem_meta";

            history.Add(new
            {
                Year = hYear,
                Month = hMonth,
                GoalAmount = hGoalAmount,
                NetSpent = hNet,
                Difference = diff,
                Status = hStatus
            });
        }
    }

    return Results.Ok(new
    {
        Year = selectedYear,
        Month = selectedMonth,
        OverallGoal = overallGoal == null ? null : new { overallGoal.Id, overallGoal.Amount },
        Summary = new
        {
            GrossSpent = debits,
            Credits = credits,
            NetSpent = netSpent,
            GoalAmount = overallGoalAmount,
            Available = available,
            PercentageUsed = percentageUsed,
            Projection = projection,
            Status = status
        },
        CategoryGoals = categoryGoalResponses,
        History = history
    });
}).RequireAuthorization();

app.MapPost("/api/goals", async (SaveGoalRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    if (request.Amount < 0)
    {
        return Results.BadRequest(new { Detail = "O valor da meta deve ser maior ou igual a zero." });
    }

    var monthsToApply = new List<(int Year, int Month)> { (request.Year, request.Month) };
    var repeatCount = Math.Clamp(request.RepeatNextMonths ?? 0, 0, 12);
    for (var i = 1; i <= repeatCount; i++)
    {
        var nextDate = new DateTime(request.Year, request.Month, 1).AddMonths(i);
        monthsToApply.Add((nextDate.Year, nextDate.Month));
    }

    foreach (var (y, m) in monthsToApply)
    {
        var existing = await db.MonthlyGoals.FirstOrDefaultAsync(g =>
            g.UserId == userId && g.Year == y && g.Month == m && g.CategoryId == request.CategoryId, cancellationToken);

        if (existing == null)
        {
            db.MonthlyGoals.Add(new MonthlyGoal
            {
                UserId = userId,
                Year = y,
                Month = m,
                CategoryId = request.CategoryId,
                Amount = request.Amount,
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Amount = request.Amount;
            existing.UpdatedAt = DateTime.UtcNow;
        }
    }

    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { Success = true, Count = monthsToApply.Count });
}).RequireAuthorization();

app.MapPut("/api/goals/{id:guid}", async (Guid id, UpdateGoalRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var goal = await db.MonthlyGoals.FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId, cancellationToken);
    if (goal == null) return Results.NotFound();

    if (request.Amount < 0)
    {
        return Results.BadRequest(new { Detail = "O valor da meta deve ser maior ou igual a zero." });
    }

    goal.Amount = request.Amount;
    goal.UpdatedAt = DateTime.UtcNow;
    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(goal);
}).RequireAuthorization();

app.MapDelete("/api/goals/{id:guid}", async (Guid id, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var goal = await db.MonthlyGoals.FirstOrDefaultAsync(g => g.Id == id && g.UserId == userId, cancellationToken);
    if (goal == null) return Results.NotFound();

    db.MonthlyGoals.Remove(goal);
    await db.SaveChangesAsync(cancellationToken);
    return Results.NoContent();
}).RequireAuthorization();

app.MapPost("/api/goals/copy-previous", async (CopyGoalsRequest request, AppDbContext db, HttpContext context, CancellationToken cancellationToken) =>
{
    var userId = CurrentUserId(context);
    var targetDate = new DateTime(request.TargetYear, request.TargetMonth, 1);
    var prevDate = targetDate.AddMonths(-1);

    var prevGoals = await db.MonthlyGoals
        .Where(g => g.UserId == userId && g.Year == prevDate.Year && g.Month == prevDate.Month)
        .ToListAsync(cancellationToken);

    if (prevGoals.Count == 0)
    {
        return Results.NotFound(new { Detail = "Nenhuma meta encontrada no mês anterior para copiar." });
    }

    var copied = 0;
    foreach (var pg in prevGoals)
    {
        var existing = await db.MonthlyGoals.FirstOrDefaultAsync(g =>
            g.UserId == userId && g.Year == request.TargetYear && g.Month == request.TargetMonth && g.CategoryId == pg.CategoryId, cancellationToken);

        if (existing == null)
        {
            db.MonthlyGoals.Add(new MonthlyGoal
            {
                UserId = userId,
                Year = request.TargetYear,
                Month = request.TargetMonth,
                CategoryId = pg.CategoryId,
                Amount = pg.Amount,
                CreatedAt = DateTime.UtcNow
            });
            copied++;
        }
        else
        {
            existing.Amount = pg.Amount;
            existing.UpdatedAt = DateTime.UtcNow;
            copied++;
        }
    }

    await db.SaveChangesAsync(cancellationToken);
    return Results.Ok(new { Copied = copied });
}).RequireAuthorization();

static string CurrentUserId(HttpContext context) =>
    context.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new UnauthorizedAccessException();

static string CurrentUserName(HttpContext context) =>
    context.User.FindFirstValue(ClaimTypes.Name) ?? "";

static string CurrentUserEmail(HttpContext context) =>
    context.User.FindFirstValue(ClaimTypes.Email) ?? "";

static string NormalizeEmail(string email) => email.Trim().ToLowerInvariant();

static void DeleteUploadedFile(IWebHostEnvironment env, string filePath)
{
    if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return;

    var uploadRoot = Path.GetFullPath(Path.Combine(env.ContentRootPath, "uploads", "invoices"));
    var savedFile = Path.GetFullPath(filePath);
    if (savedFile.StartsWith(uploadRoot, StringComparison.OrdinalIgnoreCase))
    {
        File.Delete(savedFile);
    }
}

static async Task<MonthSummaryResponse> BuildMonthSummaryAsync(
    AppDbContext db,
    string userId,
    int month,
    int year,
    CancellationToken cancellationToken)
{
    var transactions = db.Transactions.Where(t =>
        t.UserId == userId &&
        t.Invoice.ReferenceMonth == month &&
        t.Invoice.ReferenceYear == year);

    var debits = await transactions.Where(t => t.Amount > 0).SumAsync(t => t.Amount, cancellationToken);
    var credits = await transactions.Where(t => t.Amount < 0).SumAsync(t => t.Amount, cancellationToken);

    return new MonthSummaryResponse(
        month,
        year,
        debits,
        credits,
        debits + credits,
        await transactions.CountAsync(cancellationToken));
}

static async Task RepairCategorizationRulePatternsAsync(AppDbContext db)
{
    var rules = await db.CategorizationRules.ToListAsync();
    var changed = false;

    foreach (var rule in rules)
    {
        var previous = rule.NormalizedPattern;
        var normalized = TextNormalizer.NormalizeDescription(rule.Pattern);
        if (string.IsNullOrWhiteSpace(normalized) || rule.NormalizedPattern == normalized)
        {
            continue;
        }

        if (!string.IsNullOrWhiteSpace(previous) && previous.Length < 3 && normalized.Length >= 3)
        {
            var fallback = await db.Categories.FirstOrDefaultAsync(c =>
                c.UserId == rule.UserId &&
                c.Name == "Outros");

            await db.Transactions
                .Where(t =>
                    t.UserId == rule.UserId &&
                    t.CategoryId == rule.CategoryId &&
                    t.NormalizedDescription.Contains(previous) &&
                    !t.NormalizedDescription.Contains(normalized))
                .ExecuteUpdateAsync(setters =>
                    setters.SetProperty(t => t.CategoryId, fallback == null ? null : (Guid?)fallback.Id));
        }

        rule.NormalizedPattern = normalized;
        changed = true;
    }

    if (changed)
    {
        await db.SaveChangesAsync();
    }
}

static AuthResponse CreateAuthResponse(User user, string issuer, SymmetricSecurityKey signingKey)
{
    var expiresAt = DateTime.UtcNow.AddDays(7);
    var credentials = new SigningCredentials(signingKey, SecurityAlgorithms.HmacSha256);
    var token = new JwtSecurityToken(
        issuer: issuer,
        audience: issuer,
        claims:
        [
            new Claim(ClaimTypes.NameIdentifier, user.Id),
            new Claim(ClaimTypes.Name, user.Name),
            new Claim(ClaimTypes.Email, user.Email)
        ],
        expires: expiresAt,
        signingCredentials: credentials);

    return new AuthResponse(
        new JwtSecurityTokenHandler().WriteToken(token),
        expiresAt,
        new UserResponse(user.Id, user.Name, user.Email));
}

static string HashPassword(string password)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return $"v1.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
}

static bool VerifyPassword(string password, string storedHash)
{
    var parts = storedHash.Split('.');
    if (parts.Length != 3 || parts[0] != "v1") return false;

    var salt = Convert.FromBase64String(parts[1]);
    var expected = Convert.FromBase64String(parts[2]);
    var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return CryptographicOperations.FixedTimeEquals(actual, expected);
}

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

public record RegisterRequest(string Name, string Email, string Password);
public record LoginRequest(string Email, string Password);
public record UserResponse(string Id, string Name, string Email);
public record AuthResponse(string Token, DateTime ExpiresAt, UserResponse User);
public record MonthSummaryResponse(int Month, int Year, decimal TotalSpent, decimal TotalCredits, decimal NetAmount, int TransactionCount);
public record UpdateTransactionCategoryRequest(Guid CategoryId, string Mode, string? RulePattern);
public record BulkCategorizeRequest(Guid[] TransactionIds, Guid CategoryId);
public record CategoryRequest(string Name, string Color, string Icon, decimal MonthlyGoal);
public record CategorySummaryResponse(Guid? CategoryId, string CategoryName, decimal Total, int Count, decimal MonthlyGoal);
public record CreateRuleRequest(string MatchType, string Pattern, Guid CategoryId);

public record NubankCsvPreviewItemDto(
    int LineNumber,
    string Date,
    string Description,
    string NormalizedDescription,
    decimal Amount,
    string Type,
    Guid? CategoryId,
    string? CategoryName,
    bool IsValid,
    string? ErrorMessage,
    bool IsDuplicate,
    string? DuplicateReason,
    bool Selected
);

public record NubankCsvPreviewResponse(
    string FileName,
    int TotalLines,
    int ValidCount,
    int InvalidCount,
    int DuplicateCount,
    decimal TotalAmount,
    int ReferenceMonth,
    int ReferenceYear,
    string BankName,
    List<NubankCsvPreviewItemDto> Items
);

public record NubankCsvConfirmItemDto(
    string Date,
    string Description,
    string? NormalizedDescription,
    decimal Amount,
    string Type,
    Guid? CategoryId
);

public record NubankCsvConfirmRequest(
    string OriginalFileName,
    string BankName,
    string? CardName,
    int ReferenceMonth,
    int ReferenceYear,
    int IgnoredCount,
    int RejectedCount,
    List<NubankCsvConfirmItemDto> Transactions
);

public record NubankCsvConfirmResponse(
    Guid Id,
    string Status,
    int ImportedCount,
    int IgnoredCount,
    int RejectedCount
);

public record SaveGoalRequest(int Year, int Month, Guid? CategoryId, decimal Amount, int? RepeatNextMonths);
public record UpdateGoalRequest(decimal Amount);
public record CopyGoalsRequest(int TargetYear, int TargetMonth);

