using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Invoice.Api.Services;

public sealed class NubankCsvParser
{
    private static readonly string[] DateFormats =
    [
        "yyyy-MM-dd",
        "dd/MM/yyyy",
        "d/M/yyyy",
        "yyyy/MM/dd",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-ddTHH:mm:ssZ"
    ];

    public NubankCsvParseResult Parse(Stream stream, Encoding? encoding = null)
    {
        using var reader = new StreamReader(stream, encoding ?? Encoding.UTF8, detectEncodingFromByteOrderMarks: true, leaveOpen: true);
        var rawContent = reader.ReadToEnd();
        return Parse(rawContent);
    }

    public NubankCsvParseResult Parse(string content)
    {
        if (string.IsNullOrWhiteSpace(content))
        {
            throw new InvalidOperationException("O arquivo CSV está vazio.");
        }

        var lines = SplitCsvLines(content);
        if (lines.Count == 0)
        {
            throw new InvalidOperationException("O arquivo CSV não possui linhas legíveis.");
        }

        var headerTokens = lines[0];
        var delimiter = DetectDelimiter(headerTokens);
        var headers = ParseCsvRow(headerTokens, delimiter);

        var dateIdx = FindHeaderIndex(headers, ["date", "data", "dt"]);
        var titleIdx = FindHeaderIndex(headers, ["title", "titulo", "título", "description", "descricao", "descrição"]);
        var amountIdx = FindHeaderIndex(headers, ["amount", "valor", "vlr"]);
        var categoryIdx = FindHeaderIndex(headers, ["category", "categoria", "tag"]);

        if (dateIdx < 0 || titleIdx < 0 || amountIdx < 0)
        {
            var missing = new List<string>();
            if (dateIdx < 0) missing.Add("data (date)");
            if (titleIdx < 0) missing.Add("descrição (title)");
            if (amountIdx < 0) missing.Add("valor (amount)");

            throw new InvalidOperationException(
                $"O arquivo CSV não contém as colunas obrigatórias: {string.Join(", ", missing)}. " +
                $"Colunas encontradas: {string.Join(", ", headers.Where(h => !string.IsNullOrWhiteSpace(h)))}");
        }

        var rows = new List<NubankCsvRow>();
        var seenKeys = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        DateTime? latestDate = null;
        var validCount = 0;
        var invalidCount = 0;
        var duplicateCount = 0;
        decimal totalAmount = 0;

        for (var i = 1; i < lines.Count; i++)
        {
            var lineRaw = lines[i];
            if (string.IsNullOrWhiteSpace(lineRaw))
            {
                continue;
            }

            var cells = ParseCsvRow(lineRaw, delimiter);
            if (cells.All(string.IsNullOrWhiteSpace))
            {
                continue;
            }

            var lineIndex = i + 1; // 1-based line number for user reference
            var row = new NubankCsvRow
            {
                LineNumber = lineIndex
            };

            var rawDate = GetCell(cells, dateIdx);
            var rawTitle = GetCell(cells, titleIdx);
            var rawAmount = GetCell(cells, amountIdx);
            var rawCategory = categoryIdx >= 0 ? GetCell(cells, categoryIdx) : "";

            row.RawDate = rawDate;
            row.RawTitle = rawTitle;
            row.RawAmount = rawAmount;
            row.RawCategory = rawCategory;

            if (string.IsNullOrWhiteSpace(rawDate) && string.IsNullOrWhiteSpace(rawTitle) && string.IsNullOrWhiteSpace(rawAmount))
            {
                continue;
            }

            var isValid = true;
            var errorReasons = new List<string>();

            // Parse Date
            if (TryParseDate(rawDate, out var parsedDate, out var formattedDate))
            {
                row.Date = formattedDate;
                if (latestDate is null || parsedDate > latestDate.Value)
                {
                    latestDate = parsedDate;
                }
            }
            else
            {
                isValid = false;
                errorReasons.Add($"Data inválida: '{rawDate}'");
                row.Date = rawDate.Trim();
            }

            // Parse Title / Description
            if (string.IsNullOrWhiteSpace(rawTitle))
            {
                isValid = false;
                errorReasons.Add("Descrição ausente");
                row.Description = "";
                row.NormalizedDescription = "";
            }
            else
            {
                row.Description = rawTitle.Trim();
                row.NormalizedDescription = TextNormalizer.NormalizeDescription(row.Description);
            }

            // Parse Amount
            if (TryParseAmount(rawAmount, out var parsedAmount))
            {
                row.Amount = parsedAmount;
                row.Type = parsedAmount < 0 ? "credito" : "debito";
            }
            else
            {
                isValid = false;
                errorReasons.Add($"Valor monetário inválido: '{rawAmount}'");
                row.Amount = 0;
                row.Type = "debito";
            }

            row.Category = rawCategory.Trim();

            if (isValid)
            {
                row.IsValid = true;
                validCount++;
                totalAmount += row.Amount;

                // Check internal duplicate
                var dedupeKey = $"{row.Date}|{row.NormalizedDescription}|{row.Amount:0.00}";
                if (seenKeys.TryGetValue(dedupeKey, out var previousLine))
                {
                    row.IsDuplicate = true;
                    row.DuplicateReason = $"Duplicada no próprio arquivo (idêntica à linha {previousLine})";
                    duplicateCount++;
                }
                else
                {
                    seenKeys[dedupeKey] = lineIndex;
                }
            }
            else
            {
                row.IsValid = false;
                row.ErrorMessage = string.Join("; ", errorReasons);
                invalidCount++;
            }

            rows.Add(row);
        }

        var refMonth = latestDate?.Month ?? DateTime.UtcNow.Month;
        var refYear = latestDate?.Year ?? DateTime.UtcNow.Year;

        return new NubankCsvParseResult
        {
            TotalLines = rows.Count,
            ValidCount = validCount,
            InvalidCount = invalidCount,
            DuplicateCount = duplicateCount,
            TotalAmount = totalAmount,
            ReferenceMonth = refMonth,
            ReferenceYear = refYear,
            Rows = rows
        };
    }

