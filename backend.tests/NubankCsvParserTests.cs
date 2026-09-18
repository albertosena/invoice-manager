using Invoice.Api.Services;
using Xunit;

namespace Invoice.Api.Tests;

public class NubankCsvParserTests
{
    private readonly NubankCsvParser _parser = new();

    private const string SampleNubankCsv = """
date,title,amount
2026-09-16,Pontual Servicos Auxil,"34,00"
2026-09-16,Ifd*Papagueti Buritis,"25,89"
2026-09-16,Verdinho Falls,"60,91"
2026-09-16,Api Payment*380b084ed8,"35,00"
2026-09-15,Costelaria Monjardim,"55,47"
2026-09-15,Ifd*Sub Betania Alimen,"81,55"
2026-09-15,Ifd*Lorraine Cristina,"5,00"
2026-09-15,Taxi 14set 09h09min,"32,45"
2026-09-14,Shopee *Parisfashionte - Parcela 1/2,"90,45"
2026-09-14,Shopee *Shopmiximporta - Parcela 1/2,"33,48"
2026-09-14,Shopee *Dafushopbrasil,"56,88"
2026-09-14,Shopee *Passarinhofest,"49,18"
2026-09-14,Shopee *Papelpapelaria,"55,55"
2026-09-13,Minas Grill Bh Shop,"136,20"
2026-09-13,Ifd*Delivery88,"79,36"
2026-09-13,Araujo Loja,"101,12"
2026-09-13,Ri Happy,"179,99"
2026-09-13,Multiplan Administrado,"23,00"
2026-09-12,Ifd*Zamp S.A.,"45,97"
2026-09-12,Max Paper,"112,40"
2026-09-12,Pg *Nuvem Mariachocola - Parcela 1/4,"126,34"
2026-09-12,Terminal Ii Oeste,"30,80"
2026-09-12,Zrrestaurantebufe,"46,89"
2026-09-12,Intercity Anhembi,"34,00"
2026-09-12,Mp *Naty,"20,00"
2026-09-11,IOF de compra internacional,"1,09"
2026-09-11,Zigpay,"67,00"
2026-09-11,Boardgamearena,"31,18"
2026-09-11,Zigpay,"100,11"
2026-09-11,Ifd*Papagueti Buritis,"25,89"
2026-09-10,IOF de compra internacional,"1,96"
2026-09-10,IOF de volta de Boardgamearena,"- 1,09"
2026-09-10,IOF de volta de Real-Debrid*15900420,"- 1,96"
2026-09-10,Zig* *Sombrinha,"18,70"
2026-09-10,Zig* *Sombrinha,"17,60"
2026-09-10,Ifd*Arcos Dourados Com,"32,93"
2026-09-10,Zig* *Sombrinha,"25,19"
2026-09-10,Real-Debrid*15900420,"56,09"
2026-09-10,Timo Reboucas Restaura,"147,15"
2026-09-09,"Crédito de ""Google One"" (Google One)","- 20,82"
2026-09-09,Ifd*Wesley Nascimento,"81,56"
2026-09-09,Google One,"23,99"
2026-09-09,Ifd*Bernardes Comercio,"29,23"
2026-09-09,Araujo Loja,"60,00"
2026-09-09,Ifd*Idelvando Goncalve,"2,00"
2026-09-09,Dl*Uberrides,"58,72"
2026-09-08,Fany Goulart Leite Soa,"254,00"
2026-09-08,Concessionaria Nascent,"9,10"
2026-09-08,Concessionaria Nascent,"9,10"
2026-09-08,Cafe dos Motoristas,"128,00"
2026-09-07,58 46 889 Antonio Marc,"107,00"
2026-09-07,Super J,"71,41"
2026-09-06,Elisangela Maria da Si,"104,50"
2026-09-06,Postobeirarioi,"240,00"
2026-09-06,Bar e Restaurante Turv,"184,00"
2026-09-06,Churrascaria Boi Na,"92,94"
2026-09-05,Apple.Com/Bill,"9,99"
2026-09-05,Del Variedades,"8,90"
2026-09-05,Ifd*Gvg Eventos e Alim,"80,27"
2026-09-05,Dl*Uberrides,"2,23"
2026-09-05,Del Variedades,"68,80"
2026-09-05,Conveniencia Barra Se,"29,30"
2026-09-05,99*,"28,18"
2026-09-05,Posto Havai,"183,88"
2026-09-05,Dl*Uberrides,"20,62"
2026-09-05,Mercadolivre*Mercadol - Parcela 1/2,"111,14"
2026-09-04,Pop 03set 18h56min,"36,90"
2026-09-04,Ifd*Bernardes Comercio,"25,83"
2026-09-04,Dl*Google Youtub,"53,90"
2026-09-04,Google One,"24,99"
2026-09-04,Dl*Uberrides,"47,98"
2026-09-04,Ifd*Ifood Club,"8,97"
2026-09-03,Dl*Uberrides,"27,61"
2026-09-03,99*,"20,81"
2026-09-03,Dl*Uberrides,"39,45"
2026-09-03,Dl*Uberrides,"15,77"
2026-09-03,Ifd*Mario Werneck,"35,08"
2026-09-02,Ifd*Zamp S.A.,"51,98"
2026-09-02,Ds Eventos,"12,50"
2026-09-02,Ifd*Leve Buritis Resta,"67,39"
2026-09-02,Mep*Arena Mrv Esplanad,"13,00"
2026-09-02,Dl*Uberrides,"56,33"
2026-09-02,99*,"29,56"
2026-09-02,Ifd*Ifood Club,"8,97"
2026-09-02,Mp *Janaina,"40,00"
2026-09-01,Ifd*Gvg Eventos e Alim,"33,69"
2026-08-31,Ifd*Rodrigues de Olive,"125,97"
2026-08-31,Mercadolivre*Mercadol,"121,98"
2026-08-30,Padaria Sabor do Trigo,"41,75"
2026-08-30,Super Nosso Nova Lima,"204,63"
2026-08-30,Smoke Point,"25,90"
2026-08-30,Smoke Point,"10,00"
2026-08-29,Sn Buritis,"955,37"
2026-08-29,Leandrolimade,"200,00"
2026-08-29,Ifd*Pizzaria Nova Lima,"42,79"
2026-08-28,Ifd*Ifood Club,"8,97"
2026-08-28,Ifd*Arcos Dourados Com,"52,95"
2026-08-28,Ifd*Rafael Araujo Gori,"52,03"
2026-08-25,Trocafy *Trocafy - Parcela 1/10,"448,19"
2026-08-24,Pagamento recebido,"- 260,46"
2026-08-23,IOF de compra internacional,"3,75"
2026-08-23,Openai *Chatgpt Subscr,"107,38"
2026-08-18,"Crédito de ""Google One"" (Google One)","- 3,22"
2026-08-18,Dm*Spotify,"40,90"
""";

