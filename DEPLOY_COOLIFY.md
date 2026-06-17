# Deploy no Coolify

## Rodar localmente

1. Copie o arquivo de variaveis:
   ```bash
   cp .env.example .env
   ```

2. Suba todos os servicos:
   ```bash
   docker compose up -d --build
   ```

3. Acesse:
   - App: http://localhost:8080
   - API direta, se precisar testar: http://localhost:5000
   - Extractor direto, se precisar testar: http://localhost:8000

No modo local com `ng serve`, o frontend usa `http://localhost:5000/api`. No container Nginx, ele usa `/api` e o proprio Nginx faz proxy para `invoice-api:5000`.

## Deploy no Coolify

1. No Coolify, crie um novo recurso do tipo **Docker Compose** apontando para:
   - Repository: `https://github.com/albertosena/invoice-manager.git`
   - Branch: `main`
   - Compose file: `docker-compose.yml`

2. Configure o dominio do servico `invoice-web`:
   - Domain: `https://invoice.albertosena.com`
   - Port interno: `80`

3. Configure as variaveis de ambiente no Coolify:
   ```env
   ASPNETCORE_ENVIRONMENT=Production
   WEB_PORT=8080
   API_PORT=5000
   EXTRACTOR_PORT=8000
   POSTGRES_PORT=5432

   POSTGRES_DB=invoice_manager
   POSTGRES_USER=invoice
   POSTGRES_PASSWORD=troque-por-uma-senha-forte

   JWT_ISSUER=invoice-manager
   JWT_KEY=troque-por-uma-chave-longa-com-32-ou-mais-caracteres
   ```

4. Faça o deploy.

5. Acesse:
   - https://invoice.albertosena.com

## Como a aplicacao fica conectada em producao

- O navegador acessa apenas `invoice-web`.
- O Angular chama `/api`.
- O Nginx do frontend encaminha `/api` para `invoice-api:5000`.
- O backend chama o extractor em `http://invoice-extractor:8000`.
- O backend usa o Postgres em `invoice-db:5432`.

## Observacoes

- Use uma `JWT_KEY` forte em producao. Nao use o valor local do `.env.example`.
- O volume `invoice_pgdata` guarda os dados do Postgres.
- O volume `invoice_uploads` guarda os PDFs importados.
- O backend aplica migrations automaticamente ao iniciar.
