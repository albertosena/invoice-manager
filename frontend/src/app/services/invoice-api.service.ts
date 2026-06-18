import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { API_BASE } from './api-url';
import {
  CategorizationRule,
  Category,
  CategorySummary,
  Invoice,
  MonthComparison,
  MonthlySummary,
  Transaction,
  UploadInvoiceResponse,
} from '../models/invoice.models';

@Injectable({ providedIn: 'root' })
export class InvoiceApiService {
  constructor(private http: HttpClient) {}

  uploadInvoice(data: FormData) {
    return this.http.post<UploadInvoiceResponse>(`${API_BASE}/invoices/upload`, data);
  }

  getInvoices() {
    return this.http.get<Invoice[]>(`${API_BASE}/invoices`);
  }

  getTransactions(invoiceId: string) {
    return this.http.get<Transaction[]>(`${API_BASE}/invoices/${invoiceId}/transactions`);
  }

  deleteInvoice(invoiceId: string) {
    return this.http.delete(`${API_BASE}/invoices/${invoiceId}`);
  }

  getCategories() {
    return this.http.get<Category[]>(`${API_BASE}/categories`);
  }

  createCategory(payload: Pick<Category, 'name' | 'color' | 'icon' | 'monthlyGoal'>) {
    return this.http.post<Category>(`${API_BASE}/categories`, payload);
  }

  updateCategory(
    categoryId: string,
    payload: Pick<Category, 'name' | 'color' | 'icon' | 'monthlyGoal'>,
  ) {
    return this.http.put(`${API_BASE}/categories/${categoryId}`, payload);
  }

  deleteCategory(categoryId: string) {
    return this.http.delete(`${API_BASE}/categories/${categoryId}`);
  }

  getCategorizationRules() {
    return this.http.get<CategorizationRule[]>(`${API_BASE}/categorization-rules`);
  }

  createRule(payload: { matchType: string; pattern: string; categoryId: string }) {
    return this.http.post(`${API_BASE}/categorization-rules`, payload);
  }

  updateRule(ruleId: string, payload: { matchType: string; pattern: string; categoryId: string }) {
    return this.http.put(`${API_BASE}/categorization-rules/${ruleId}`, payload);
  }

  deleteRule(ruleId: string) {
    return this.http.delete(`${API_BASE}/categorization-rules/${ruleId}`);
  }

  updateTransactionCategory(
    transactionId: string,
    payload: { categoryId: string; mode: string; rulePattern: string | null },
  ) {
    return this.http.patch(`${API_BASE}/transactions/${transactionId}/category`, payload);
  }

  bulkCategorize(transactionIds: string[], categoryId: string) {
    return this.http.post<{ updated: number }>(`${API_BASE}/transactions/bulk-categorize`, {
      transactionIds,
      categoryId,
    });
  }

  getMonthlySummary(periodParams: string) {
    return this.http.get<MonthlySummary>(`${API_BASE}/dashboard/monthly-summary${periodParams}`);
  }

  getCategorySummary(periodParams: string) {
    return this.http.get<CategorySummary[]>(
      `${API_BASE}/dashboard/category-summary${periodParams}`,
    );
  }

  getMonthComparison(periodParams: string) {
    return this.http.get<MonthComparison>(`${API_BASE}/dashboard/month-comparison${periodParams}`);
  }
}
