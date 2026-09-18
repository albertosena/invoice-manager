import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { App } from './app';
import { Category, Invoice, Transaction } from './models/invoice.models';
import { AuthService } from './services/auth.service';
import { InvoiceApiService } from './services/invoice-api.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  let component: App;
  let auth: jasmine.SpyObj<AuthService>;
  let api: jasmine.SpyObj<InvoiceApiService>;

  const user = { id: 'user-1', name: 'Ana', email: 'ana@example.com' };
  const categories: Category[] = [
    { id: 'food', name: 'Alimentação', color: '#ff0000', icon: 'cart', monthlyGoal: 1000 },
    { id: 'transport', name: 'Transporte', color: '#0000ff', icon: 'car', monthlyGoal: 500 },
  ];
  const invoices: Invoice[] = [
    {
      id: 'inv-1', bankName: 'Banco', referenceMonth: 6, referenceYear: 2026,
      originalFileName: 'junho.pdf', status: 'completed', createdAt: '2026-06-10T12:00:00Z',
      transactionCount: 2,
    },
    {
      id: 'inv-2', bankName: 'Banco', referenceMonth: 5, referenceYear: 2026,
      originalFileName: 'maio.pdf', status: 'failed', createdAt: '2026-05-10T12:00:00Z',
      transactionCount: 0,
    },
  ];
  const transactions: Transaction[] = [
    {
      id: 'tx-1', date: '2026-06-01', description: 'SUPERMERCADO CENTRAL',
      normalizedDescription: 'SUPERMERCADO CENTRAL', rawCategory: '', amount: 200,
      type: 'debit', categoryId: 'food', categoryName: 'Alimentação',
    },
    {
      id: 'tx-2', date: '2026-06-02', description: 'ESTORNO',
      normalizedDescription: 'ESTORNO', rawCategory: '', amount: -50,
      type: 'credit', categoryId: 'transport', categoryName: 'Transporte',
    },
  ];

  beforeEach(async () => {
    localStorage.clear();
    history.replaceState(null, '', '/dashboard');
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'register', 'me']);
    api = jasmine.createSpyObj<InvoiceApiService>('InvoiceApiService', [
      'uploadInvoice', 'previewNubankCsv', 'confirmNubankCsv', 'getInvoices', 'getTransactions', 'deleteInvoice', 'getCategories',
      'createCategory', 'updateCategory', 'deleteCategory', 'getCategorizationRules',
      'createRule', 'updateRule', 'deleteRule', 'updateTransactionCategory', 'bulkCategorize',
      'getMonthlySummary', 'getCategorySummary', 'getMonthComparison',
      'getGoals', 'saveGoal', 'updateGoal', 'deleteGoal', 'copyPreviousMonthGoals',
    ]);
    auth.me.and.returnValue(of(user));
    api.getInvoices.and.returnValue(of([]));
    api.getTransactions.and.returnValue(of([]));
    api.getCategories.and.returnValue(of([]));
    api.getCategorizationRules.and.returnValue(of([]));
    api.getMonthlySummary.and.returnValue(of({
      totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0,
    }));
    api.getCategorySummary.and.returnValue(of([]));
    api.getMonthComparison.and.returnValue(of({
      current: { totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0 },
      previous: { totalSpent: 0, totalCredits: 0, netAmount: 0, transactionCount: 0 },
      difference: 0, percentage: null,
    }));
    api.getGoals.and.returnValue(of({
      year: 2026,
      month: 6,
      overallGoal: null,
      summary: {
        grossSpent: 0,
        credits: 0,
        netSpent: 0,
        goalAmount: 0,
        available: 0,
        percentageUsed: 0,
        projection: 0,
        status: 'no_goal',
      },
      categoryGoals: [],
      history: [],
    }));
    api.saveGoal.and.returnValue(of({ success: true, count: 1 }));
    api.updateGoal.and.returnValue(of({} as any));
    api.deleteGoal.and.returnValue(of(undefined as any));
    api.copyPreviousMonthGoals.and.returnValue(of({ success: true, copied: 2 }));

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: InvoiceApiService, useValue: api },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  function authenticate(page: 'dashboard' | 'invoices' | 'goals' | 'categories' = 'dashboard'): void {
    component.token.set('token');
    component.currentUser.set(user);
    component.activePage.set(page);
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  describe('dashboard', () => {
    beforeEach(() => authenticate());

    it('renders the 3 main financial cards with the monthly summary values', () => {
      component.monthlySummary.set({
        totalSpent: 1250.5,
        totalCredits: -200,
        netAmount: 1050.5,
        transactionCount: 8,
        monthlyGoal: 3000,
        categorizedCount: 6,
        uncategorizedCount: 2,
        categorizedPercentage: 75,
      });
      fixture.detectChanges();
      const cards = fixture.nativeElement.querySelectorAll('.dashboard-top-cards .metric-card');
      expect(cards.length).toBe(3);
      expect(text()).toContain('Gasto líquido no mês');
      expect(text()).toContain('R$ 1.050,50');
      expect(text()).toContain('Compras: R$ 1.250,50');
      expect(text()).toContain('Créditos: -R$ 200,00');
      expect(text()).toContain('Meta mensal');
      expect(text()).toContain('de R$ 3.000,00');
      expect(text()).toContain('Lançamentos');
      expect(cards[2].textContent).toContain('8');
      expect(text()).toContain('6 categorizados');
      expect(text()).toContain('2 sem categoria');
    });

    it('calculates current/previous category shares and increase, decrease, and neutral trends', () => {
      component.categorySummary.set([
        { categoryId: 'food', categoryName: 'Alimentação', total: 600, count: 3, monthlyGoal: 1000 },
        { categoryId: 'transport', categoryName: 'Transporte', total: 300, count: 2, monthlyGoal: 500 },
        { categoryId: null, categoryName: 'Lazer', total: 100, count: 1, monthlyGoal: 0 },
      ]);
      component.previousCategorySummary.set([
        { categoryId: 'food', categoryName: 'Alimentação', total: 400, count: 2, monthlyGoal: 1000 },
        { categoryId: 'transport', categoryName: 'Transporte', total: 500, count: 2, monthlyGoal: 500 },
        { categoryId: null, categoryName: 'Lazer', total: 100, count: 1, monthlyGoal: 0 },
      ]);

      const rows = component.categoryComparisonRows();
      expect(rows[0]).toEqual(jasmine.objectContaining({ delta: 200, percentage: 50, share: 60 }));
      expect(component.categoryTrendClass(rows[0])).toBe('up');
      expect(component.categoryTrendClass(rows[1])).toBe('down');
      expect(component.categoryTrendClass(rows[2])).toBe('flat');
      expect(component.categoryPercentageLabel(rows[2])).toBe('0%');
    });

    it('renders category totals, percentages, comparison, and insights', () => {
      component.categories.set(categories);
      component.categorySummary.set([
        { categoryId: 'food', categoryName: 'Alimentação', total: 750, count: 3, monthlyGoal: 1000 },
        { categoryId: 'transport', categoryName: 'Transporte', total: 250, count: 1, monthlyGoal: 500 },
      ]);
      component.previousCategorySummary.set([
        { categoryId: 'food', categoryName: 'Alimentação', total: 500, count: 2, monthlyGoal: 1000 },
        { categoryId: 'transport', categoryName: 'Transporte', total: 300, count: 1, monthlyGoal: 500 },
      ]);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelectorAll('.category-summary-row').length).toBe(2);
      expect(text()).toContain('75% do gasto');
      expect(text()).toContain('Maior gasto');
      expect(text()).toContain('Maior alta');
      expect(text()).toContain('Maior queda');
    });

    it('renders recent invoices and opens one in the invoice workspace', () => {
      component.invoices.set(invoices);
      api.getTransactions.and.returnValue(of(transactions));
      fixture.detectChanges();
      const recent = fixture.nativeElement.querySelector('.recent-invoices-panel .invoice-item') as HTMLButtonElement;
      expect(text()).toContain('junho.pdf');
      expect(recent.textContent).toContain('Concluída');

      recent.click();
      expect(component.activePage()).toBe('invoices');
      expect(component.selectedInvoiceId()).toBe('inv-1');
      expect(api.getTransactions).toHaveBeenCalledWith('inv-1');
    });

    it('shows dashboard empty states when there are no invoices or categories', () => {
      fixture.detectChanges();
      expect(text()).toContain('Sem dados para o período selecionado.');
      expect(text()).toContain('Importe uma fatura PDF para alimentar o dashboard.');
    });

    it('reloads dashboard data for a changed period including the previous month', () => {
      component.changeDashboardPeriod('2026-01');
      expect(component.dashboardPeriod()).toBe('2026-01');
      expect(api.getMonthlySummary).toHaveBeenCalledWith('?month=1&year=2026');
      expect(api.getCategorySummary).toHaveBeenCalledWith('?month=12&year=2025');
      expect(api.getMonthComparison).toHaveBeenCalledWith('?month=1&year=2026');
    });
  });

  describe('invoices and imports', () => {
    beforeEach(() => authenticate('invoices'));

    it('renders the invoice list, failed status mapping, and a zero-transaction invoice', () => {
      component.invoices.set(invoices);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.invoice-row').length).toBe(2);
      expect(text()).toContain('maio.pdf');
      expect(text()).toContain('0 itens');
      expect(component.invoiceStatusLabel('failed')).toBe('Falhou');
    });

    it('calculates selected invoice totals from debits and credits', () => {
      component.transactions.set(transactions);
      fixture.detectChanges();
      expect(component.selectedInvoiceSummary()).toEqual({
        totalSpent: 200, totalCredits: -50, netAmount: 150, transactionCount: 2,
      });
      expect(text()).toContain('R$ 150,00');
      expect(text()).toContain('SUPERMERCADO CENTRAL');
    });

    it('filters transactions by text, category, debit/credit, and matching rules', () => {
      component.transactions.set(transactions);
      component.categorizationRules.set([{
        id: 'rule-1', matchType: 'contains', pattern: 'SUPERMERCADO',
        normalizedPattern: 'SUPERMERCADO', categoryId: 'food', category: categories[0],
        createdAt: '2026-06-01',
      }]);
      component.transactionSearch.set('central');
      expect(component.filteredTransactions().map((item) => item.id)).toEqual(['tx-1']);
      component.transactionSearch.set('');
      component.transactionQuickFilter.set('creditos');
      expect(component.filteredTransactions().map((item) => item.id)).toEqual(['tx-2']);
      component.transactionQuickFilter.set('withRule');
      expect(component.filteredTransactions().map((item) => item.id)).toEqual(['tx-1']);
      component.transactionCategoryFilter.set('transport');
      expect(component.filteredTransactions()).toEqual([]);
    });

    it('imports a PDF, selects the result, refreshes data, and loads its transactions', () => {
      api.uploadInvoice.and.returnValue(of({ id: 'inv-new', status: 'completed', transactions: 4 }));
      spyOn(component, 'refreshAll');
      spyOn(component, 'loadTransactions');
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [new File(['pdf'], 'new.pdf')] });

      component.onFileSelected({ target: input } as unknown as Event);

      expect(api.uploadInvoice).toHaveBeenCalled();
      expect(component.uploadMessage()).toContain('4');
      expect(component.selectedInvoiceId()).toBe('inv-new');
      expect(component.activePage()).toBe('invoices');
      expect(component.refreshAll).toHaveBeenCalled();
      expect(component.loadTransactions).toHaveBeenCalledWith('inv-new');
      expect(component.loading()).toBeFalse();
    });

    it('shows the API detail and stops loading after a failed import', () => {
      api.uploadInvoice.and.returnValue(throwError(() => ({ error: { detail: 'PDF inválido' } })));
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [new File(['bad'], 'bad.pdf')] });
      component.onFileSelected({ target: input } as unknown as Event);
      expect(component.uploadMessage()).toBe('PDF inválido');
      expect(component.loading()).toBeFalse();
    });

    it('previews a Nubank CSV, allows deselecting duplicates, and confirms import', () => {
      const previewResponse = {
        fileName: 'nubank.csv',
        totalLines: 3,
        validCount: 3,
        invalidCount: 0,
        duplicateCount: 1,
        totalAmount: 48.0,
        referenceMonth: 9,
        referenceYear: 2026,
        bankName: 'Nubank',
        items: [
          {
            lineNumber: 2,
            date: '2026-09-16',
            description: 'Uber',
            normalizedDescription: 'UBER',
            amount: 25.0,
            type: 'debito',
            categoryId: null,
            categoryName: null,
            isValid: true,
            errorMessage: null,
            isDuplicate: false,
            duplicateReason: null,
            selected: true,
          },
          {
            lineNumber: 3,
            date: '2026-09-15',
            description: 'Uber',
            normalizedDescription: 'UBER',
            amount: 25.0,
            type: 'debito',
            categoryId: null,
            categoryName: null,
            isValid: true,
            errorMessage: null,
            isDuplicate: true,
            duplicateReason: 'Duplicada',
            selected: true,
          },
          {
            lineNumber: 4,
            date: '2026-09-10',
            description: 'Estorno',
            normalizedDescription: 'ESTORNO',
            amount: -2.0,
            type: 'credito',
            categoryId: null,
            categoryName: null,
            isValid: true,
            errorMessage: null,
            isDuplicate: false,
            duplicateReason: null,
            selected: true,
          },
        ],
      };

      api.previewNubankCsv.and.returnValue(of(previewResponse));
      api.confirmNubankCsv.and.returnValue(
        of({ id: 'inv-nubank-1', status: 'completed', importedCount: 2, ignoredCount: 1, rejectedCount: 0 }),
      );
      spyOn(component, 'refreshAll');
      spyOn(component, 'loadTransactions');

      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [new File(['csv'], 'nubank.csv')] });

      component.onCsvFileSelected({ target: input } as unknown as Event);

      expect(api.previewNubankCsv).toHaveBeenCalled();
      expect(component.showNubankPreviewModal()).toBeTrue();
      expect(component.nubankPreviewItems().length).toBe(3);
      expect(component.nubankDuplicateCount()).toBe(1);
      expect(component.nubankSelectedCount()).toBe(3);

      // Deselect duplicates
      component.deselectNubankDuplicates();
      expect(component.nubankSelectedCount()).toBe(2);

      // Confirm import
      component.confirmNubankImport();
      expect(api.confirmNubankCsv).toHaveBeenCalled();
      expect(component.showNubankPreviewModal()).toBeFalse();
      expect(component.uploadMessage()).toContain('2 lançamentos importados');
      expect(component.selectedInvoiceId()).toBe('inv-nubank-1');
      expect(component.activePage()).toBe('invoices');
      expect(component.loadTransactions).toHaveBeenCalledWith('inv-nubank-1');
    });

    it('cancels Nubank CSV preview without importing', () => {
      component.showNubankPreviewModal.set(true);
      component.nubankPreviewItems.set([
        {
          lineNumber: 2,
          date: '2026-09-16',
          description: 'Uber',
          normalizedDescription: 'UBER',
          amount: 25.0,
          type: 'debito',
          categoryId: null,
          categoryName: null,
          isValid: true,
          errorMessage: null,
          isDuplicate: false,
          duplicateReason: null,
          selected: true,
        },
      ]);

      component.cancelNubankPreview();
      expect(component.showNubankPreviewModal()).toBeFalse();
      expect(component.nubankPreviewItems().length).toBe(0);
      expect(api.confirmNubankCsv).not.toHaveBeenCalled();
    });

    it('handles drag and drop for Nubank CSV', () => {
      const mockDragEvent = {
        preventDefault: jasmine.createSpy('preventDefault'),
        stopPropagation: jasmine.createSpy('stopPropagation'),
        dataTransfer: {
          types: ['Files'],
          files: [new File(['csv'], 'nubank.csv', { type: 'text/csv' })],
        },
      } as unknown as DragEvent;

      component.onCsvDragOver(mockDragEvent);
      expect(component.isDraggingCsv()).toBeTrue();

      component.onCsvDragLeave(mockDragEvent);
      expect(component.isDraggingCsv()).toBeFalse();

      spyOn(component, 'handleCsvFile');
      component.onCsvDrop(mockDragEvent);
      expect(component.isDraggingCsv()).toBeFalse();
      expect(component.handleCsvFile).toHaveBeenCalled();
    });
  });

  describe('categories, forms, auth, and navigation', () => {
    it('renders and filters categories with their totals and goals', () => {
      authenticate('categories');
      component.categories.set(categories);
      component.categorySummary.set([
        { categoryId: 'food', categoryName: 'Alimentação', total: 250, count: 2, monthlyGoal: 1000 },
      ]);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.category-card').length).toBe(2);
      expect(text()).toContain('Meta R$ 1.000,00');
      component.categorySearch.set('transport');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelectorAll('.category-card').length).toBe(1);
      expect(text()).toContain('Transporte');
    });

    it('guards invalid category/rule forms and submits normalized valid values', () => {
      api.createCategory.and.returnValue(of(categories[0]));
      api.createRule.and.returnValue(of({}));
      spyOn(component, 'loadCategories');
      spyOn(component, 'loadDashboard');
      spyOn(component, 'loadCategorizationRules');

      component.newCategory = { name: '   ', color: '#fff', icon: 'x', monthlyGoal: -5 };
      component.createCategory();
      expect(api.createCategory).not.toHaveBeenCalled();
      component.newCategory.name = ' Mercado ';
      component.createCategory();
      expect(api.createCategory).toHaveBeenCalledWith(jasmine.objectContaining({
        name: 'Mercado', monthlyGoal: 0,
      }));

      component.ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
      component.saveRule();
      expect(component.ruleFormMessage()).toContain('Informe o texto');
      expect(api.createRule).not.toHaveBeenCalled();
      component.ruleForm = { id: '', pattern: ' UBER ', categoryId: 'transport', matchType: 'contains' };
      component.saveRule();
      expect(api.createRule).toHaveBeenCalledWith({
        matchType: 'contains', pattern: 'UBER', categoryId: 'transport',
      });
    });

    it('shows login errors and persists a successful login', () => {
      auth.login.and.returnValues(
        throwError(() => new Error('unauthorized')),
        of({ token: 'new-token', expiresAt: '2026-07-01', user }),
      );
      component.login();
      expect(component.authMessage()).toContain('inválidos');
      expect(component.loading()).toBeFalse();
      spyOn(component, 'refreshAll');
      component.login();
      expect(component.token()).toBe('new-token');
      expect(localStorage.getItem('invoice-manager-token')).toBe('new-token');
      expect(component.refreshAll).toHaveBeenCalled();
    });

    it('navigates sidebar pages and falls back to dashboard for an unknown URL', () => {
      authenticate();
      fixture.detectChanges();
      const buttons = Array.from(
        fixture.nativeElement.querySelectorAll('.admin-nav button'),
      ) as HTMLButtonElement[];
      buttons.find((button) => button.textContent?.includes('Faturas'))?.click();
      expect(component.activePage()).toBe('invoices');
      expect(window.location.pathname).toBe('/invoices');
      component.navigatePage('categories');
      expect(window.location.pathname).toBe('/categories');

      history.replaceState(null, '', '/unknown');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(component.activePage()).toBe('dashboard');
    });
  });

  describe('goals module', () => {
    beforeEach(() => {
      authenticate('goals');
    });

    it('loads and displays goals overview, category limits, and history', () => {
      component.goalsData.set({
        year: 2026,
        month: 6,
        overallGoal: { id: 'goal-1', amount: 5000 },
        summary: {
          grossSpent: 2500,
          credits: -300,
          netSpent: 2200,
          goalAmount: 5000,
          available: 2800,
          percentageUsed: 44,
          projection: 3600,
          status: 'normal',
        },
        categoryGoals: [
          {
            id: 'cg-1',
            categoryId: 'food',
            categoryName: 'Alimentação',
            categoryColor: '#ff0000',
            categoryIcon: 'cart',
            amount: 1500,
            spent: 800,
            available: 700,
            percentage: 53.3,
            status: 'normal',
          },
        ],
        history: [
          {
            year: 2026,
            month: 5,
            goalAmount: 5000,
            netSpent: 4200,
            difference: 800,
            status: 'cumprida',
          },
        ],
      });
      fixture.detectChanges();

      expect(text()).toContain('Visão Geral de Metas');
      expect(text()).toContain('R$ 5.000,00');
      expect(text()).toContain('R$ 2.200,00');
      expect(text()).toContain('R$ 2.800,00');
      expect(text()).toContain('44%');
      expect(text()).toContain('Alimentação');
      expect(text()).toContain('R$ 800,00 de R$ 1.500,00');
      expect(text()).toContain('R$ 700,00 disponível');
      expect(text()).toContain('Histórico dos Últimos Meses');
      expect(text()).toContain('Cumprida');
    });

    it('opens goal modal for overall goal creation and saves', () => {
      component.openCreateOverallGoal();
      expect(component.isGoalModalOpen()).toBeTrue();
      expect(component.goalModalMode()).toBe('overall');

      component.handleGoalModalSave({
        categoryId: null,
        amount: 4000,
        repeatNextMonths: 3,
      });
      expect(api.saveGoal).toHaveBeenCalledWith(
        jasmine.objectContaining({
          amount: 4000,
          repeatNextMonths: 3,
        }),
      );
      expect(component.isGoalModalOpen()).toBeFalse();
    });

    it('copies goals from previous month', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      spyOn(window, 'alert');
      component.copyPreviousMonthGoals();
      expect(api.copyPreviousMonthGoals).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(jasmine.stringMatching(/sucesso/i));
    });

    it('deletes a goal after confirmation', () => {
      spyOn(window, 'confirm').and.returnValue(true);
      component.deleteGoal('cg-1');
      expect(api.deleteGoal).toHaveBeenCalledWith('cg-1');
    });
  });

  describe('Dark Mode Theme', () => {
    afterEach(() => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('invoice_theme');
    });

    it('initializes theme and toggles between light and dark', () => {
      component.isDarkMode.set(false);
      component.applyTheme(false);
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();

      component.toggleTheme();
      expect(component.isDarkMode()).toBeTrue();
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem('invoice_theme')).toBe('dark');

      component.toggleTheme();
      expect(component.isDarkMode()).toBeFalse();
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
      expect(localStorage.getItem('invoice_theme')).toBe('light');
    });

    it('applies dark theme attribute when dark is true', () => {
      component.applyTheme(true);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      component.applyTheme(false);
      expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    });
  });
});
