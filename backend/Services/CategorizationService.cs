using Invoice.Api.Data;
using Invoice.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Invoice.Api.Services;

public sealed class CategorizationService(AppDbContext db)
{
    public async Task ApplyRulesAsync(string userId, List<Transaction> transactions, CancellationToken cancellationToken)
    {
        var rules = await db.CategorizationRules
            .Where(r => r.UserId == userId)
            .OrderBy(r => r.CreatedAt)
            .ToListAsync(cancellationToken);

        var fallback = await db.Categories
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Name == "Outros", cancellationToken);

        var credit = await db.Categories
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Name == "Credito / Estorno", cancellationToken);

        foreach (var transaction in transactions)
        {
            if (transaction.Amount < 0 && credit is not null)
            {
                transaction.CategoryId = credit.Id;
                continue;
            }

            var rule = rules.FirstOrDefault(r =>
                r.MatchType == "contains" &&
                transaction.NormalizedDescription.Contains(r.NormalizedPattern, StringComparison.OrdinalIgnoreCase));

            transaction.CategoryId = rule?.CategoryId ?? fallback?.Id;
        }
    }

    public async Task UpdateTransactionCategoryAsync(
        string userId,
        Transaction transaction,
        Guid categoryId,
        string mode,
        string? rulePattern,
        CancellationToken cancellationToken)
    {
        transaction.CategoryId = categoryId;

        if (mode == "single" && string.IsNullOrWhiteSpace(rulePattern))
        {
            return;
        }

        var pattern = TextNormalizer.NormalizeDescription(
            string.IsNullOrWhiteSpace(rulePattern)
                ? TextNormalizer.GuessRulePattern(transaction.NormalizedDescription)
                : rulePattern);

        if (string.IsNullOrWhiteSpace(pattern))
        {
            return;
        }

        var existingRule = await db.CategorizationRules.FirstOrDefaultAsync(r =>
            r.UserId == userId &&
            r.NormalizedPattern == pattern,
            cancellationToken);

        if (existingRule is null)
        {
            db.CategorizationRules.Add(new CategorizationRule
            {
                UserId = userId,
                MatchType = "contains",
                Pattern = pattern,
                NormalizedPattern = pattern,
                CategoryId = categoryId
            });
        }
        else
        {
            existingRule.CategoryId = categoryId;
            existingRule.MatchType = "contains";
            existingRule.Pattern = pattern;
        }

        var matchingTransactions = await db.Transactions
            .Where(t => t.UserId == userId &&
                        t.NormalizedDescription.Contains(pattern))
            .ToListAsync(cancellationToken);

        foreach (var item in matchingTransactions)
        {
            item.CategoryId = categoryId;
        }
    }
}
