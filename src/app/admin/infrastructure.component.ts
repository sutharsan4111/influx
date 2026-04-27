import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule, RouterOutlet } from '@angular/router';

@Component({
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  template: `
    <div class="infrastructure-page">
      <div class="infra-tabs">
        <a
          class="infra-tab"
          routerLink="/infrastructure/ssl"
          [class.active]="isActive('/infrastructure/ssl')">
          SSL
        </a>
        <a
          class="infra-tab"
          routerLink="/infrastructure/ihub"
          [class.active]="isActive('/infrastructure/ihub')">
          IHUB
        </a>
        <a
          class="infra-tab"
          routerLink="/infrastructure/automation-ssl"
          [class.active]="isActive('/infrastructure/automation-ssl')">
          Automation SSL
        </a>
      </div>

      <div class="infra-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .infrastructure-page {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .infra-tabs {
      display: flex;
      align-items: center;
      gap: 10px;
      background: #eef2f7;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 10px;
      width: fit-content;
      max-width: 100%;
      flex-wrap: wrap;
    }

    .infra-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 16px;
      border-radius: 9px;
      text-decoration: none;
      color: #334155;
      font-weight: 600;
      font-size: 13px;
      transition: all 0.2s ease;
      background: transparent;
    }

    .infra-tab:hover {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .infra-tab.active {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      box-shadow: 0 6px 14px rgba(37, 99, 235, 0.3);
    }

    .infra-content {
      min-width: 0;
    }

    :host-context(.dark-theme) .infra-tabs {
      background: #0f172a;
      border-color: #334155;
    }

    :host-context(.dark-theme) .infra-tab {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .infra-tab:hover {
      background: #1e293b;
      color: #bfdbfe;
    }
  `]
})
export class InfrastructureComponent {
  constructor(private router: Router) {}

  isActive(route: string) {
    return this.router.url.startsWith(route);
  }
}
