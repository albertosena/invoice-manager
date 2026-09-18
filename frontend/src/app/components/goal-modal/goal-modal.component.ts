import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Category } from '../../models/invoice.models';

export type GoalModalMode = 'overall' | 'category' | 'edit';

export interface GoalModalSaveEvent {
  id?: string;
  categoryId?: string | null;
  amount: number;
  repeatNextMonths: number;
}

@Component({
  selector: 'app-goal-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isOpen) {
      <div class="modal-backdrop" (click)="onBackdropClick($event)">
        <div class="modal-dialog" role="dialog" aria-modal="true" [attr.aria-labelledby]="modalTitleId">
          <header class="modal-header">
            <div>
              <h3 [id]="modalTitleId">{{ title }}</h3>
              <p class="modal-subtitle">{{ subtitle }}</p>
            </div>
            <button type="button" class="btn-close" (click)="onClose()" aria-label="Fechar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <form (ngSubmit)="onSubmit()" class="modal-body">
            @if (mode === 'category') {
              <div class="form-group">
                <label for="goalCategorySelect">Categoria</label>
                <select
                  id="goalCategorySelect"
                  name="categoryId"
                  class="form-control"
                  [(ngModel)]="formCategoryId"
                  required
                >
                  <option value="" disabled selected>Selecione uma categoria</option>
                  @for (cat of availableCategories; track cat.id) {
                    <option [value]="cat.id">{{ cat.name }}</option>
                  }
                </select>
              </div>
            } @else if (mode === 'edit' && formCategoryName) {
              <div class="form-group">
                <span class="field-label">Categoria</span>
                <div class="static-value-badge">
                  <span>{{ formCategoryName }}</span>
                </div>
              </div>
            }

            <div class="form-group">
              <label for="goalAmountInput">Valor da meta (R$)</label>
              <div class="input-currency-wrapper">
                <span class="currency-prefix">R$</span>
                <input
                  id="goalAmountInput"
                  type="number"
                  name="amount"
                  class="form-control currency-input"
                  placeholder="0,00"
                  step="0.01"
                  min="0.01"
                  [(ngModel)]="formAmount"
                  required
                  autofocus
                />
              </div>
              <small class="field-hint">Defina um limite de gastos para o período.</small>
            </div>

            @if (mode !== 'edit') {
              <div class="form-group">
                <label for="goalRepeatSelect">Repetir esta meta nos próximos meses?</label>
                <select
                  id="goalRepeatSelect"
                  name="repeatNextMonths"
                  class="form-control"
                  [(ngModel)]="formRepeatNextMonths"
                >
                  <option [value]="0">Apenas neste mês</option>
                  <option [value]="1">Repetir para o próximo mês (1 mês)</option>
                  <option [value]="3">Repetir para os próximos 3 meses</option>
                  <option [value]="6">Repetir para os próximos 6 meses</option>
                  <option [value]="12">Repetir para todo o próximo ano (12 meses)</option>
                </select>
                <small class="field-hint">Economize tempo aplicando a mesma meta para os meses futuros.</small>
              </div>
            }

            <footer class="modal-actions">
              <button type="button" class="btn-cancel" (click)="onClose()">
                Cancelar
              </button>
              <button
                type="submit"
                class="btn-save"
                [disabled]="!isValid"
              >
                {{ mode === 'edit' ? 'Salvar alterações' : 'Definir meta' }}
              </button>
            </footer>
          </form>
        </div>
      </div>
    }
  `,
  styles: [`
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 1rem;
      animation: fadeIn 0.15s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .modal-dialog {
      background: #ffffff;
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      border: 1px solid #e2e8f0;
      animation: slideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slideUp {
      from { transform: translateY(12px) scale(0.98); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    .modal-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      padding: 1.5rem 1.5rem 1rem;
      border-bottom: 1px solid #f1f5f9;
    }
    .modal-header h3 {
      font-size: 1.125rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }
    .modal-subtitle {
      font-size: 0.8125rem;
      color: #64748b;
      margin: 0.25rem 0 0;
    }
    .btn-close {
      background: transparent;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      padding: 0.25rem;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .btn-close:hover {
      color: #0f172a;
      background: #f1f5f9;
    }
    .btn-close svg {
      width: 20px;
      height: 20px;
    }
    .modal-body {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .form-group label, .field-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: #334155;
    }
    .form-control {
      padding: 0.625rem 0.875rem;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.875rem;
      color: #0f172a;
      background: #ffffff;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
      width: 100%;
      box-sizing: border-box;
    }
    .form-control:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
    }
    .input-currency-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .currency-prefix {
      position: absolute;
      left: 0.875rem;
      font-size: 0.875rem;
      font-weight: 600;
      color: #64748b;
      pointer-events: none;
    }
    .currency-input {
      padding-left: 2.5rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .field-hint {
      font-size: 0.75rem;
      color: #64748b;
    }
    .static-value-badge {
      padding: 0.5rem 0.75rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #1e293b;
    }
    .modal-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.75rem;
      margin-top: 0.75rem;
      padding-top: 1rem;
      border-top: 1px solid #f1f5f9;
    }
    .btn-cancel {
      padding: 0.625rem 1rem;
      background: transparent;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-cancel:hover {
      background: #f8fafc;
      color: #0f172a;
    }
    .btn-save {
      padding: 0.625rem 1.25rem;
      background: #6366f1;
      border: 1px solid transparent;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      color: #ffffff;
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-save:hover:not(:disabled) {
      background: #4f46e5;
    }
    .btn-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `]
})
export class GoalModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() mode: GoalModalMode = 'overall';
  @Input() categories: Category[] = [];
  @Input() initialData: {
    id?: string;
    categoryId?: string | null;
    categoryName?: string;
    amount: number;
    repeatNextMonths?: number;
  } | null = null;
  @Input() existingCategoryIds: string[] = [];

  @Output() save = new EventEmitter<GoalModalSaveEvent>();
  @Output() close = new EventEmitter<void>();

  formAmount: number | null = null;
  formCategoryId = '';
  formCategoryName = '';
  formRepeatNextMonths = 0;
  modalTitleId = 'goalModalTitle';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.initForm();
    }
  }

  private initForm(): void {
    if (this.initialData) {
      this.formAmount = this.initialData.amount || null;
      this.formCategoryId = this.initialData.categoryId ?? '';
      this.formCategoryName = this.initialData.categoryName ?? '';
      this.formRepeatNextMonths = this.initialData.repeatNextMonths ?? 0;
    } else {
      this.formAmount = null;
      this.formCategoryId = '';
      this.formCategoryName = '';
      this.formRepeatNextMonths = 0;
    }
  }

  get availableCategories(): Category[] {
    if (this.mode === 'category') {
      return this.categories.filter((c) => !this.existingCategoryIds.includes(c.id));
    }
    return this.categories;
  }

  get title(): string {
    switch (this.mode) {
      case 'overall':
        return this.initialData?.id ? 'Editar Meta Geral do Mês' : 'Definir Meta Geral do Mês';
      case 'category':
        return 'Definir Meta por Categoria';
      case 'edit':
        return 'Editar Meta';
      default:
        return 'Meta';
    }
  }

  get subtitle(): string {
    switch (this.mode) {
      case 'overall':
        return 'Estabeleça um limite global para seus gastos no mês.';
      case 'category':
        return 'Defina quanto planeja gastar nesta categoria específica.';
      case 'edit':
        return 'Ajuste o valor planejado para esta meta.';
      default:
        return '';
    }
  }

  get isValid(): boolean {
    if (this.formAmount === null || this.formAmount <= 0) return false;
    if (this.mode === 'category' && !this.formCategoryId) return false;
    return true;
  }

  onBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.onClose();
    }
  }

  onClose(): void {
    this.close.emit();
  }

  onSubmit(): void {
    if (!this.isValid) return;
    this.save.emit({
      id: this.initialData?.id,
      categoryId: this.mode === 'category' ? this.formCategoryId : this.initialData?.categoryId,
      amount: Number(this.formAmount),
      repeatNextMonths: Number(this.formRepeatNextMonths) || 0,
    });
  }
}
