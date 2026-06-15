using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Invoice.Api.Services;

public static partial class TextNormalizer
{
    public static string NormalizeDescription(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "";
        }

        var upper = value.Trim().ToUpperInvariant().Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(upper.Length);

        foreach (var c in upper)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
            {
                builder.Append(c);
            }
        }

        var withoutAccents = builder.ToString().Normalize(NormalizationForm.FormC);
        var alphaNumeric = SpecialCharsRegex().Replace(withoutAccents, " ");
        var withoutLongCodes = LongCodeRegex().Replace(alphaNumeric, " ");
        return SpacesRegex().Replace(withoutLongCodes, " ").Trim();
    }

    public static string GuessRulePattern(string normalizedDescription)
    {
        var tokens = normalizedDescription
            .Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .Where(token => token.Length >= 3 && !token.All(char.IsDigit))
            .Take(2)
            .ToArray();

        return tokens.Length == 0 ? normalizedDescription : string.Join(' ', tokens);
    }

    [GeneratedRegex("[^A-Z0-9 ]+")]
    private static partial Regex SpecialCharsRegex();

    [GeneratedRegex("\\b[A-Z0-9]{10,}\\b")]
    private static partial Regex LongCodeRegex();

    [GeneratedRegex("\\s+")]
    private static partial Regex SpacesRegex();
}
