import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoalStatus } from '../../models/invoice.models';

@Component({
  selector: 'app-goal-status-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="goal-badge"
      [class.badge-normal]="status === 'normal'"
      [class.badge-warning]="status === 'warning'"
      [class.badge-danger]="status === 'danger'"
      [class.badge-no-goal]="status === 'no_goal'"
    >
      <span class="badge-dot" aria-hidden="true"></span>
      <span>{{ displayLabel }}</span>
    </span>
  `,
  styles: [`
    .goal-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.25rem 0.625rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.01em;
    }
    .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .badge-normal {
      background: #ecfdf5;
      color: #065f46;
    }
    .badge-normal .badge-dot {
      background: #10b981;
    }
    .badge-warning {
      background: #fffbeb;
      color: #92400e;
    }
    .badge-warning .badge-dot {
      background: #f59e0b;
    }
    .badge-danger {
      background: #fef2f2;
      color: #991b1b;
    }
    .badge-danger .badge-dot {
      background: #ef4444;
    }
    .badge-no-goal {
      background: #f1f5f9;
      color: #475569;
    }
    .badge-no-goal .badge-dot {
      background: #94a3b8;
    }
  `]
})
export class GoalStatusBadgeComponent {
  @Input() status: GoalStatus = 'no_goal';
  @Input() customLabel?: string;

  get displayLabel(): string {
    if (this.customLabel) return this.customLabel;
    switch (this.status) {
      case 'normal':
        return 'Dentro do esperado';
      case 'warning':
        return 'Atenção';
      case 'danger':
        return 'Meta ultrapassada';
      case 'no_goal':
        return 'Sem meta';
      default:
        return 'Sem meta';
    }
  }
}
