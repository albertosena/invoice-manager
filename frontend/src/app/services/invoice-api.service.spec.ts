import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE } from './api-url';
import { InvoiceApiService } from './invoice-api.service';

describe('InvoiceApiService', () => {
  let service: InvoiceApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [InvoiceApiService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InvoiceApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uploads a PDF using multipart form data', () => {
    const data = new FormData();
    data.append('file', new File(['pdf'], 'invoice.pdf', { type: 'application/pdf' }));
    const response = { id: 'inv-1', status: 'completed', transactions: 12 };

    service.uploadInvoice(data).subscribe((value) => expect(value).toEqual(response));

    const request = http.expectOne(`${API_BASE}/invoices/upload`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBe(data);
    request.flush(response);
  });

  it('previews Nubank CSV file via previewNubankCsv', () => {
    const file = new File(['date,title,amount'], 'nubank.csv', { type: 'text/csv' });
    const response = {
      fileName: 'nubank.csv',
      totalLines: 1,
      validCount: 1,
      invalidCount: 0,
      duplicateCount: 0,
      totalAmount: 34.0,
      referenceMonth: 9,
      referenceYear: 2026,
      bankName: 'Nubank',
      items: [],
    };

    service.previewNubankCsv(file).subscribe((value) => expect(value).toEqual(response));

    const request = http.expectOne(`${API_BASE}/invoices/nubank-csv/preview`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body instanceof FormData).toBeTrue();
    request.flush(response);
  });

  it('confirms Nubank CSV import via confirmNubankCsv', () => {
    const payload = {
      originalFileName: 'nubank.csv',
      bankName: 'Nubank',
      referenceMonth: 9,
      referenceYear: 2026,
      ignoredCount: 0,
      rejectedCount: 0,
      transactions: [{ date: '2026-09-16', description: 'Uber', amount: 25.0, type: 'debito', categoryId: null }],
    };
    const response = { id: 'inv-nubank', status: 'completed', importedCount: 1, ignoredCount: 0, rejectedCount: 0 };

    service.confirmNubankCsv(payload).subscribe((value) => expect(value).toEqual(response));

    const request = http.expectOne(`${API_BASE}/invoices/nubank-csv/confirm`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush(response);
  });

  it('loads invoices and transactions from their expected endpoints', () => {
    service.getInvoices().subscribe((value) => expect(value).toEqual([]));
    http.expectOne(`${API_BASE}/invoices`).flush([]);

    service.getTransactions('inv 1').subscribe((value) => expect(value).toEqual([]));
    const request = http.expectOne(`${API_BASE}/invoices/inv 1/transactions`);
    expect(request.request.method).toBe('GET');
    request.flush([]);
  });

  it('creates, updates, and deletes categories with the original payload', () => {
    const payload = { name: 'Mercado', color: '#123456', icon: 'cart', monthlyGoal: 800 };

    service.createCategory(payload).subscribe();
    let request = http.expectOne(`${API_BASE}/categories`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(payload);
    request.flush({ id: 'cat-1', ...payload });

    service.updateCategory('cat-1', payload).subscribe();
    request = http.expectOne(`${API_BASE}/categories/cat-1`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual(payload);
    request.flush({});

    service.deleteCategory('cat-1').subscribe();
    request = http.expectOne(`${API_BASE}/categories/cat-1`);
    expect(request.request.method).toBe('DELETE');
    request.flush({});
  });

  it('sends rule and transaction categorization mutations correctly', () => {
    const rule = { matchType: 'contains', pattern: 'UBER', categoryId: 'cat-1' };
    service.createRule(rule).subscribe();
    let request = http.expectOne(`${API_BASE}/categorization-rules`);
    expect(request.request.body).toEqual(rule);
    request.flush({});

    service.updateTransactionCategory('tx-1', {
      categoryId: 'cat-1',
      mode: 'single',
      rulePattern: null,
    }).subscribe();
    request = http.expectOne(`${API_BASE}/transactions/tx-1/category`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ categoryId: 'cat-1', mode: 'single', rulePattern: null });
    request.flush({});

    service.bulkCategorize(['tx-1', 'tx-2'], 'cat-1').subscribe();
    request = http.expectOne(`${API_BASE}/transactions/bulk-categorize`);
    expect(request.request.body).toEqual({ transactionIds: ['tx-1', 'tx-2'], categoryId: 'cat-1' });
    request.flush({ updated: 2 });
  });

  it('passes the selected period to all dashboard endpoints', () => {
    const params = '?month=6&year=2026';
    service.getMonthlySummary(params).subscribe((summary) => expect(summary.totalSpent).toBe(0));
    service.getCategorySummary(params).subscribe((summary) => expect(summary).toEqual([]));
    service.getMonthComparison(params).subscribe((comparison) => expect(comparison.difference).toBe(0));

    http.expectOne(`${API_BASE}/dashboard/monthly-summary${params}`).flush({
      totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0,
    });
    http.expectOne(`${API_BASE}/dashboard/category-summary${params}`).flush([]);
    http.expectOne(`${API_BASE}/dashboard/month-comparison${params}`).flush({
      current: { totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0 },
      previous: { totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0 },
      difference: 0,
      percentage: null,
    });
  });

  it('propagates API failures to subscribers', () => {
    let status = 0;
    service.getInvoices().subscribe({ error: (error) => (status = error.status) });
    http.expectOne(`${API_BASE}/invoices`).flush('unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });
    expect(status).toBe(503);
  });
});
