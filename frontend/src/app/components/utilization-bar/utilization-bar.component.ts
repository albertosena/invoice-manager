import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GoalStatus } from '../../models/invoice.models';

@Component({
  selector: 'app-utilization-bar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="utilization-bar-wrapper">
      <div class="progress-track" [style.height]="height">
        <div
          class="progress-fill"
          [class.progress-normal]="barStatus === 'normal'"
          [class.progress-warning]="barStatus === 'warning'"
          [class.progress-danger]="barStatus === 'danger'"
          [style.width.%]="clampedPercentage"
        ></div>
      </div>
      @if (showLabel) {
        <span class="progress-text" [class]="barStatus">
          {{ formattedPercentage }}%
        </span>
      }
    </div>
  `,
  styles: [`
    .utilization-bar-wrapper {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
    }
    .progress-track {
      flex: 1;
      height: 8px;
      background: var(--bg-card-muted, #f1f5f9);
      border-radius: 9999px;
      overflow: hidden;
      position: relative;
    }
    .progress-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .progress-normal {
      background: #10b981;
    }
    .progress-warning {
      background: #f59e0b;
    }
    .progress-danger {
      background: #ef4444;
    }
    .progress-text {
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      min-width: 2.75rem;
      text-align: right;
    }
    .progress-text.normal { color: #059669; }
    .progress-text.warning { color: #d97706; }
    .progress-text.danger { color: #dc2626; }
    .progress-text.no_goal { color: #64748b; }

    :host-context([data-theme="dark"]) .progress-track {
      background: var(--border-color, #374459);
    }
    :host-context([data-theme="dark"]) .progress-text.normal { color: #34d399; }
    :host-context([data-theme="dark"]) .progress-text.warning { color: #fbbf24; }
    :host-context([data-theme="dark"]) .progress-text.danger { color: #fb7185; }
    :host-context([data-theme="dark"]) .progress-text.no_goal { color: #94a3b8; }
  `]
})
export class UtilizationBarComponent {
  @Input() percentage = 0;
  @Input() status?: GoalStatus;
  @Input() height = '8px';
  @Input() showLabel = false;

  get barStatus(): GoalStatus {
    if (this.status) return this.status;
    if (this.percentage >= 100) return 'danger';
    if (this.percentage >= 80) return 'warning';
    return 'normal';
  }

  get clampedPercentage(): number {
    return Math.min(100, Math.max(0, this.percentage));
  }

  get formattedPercentage(): string {
    return new Intl.NumberFormat('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(this.percentage);
  }
}