    public static bool TryParseAmount(string raw, out decimal result)
    {
        result = 0;
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var cleaned = raw.Trim();
        // Remove common currency symbols
        cleaned = cleaned.Replace("R$", "").Replace("$", "").Trim();

        // Handle Unicode minus signs
        cleaned = cleaned
            .Replace('\u2212', '-')
            .Replace('\u2013', '-')
            .Replace('\u2014', '-');

        var isNegative = false;
        if (cleaned.StartsWith('(') && cleaned.EndsWith(')'))
        {
            isNegative = true;
            cleaned = cleaned[1..^1].Trim();
        }
        else if (cleaned.StartsWith('-'))
        {
            isNegative = true;
            cleaned = cleaned[1..].Trim();
        }
        else if (cleaned.EndsWith('-'))
        {
            isNegative = true;
            cleaned = cleaned[..^1].Trim();
        }

        // Remove spaces inside numbers (e.g. "- 20,82" -> "20,82")
        cleaned = cleaned.Replace(" ", "");

        // Determine if format is Brazilian (34,00 or 1.234,56) or English (34.00 or 1,234.56)
        if (cleaned.Contains(',') && cleaned.Contains('.'))
        {
            var lastComma = cleaned.LastIndexOf(',');
            var lastDot = cleaned.LastIndexOf('.');
            if (lastComma > lastDot)
            {
                // Brazilian: 1.234,56 -> remove dots, replace comma with dot
                cleaned = cleaned.Replace(".", "").Replace(',', '.');
            }
            else
            {
                // English: 1,234.56 -> remove commas
                cleaned = cleaned.Replace(",", "");
            }
        }
        else if (cleaned.Contains(','))
        {
            // Brazilian comma decimal: 34,00 -> 34.00
            cleaned = cleaned.Replace(',', '.');
        }

        if (decimal.TryParse(cleaned, NumberStyles.Number | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value))
        {
            result = isNegative ? -Math.Abs(value) : value;
            return true;
        }

        return false;
    }

