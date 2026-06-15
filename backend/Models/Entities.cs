namespace Invoice.Api.Models;

public static class InvoiceStatus
{
    public const string Uploaded = "uploaded";
    public const string Processing = "processing";
    public const string Completed = "completed";
    public const string Failed = "failed";
}

public sealed class User
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = "";
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class Invoice
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public User? User { get; set; }
    public string BankName { get; set; } = "";
    public string CardName { get; set; } = "";
    public int ReferenceMonth { get; set; }
    public int ReferenceYear { get; set; }
    public string OriginalFileName { get; set; } = "";
    public string FilePath { get; set; } = "";
    public string Status { get; set; } = InvoiceStatus.Uploaded;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<Transaction> Transactions { get; set; } = [];
}

public sealed class Transaction
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid InvoiceId { get; set; }
    public Invoice Invoice { get; set; } = null!;
    public string UserId { get; set; } = "";
    public User? User { get; set; }
    public string Date { get; set; } = "";
    public string Description { get; set; } = "";
    public string NormalizedDescription { get; set; } = "";
    public string RawCategory { get; set; } = "";
    public decimal Amount { get; set; }
    public string Type { get; set; } = "debito";
    public Guid? CategoryId { get; set; }
    public Category? Category { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class Category
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public User? User { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#64748b";
    public string Icon { get; set; } = "tag";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public sealed class CategorizationRule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string UserId { get; set; } = "";
    public User? User { get; set; }
    public string MatchType { get; set; } = "contains";
    public string Pattern { get; set; } = "";
    public string NormalizedPattern { get; set; } = "";
    public Guid CategoryId { get; set; }
    public Category Category { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
