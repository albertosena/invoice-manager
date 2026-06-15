import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

const API_BASE = `http://${window.location.hostname}:5000/api`;

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

type MonthlySummary = {
  totalSpent: number;
  totalCredits: number;
  netAmount: number;
  transactionCount: number;
};

type CategorySummary = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
};

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
  categorySummary = signal<CategorySummary[]>([]);
  monthlySummary = signal<MonthlySummary | null>(null);
  selectedInvoiceId = signal<string | null>(null);
  uploadMessage = signal('');
  loading = signal(false);
  pendingRule = signal<{
    transaction: Transaction;
    categoryId: string;
    categoryName: string;
    pattern: string;
  } | null>(null);

  newCategory = { name: '', color: '#64748b', icon: 'tag' };

  selectedInvoice = computed(() =>
    this.invoices().find(invoice => invoice.id === this.selectedInvoiceId()) ?? null
  );

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  refreshAll(): void {
    this.loadInvoices();
    this.loadCategories();
    this.loadDashboard();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const data = new FormData();
    data.append('file', file);
    this.loading.set(true);
    this.uploadMessage.set('Importando e extraindo lancamentos...');

    this.http.post<{ id: string; status: string; transactions: number }>(`${API_BASE}/invoices/upload`, data)
      .subscribe({
        next: result => {
          this.uploadMessage.set(`Fatura importada com ${result.transactions} lancamentos.`);
          this.selectedInvoiceId.set(result.id);
          this.refreshAll();
          this.loadTransactions(result.id);
          this.loading.set(false);
          input.value = '';
        },
        error: error => {
          this.uploadMessage.set(error?.error?.detail ?? 'Falha ao importar PDF.');
          this.loading.set(false);
        }
      });
  }

  loadInvoices(): void {
    this.http.get<Invoice[]>(`${API_BASE}/invoices`).subscribe(invoices => this.invoices.set(invoices));
  }

  loadTransactions(invoiceId: string): void {
    this.selectedInvoiceId.set(invoiceId);
    this.http.get<Transaction[]>(`${API_BASE}/invoices/${invoiceId}/transactions`).subscribe(transactions => this.transactions.set(transactions));
  }

  loadCategories(): void {
    this.http.get<Category[]>(`${API_BASE}/categories`).subscribe(categories => this.categories.set(categories));
  }

  loadDashboard(): void {
    this.http.get<MonthlySummary>(`${API_BASE}/dashboard/monthly-summary`).subscribe(summary => this.monthlySummary.set(summary));
    this.http.get<CategorySummary[]>(`${API_BASE}/dashboard/category-summary`).subscribe(summary => this.categorySummary.set(summary));
  }

  createCategory(): void {
    const name = this.newCategory.name.trim();
    if (!name) return;

    this.http.post<Category>(`${API_BASE}/categories`, { ...this.newCategory, name }).subscribe(() => {
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
    }).subscribe(() => {
      this.loadCategories();
      this.loadDashboard();
    });
  }

  deleteCategory(category: Category): void {
    const confirmed = window.confirm(`Excluir a categoria "${category.name}"?`);
    if (!confirmed) return;

    this.http.delete(`${API_BASE}/categories/${category.id}`).subscribe(() => {
      this.loadCategories();
      this.loadDashboard();
      const selected = this.selectedInvoiceId();
      if (selected) this.loadTransactions(selected);
    });
  }

  deleteInvoice(invoice: Invoice, event: MouseEvent): void {
    event.stopPropagation();
    const confirmed = window.confirm(`Excluir a fatura "${invoice.originalFileName}" e todos os seus lancamentos?`);
    if (!confirmed) return;

    this.http.delete(`${API_BASE}/invoices/${invoice.id}`).subscribe(() => {
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
    }).subscribe(() => {
      this.pendingRule.set(null);
      const selected = this.selectedInvoiceId();
      if (selected) this.loadTransactions(selected);
      this.loadDashboard();
      this.uploadMessage.set(`Regra "${pattern}" aplicada para historico e futuras faturas.`);
    });
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

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value ?? 0);
  }
}