    [Fact]
    public void Parse_RealNubankSampleCsv_ParsesSuccessfully()
    {
        var result = _parser.Parse(SampleNubankCsv);

        Assert.Equal(104, result.TotalLines);
        Assert.Equal(104, result.ValidCount);
        Assert.Equal(0, result.InvalidCount);
        Assert.Equal(1, result.DuplicateCount); // Concessionaria Nascent duplicated on 2026-09-08
        Assert.Equal(9, result.ReferenceMonth);
        Assert.Equal(2026, result.ReferenceYear);

        // Verify duplicate detection for Concessionaria Nascent
        var tollCharges = result.Rows.Where(r => r.Description == "Concessionaria Nascent").ToList();
        Assert.Equal(2, tollCharges.Count);
        Assert.False(tollCharges[0].IsDuplicate);
        Assert.True(tollCharges[1].IsDuplicate);
        Assert.Contains("Duplicada", tollCharges[1].DuplicateReason);

        // Verify payment received (negative value with space)
        var payment = result.Rows.FirstOrDefault(r => r.Description == "Pagamento recebido");
        Assert.NotNull(payment);
        Assert.Equal(-260.46m, payment.Amount);
        Assert.Equal("credito", payment.Type);
        Assert.Equal("2026-08-24", payment.Date);

        // Verify credit/refund with internal quotes
        var credit = result.Rows.FirstOrDefault(r => r.Description.Contains("Crédito de \"Google One\""));
        Assert.NotNull(credit);
        Assert.Equal(-20.82m, credit.Amount);
        Assert.Equal("credito", credit.Type);

        // Verify standard purchase
        var purchase = result.Rows.First(r => r.Description == "Pontual Servicos Auxil");
        Assert.Equal(34.00m, purchase.Amount);
        Assert.Equal("debito", purchase.Type);
        Assert.Equal("2026-09-16", purchase.Date);
    }

