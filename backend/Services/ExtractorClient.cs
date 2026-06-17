using System.Net.Http.Headers;
using System.Text.Json.Serialization;

namespace Invoice.Api.Services;

public sealed class ExtractorClient(HttpClient httpClient)
{
    public async Task<ExtractedInvoice> ExtractAsync(string filePath, string originalFileName, CancellationToken cancellationToken)
    {
        await using var file = File.OpenRead(filePath);
        using var content = new MultipartFormDataContent();
        using var fileContent = new StreamContent(file);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
        content.Add(fileContent, "file", originalFileName);

        var response = await httpClient.PostAsync("/extract", content, cancellationToken);
        response.EnsureSuccessStatusCode();

        var extracted = await response.Content.ReadFromJsonAsync<ExtractedInvoice>(cancellationToken);
        return extracted ?? new ExtractedInvoice("itau", DateTime.UtcNow.Month, DateTime.UtcNow.Year, []);
    }
}

public sealed record ExtractedInvoice(
    [property: JsonPropertyName("bank")] string Bank,
    [property: JsonPropertyName("referenceMonth")] int ReferenceMonth,
    [property: JsonPropertyName("referenceYear")] int ReferenceYear,
    [property: JsonPropertyName("transactions")] List<ExtractedTransaction> Transactions);

public sealed record ExtractedTransaction(
    [property: JsonPropertyName("date")] string Date,
    [property: JsonPropertyName("description")] string Description,
    [property: JsonPropertyName("rawCategory")] string RawCategory,
    [property: JsonPropertyName("amount")] decimal Amount,
    [property: JsonPropertyName("type")] string Type);
