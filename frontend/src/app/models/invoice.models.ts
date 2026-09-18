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
  monthlyGoal?: number;
  categorizedCount?: number;
  uncategorizedCount?: number;
  categorizedPercentage?: number;
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

export type Page = 'dashboard' | 'invoices' | 'goals' | 'categories';

export type GoalStatus = 'normal' | 'warning' | 'danger' | 'no_goal';

export type CategoryGoalItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  categoryIcon: string;
  amount: number;
  spent: number;
  available: number;
  percentage: number;
  status: GoalStatus;
};

export type GoalSummary = {
  grossSpent: number;
  credits: number;
  netSpent: number;
  goalAmount: number;
  available: number;
  percentageUsed: number;
  projection: number;
  status: GoalStatus;
};

export type GoalHistoryMonth = {
  year: number;
  month: number;
  goalAmount: number;
  netSpent: number;
  difference: number;
  status: 'cumprida' | 'ultrapassada' | 'sem_meta';
};

export type GoalsResponse = {
  year: number;
  month: number;
  overallGoal: { id: string; amount: number } | null;
  summary: GoalSummary;
  categoryGoals: CategoryGoalItem[];
  history: GoalHistoryMonth[];
};

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

export type NubankCsvPreviewItem = {
  lineNumber: number;
  date: string;
  description: string;
  normalizedDescription: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  isValid: boolean;
  errorMessage: string | null;
  isDuplicate: boolean;
  duplicateReason: string | null;
  selected: boolean;
};

export type NubankCsvPreviewResponse = {
  fileName: string;
  totalLines: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  totalAmount: number;
  referenceMonth: number;
  referenceYear: number;
  bankName: string;
  items: NubankCsvPreviewItem[];
};

export type NubankCsvConfirmItem = {
  date: string;
  description: string;
  normalizedDescription?: string;
  amount: number;
  type: string;
  categoryId: string | null;
};

export type NubankCsvConfirmRequest = {
  originalFileName: string;
  bankName: string;
  cardName?: string;
  referenceMonth: number;
  referenceYear: number;
  ignoredCount: number;
  rejectedCount: number;
  transactions: NubankCsvConfirmItem[];
};

export type NubankCsvConfirmResponse = {
  id: string;
  status: string;
  importedCount: number;
  ignoredCount: number;
  rejectedCount: number;
};

