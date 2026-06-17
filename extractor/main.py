from collections import defaultdict
from decimal import Decimal
from pathlib import Path
import csv
import re
import tempfile
import unicodedata

import fitz
from fastapi import FastAPI, File, UploadFile
from pydantic import BaseModel

app = FastAPI(title="Invoice Extractor")

date_re = re.compile(r"^\d{2}/\d{2}$")
value_re = re.compile(r"^-?\s?\d{1,3}(?:\.\d{3})*,\d{2}$")
negative_signs = {"-", "\u2212", "\u2013", "\u2014"}


class Transaction(BaseModel):
    date: str
    description: str
    rawCategory: str
    amount: float
    type: str


class ExtractResponse(BaseModel):
    bank: str
    transactions: list[Transaction]


def normalize_value(value: str) -> Decimal:
    value = value.strip().replace(" ", "")

    for sign in negative_signs:
        value = value.replace(sign, "-")

    negative = value.startswith("-")
    if negative:
        value = value[1:]

    value = value.replace(".", "").replace(",", ".")
    if negative:
        value = "-" + value

    return Decimal(value)


def parse_description_and_value(parts: list[str], date_index: int, value_index: int):
    value = parts[value_index]
    description_parts = parts[date_index + 1:value_index]

    if description_parts and description_parts[-1] in negative_signs:
        value = "-" + value
        description_parts = description_parts[:-1]

    description = " ".join(description_parts).strip()
    return description, normalize_value(value)


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    return ascii_text.lower()


def find_installments_section_y(words) -> float | None:
    rows = defaultdict(list)

    for x0, y0, _x1, _y1, text, *_ in words:
        text = text.strip()
        if not text:
            continue

        y_key = round(y0 / 3) * 3
        rows[y_key].append((x0, text))

    for y in sorted(rows.keys()):
        line = " ".join(text for x, text in sorted(rows[y], key=lambda p: p[0]))
        normalized_line = normalize_text(line)

        if "compras parceladas" in normalized_line and "proximas faturas" in normalized_line:
            return y

    return None


def extract_rows_from_page(page, page_number: int):
    words = page.get_text("words")
    page_width = page.rect.width
    transactions = []
    installments_section_y = find_installments_section_y(words)

    columns = [
        ("esquerda", page_width * 0.25, page_width * 0.58),
        ("direita", page_width * 0.58, page_width * 0.95),
    ]

    for column_name, min_x, max_x in columns:
        rows = defaultdict(list)

        for x0, y0, _x1, _y1, text, *_ in words:
            text = text.strip()
            if not text:
                continue

            if not (min_x <= x0 < max_x):
                continue

            if y0 < 100 or y0 > page.rect.height - 80:
                continue

            y_key = round(y0 / 3) * 3
            rows[y_key].append((x0, text))

        for y in sorted(rows.keys()):
            if installments_section_y is not None and y >= installments_section_y:
                continue

            parts = [text for x, text in sorted(rows[y], key=lambda p: p[0])]

            if len(parts) < 3:
                continue

            date_index = next((i for i, part in enumerate(parts) if date_re.match(part)), None)
            value_index = next((i for i in range(len(parts) - 1, -1, -1) if value_re.match(parts[i])), None)

            if date_index is None or value_index is None or value_index <= date_index:
                continue

            date = parts[date_index]
            description, amount = parse_description_and_value(parts, date_index, value_index)

            normalized_description = normalize_text(description)

            if "compras parceladas" in normalized_description:
                continue
            if "proximas faturas" in normalized_description:
                continue
            if not description:
                continue

            transactions.append(
                {
                    "page": page_number,
                    "column": column_name,
                    "y": y,
                    "date": date,
                    "description": description,
                    "rawCategory": "",
                    "amount": amount,
                    "type": "credito" if amount < 0 else "debito",
                }
            )

    return transactions


def extract_transactions(pdf_path: str):
    doc = fitz.open(pdf_path)
    all_transactions = []
    seen = set()
    total_pages = len(doc)

    for page_number, page in enumerate(doc, start=1):
        if page_number == total_pages:
            continue

        rows = extract_rows_from_page(page, page_number)
        for row in rows:
            key = (
                row["page"],
                row["column"],
                row["y"],
                row["date"],
                row["description"],
                str(row["amount"]),
            )

            if key in seen:
                continue

            seen.add(key)
            all_transactions.append(row)

    return all_transactions


def export_csv_debug(transactions: list[dict], output_path: str):
    with open(output_path, "w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["page", "column", "y", "date", "description", "rawCategory", "amount", "type"],
            delimiter=";",
        )
        writer.writeheader()
        writer.writerows(transactions)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract", response_model=ExtractResponse)
async def extract(file: UploadFile = File(...)):
    suffix = Path(file.filename or "invoice.pdf").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_file.write(await file.read())
        temp_path = temp_file.name

    try:
        rows = extract_transactions(temp_path)
        transactions = [
            Transaction(
                date=row["date"],
                description=row["description"],
                rawCategory=row["rawCategory"],
                amount=float(row["amount"]),
                type=row["type"],
            )
            for row in rows
        ]
        return ExtractResponse(bank="itau", transactions=transactions)
    finally:
        Path(temp_path).unlink(missing_ok=True)
