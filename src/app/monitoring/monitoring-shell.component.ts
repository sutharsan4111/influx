import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-monitoring-shell',
  standalone: true,
  imports: [CommonModule, RouterModule, RouterOutlet],
  template: `
    <div class="monitoring-shell">
      <div class="page-intro">
        <div>
          <p class="eyebrow">Monitor</p>
          <h1>Live Infrastructure Monitoring</h1>
          <p class="lead">Track assets and Azure resources in real time for the currently signed-in user.</p>
        </div>
        <nav class="nav-tabs">
          <a routerLink="assets" routerLinkActive="active">Asset Monitoring</a>
          <a routerLink="azure" routerLinkActive="active">Azure Monitoring</a>
        </nav>
      </div>
      <div class="shell-content">
        <router-outlet></router-outlet>
      </div>
    </div>
  `,
  styles: [`
    .monitoring-shell {
      min-height: 100%;
      padding: 20px;
      max-width: 1600px;
      margin: 0 auto;
    }

    .page-intro {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      margin-bottom: 22px;
      flex-wrap: wrap;
    }

    .eyebrow {
      margin: 0 0 6px;
      color: #2563eb;
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      font-weight: 700;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 3vw, 3rem);
      line-height: 1.05;
      color: #0f172a;
    }

    .lead {
      margin-top: 10px;
      color: #475569;
      max-width: 720px;
      line-height: 1.7;
    }

    .nav-tabs {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .nav-tabs a {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 160px;
      padding: 12px 18px;
      border-radius: 999px;
      background: #f8fafc;
      color: #475569;
      text-decoration: none;
      font-size: 0.92rem;
      font-weight: 600;
      transition: all 0.2s ease;
    }

    .nav-tabs a.active,
    .nav-tabs a:hover {
      background: #2563eb;
      color: #fff;
      box-shadow: 0 12px 28px rgba(37, 99, 235, 0.18);
    }

    .shell-content {
      min-height: calc(100vh - 180px);
    }

    @media (max-width: 860px) {
      .page-intro {
        align-items: flex-start;
      }

      .nav-tabs {
        width: 100%;
      }

      .nav-tabs a {
        flex: 1;
      }
    }
  `]
})
export class MonitoringShellComponent {}
