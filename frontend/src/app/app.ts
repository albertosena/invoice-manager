import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

const API_BASE = window.location.port === '4200'
  ? `http://${window.location.hostname}:5000/api`
  : '/api';

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

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
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
  token = signal(localStorage.getItem('invoice-manager-token') ?? '');
  currentUser = signal<User | null>(this.readStoredUser());
  transactionSearch = signal('');
  transactionCategoryFilter = signal('');
  transactionTypeFilter = signal('');
  pendingRule = signal<{
    transaction: Transaction;
    categoryId: string;
    categoryName: string;
    pattern: string;
  } | null>(null);

  newCategory = { name: '', color: '#64748b', icon: 'tag' };
  ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
  loginForm = { email: '', password: '' };
  registerForm = { name: '', email: '', password: '' };

  isAuthenticated = computed(() => !!this.token() && !!this.currentUser());

  pageTitle = computed(() => {
    const titles: Record<Page, string> = {
      dashboard: 'Dashboard',
      invoices: 'Importar faturas',
      categories: 'Categorias'
    };
    return titles[this.activePage()];
  });

  pageSubtitle = computed(() => {
    const subtitles: Record<Page, string> = {
      dashboard: 'Visao geral das suas faturas, gastos e categorias.',
      invoices: 'Importe PDFs, selecione faturas e categorize lancamentos.',
      categories: 'Organize as categorias usadas nas regras e transacoes.'
    };
    return subtitles[this.activePage()];
  });

  selectedInvoice = computed(() =>
    this.invoices().find(invoice => invoice.id === this.selectedInvoiceId()) ?? null
  );

  selectedInvoiceSummary = computed<MonthlySummary>(() => {
    const transactions = this.transactions();
    const totalSpent = transactions
      .filter(transaction => transaction.amount > 0)
      .reduce((total, transaction) => total + transaction.amount, 0);
    const totalCredits = transactions
      .filter(transaction => transaction.amount < 0)
      .reduce((total, transaction) => total + transaction.amount, 0);

    return {
      totalSpent,
      totalCredits,
      netAmount: totalSpent + totalCredits,
      transactionCount: transactions.length
    };
  });

  selectedInvoiceCategorySummary = computed<CategorySummary[]>(() => {
    const categoriesById = new Map(this.categories().map(category => [category.id, category.name]));
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
        categoryName: transaction.categoryName ?? categoriesById.get(transaction.categoryId ?? '') ?? 'Sem categoria',
        total: transaction.amount,
        count: 1
      });
    }

    return Array.from(summary.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  });

  selectedInvoiceCategoryProgress = computed(() => {
    const max = Math.max(...this.selectedInvoiceCategorySummary().map(item => Math.abs(item.total)), 0);
    return max;
  });

  dashboardCategoryProgressMax = computed(() =>
    Math.max(...this.categorySummary().map(item => Math.abs(item.total)), 0)
  );

  recentInvoices = computed(() => this.invoices().slice(0, 5));

  transactionTypes = computed(() =>
    Array.from(new Set(this.transactions().map(transaction => transaction.type).filter(Boolean))).sort()
  );

  filteredTransactions = computed(() => {
    const search = this.normalizeFilterValue(this.transactionSearch());
    const categoryId = this.transactionCategoryFilter();
    const type = this.transactionTypeFilter();

    return this.transactions().filter(transaction => {
      const matchesSearch = !search || this.normalizeFilterValue([
        transaction.date,
        transaction.description,
        transaction.rawCategory,
        transaction.type,
        transaction.categoryName,
        this.formatCurrency(transaction.amount)
      ].join(' ')).includes(search);

      const matchesCategory = !categoryId || transaction.categoryId === categoryId;
      const matchesType = !type || transaction.type === type;

      return matchesSearch && matchesCategory && matchesType;
    });
  });

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (!this.token()) return;

    this.http.get<User>(`${API_BASE}/auth/me`, this.authOptions()).subscribe({
      next: user => {
        this.currentUser.set(user);
        localStorage.setItem('invoice-manager-user', JSON.stringify(user));
        this.refreshAll();
      },
      error: () => this.logout()
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
      next: response => this.applyAuthResponse(response),
      error: () => {
        this.authMessage.set('Email ou senha invalidos.');
        this.loading.set(false);
      }
    });
  }

  register(): void {
    this.authMessage.set('');
    this.loading.set(true);
    this.http.post<AuthResponse>(`${API_BASE}/auth/register`, this.registerForm).subscribe({
      next: response => this.applyAuthResponse(response),
      error: error => {
        this.authMessage.set(error?.error?.detail ?? error?.error?.Detail ?? 'Nao foi possivel criar a conta.');
        this.loading.set(false);
      }
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
    this.uploadMessage.set('Importando e extraindo lancamentos...');

    this.http.post<{ id: string; status: string; transactions: number }>(`${API_BASE}/invoices/upload`, data, this.authOptions())
      .subscribe({
        next: result => {
          this.uploadMessage.set(`Fatura importada com ${result.transactions} lancamentos.`);
          this.selectedInvoiceId.set(result.id);
          this.activePage.set('invoices');
          this.refreshAll();
          this.loadTransactions(result.id);
          this.loading.set(false);
          input.value = '';
        },
        error: error => {
          this.uploadMessage.set(error?.error?.detail ?? error?.error?.Detail ?? 'Falha ao importar PDF.');
          this.loading.set(false);
        }
      });
  }

  loadInvoices(): void {
    this.http.get<Invoice[]>(`${API_BASE}/invoices`, this.authOptions()).subscribe(invoices => this.invoices.set(invoices));
  }

  loadTransactions(invoiceId: string): void {
    this.selectedInvoiceId.set(invoiceId);
    this.http.get<Transaction[]>(`${API_BASE}/invoices/${invoiceId}/transactions`, this.authOptions()).subscribe(transactions => this.transactions.set(transactions));
  }

  clearTransactionFilters(): void {
    this.transactionSearch.set('');
    this.transactionCategoryFilter.set('');
    this.transactionTypeFilter.set('');
  }

  openInvoice(invoiceId: string): void {
    this.activePage.set('invoices');
    this.loadTransactions(invoiceId);
  }

  loadCategories(): void {
    this.http.get<Category[]>(`${API_BASE}/categories`, this.authOptions()).subscribe(categories => this.categories.set(categories));
  }

  loadCategorizationRules(): void {
    this.http.get<CategorizationRule[]>(`${API_BASE}/categorization-rules`, this.authOptions()).subscribe(rules => this.categorizationRules.set(rules));
  }

  loadDashboard(): void {
    this.http.get<MonthlySummary>(`${API_BASE}/dashboard/monthly-summary`, this.authOptions()).subscribe(summary => this.monthlySummary.set(summary));
    this.http.get<CategorySummary[]>(`${API_BASE}/dashboard/category-summary`, this.authOptions()).subscribe(summary => this.categorySummary.set(summary));
    this.http.get<MonthComparison>(`${API_BASE}/dashboard/month-comparison`, this.authOptions()).subscribe(comparison => this.monthComparison.set(comparison));
  }

  createCategory(): void {
    const name = this.newCategory.name.trim();
    if (!name) return;

    this.http.post<Category>(`${API_BASE}/categories`, { ...this.newCategory, name }, this.authOptions()).subscribe(() => {
      this.newCategory = { name: '', color: '#64748b', icon: 'tag' };
      this.loadCategories();
    });
  }

  editCategory(category: Category): void {
    const name = window.prompt('Nome da categoria', category.name)?.trim();
    if (!name) return;

    this.http.put(`${API_BASE}/categories/${category.id}`, {
      name,
      color: category.color,
      icon: category.icon
    }, this.authOptions()).subscribe(() => {
      this.loadCategories();
      this.loadDashboard();
    });
  }

  deleteCategory(category: Category): void {
    const confirmed = window.confirm(`Excluir a categoria "${category.name}"?`);
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
    const pattern = this.ruleForm.pattern.trim();
    const categoryId = this.ruleForm.categoryId;
    if (!pattern || !categoryId) return;

    const payload = { matchType: this.ruleForm.matchType, pattern, categoryId };
    const request = this.ruleForm.id
      ? this.http.put(`${API_BASE}/categorization-rules/${this.ruleForm.id}`, payload, this.authOptions())
      : this.http.post(`${API_BASE}/categorization-rules`, payload, this.authOptions());

    request.subscribe(() => {
      this.resetRuleForm();
      this.loadCategorizationRules();
    });
  }

  editRule(rule: CategorizationRule): void {
    this.ruleForm = {
      id: rule.id,
      pattern: rule.pattern,
      categoryId: rule.categoryId,
      matchType: rule.matchType
    };
  }

  deleteRule(rule: CategorizationRule): void {
    const confirmed = window.confirm(`Excluir a regra "${rule.pattern}"?`);
    if (!confirmed) return;

    this.http.delete(`${API_BASE}/categorization-rules/${rule.id}`, this.authOptions()).subscribe(() => {
      if (this.ruleForm.id === rule.id) this.resetRuleForm();
      this.loadCategorizationRules();
    });
  }

  resetRuleForm(): void {
    this.ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
  }

  deleteInvoice(invoice: Invoice, event: MouseEvent): void {
    event.stopPropagation();
    const confirmed = window.confirm(`Excluir a fatura "${invoice.originalFileName}" e todos os seus lancamentos?`);
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

  openCategorizationRuleModal(transaction: Transaction, categoryId: string): void {
    const category = this.categories().find(item => item.id === categoryId);
    if (!category) return;

    this.pendingRule.set({
      transaction,
      categoryId,
      categoryName: category.name,
      pattern: this.suggestPattern(transaction.normalizedDescription || transaction.description)
    });
  }

  closeCategorizationRuleModal(): void {
    this.pendingRule.set(null);
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

    this.http.patch(`${API_BASE}/transactions/${current.transaction.id}/category`, {
      categoryId: current.categoryId,
      mode: 'all',
      rulePattern: pattern
    }, this.authOptions()).subscribe(() => {
      this.pendingRule.set(null);
      const selected = this.selectedInvoiceId();
      if (selected) this.loadTransactions(selected);
      this.loadDashboard();
      this.uploadMessage.set(`Regra "${pattern}" aplicada para historico e futuras faturas.`);
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
      .filter(token => token.length >= 3 && !/^\d+$/.test(token));

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
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
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
}
