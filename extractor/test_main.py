from decimal import Decimal

import main


class Rect:
    width = 600
    height = 840


class Page:
    rect = Rect()

    def __init__(self, words):
        self.words = words

    def get_text(self, kind):
        assert kind == "words"
        return self.words


def word(x, y, text):
    return (x, y, x + 20, y + 10, text, 0, 0, 0)


def test_installments_cutoff_only_affects_its_own_column():
    words = [
        word(350, 150, "Compras"),
        word(395, 150, "parceladas"),
        word(450, 150, "-"),
        word(460, 150, "próximas"),
        word(520, 150, "faturas"),
        word(150, 180, "10/07"),
        word(190, 180, "COMPRA"),
        word(310, 180, "100,00"),
        word(350, 180, "10/07"),
        word(390, 180, "PARCELA"),
        word(510, 180, "50,00"),
    ]

    rows = main.extract_rows_from_page(Page(words), page_number=4)

    assert len(rows) == 1
    assert rows[0]["column"] == "esquerda"
    assert rows[0]["description"] == "COMPRA"
    assert rows[0]["amount"] == Decimal("100.00")


def test_iof_charge_inherits_the_related_international_transaction_date():
    words = [
        word(150, 180, "25/06"),
        word(190, 180, "COMPRA"),
        word(310, 180, "25,46"),
        word(150, 195, "Repasse"),
        word(195, 195, "de"),
        word(215, 195, "IOF"),
        word(240, 195, "em"),
        word(260, 195, "R$"),
        word(310, 195, "0,88"),
    ]

    rows = main.extract_rows_from_page(Page(words), page_number=4)

    assert len(rows) == 2
    assert rows[1]["date"] == "25/06"
    assert rows[1]["description"] == "Repasse de IOF em R$"
    assert rows[1]["amount"] == Decimal("0.88")
