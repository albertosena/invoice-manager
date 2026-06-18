export type Invoice = {
  id: string;
  bankName: string;
  referenceMonth: number;
  referenceYear: number;
  originalFileName: string;
  status: string;
  createdAt: string;
  transactionCount: number;
};

export type Transaction = {
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

export type Category = {
  id: string;
  name: string;
  color: string;
  icon: string;
  monthlyGoal: number;
};

export type CategorizationRule = {
  id: string;
  matchType: string;
  pattern: string;
  normalizedPattern: string;
  categoryId: string;
  category: Category | null;
  createdAt: string;
};

export type MonthlySummary = {
  month?: number;
  year?: number;
  totalSpent: number;
  totalCredits: number;
  netAmount: number;
  transactionCount: number;
};

export type MonthComparison = {
  current: MonthlySummary;
  previous: MonthlySummary;
  difference: number;
  percentage: number | null;
};

export type SummaryMetric = 'totalSpent' | 'totalCredits' | 'netAmount' | 'transactionCount';

export type CategorySummary = {
  categoryId: string | null;
  categoryName: string;
  total: number;
  count: number;
  monthlyGoal: number;
};

export type CategoryComparison = CategorySummary & {
  previousTotal: number;
  previousCount: number;
  delta: number;
  percentage: number | null;
  share: number;
};

export type CategoryInsight = {
  label: string;
  categoryName: string;
  value: string;
  tone: 'neutral' | 'up' | 'down';
};

export type User = {
  id: string;
  name: string;
  email: string;
};

export type AuthResponse = {
  token: string;
  expiresAt: string;
  user: User;
};

export type Page = 'dashboard' | 'invoices' | 'categories';

export type TransactionQuickFilter =
  | 'all'
  | 'outros'
  | 'debitos'
  | 'creditos'
  | 'withRule'
  | 'withoutRule';

export type UploadInvoiceResponse = {
  id: string;
  status: string;
  transactions: number;
};