    [Fact]
    public void Parse_NegativeAmountsAndSpaces_InterpretedCorrectly()
    {
        var csv = """
date,title,amount
2026-09-01,Estorno Loja,"- 50,00"
2026-09-02,Devolucao PIX,"-120,50"
2026-09-03,Credito Especial,"(30,00)"
""";

        var result = _parser.Parse(csv);

        Assert.Equal(3, result.ValidCount);
        Assert.Equal(-50.00m, result.Rows[0].Amount);
        Assert.Equal("credito", result.Rows[0].Type);

        Assert.Equal(-120.50m, result.Rows[1].Amount);
        Assert.Equal("credito", result.Rows[1].Type);

        Assert.Equal(-30.00m, result.Rows[2].Amount);
        Assert.Equal("credito", result.Rows[2].Type);
    }

    [Fact]
    public void Parse_EmptyLinesAndWhitespace_IgnoredGracefully()
    {
        var csv = """
date,title,amount

2026-09-01,Padaria,"15,00"

   
,,,
2026-09-02,Mercado,"45,00"

""";

        var result = _parser.Parse(csv);

        Assert.Equal(2, result.TotalLines);
        Assert.Equal(2, result.ValidCount);
        Assert.Equal(0, result.InvalidCount);
    }

    [Fact]
    public void Parse_InvalidDatesAndAmounts_IdentifiesInvalidRows()
    {
        var csv = """
date,title,amount
data-errada,Uber,"20,00"
2026-09-05,Farmacia,valor-invalido
2026-09-06,,30.00
""";

        var result = _parser.Parse(csv);

        Assert.Equal(3, result.TotalLines);
        Assert.Equal(0, result.ValidCount);
        Assert.Equal(3, result.InvalidCount);

        Assert.False(result.Rows[0].IsValid);
        Assert.Contains("Data inválida", result.Rows[0].ErrorMessage);

        Assert.False(result.Rows[1].IsValid);
        Assert.Contains("Valor monetário inválido", result.Rows[1].ErrorMessage);

        Assert.False(result.Rows[2].IsValid);
        Assert.Contains("Descrição ausente", result.Rows[2].ErrorMessage);
    }

    [Fact]
    public void Parse_MissingMandatoryColumns_ThrowsInvalidOperationException()
    {
        var csv = """
coluna1,coluna2,coluna3
1,2,3
""";

        var ex = Assert.Throws<InvalidOperationException>(() => _parser.Parse(csv));
        Assert.Contains("não contém as colunas obrigatórias", ex.Message);
    }

    [Fact]
    public void Parse_SemicolonDelimiterAndAlternativeHeaders_ParsesCorrectly()
    {
        var csv = """
Data;Descrição;Valor;Categoria
16/09/2026;Restaurante Central;75,50;Alimentacao
15/09/2026;Uber Corrida;- 18,90;Transporte
""";

        var result = _parser.Parse(csv);

        Assert.Equal(2, result.ValidCount);
        Assert.Equal("2026-09-16", result.Rows[0].Date);
        Assert.Equal("Restaurante Central", result.Rows[0].Description);
        Assert.Equal(75.50m, result.Rows[0].Amount);
        Assert.Equal("Alimentacao", result.Rows[0].Category);

        Assert.Equal("2026-09-15", result.Rows[1].Date);
        Assert.Equal(-18.90m, result.Rows[1].Amount);
        Assert.Equal("credito", result.Rows[1].Type);
        Assert.Equal("Transporte", result.Rows[1].Category);
    }

    [Theory]
    [InlineData("1.234,56", 1234.56)]
    [InlineData("34,00", 34.00)]
    [InlineData("- 20,82", -20.82)]
    [InlineData("R$ 150,00", 150.00)]
    [InlineData("- R$ 45,90", -45.90)]
    public void TryParseAmount_HandlesVariousFormats(string input, decimal expected)
    {
        var success = NubankCsvParser.TryParseAmount(input, out var result);
        Assert.True(success);
        Assert.Equal(expected, result);
    }

    [Theory]
    [InlineData("2026-09-16", "2026-09-16")]
    [InlineData("16/09/2026", "2026-09-16")]
    [InlineData("2026-09-16T10:30:00", "2026-09-16")]
    public void TryParseDate_HandlesVariousFormats(string input, string expected)
    {
        var success = NubankCsvParser.TryParseDate(input, out _, out var formatted);
        Assert.True(success);
        Assert.Equal(expected, formatted);
    }
}