    public static bool TryParseDate(string raw, out DateTime parsedDate, out string formattedDate)
    {
        parsedDate = default;
        formattedDate = "";
        if (string.IsNullOrWhiteSpace(raw)) return false;

        var trimmed = raw.Trim();

        if (DateTime.TryParseExact(trimmed, DateFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out parsedDate) ||
            DateTime.TryParse(trimmed, CultureInfo.GetCultureInfo("pt-BR"), DateTimeStyles.None, out parsedDate) ||
            DateTime.TryParse(trimmed, CultureInfo.InvariantCulture, DateTimeStyles.None, out parsedDate))
        {
            formattedDate = parsedDate.ToString("yyyy-MM-dd");
            return true;
        }

        return false;
    }

    private static char DetectDelimiter(string headerLine)
    {
        var commaCount = CountOutsideQuotes(headerLine, ',');
        var semicolonCount = CountOutsideQuotes(headerLine, ';');
        return semicolonCount > commaCount ? ';' : ',';
    }

    private static int CountOutsideQuotes(string line, char target)
    {
        var inQuotes = false;
        var count = 0;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (c == target && !inQuotes)
            {
                count++;
            }
        }
        return count;
    }

    private static List<string> SplitCsvLines(string content)
    {
        var lines = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < content.Length; i++)
        {
            var c = content[i];

            if (c == '"')
            {
                inQuotes = !inQuotes;
                current.Append(c);
            }
            else if ((c == '\r' || c == '\n') && !inQuotes)
            {
                if (c == '\r' && i + 1 < content.Length && content[i + 1] == '\n')
                {
                    i++;
                }

                lines.Add(current.ToString());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        if (current.Length > 0)
        {
            lines.Add(current.ToString());
        }

        return lines;
    }

    private static List<string> ParseCsvRow(string line, char delimiter)
    {
        var cells = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;

        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];

            if (c == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    // Escaped quote: ""
                    current.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }
            }
            else if (c == delimiter && !inQuotes)
            {
                cells.Add(current.ToString().Trim());
                current.Clear();
            }
            else
            {
                current.Append(c);
            }
        }

        cells.Add(current.ToString().Trim());
        return cells;
    }

    private static int FindHeaderIndex(List<string> headers, string[] candidates)
    {
        for (var i = 0; i < headers.Count; i++)
        {
            var normalized = TextNormalizer.NormalizeDescription(headers[i]).ToLowerInvariant();
            foreach (var candidate in candidates)
            {
                var normCandidate = TextNormalizer.NormalizeDescription(candidate).ToLowerInvariant();
                if (normalized == normCandidate)
                {
                    return i;
                }
            }
        }
        return -1;
    }

    private static string GetCell(List<string> cells, int index) =>
        index >= 0 && index < cells.Count ? cells[index] : "";
}

public sealed class NubankCsvRow
{
    public int LineNumber { get; set; }
    public string RawDate { get; set; } = "";
    public string RawTitle { get; set; } = "";
    public string RawAmount { get; set; } = "";
    public string RawCategory { get; set; } = "";

    public string Date { get; set; } = "";
    public string Description { get; set; } = "";
    public string NormalizedDescription { get; set; } = "";
    public decimal Amount { get; set; }
    public string Type { get; set; } = "debito";
    public string Category { get; set; } = "";

    public bool IsValid { get; set; }
    public string? ErrorMessage { get; set; }
    public bool IsDuplicate { get; set; }
    public string? DuplicateReason { get; set; }
}

public sealed class NubankCsvParseResult
{
    public int TotalLines { get; set; }
    public int ValidCount { get; set; }
    public int InvalidCount { get; set; }
    public int DuplicateCount { get; set; }
    public decimal TotalAmount { get; set; }
    public int ReferenceMonth { get; set; }
    public int ReferenceYear { get; set; }
    public List<NubankCsvRow> Rows { get; set; } = [];
}
