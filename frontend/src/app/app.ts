import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

const API_BASE =
  window.location.port === '4200' ? `http://${window.location.hostname}:5000/api` : '/api';

type Invoice = {
  id: string;
  bankName: string;
  referenceMonth: number;
  referenceYear: number;
  originalFileName: string;
  status: string;
  createdAt: string;
  transactionCount: number;
};

type Transaction = {
  id: string;
  date: string;
  description: string;
  normalizedDescription: string;
  rawCategory: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
};

type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
};

type CategorizationRule = {
  id: string;
  matchType: string;
  pattern: string;
  normalizedPattern: string;
  categoryId: string;
  category: Category | null;
  createdAt: string;
};

type MonthlySummary = {
  month?: number;
  year?: number;
  totalSpent: number;
  totalCredits: number;
  netAmount: number;
  transactionCount: number;
};

type MonthComparison = {
  current: MonthlySummary;
  previous: MonthlySummary;
  difference: number;
  percentage: number | null;
};

type SummaryMetric = 'totalSpent' | 'totalCredits' | 'netAmount' | 'transactionCount';

type CategorySummary = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
};

type User = {
  id: string;
  name: string;
  email: string;
};

type AuthResponse = {
  token: string;
  expiresAt: string;
  user: User;
};

type Page = 'dashboard' | 'invoices' | 'categories';
type TransactionQuickFilter =
  | 'all'
  | 'outros'
  | 'debitos'
  | 'creditos'
  | 'withRule'
  | 'withoutRule';

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  invoices = signal<Invoice[]>([]);
  transactions = signal<Transaction[]>([]);
  categories = signal<Category[]>([]);
  categorizationRules = signal<CategorizationRule[]>([]);
  categorySummary = signal<CategorySummary[]>([]);
  monthlySummary = signal<MonthlySummary | null>(null);
  monthComparison = signal<MonthComparison | null>(null);
  selectedInvoiceId = signal<string | null>(null);
  uploadMessage = signal('');
  authMessage = signal('');
  loading = signal(false);
  authMode = signal<'login' | 'register'>('login');
  activePage = signal<Page>('dashboard');
  sidebarCollapsed = signal(false);
  token = signal(localStorage.getItem('invoice-manager-token') ?? '');
  currentUser = signal<User | null>(this.readStoredUser());
  transactionSearch = signal('');
  transactionCategoryFilter = signal('');
  transactionQuickFilter = signal<TransactionQuickFilter>('all');
  categorySearch = signal('');
  ruleSearch = signal('');
  ruleFormMessage = signal('');
  selectedTransactionIds = signal<Set<string>>(new Set());
  bulkCategoryId = signal('');
  dashboardPeriod = signal(this.currentPeriodValue());
  pendingRule = signal<{
    transaction: Transaction;
    categoryId: string;
    categoryName: string;
    pattern: string;
    transactionIds?: string[];
  } | null>(null);

  newCategory = { name: '', color: '#64748b', icon: 'tag' };
  ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
  loginForm = { email: '', password: '' };
  registerForm = { name: '', email: '', password: '' };

  isAuthenticated = computed(() => !!this.token() && !!this.currentUser());

  pageTitle = computed(() => {
    const titles: Record<Page, string> = {
      dashboard: 'Dashboard',
      invoices: 'Faturas',
      categories: 'Categorias e regras',
    };
    return titles[this.activePage()];
  });

  pageSubtitle = computed(() => {
    const subtitles: Record<Page, string> = {
      dashboard: 'Visão geral das suas faturas, gastos e categorias.',
      invoices: 'Importe PDFs, selecione faturas e categorize lançamentos.',
      categories: 'Organize categorias, regras e classificações automáticas.',
    };
    return subtitles[this.activePage()];
  });

  dashboardPeriodLabel = computed(() => this.formatPeriodLabel(this.dashboardPeriod()));

  selectedInvoice = computed(
    () => this.invoices().find((invoice) => invoice.id === this.selectedInvoiceId()) ?? null,
  );

  selectedInvoiceSummary = computed<MonthlySummary>(() => {
    const transactions = this.transactions();
    const totalSpent = transactions
      .filter((transaction) => transaction.amount > 0)
      .reduce((total, transaction) => total + transaction.amount, 0);
    const totalCredits = transactions
      .filter((transaction) => transaction.amount < 0)
      .reduce((total, transaction) => total + transaction.amount, 0);

    return {
      totalSpent,
      totalCredits,
      netAmount: totalSpent + totalCredits,
      transactionCount: transactions.length,
    };
  });

  selectedInvoiceCategorySummary = computed<CategorySummary[]>(() => {
    const categoriesById = new Map(
      this.categories().map((category) => [category.id, category.name]),
    );
    const summary = new Map<string, CategorySummary>();

    for (const transaction of this.transactions()) {
      const key = transaction.categoryId ?? 'uncategorized';
      const current = summary.get(key);

      if (current) {
        current.total += transaction.amount;
        current.count += 1;
        continue;
      }

      summary.set(key, {
        categoryId: transaction.categoryId,
        categoryName:
          transaction.categoryName ??
          categoriesById.get(transaction.categoryId ?? '') ??
          'Sem categoria',
        total: transaction.amount,
        count: 1,
      });
    }

    return Array.from(summary.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  });

  selectedInvoiceCategoryProgress = computed(() => {
    const max = Math.max(
      ...this.selectedInvoiceCategorySummary().map((item) => Math.abs(item.total)),
      0,
    );
    return max;
  });

  dashboardCategoryProgressMax = computed(() =>
    Math.max(...this.categorySummary().map((item) => Math.abs(item.total)), 0),
  );

  recentInvoices = computed(() => this.invoices().slice(0, 5));

  filteredTransactions = computed(() => {
    const search = this.normalizeFilterValue(this.transactionSearch());
    const categoryId = this.transactionCategoryFilter();
    const quickFilter = this.transactionQuickFilter();

    return this.transactions().filter((transaction) => {
      const matchesSearch =
        !search ||
        this.normalizeFilterValue(
          [
            transaction.date,
            transaction.description,
            transaction.rawCategory,
            transaction.type,
            transaction.categoryName,
            this.formatCurrency(transaction.amount),
          ].join(' '),
        ).includes(search);

      const matchesCategory = !categoryId || transaction.categoryId === categoryId;
      const matchesQuickFilter = this.transactionMatchesQuickFilter(transaction, quickFilter);

      return matchesSearch && matchesCategory && matchesQuickFilter;
    });
  });

  selectedTransactions = computed(() => {
    const selected = this.selectedTransactionIds();
    return this.transactions().filter((transaction) => selected.has(transaction.id));
  });

  selectedTransactionCount = computed(() => this.selectedTransactions().length);

  allFilteredSelected = computed(() => {
    const filtered = this.filteredTransactions();
    const selected = this.selectedTransactionIds();
    return filtered.length > 0 && filtered.every((transaction) => selected.has(transaction.id));
  });

  othersInsight = computed(
    () => this.categorySummary().find((item) => this.isOtherCategory(item.categoryName)) ?? null,
  );

  filteredCategories = computed(() => {
    const search = this.normalizeFilterValue(this.categorySearch());
    if (!search) return this.categories();

    return this.categories().filter((category) =>
      this.normalizeFilterValue([category.name, category.icon].join(' ')).includes(search),
    );
  });

  filteredCategorizationRules = computed(() => {
    const search = this.normalizeFilterValue(this.ruleSearch());
    if (!search) return this.categorizationRules();

    return this.categorizationRules().filter((rule) =>
      this.normalizeFilterValue(
        [rule.pattern, rule.category?.name, this.ruleMatchLabel(rule.matchType)].join(' '),
      ).includes(search),
    );
  });

  activeRulesCount = computed(() =>
    this.categorizationRules().filter((rule) =>
      this.categories().some((category) => category.id === rule.categoryId),
    ).length,
  );

  rulePreview = computed(() => {
    const pattern = this.ruleForm.pattern.trim();
    const category = this.categoryNameById(this.ruleForm.categoryId);
    if (!pattern || !category) return '';

    return `Se a descrição contiver "${pattern}", classificar como "${category}".`;
  });

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (!this.token()) return;

    this.http.get<User>(`${API_BASE}/auth/me`, this.authOptions()).subscribe({
      next: (user) => {
        this.currentUser.set(user);
        localStorage.setItem('invoice-manager-user', JSON.stringify(user));
        this.refreshAll();
      },
      error: () => this.logout(),
    });
  }

  refreshAll(): void {
    if (!this.token()) return;
    this.loadInvoices();
    this.loadCategories();
    this.loadCategorizationRules();
    this.loadDashboard();
  }

  login(): void {
    this.authMessage.set('');
    this.loading.set(true);
    this.http.post<AuthResponse>(`${API_BASE}/auth/login`, this.loginForm).subscribe({
      next: (response) => this.applyAuthResponse(response),
      error: () => {
        this.authMessage.set('Email ou senha invalidos.');
        this.loading.set(false);
      },
    });
  }

  register(): void {
    this.authMessage.set('');
    this.loading.set(true);
    this.http.post<AuthResponse>(`${API_BASE}/auth/register`, this.registerForm).subscribe({
      next: (response) => this.applyAuthResponse(response),
      error: (error) => {
        this.authMessage.set(
          error?.error?.detail ?? error?.error?.Detail ?? 'Nao foi possivel criar a conta.',
        );
        this.loading.set(false);
      },
    });
  }

  logout(): void {
    this.token.set('');
    this.currentUser.set(null);
    this.invoices.set([]);
    this.transactions.set([]);
    this.categories.set([]);
    this.categorizationRules.set([]);
    this.categorySummary.set([]);
    this.monthlySummary.set(null);
    this.monthComparison.set(null);
    this.selectedInvoiceId.set(null);
    localStorage.removeItem('invoice-manager-token');
    localStorage.removeItem('invoice-manager-user');
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const data = new FormData();
    data.append('file', file);
    this.loading.set(true);
    this.uploadMessage.set('Importando e extraindo lançamentos...');

    this.http
      .post<{
        id: string;
        status: string;
        transactions: number;
      }>(`${API_BASE}/invoices/upload`, data, this.authOptions())
      .subscribe({
        next: (result) => {
          this.uploadMessage.set(`Fatura importada com ${result.transactions} lançamentos.`);
          this.selectedInvoiceId.set(result.id);
          this.activePage.set('invoices');
          this.refreshAll();
          this.loadTransactions(result.id);
          this.loading.set(false);
          input.value = '';
        },
        error: (error) => {
          this.uploadMessage.set(
            error?.error?.detail ?? error?.error?.Detail ?? 'Falha ao importar PDF.',
          );
          this.loading.set(false);
        },
      });
  }

  loadInvoices(): void {
    this.http
      .get<Invoice[]>(`${API_BASE}/invoices`, this.authOptions())
      .subscribe((invoices) => this.invoices.set(invoices));
  }

  loadTransactions(invoiceId: string): void {
    this.selectedInvoiceId.set(invoiceId);
    this.clearTransactionSelection();
    this.http
      .get<Transaction[]>(`${API_BASE}/invoices/${invoiceId}/transactions`, this.authOptions())
      .subscribe((transactions) => this.transactions.set(transactions));
  }

  clearTransactionFilters(): void {
    this.transactionSearch.set('');
    this.transactionCategoryFilter.set('');
    this.transactionQuickFilter.set('all');
  }

  openInvoice(invoiceId: string): void {
    this.activePage.set('invoices');
    this.loadTransactions(invoiceId);
  }

  loadCategories(): void {
    this.http
      .get<Category[]>(`${API_BASE}/categories`, this.authOptions())
      .subscribe((categories) => this.categories.set(categories));
  }

  loadCategorizationRules(): void {
    this.http
      .get<CategorizationRule[]>(`${API_BASE}/categorization-rules`, this.authOptions())
      .subscribe((rules) => this.categorizationRules.set(rules));
  }

  loadDashboard(): void {
    const params = this.dashboardPeriodParams();
    this.http
      .get<MonthlySummary>(`${API_BASE}/dashboard/monthly-summary${params}`, this.authOptions())
      .subscribe((summary) => this.monthlySummary.set(summary));
    this.http
      .get<CategorySummary[]>(`${API_BASE}/dashboard/category-summary${params}`, this.authOptions())
      .subscribe((summary) => this.categorySummary.set(summary));
    this.http
      .get<MonthComparison>(`${API_BASE}/dashboard/month-comparison${params}`, this.authOptions())
      .subscribe((comparison) => this.monthComparison.set(comparison));
  }

  changeDashboardPeriod(value: string): void {
    this.dashboardPeriod.set(value);
    this.loadDashboard();
  }

  createCategory(): void {
    const name = this.newCategory.name.trim();
    if (!name) return;

    this.http
      .post<Category>(`${API_BASE}/categories`, { ...this.newCategory, name }, this.authOptions())
      .subscribe(() => {
        this.newCategory = { name: '', color: '#64748b', icon: 'tag' };
        this.loadCategories();
      });
  }

  editCategory(category: Category): void {
    const name = window.prompt('Nome da categoria', category.name)?.trim();
    if (!name) return;

    this.http
      .put(
        `${API_BASE}/categories/${category.id}`,
        {
          name,
          color: category.color,
          icon: category.icon,
        },
        this.authOptions(),
      )
      .subscribe(() => {
        this.loadCategories();
        this.loadDashboard();
      });
  }

  deleteCategory(category: Category): void {
    const linkedRules = this.categoryRuleCount(category.id);
    const linkedItems = this.categoryItemCount(category.id);
    const details = [
      linkedRules ? `${linkedRules} regra(s) vinculada(s)` : '',
      linkedItems ? `${linkedItems} item(ns) no resumo atual` : '',
    ]
      .filter(Boolean)
      .join(' e ');
    const suffix = details ? ` Ela possui ${details}.` : '';
    const confirmed = window.confirm(
      `Excluir a categoria "${category.name}"?${suffix} Esta ação pode afetar lançamentos e regras existentes.`,
    );
    if (!confirmed) return;

    this.http.delete(`${API_BASE}/categories/${category.id}`, this.authOptions()).subscribe(() => {
      this.loadCategories();
      this.loadCategorizationRules();
      this.loadDashboard();
      const selected = this.selectedInvoiceId();
      if (selected) this.loadTransactions(selected);
    });
  }

  saveRule(): void {
    this.ruleFormMessage.set('');
    const pattern = this.ruleForm.pattern.trim();
    const categoryId = this.ruleForm.categoryId;
    if (!pattern || !categoryId) {
      this.ruleFormMessage.set('Informe o texto para identificar e escolha uma categoria.');
      return;
    }

    const payload = { matchType: this.ruleForm.matchType, pattern, categoryId };
    const request = this.ruleForm.id
      ? this.http.put(
          `${API_BASE}/categorization-rules/${this.ruleForm.id}`,
          payload,
          this.authOptions(),
        )
      : this.http.post(`${API_BASE}/categorization-rules`, payload, this.authOptions());

    request.subscribe(() => {
      this.resetRuleForm();
      this.loadCategorizationRules();
    });
  }

  editRule(rule: CategorizationRule): void {
    this.ruleFormMessage.set('');
    this.ruleForm = {
      id: rule.id,
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      matchType: rule.matchType,
    };
  }

  deleteRule(rule: CategorizationRule): void {
    const confirmed = window.confirm(`Excluir a regra "${rule.pattern}"?`);
    if (!confirmed) return;

    this.http
      .delete(`${API_BASE}/categorization-rules/${rule.id}`, this.authOptions())
      .subscribe(() => {
        if (this.ruleForm.id === rule.id) this.resetRuleForm();
        this.loadCategorizationRules();
      });
  }

  resetRuleForm(): void {
    this.ruleFormMessage.set('');
    this.ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
  }

  focusRuleForm(): void {
    document.getElementById('rulePattern')?.focus();
  }

  deleteInvoice(invoice: Invoice, event: MouseEvent): void {
    event.stopPropagation();
    const confirmed = window.confirm(
      `Excluir a fatura "${invoice.originalFileName}" e todos os seus lançamentos?`,
    );
    if (!confirmed) return;

    this.http.delete(`${API_BASE}/invoices/${invoice.id}`, this.authOptions()).subscribe(() => {
      if (this.selectedInvoiceId() === invoice.id) {
        this.selectedInvoiceId.set(null);
        this.transactions.set([]);
      }
      this.refreshAll();
      this.uploadMessage.set('Fatura excluida.');
    });
  }

  updateTransactionCategory(transaction: Transaction, categoryId: string): void {
    const category = this.categories().find((item) => item.id === categoryId);
    if (!category) return;

    const selectedIds = Array.from(this.selectedTransactionIds());
    const targetIds =
      selectedIds.length > 0
        ? selectedIds.includes(transaction.id)
          ? selectedIds
          : [...selectedIds, transaction.id]
        : [];

    if (targetIds.length > 0) {
      this.applyCategoryToTransactions(targetIds, categoryId, category.name, () => {
        this.pendingRule.set({
          transaction: { ...transaction, categoryId, categoryName: category.name },
          categoryId,
          categoryName: category.name,
          pattern: this.suggestPattern(transaction.description),
          transactionIds: targetIds,
        });
      });
      return;
    }

    this.http
      .patch(
        `${API_BASE}/transactions/${transaction.id}/category`,
        {
          categoryId,
          mode: 'single',
          rulePattern: null,
        },
        this.authOptions(),
      )
      .subscribe(() => {
        this.transactions.update((transactions) =>
          transactions.map((item) =>
            item.id === transaction.id
              ? { ...item, categoryId, categoryName: category.name }
              : item,
          ),
        );
        this.loadDashboard();
        this.pendingRule.set({
          transaction: { ...transaction, categoryId, categoryName: category.name },
          categoryId,
          categoryName: category.name,
          pattern: this.suggestPattern(
            transaction.normalizedDescription || transaction.description,
          ),
        });
      });
  }

  closeCategorizationRuleModal(): void {
    const current = this.pendingRule();
    if (!current?.transactionIds?.length) {
      this.pendingRule.set(null);
      return;
    }

    this.applyCategoryToTransactions(
      current.transactionIds,
      current.categoryId,
      current.categoryName,
      () => {
        this.pendingRule.set(null);
        this.uploadMessage.set('Categoria aplicada aos lançamentos selecionados.');
      },
    );
  }

  updatePendingPattern(pattern: string): void {
    const current = this.pendingRule();
    if (!current) return;
    this.pendingRule.set({ ...current, pattern });
  }

  saveCategorizationRule(): void {
    const current = this.pendingRule();
    const pattern = current?.pattern.trim();
    if (!current || !pattern) return;

    this.http
      .post(
        `${API_BASE}/categorization-rules`,
        {
          matchType: 'contains',
          pattern,
          categoryId: current.categoryId,
        },
        this.authOptions(),
      )
      .subscribe(() => {
        this.pendingRule.set(null);
        const selected = this.selectedInvoiceId();
        if (selected) this.loadTransactions(selected);
        this.loadCategorizationRules();
        this.loadDashboard();
        this.uploadMessage.set(`Regra "${pattern}" aplicada ao histórico e às próximas faturas.`);
      });
  }

  toggleTransactionSelection(transactionId: string, selected: boolean): void {
    this.selectedTransactionIds.update((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(transactionId);
      } else {
        next.delete(transactionId);
      }
      return next;
    });
  }

  toggleAllFilteredTransactions(selected: boolean): void {
    this.selectedTransactionIds.update((current) => {
      const next = new Set(current);
      for (const transaction of this.filteredTransactions()) {
        if (selected) {
          next.add(transaction.id);
        } else {
          next.delete(transaction.id);
        }
      }
      return next;
    });
  }

  clearTransactionSelection(): void {
    this.selectedTransactionIds.set(new Set());
    this.bulkCategoryId.set('');
  }

  applyBulkCategory(): void {
    const categoryId = this.bulkCategoryId();
    const ids = Array.from(this.selectedTransactionIds());
    if (!categoryId || ids.length === 0) return;

    const category = this.categories().find((item) => item.id === categoryId);
    if (!category) return;

    this.applyCategoryToTransactions(ids, categoryId, category.name, () => {
      this.clearTransactionSelection();
      this.uploadMessage.set('Categoria alterada para os lançamentos selecionados.');
    });
  }

  createRuleFromSelection(): void {
    const transaction = this.selectedTransactions()[0];
    const ids = Array.from(this.selectedTransactionIds());
    const categoryId = this.bulkCategoryId() || transaction?.categoryId;
    if (!transaction || !categoryId) return;

    const category = this.categories().find((item) => item.id === categoryId);
    if (!category) return;

    this.applyCategoryToTransactions(ids, categoryId, category.name, () => {
      this.clearTransactionSelection();
      this.pendingRule.set({
        transaction: { ...transaction, categoryId, categoryName: category.name },
        categoryId,
        categoryName: category.name,
        pattern: this.suggestPattern(transaction.description),
        transactionIds: ids,
      });
    });
  }

  isTransactionSelected(transactionId: string): boolean {
    return this.selectedTransactionIds().has(transactionId);
  }

  private applyCategoryToTransactions(
    ids: string[],
    categoryId: string,
    categoryName: string,
    afterApply?: () => void,
  ): void {
    if (ids.length === 0) return;

    this.http
      .post<{ updated: number }>(
        `${API_BASE}/transactions/bulk-categorize`,
        {
          transactionIds: ids,
          categoryId,
        },
        this.authOptions(),
      )
      .subscribe(() => {
        this.transactions.update((transactions) =>
          transactions.map((transaction) =>
            ids.includes(transaction.id)
              ? { ...transaction, categoryId, categoryName }
              : transaction,
          ),
        );
        this.loadDashboard();
        afterApply?.();
      });
  }

  private applyAuthResponse(response: AuthResponse): void {
    this.token.set(response.token);
    this.currentUser.set(response.user);
    localStorage.setItem('invoice-manager-token', response.token);
    localStorage.setItem('invoice-manager-user', JSON.stringify(response.user));
    this.loading.set(false);
    this.authMessage.set('');
    this.uploadMessage.set('');
    this.refreshAll();
  }

  private authOptions(): { headers: { Authorization: string } } {
    return { headers: { Authorization: `Bearer ${this.token()}` } };
  }

  private readStoredUser(): User | null {
    const value = localStorage.getItem('invoice-manager-user');
    if (!value) return null;

    try {
      return JSON.parse(value) as User;
    } catch {
      return null;
    }
  }

  private suggestPattern(value: string): string {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = normalized
      .split(' ')
      .filter((token) => token.length >= 3 && !/^\d+$/.test(token));

    return tokens.slice(0, 2).join(' ') || normalized;
  }

  private normalizeFilterValue(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
      value ?? 0,
    );
  }

  metricDelta(metric: SummaryMetric): number {
    const comparison = this.monthComparison();
    if (!comparison) return 0;
    return (comparison.current[metric] ?? 0) - (comparison.previous[metric] ?? 0);
  }

  trendIcon(value: number): string {
    if (value > 0) return '↑';
    if (value < 0) return '↓';
    return '=';
  }

  formatSignedCurrency(value: number): string {
    const formatted = this.formatCurrency(Math.abs(value));
    if (value > 0) return `+${formatted}`;
    if (value < 0) return `-${formatted}`;
    return formatted;
  }

  formatSignedNumber(value: number): string {
    if (value > 0) return `+${value}`;
    return String(value);
  }

  categoryProgress(value: number): number {
    const max = this.selectedInvoiceCategoryProgress();
    return max ? Math.max(4, Math.round((Math.abs(value) / max) * 100)) : 0;
  }

  dashboardCategoryProgress(value: number): number {
    const max = this.dashboardCategoryProgressMax();
    return max ? Math.max(4, Math.round((Math.abs(value) / max) * 100)) : 0;
  }

  invoiceStatusLabel(status: string): string {
    const normalized = status.toLowerCase();
    const labels: Record<string, string> = {
      completed: 'Concluída',
      uploaded: 'Recebida',
      processing: 'Processando',
      failed: 'Falhou',
    };
    return labels[normalized] ?? status;
  }

  ruleLabel(transaction: Transaction): string {
    return this.transactionHasMatchingRule(transaction) ? 'Regra aplicada' : 'Manual';
  }

  ruleMatchLabel(matchType: string): string {
    const labels: Record<string, string> = {
      contains: 'contém na descrição normalizada',
    };
    return labels[matchType] ?? `${matchType} na descrição normalizada`;
  }

  categoryBadgeClass(categoryName: string | null): string {
    return this.isOtherCategory(categoryName) ? 'category-badge warning' : 'category-badge';
  }

  categoryColor(categoryId: string | null): string {
    return this.categories().find((category) => category.id === categoryId)?.color ?? '#cbd5e1';
  }

  categoryRuleCount(categoryId: string): number {
    return this.categorizationRules().filter((rule) => rule.categoryId === categoryId).length;
  }

  categoryItemCount(categoryId: string): number {
    return this.categorySummary().find((item) => item.categoryId === categoryId)?.count ?? 0;
  }

  categoryNameById(categoryId: string): string {
    return this.categories().find((category) => category.id === categoryId)?.name ?? '';
  }

  periodOptions(): string[] {
    const now = new Date();
    return Array.from({ length: 18 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    });
  }

  private transactionMatchesQuickFilter(
    transaction: Transaction,
    quickFilter: TransactionQuickFilter,
  ): boolean {
    switch (quickFilter) {
      case 'outros':
        return this.isOtherCategory(transaction.categoryName);
      case 'debitos':
        return transaction.amount > 0;
      case 'creditos':
        return transaction.amount < 0;
      case 'withRule':
        return this.transactionHasMatchingRule(transaction);
      case 'withoutRule':
        return !this.transactionHasMatchingRule(transaction);
      default:
        return true;
    }
  }

  private transactionHasMatchingRule(transaction: Transaction): boolean {
    const normalized =
      transaction.normalizedDescription || this.suggestPattern(transaction.description);
    return this.categorizationRules().some(
      (rule) =>
        transaction.categoryId === rule.categoryId &&
        normalized.includes(rule.normalizedPattern || this.suggestPattern(rule.pattern)),
    );
  }

  isOtherCategory(categoryName: string | null): boolean {
    const normalized = this.normalizeFilterValue(categoryName ?? '');
    return normalized === 'outros' || normalized === 'sem categoria';
  }

  private currentPeriodValue(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private dashboardPeriodParams(): string {
    const [year, month] = this.dashboardPeriod().split('-');
    return `?month=${Number(month)}&year=${Number(year)}`;
  }

  formatPeriodLabel(value: string): string {
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
      .format(new Date(year, month - 1, 1))
      .replace(/^./, (letter) => letter.toUpperCase());
  }
}
