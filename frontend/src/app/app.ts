import {
  AfterViewChecked,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './services/auth.service';
import { InvoiceApiService } from './services/invoice-api.service';
import {
  AuthResponse,
  CategorizationRule,
  Category,
  CategoryComparison,
  CategoryInsight,
  CategorySummary,
  GoalHistoryMonth,
  GoalStatus,
  GoalSummary,
  GoalsResponse,
  Invoice,
  MonthComparison,
  MonthlySummary,
  NubankCsvConfirmRequest,
  NubankCsvPreviewItem,
  NubankCsvPreviewResponse,
  Page,
  SummaryMetric,
  Transaction,
  TransactionQuickFilter,
  User,
} from './models/invoice.models';
import { UtilizationBarComponent } from './components/utilization-bar/utilization-bar.component';
import { GoalStatusBadgeComponent } from './components/goal-status-badge/goal-status-badge.component';
import {
  GoalModalComponent,
  GoalModalMode,
  GoalModalSaveEvent,
} from './components/goal-modal/goal-modal.component';

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    UtilizationBarComponent,
    GoalStatusBadgeComponent,
    GoalModalComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit, AfterViewChecked, OnDestroy {
  @ViewChild('invoiceWorkspace') private invoiceWorkspace?: ElementRef<HTMLElement>;
  @ViewChild('invoiceSidebar') private invoiceSidebar?: ElementRef<HTMLElement>;

  private invoiceSidebarObserver?: ResizeObserver;
  private observedInvoiceSidebar?: HTMLElement;

  private readonly pagePaths: Record<Page, string> = {
    dashboard: '/dashboard',
    invoices: '/invoices',
    goals: '/goals',
    categories: '/categories',
  };

  invoices = signal<Invoice[]>([]);
  transactions = signal<Transaction[]>([]);
  categories = signal<Category[]>([]);
  categorizationRules = signal<CategorizationRule[]>([]);
  categorySummary = signal<CategorySummary[]>([]);
  previousCategorySummary = signal<CategorySummary[]>([]);
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
  editingCategoryId = signal('');
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

  // Nubank CSV import state
  showNubankPreviewModal = signal(false);
  nubankPreviewResponse = signal<NubankCsvPreviewResponse | null>(null);
  nubankPreviewItems = signal<NubankCsvPreviewItem[]>([]);
  nubankReferencePeriod = signal('');
  nubankBankName = signal('Nubank');
  nubankCardName = signal('Nubank');
  isDraggingCsv = signal(false);

  nubankValidItems = computed(() => this.nubankPreviewItems().filter((item) => item.isValid));
  nubankSelectedItems = computed(() =>
    this.nubankPreviewItems().filter((item) => item.isValid && item.selected),
  );
  nubankSelectedCount = computed(() => this.nubankSelectedItems().length);
  nubankSelectedDebits = computed(() =>
    this.nubankSelectedItems()
      .filter((item) => item.amount > 0)
      .reduce((total, item) => total + item.amount, 0),
  );
  nubankSelectedCredits = computed(() =>
    this.nubankSelectedItems()
      .filter((item) => item.amount < 0)
      .reduce((total, item) => total + item.amount, 0),
  );
  nubankSelectedTotal = computed(() =>
    this.nubankSelectedItems().reduce((total, item) => total + item.amount, 0),
  );
  nubankDuplicateCount = computed(
    () => this.nubankPreviewItems().filter((item) => item.isDuplicate).length,
  );
  nubankInvalidCount = computed(
    () => this.nubankPreviewItems().filter((item) => !item.isValid).length,
  );
  allNubankItemsSelected = computed(() => {
    const valid = this.nubankValidItems();
    return valid.length > 0 && valid.every((item) => item.selected);
  });

  newCategory = { name: '', color: '#64748b', icon: 'tag', monthlyGoal: 0 };
  ruleForm = { id: '', pattern: '', categoryId: '', matchType: 'contains' };
  loginForm = { email: '', password: '' };
  registerForm = { name: '', email: '', password: '' };
  transactionQuickFilterOptions: { value: TransactionQuickFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'outros', label: 'Outros' },
    { value: 'debitos', label: 'Débitos' },
    { value: 'creditos', label: 'Créditos' },
    { value: 'withRule', label: 'Com regra' },
    { value: 'withoutRule', label: 'Sem regra' },
  ];

  isAuthenticated = computed(() => !!this.token() && !!this.currentUser());

  pageTitle = computed(() => {
    const titles: Record<Page, string> = {
      dashboard: 'Dashboard',
      invoices: 'Faturas',
      goals: 'Metas Mensais',
      categories: 'Categorias',
    };
    return titles[this.activePage()];
  });

  pageSubtitle = computed(() => {
    const subtitles: Record<Page, string> = {
      dashboard: 'Visão geral das suas faturas, gastos e metas.',
      invoices: 'Importe PDFs, selecione faturas e categorize lançamentos.',
      goals: 'Acompanhe suas metas de gastos gerais e por categoria.',
      categories: 'Organize categorias, regras e classificações automáticas.',
    };
    return subtitles[this.activePage()];
  });

  dashboardPeriodLabel = computed(() => this.formatPeriodLabel(this.dashboardPeriod()));
  previousDashboardPeriodLabel = computed(() =>
    this.formatPeriodLabel(this.previousDashboardPeriodValue()),
  );

  // Goals page state
  goalsData = signal<GoalsResponse | null>(null);
  goalsPeriod = signal(this.currentPeriodValue());
  goalsPeriodLabel = computed(() => this.formatPeriodLabel(this.goalsPeriod()));
  isGoalModalOpen = signal(false);
  goalModalMode = signal<GoalModalMode>('overall');
  goalModalInitialData = signal<{
    id?: string;
    categoryId?: string | null;
    categoryName?: string;
    amount: number;
    repeatNextMonths?: number;
  } | null>(null);
  goalsExistingCategoryIds = computed(() =>
    (this.goalsData()?.categoryGoals ?? []).map((cg) => cg.categoryId),
  );

  // Dashboard 3 Cards computeds
  dashboardNetSpent = computed(() => this.monthlySummary()?.netAmount ?? 0);
  dashboardDebits = computed(() => this.monthlySummary()?.totalSpent ?? 0);
  dashboardCredits = computed(() => this.monthlySummary()?.totalCredits ?? 0);
  dashboardGoal = computed(() => this.monthlySummary()?.monthlyGoal ?? 0);
  dashboardGoalPercentage = computed(() => {
    const goal = this.dashboardGoal();
    if (goal <= 0) return 0;
    return Math.round((this.dashboardNetSpent() / goal) * 1000) / 10;
  });
  dashboardGoalAvailable = computed(() => {
    const goal = this.dashboardGoal();
    return goal - this.dashboardNetSpent();
  });
  dashboardGoalStatus = computed<GoalStatus>(() => {
    const goal = this.dashboardGoal();
    if (goal <= 0) return 'no_goal';
    const pct = this.dashboardGoalPercentage();
    if (pct >= 100) return 'danger';
    if (pct >= 80) return 'warning';
    return 'normal';
  });
  dashboardCategorizedCount = computed(() => this.monthlySummary()?.categorizedCount ?? 0);
  dashboardUncategorizedCount = computed(() => this.monthlySummary()?.uncategorizedCount ?? 0);
  dashboardCategorizedPercentage = computed(
    () => this.monthlySummary()?.categorizedPercentage ?? 0,
  );

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
    const categoriesById = new Map(this.categories().map((category) => [category.id, category]));
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
          categoriesById.get(transaction.categoryId ?? '')?.name ??
          'Sem categoria',
        total: transaction.amount,
        count: 1,
        monthlyGoal: categoriesById.get(transaction.categoryId ?? '')?.monthlyGoal ?? 0,
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
    Math.max(
      ...this.categoryComparisonRows().flatMap((item) => [
        Math.abs(item.total),
        Math.abs(item.previousTotal),
        Math.abs(item.monthlyGoal),
      ]),
      0,
    ),
  );

  categoryComparisonRows = computed<CategoryComparison[]>(() => {
    const previousByKey = new Map(
      this.previousCategorySummary().map((item) => [this.categorySummaryKey(item), item]),
    );
    const currentTotal = this.categorySummary()
      .filter((item) => item.total > 0)
      .reduce((total, item) => total + item.total, 0);

    return this.categorySummary()
      .map((item) => {
        const previous = previousByKey.get(this.categorySummaryKey(item));
        const previousTotal = previous?.total ?? 0;
        const delta = item.total - previousTotal;
        return {
          ...item,
          previousTotal,
          previousCount: previous?.count ?? 0,
          delta,
          percentage:
            previousTotal === 0 ? null : Math.round((delta / Math.abs(previousTotal)) * 1000) / 10,
          share: currentTotal > 0 && item.total > 0 ? (item.total / currentTotal) * 100 : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  });

  categoryInsights = computed<CategoryInsight[]>(() => {
    const rows = this.categoryComparisonRows();
    if (!rows.length) return [];

    const highest = rows.reduce((best, item) => (item.total > best.total ? item : best), rows[0]);
    const biggestIncrease = rows.reduce(
      (best, item) => (item.delta > best.delta ? item : best),
      rows[0],
    );
    const biggestDecrease = rows.reduce(
      (best, item) => (item.delta < best.delta ? item : best),
      rows[0],
    );

    const insights: CategoryInsight[] = [
      {
        label: 'Maior gasto',
        categoryName: highest.categoryName,
        value: this.formatCurrency(highest.total),
        tone: 'neutral',
      },
    ];

    if (biggestIncrease.delta > 0) {
      insights.push({
        label: 'Maior alta',
        categoryName: biggestIncrease.categoryName,
        value: this.formatSignedCurrency(biggestIncrease.delta),
        tone: 'up',
      });
    }

    if (biggestDecrease.delta < 0) {
      insights.push({
        label: 'Maior queda',
        categoryName: biggestDecrease.categoryName,
        value: this.formatSignedCurrency(biggestDecrease.delta),
        tone: 'down',
      });
    }

    insights.push({
      label: 'Categorias ativas',
      categoryName: `${rows.length}`,
      value: `${rows.reduce((total, item) => total + item.count, 0)} lançamentos`,
      tone: 'neutral',
    });

    return insights;
  });

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

  activeRulesCount = computed(
    () =>
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

  constructor(
    private authService: AuthService,
    private invoiceApi: InvoiceApiService,
  ) {}

  ngOnInit(): void {
    this.syncPageFromUrl();
    window.addEventListener('popstate', () => this.syncPageFromUrl());

    if (!this.token()) return;

    this.authService.me().subscribe({
      next: (user) => {
        this.currentUser.set(user);
        localStorage.setItem('invoice-manager-user', JSON.stringify(user));
        this.refreshAll();
      },
      error: () => this.logout(),
    });
  }

  ngAfterViewChecked(): void {
    this.observeInvoiceSidebarHeight();
  }

  ngOnDestroy(): void {
    this.invoiceSidebarObserver?.disconnect();
  }

  refreshAll(): void {
    if (!this.token()) return;
    this.loadInvoices();
    this.loadCategories();
    this.loadCategorizationRules();
    this.loadDashboard();
    this.loadGoals();
  }

  private observeInvoiceSidebarHeight(): void {
    const sidebar = this.invoiceSidebar?.nativeElement;
    const workspace = this.invoiceWorkspace?.nativeElement;

    if (!sidebar || !workspace || sidebar === this.observedInvoiceSidebar) return;

    this.invoiceSidebarObserver?.disconnect();
    this.observedInvoiceSidebar = sidebar;
    this.syncInvoiceWorkspaceHeight();

    this.invoiceSidebarObserver = new ResizeObserver(() => this.syncInvoiceWorkspaceHeight());
    this.invoiceSidebarObserver.observe(sidebar);
  }

  private syncInvoiceWorkspaceHeight(): void {
    const sidebar = this.invoiceSidebar?.nativeElement;
    const workspace = this.invoiceWorkspace?.nativeElement;
    if (!sidebar || !workspace) return;

    workspace.style.setProperty('--invoice-sidebar-height', `${sidebar.offsetHeight}px`);
  }

  login(): void {
    this.authMessage.set('');
    this.loading.set(true);
    this.authService.login(this.loginForm).subscribe({
      next: (response) => this.applyAuthResponse(response),
      error: () => {
        this.authMessage.set('Email ou senha inválidos.');
        this.loading.set(false);
      },
    });
  }

  register(): void {
    this.authMessage.set('');
    this.loading.set(true);
    this.authService.register(this.registerForm).subscribe({
      next: (response) => this.applyAuthResponse(response),
      error: (error) => {
        this.authMessage.set(
          error?.error?.detail ?? error?.error?.Detail ?? 'Não foi possível criar a conta.',
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
    this.goalsData.set(null);
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

    this.invoiceApi.uploadInvoice(data).subscribe({
      next: (result) => {
        this.uploadMessage.set(`Fatura importada com ${result.transactions} lançamentos.`);
        this.selectedInvoiceId.set(result.id);
        this.navigatePage('invoices');
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

  onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.handleCsvFile(file);
    input.value = '';
  }

  onCsvDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer?.types.includes('Files')) {
      this.isDraggingCsv.set(true);
    }
  }

  onCsvDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingCsv.set(false);
  }

  onCsvDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingCsv.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.csv')) {
        this.uploadMessage.set('Por favor, envie um arquivo .csv do Nubank.');
        return;
      }
      this.handleCsvFile(file);
    }
  }

  handleCsvFile(file: File): void {
    this.loading.set(true);
    this.uploadMessage.set('Lendo e analisando fatura Nubank CSV...');

    this.invoiceApi.previewNubankCsv(file).subscribe({
      next: (preview) => {
        this.nubankPreviewResponse.set(preview);
        this.nubankPreviewItems.set(preview.items.map((item) => ({ ...item })));
        const periodStr = `${preview.referenceYear}-${String(preview.referenceMonth).padStart(2, '0')}`;
        this.nubankReferencePeriod.set(periodStr);
        this.nubankBankName.set(preview.bankName || 'Nubank');
        this.nubankCardName.set('Nubank');
        this.showNubankPreviewModal.set(true);
        this.loading.set(false);
        this.uploadMessage.set('');
      },
      error: (error) => {
        this.uploadMessage.set(
          error?.error?.detail ?? error?.error?.Detail ?? 'Falha ao analisar fatura CSV do Nubank.',
        );
        this.loading.set(false);
      },
    });
  }

  toggleAllNubankItems(selected: boolean): void {
    this.nubankPreviewItems.update((items) =>
      items.map((item) => (item.isValid ? { ...item, selected } : item)),
    );
  }

  deselectNubankDuplicates(): void {
    this.nubankPreviewItems.update((items) =>
      items.map((item) => (item.isDuplicate ? { ...item, selected: false } : item)),
    );
  }

  toggleNubankItemSelection(index: number): void {
    this.nubankPreviewItems.update((items) => {
      const copy = [...items];
      if (copy[index] && copy[index].isValid) {
        copy[index] = { ...copy[index], selected: !copy[index].selected };
      }
      return copy;
    });
  }

  updateNubankItemCategory(index: number, categoryId: string): void {
    this.nubankPreviewItems.update((items) => {
      const copy = [...items];
      if (copy[index]) {
        const cat = this.categories().find((c) => c.id === categoryId);
        copy[index] = {
          ...copy[index],
          categoryId: categoryId || null,
          categoryName: cat?.name ?? null,
        };
      }
      return copy;
    });
  }

  updateNubankItemDescription(index: number, description: string): void {
    this.nubankPreviewItems.update((items) => {
      const copy = [...items];
      if (copy[index]) {
        copy[index] = { ...copy[index], description };
      }
      return copy;
    });
  }

  updateNubankItemAmount(index: number, amountStr: string): void {
    const amount = parseFloat(amountStr.replace(',', '.'));
    if (!isNaN(amount)) {
      this.nubankPreviewItems.update((items) => {
        const copy = [...items];
        if (copy[index]) {
          copy[index] = {
            ...copy[index],
            amount,
            type: amount < 0 ? 'credito' : 'debito',
          };
        }
        return copy;
      });
    }
  }

  updateNubankItemDate(index: number, date: string): void {
    this.nubankPreviewItems.update((items) => {
      const copy = [...items];
      if (copy[index]) {
        copy[index] = { ...copy[index], date };
      }
      return copy;
    });
  }

  cancelNubankPreview(): void {
    this.showNubankPreviewModal.set(false);
    this.nubankPreviewResponse.set(null);
    this.nubankPreviewItems.set([]);
  }

  confirmNubankImport(): void {
    const selected = this.nubankSelectedItems();
    if (selected.length === 0) {
      alert('Selecione pelo menos uma transação válida para importar.');
      return;
    }

    const periodParts = this.nubankReferencePeriod().split('-');
    const year = parseInt(periodParts[0], 10);
    const month = parseInt(periodParts[1], 10);

    const validCount = this.nubankValidItems().length;
    const ignoredCount = validCount - selected.length;
    const rejectedCount = this.nubankInvalidCount();

    const payload: NubankCsvConfirmRequest = {
      originalFileName: this.nubankPreviewResponse()?.fileName ?? 'nubank.csv',
      bankName: this.nubankBankName() || 'Nubank',
      cardName: this.nubankCardName() || 'Nubank',
      referenceMonth: month,
      referenceYear: year,
      ignoredCount,
      rejectedCount,
      transactions: selected.map((item) => ({
        date: item.date,
        description: item.description,
        normalizedDescription: item.normalizedDescription,
        amount: item.amount,
        type: item.amount < 0 ? 'credito' : 'debito',
        categoryId: item.categoryId,
      })),
    };

    this.loading.set(true);
    this.invoiceApi.confirmNubankCsv(payload).subscribe({
      next: (result) => {
        this.showNubankPreviewModal.set(false);
        this.nubankPreviewResponse.set(null);
        this.nubankPreviewItems.set([]);
        this.loading.set(false);

        this.uploadMessage.set(
          `Fatura Nubank importada com sucesso: ${result.importedCount} lançamentos importados (${result.ignoredCount} ignorados, ${result.rejectedCount} rejeitados).`,
        );
        this.selectedInvoiceId.set(result.id);
        this.navigatePage('invoices');
        this.refreshAll();
        this.loadTransactions(result.id);
      },
      error: (error) => {
        this.loading.set(false);
        alert(
          error?.error?.detail ??
            error?.error?.Detail ??
            'Falha ao confirmar importação da fatura Nubank.',
        );
      },
    });
  }

  loadInvoices(): void {
    this.invoiceApi.getInvoices().subscribe((invoices) => {
      this.invoices.set(invoices);
      if (this.activePage() === 'dashboard' && !this.categorySummary().length) {
        this.loadCategorySummaryFallback(this.dashboardPeriod(), true);
      }
    });
  }

  loadTransactions(invoiceId: string): void {
    this.selectedInvoiceId.set(invoiceId);
    this.clearTransactionSelection();
    this.invoiceApi
      .getTransactions(invoiceId)
      .subscribe((transactions) => this.transactions.set(transactions));
  }

  clearTransactionFilters(): void {
    this.transactionSearch.set('');
    this.transactionCategoryFilter.set('');
    this.transactionQuickFilter.set('all');
  }

  changeTransactionQuickFilter(value: TransactionQuickFilter): void {
    this.transactionQuickFilter.set(value);
  }

  openInvoice(invoiceId: string): void {
    this.navigatePage('invoices');
    this.loadTransactions(invoiceId);
  }

  navigatePage(page: Page): void {
    this.activePage.set(page);
    const path = this.pagePaths[page];
    if (window.location.pathname !== path) {
      history.pushState(null, '', path);
    }
    if (page === 'goals') {
      this.loadGoals();
    }
  }

  loadCategories(): void {
    this.invoiceApi.getCategories().subscribe((categories) => this.categories.set(categories));
  }

  loadCategorizationRules(): void {
    this.invoiceApi
      .getCategorizationRules()
      .subscribe((rules) => this.categorizationRules.set(rules));
  }

  loadDashboard(): void {
    const params = this.dashboardPeriodParams();
    const previousParams = this.dashboardPeriodParams(this.previousDashboardPeriodValue());
    this.invoiceApi
      .getMonthlySummary(params)
      .subscribe((summary) => this.monthlySummary.set(summary));
    this.invoiceApi
      .getCategorySummary(params)
      .subscribe({
        next: (summary) => {
          const normalized = this.normalizeCategorySummary(summary);
          this.categorySummary.set(normalized);
          if (!normalized.length) this.loadCategorySummaryFallback(this.dashboardPeriod(), true);
        },
        error: () => this.loadCategorySummaryFallback(this.dashboardPeriod(), true),
      });
    this.invoiceApi
      .getCategorySummary(previousParams)
      .subscribe({
        next: (summary) => {
          const normalized = this.normalizeCategorySummary(summary);
          this.previousCategorySummary.set(normalized);
          if (!normalized.length) this.loadCategorySummaryFallback(this.previousDashboardPeriodValue(), false);
        },
        error: () => this.loadCategorySummaryFallback(this.previousDashboardPeriodValue(), false),
      });
    this.invoiceApi
      .getMonthComparison(params)
      .subscribe((comparison) => this.monthComparison.set(comparison));
  }

  loadGoals(period = this.goalsPeriod()): void {
    const [year, month] = period.split('-').map(Number);
    this.invoiceApi.getGoals(year, month).subscribe({
      next: (data) => this.goalsData.set(data),
      error: () => this.goalsData.set(null),
    });
  }

  changeGoalsPeriod(value: string): void {
    this.goalsPeriod.set(value);
    this.loadGoals(value);
  }

  openCreateOverallGoal(): void {
    this.goalModalMode.set('overall');
    const existing = this.goalsData()?.overallGoal;
    this.goalModalInitialData.set(
      existing ? { id: existing.id, amount: existing.amount } : null,
    );
    this.isGoalModalOpen.set(true);
  }

  openCreateOverallGoalFromDashboard(): void {
    this.goalsPeriod.set(this.dashboardPeriod());
    this.goalModalMode.set('overall');
    const goalAmount = this.monthlySummary()?.monthlyGoal ?? 0;
    this.goalModalInitialData.set(
      goalAmount > 0 ? { amount: goalAmount } : null,
    );
    this.isGoalModalOpen.set(true);
  }

  openCreateCategoryGoal(): void {
    this.goalModalMode.set('category');
    this.goalModalInitialData.set(null);
    this.isGoalModalOpen.set(true);
  }

  openEditGoal(item: {
    id: string;
    categoryId?: string | null;
    categoryName?: string;
    amount: number;
  }): void {
    this.goalModalMode.set('edit');
    this.goalModalInitialData.set({
      id: item.id,
      categoryId: item.categoryId ?? null,
      categoryName: item.categoryName,
      amount: item.amount,
    });
    this.isGoalModalOpen.set(true);
  }

  deleteGoal(id: string): void {
    const confirmed = window.confirm('Deseja realmente excluir esta meta?');
    if (!confirmed) return;

    this.invoiceApi.deleteGoal(id).subscribe({
      next: () => {
        this.loadGoals();
        this.loadDashboard();
      },
      error: () => alert('Falha ao excluir meta.'),
    });
  }

  copyPreviousMonthGoals(): void {
    const [year, month] = this.goalsPeriod().split('-').map(Number);
    const confirmed = window.confirm(
      'Deseja copiar as metas definidas no mês anterior para este mês?',
    );
    if (!confirmed) return;

    this.invoiceApi.copyPreviousMonthGoals(year, month).subscribe({
      next: (res) => {
        this.loadGoals();
        this.loadDashboard();
        alert(`Metas copiadas com sucesso! (${res.copied} meta(s) copiada(s))`);
      },
      error: (err) => {
        alert(
          err?.error?.detail ??
            err?.error?.Detail ??
            'Nenhuma meta encontrada no mês anterior para copiar.',
        );
      },
    });
  }

  handleGoalModalSave(event: GoalModalSaveEvent): void {
    if (event.id) {
      this.invoiceApi.updateGoal(event.id, event.amount).subscribe({
        next: () => {
          this.isGoalModalOpen.set(false);
          this.loadGoals();
          this.loadDashboard();
        },
        error: (err) => alert(err?.error?.detail ?? 'Erro ao atualizar meta.'),
      });
    } else {
      const [year, month] = this.goalsPeriod().split('-').map(Number);
      this.invoiceApi
        .saveGoal({
          year,
          month,
          categoryId: event.categoryId || null,
          amount: event.amount,
          repeatNextMonths: event.repeatNextMonths,
        })
        .subscribe({
          next: () => {
            this.isGoalModalOpen.set(false);
            this.loadGoals();
            this.loadDashboard();
          },
          error: (err) => alert(err?.error?.detail ?? 'Erro ao salvar meta.'),
        });
    }
  }

  closeGoalModal(): void {
    this.isGoalModalOpen.set(false);
    this.goalModalInitialData.set(null);
  }

  goToCategorization(): void {
    this.navigatePage('invoices');
    this.transactionQuickFilter.set('outros');
  }

  changeDashboardPeriod(value: string): void {
    this.dashboardPeriod.set(value);
    this.loadDashboard();
  }

  createCategory(): void {
    const name = this.newCategory.name.trim();
    if (!name) return;

    const payload = {
      ...this.newCategory,
      name,
      monthlyGoal: Math.max(0, Number(this.newCategory.monthlyGoal) || 0),
    };
    const editingId = this.editingCategoryId();
    const request = editingId
      ? this.invoiceApi.updateCategory(editingId, payload)
      : this.invoiceApi.createCategory(payload);

    request.subscribe(() => {
      this.resetCategoryForm();
      this.loadCategories();
      this.loadDashboard();
    });
  }

  editCategory(category: Category): void {
    this.editingCategoryId.set(category.id);
    this.newCategory = {
      name: category.name,
      color: category.color,
      icon: category.icon,
      monthlyGoal: category.monthlyGoal ?? 0,
    };
  }

  resetCategoryForm(): void {
    this.editingCategoryId.set('');
    this.newCategory = { name: '', color: '#64748b', icon: 'tag', monthlyGoal: 0 };
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

    this.invoiceApi.deleteCategory(category.id).subscribe(() => {
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
      ? this.invoiceApi.updateRule(this.ruleForm.id, payload)
      : this.invoiceApi.createRule(payload);

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

    this.invoiceApi.deleteRule(rule.id).subscribe(() => {
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

    this.invoiceApi.deleteInvoice(invoice.id).subscribe(() => {
      if (this.selectedInvoiceId() === invoice.id) {
        this.selectedInvoiceId.set(null);
        this.transactions.set([]);
      }
      this.refreshAll();
      this.uploadMessage.set('Fatura excluída.');
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

    this.invoiceApi
      .updateTransactionCategory(transaction.id, {
        categoryId,
        mode: 'single',
        rulePattern: null,
      })
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

    this.invoiceApi
      .createRule({
        matchType: 'contains',
        pattern,
        categoryId: current.categoryId,
      })
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

    this.invoiceApi.bulkCategorize(ids, categoryId).subscribe(() => {
      this.transactions.update((transactions) =>
        transactions.map((transaction) =>
          ids.includes(transaction.id) ? { ...transaction, categoryId, categoryName } : transaction,
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

  private syncPageFromUrl(): void {
    const page = (Object.entries(this.pagePaths).find(([, path]) =>
      window.location.pathname.endsWith(path),
    )?.[0] ?? 'dashboard') as Page;
    this.activePage.set(page);
    if (page === 'goals') {
      this.loadGoals();
    }
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

  private normalizeCategorySummary(summary: CategorySummary[]): CategorySummary[] {
    return summary.map((item) => ({
      ...item,
      monthlyGoal: Number(item.monthlyGoal) || 0,
    }));
  }

  private loadCategorySummaryFallback(period: string, current: boolean): void {
    const [year, month] = period.split('-').map(Number);
    const invoices = this.invoices().filter(
      (invoice) => invoice.referenceYear === year && invoice.referenceMonth === month,
    );

    if (!invoices.length) {
      if (current) this.categorySummary.set([]);
      else this.previousCategorySummary.set([]);
      return;
    }

    forkJoin(
      invoices.map((invoice) =>
        this.invoiceApi.getTransactions(invoice.id).pipe(catchError(() => of([] as Transaction[]))),
      ),
    ).subscribe((groups) => {
      const categoriesById = new Map(this.categories().map((category) => [category.id, category]));
      const summary = new Map<string, CategorySummary>();

      for (const transaction of groups.flat()) {
        const key = transaction.categoryId ?? 'uncategorized';
        const category = categoriesById.get(transaction.categoryId ?? '');
        const row = summary.get(key);

        if (row) {
          row.total += transaction.amount;
          row.count += 1;
          continue;
        }

        summary.set(key, {
          categoryId: transaction.categoryId,
          categoryName: transaction.categoryName ?? category?.name ?? 'Sem categoria',
          total: transaction.amount,
          count: 1,
          monthlyGoal: category?.monthlyGoal ?? 0,
        });
      }

      const rows = Array.from(summary.values()).sort((a, b) => b.total - a.total);
      if (current) this.categorySummary.set(rows);
      else this.previousCategorySummary.set(rows);
    });
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

  categoryDeltaLabel(item: CategoryComparison): string {
    if (!this.previousCategorySummary().length) return 'Sem dados do período anterior';
    if (item.delta === 0) return 'Sem variação';
    return `${this.formatSignedCurrency(item.delta)} vs período anterior`;
  }

  categoryPercentageLabel(item: CategoryComparison): string {
    if (!this.previousCategorySummary().length) return 'sem base';
    if (item.percentage === null) return item.total === 0 ? '0%' : 'novo';
    if (item.percentage === 0) return '0%';
    const formatted = new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Math.abs(item.percentage));
    return `${item.percentage > 0 ? '+' : '-'}${formatted}%`;
  }

  categoryTrendClass(item: CategoryComparison): string {
    if (item.delta > 0) return 'up';
    if (item.delta < 0) return 'down';
    return 'flat';
  }

  categoryRowTag(item: CategoryComparison): string {
    const rows = this.categoryComparisonRows();
    if (!rows.length) return '';
    const highest = rows.reduce((best, row) => (row.total > best.total ? row : best), rows[0]);
    const increase = rows.reduce((best, row) => (row.delta > best.delta ? row : best), rows[0]);
    const decrease = rows.reduce((best, row) => (row.delta < best.delta ? row : best), rows[0]);

    if (this.categorySummaryKey(item) === this.categorySummaryKey(highest)) return 'Maior gasto';
    if (increase.delta > 0 && this.categorySummaryKey(item) === this.categorySummaryKey(increase)) {
      return 'Maior alta';
    }
    if (decrease.delta < 0 && this.categorySummaryKey(item) === this.categorySummaryKey(decrease)) {
      return 'Maior queda';
    }
    return '';
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

  private dashboardPeriodParams(value = this.dashboardPeriod()): string {
    const [year, month] = value.split('-');
    return `?month=${Number(month)}&year=${Number(year)}`;
  }

  private previousDashboardPeriodValue(): string {
    const [year, month] = this.dashboardPeriod().split('-').map(Number);
    const previous = new Date(year, month - 2, 1);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
  }

  private categorySummaryKey(item: Pick<CategorySummary, 'categoryId' | 'categoryName'>): string {
    return item.categoryId ?? this.normalizeFilterValue(item.categoryName);
  }

  formatPeriodLabel(value: string): string {
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
      .format(new Date(year, month - 1, 1))
      .replace(/^./, (letter) => letter.toUpperCase());
  }
}
