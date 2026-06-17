# Invoice Manager

Sistema web para importar faturas de cartão de crédito em PDF, extrair lançamentos, salvar em PostgreSQL e categorizar despesas mensalmente.

## Arquitetura

```text
Angular -> .NET API -> Python Extractor -> .NET API -> PostgreSQL -> Angular
```

O Angular chama somente a API .NET. O serviço Python não acessa o banco; ele apenas recebe um PDF em `POST /extract` e retorna JSON estruturado.

## Estrutura

```text
invoice-manager/
  frontend/      Angular
  backend/       .NET API + EF Core
  extractor/     FastAPI + PyMuPDF
  docker-compose.yml
```

## Rodando com Docker Compose

Na pasta `invoice-manager`:

```bash
docker compose up --build
```

Serviços:

- Frontend: http://localhost:8080
- API .NET: http://localhost:5000
- Extractor Python: http://localhost:8000/health
- PostgreSQL: localhost:5432

A API usa internamente `http://invoice-extractor:8000/extract` dentro do Docker.

## Rodando localmente

Suba um PostgreSQL local com:

```bash
docker compose up -d invoice-db
```

Inicie o extractor:

```bash
cd extractor
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Inicie a API:

```bash
cd backend
dotnet ef database update
dotnet run
```

Inicie o Angular:

```bash
cd frontend
npm install
npm start
```

Abra http://localhost:4200.

## Banco e migrations

A connection string padrão fica em `backend/appsettings.json`:

```text
Host=localhost;Port=5432;Database=invoice_manager;Username=invoice;Password=invoice
```

Para criar uma nova migration:

```bash
cd backend
dotnet ef migrations add NomeDaMigration
dotnet ef database update
```

A API também aplica migrations ao iniciar, com tentativas curtas para aguardar o Postgres no Docker.

## Fluxo de upload

1. O usuário envia o PDF pela tela Angular.
2. A API recebe em `POST /api/invoices/upload`.
3. A API salva o arquivo em `uploads/invoices`.
4. A API chama o extractor Python em `POST /extract`.
5. O extractor retorna:

```json
{
  "bank": "itau",
  "transactions": [
    {
      "date": "13/06",
      "description": "Uber Trip",
      "rawCategory": "",
      "amount": 32.9,
      "type": "debito"
    }
  ]
}
```

6. A API normaliza descrições, aplica regras simples e salva fatura/lançamentos.

## Categorias e regras

Categorias iniciais são criadas para o usuário demo. Ao editar a categoria de um lançamento, a tela permite:

- `single`: altera somente o lançamento.
- `same_invoice`: altera lançamentos parecidos na mesma fatura.
- `similar_future`: cria regra `contains` para futuras importações.

A normalização fica em `backend/Services/TextNormalizer.cs`.

## Adaptando o extractor

A lógica herdada do script original está em `extractor/main.py`:

- `extract_rows_from_page`: controla colunas, áreas ignoradas e filtros.
- `parse_description_and_value`: separa descrição e valor.
- `normalize_value`: converte valores brasileiros para número decimal.
- `extract_transactions`: ignora apenas a última página.
- `extract_rows_from_page`: lê lançamentos até antes da seção `Compras parceladas - próximas faturas`.

Se o layout do PDF mudar, ajuste primeiro os limites das colunas e filtros de texto em `extract_rows_from_page`. O retorno principal deve continuar sendo JSON; CSV existe apenas como função opcional de debug.
