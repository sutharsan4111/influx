import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonitoringService, AssetMonitoringRecord } from './monitoring.service';

@Component({
  selector: 'app-asset-monitoring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="asset-page">
      <div class="hero-card">
        <div>
          <p class="eyebrow">Asset Monitoring</p>
          <h2>Live asset health for your assigned devices</h2>
          <p class="hero-copy">Get a unified view of workstations and laptops with real-time system metrics, status, and alerts for the current signed-in user.</p>
        </div>
        <div class="hero-actions">
          <button class="refresh-btn" (click)="refresh()" [disabled]="loading">
            {{ loading ? 'Refreshing...' : 'Refresh now' }}
          </button>
        </div>
      </div>

      <section class="overview-grid">
        <article class="stat-card accent-blue">
          <span>Total assets</span>
          <strong>{{ assets.length }}</strong>
          <small>Assigned to your account</small>
        </article>
        <article class="stat-card accent-green">
          <span>Online</span>
          <strong>{{ onlineCount }}</strong>
          <small>Reporting in the last 5 minutes</small>
        </article>
        <article class="stat-card accent-orange">
          <span>Critical issues</span>
          <strong>{{ issueCount }}</strong>
          <small>Active alerts</small>
        </article>
        <article class="stat-card accent-purple">
          <span>Average CPU</span>
          <strong>{{ averageCpu | number:'1.0-0' }}%</strong>
          <small>Across current asset snapshots</small>
        </article>
      </section>

      <div class="asset-table-card">
        <div class="table-header">
          <div>
            <h3>Your assets</h3>
            <p>Live data is refreshed every 20 seconds for minimal latency.</p>
          </div>
          <div class="status-pill">Last update {{ lastUpdate || 'never' }}</div>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Disk</th>
                <th>Last seen</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let asset of assets" [class.online]="isOnline(asset.last_seen)">
                <td>
                  <strong>{{ asset.hostname }}</strong>
                  <span>{{ asset.owner_email }}</span>
                </td>
                <td><span class="status-badge" [class.online]="asset.status === 'Online'" [class.offline]="asset.status !== 'Online'">{{ asset.status }}</span></td>
                <td>{{ asset.cpu_percent || 0 }}%</td>
                <td>{{ asset.memory_percent || 0 }}%</td>
                <td>{{ asset.disk_percent || 0 }}%</td>
                <td>{{ formatTime(asset.last_seen) }}</td>
                <td>{{ asset.primary_issue || 'No issues' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="empty-state" *ngIf="!loading && assets.length === 0">
          <h4>No assets available</h4>
          <p>There are no assigned assets for your user or the current account has no active telemetry.</p>
        </div>
      </div>

      <div class="toast" *ngIf="errorMessage">{{ errorMessage }}</div>
    </div>
  `,
  styles: [`
    .asset-page { padding: 0 0 24px; }

    .hero-card {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 24px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
      border: 1px solid #e2e8f0;
      border-radius: 22px;
      padding: 24px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
    }

    .eyebrow {
      margin: 0 0 8px;
      font-size: 11px;
      color: #2563eb;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      font-weight: 700;
    }

    h2 {
      margin: 0;
      font-size: clamp(2rem, 2.4vw, 2.6rem);
      line-height: 1.05;
      color: #0f172a;
    }

    .hero-copy {
      margin: 12px 0 0;
      color: #475569;
      max-width: 700px;
      line-height: 1.7;
    }

    .refresh-btn {
      background: linear-gradient(135deg, #2563eb 0%, #0f172a 100%);
      border: none;
      color: white;
      padding: 12px 18px;
      border-radius: 999px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.2s ease;
    }

    .refresh-btn:hover:not(:disabled) {
      transform: translateY(-1px);
    }

    .overview-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
      margin: 24px 0;
    }

    .stat-card {
      background: white;
      border-radius: 20px;
      padding: 22px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
    }

    .stat-card span,
    .stat-card small {
      color: #64748b;
      display: block;
    }

    .stat-card strong {
      margin-top: 10px;
      display: block;
      font-size: 2rem;
      color: #0f172a;
    }

    .accent-blue { border-top: 4px solid #2563eb; }
    .accent-green { border-top: 4px solid #10b981; }
    .accent-orange { border-top: 4px solid #f59e0b; }
    .accent-purple { border-top: 4px solid #8b5cf6; }

    .asset-table-card {
      background: white;
      border-radius: 24px;
      padding: 22px;
      border: 1px solid rgba(226, 232, 240, 0.9);
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }

    .table-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      margin-bottom: 18px;
    }

    .table-header h3 {
      margin: 0;
      font-size: 1.1rem;
      color: #0f172a;
    }

    .table-header p {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 0.92rem;
    }

    .status-pill {
      background: #eef2ff;
      border-radius: 999px;
      padding: 10px 16px;
      color: #3730a3;
      font-weight: 600;
      font-size: 0.9rem;
    }

    .table-scroll {
      overflow-x: auto;
      border-radius: 18px;
    }

    table {
      width: 100%;
      min-width: 860px;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 16px 18px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      color: #1e293b;
      font-size: 0.95rem;
    }

    th {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
      background: #f8fafc;
    }

    tbody tr {
      transition: transform 0.15s ease, background 0.15s ease;
    }

    tbody tr:hover {
      transform: translateY(-1px);
      background: #eff6ff;
    }

    tbody tr.online {
      background: rgba(16, 185, 129, 0.08);
    }

    td strong {
      display: block;
      color: #0f172a;
      margin-bottom: 4px;
    }

    td span {
      display: block;
      color: #64748b;
      font-size: 0.85rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 700;
      font-size: 0.8rem;
      color: #475569;
      background: #f8fafc;
    }

    .status-badge.online {
      background: rgba(16, 185, 129, 0.16);
      color: #047857;
    }

    .status-badge.offline {
      background: rgba(248, 113, 113, 0.14);
      color: #b91c1c;
    }

    .empty-state {
      padding: 48px 0;
      text-align: center;
      color: #64748b;
    }

    .empty-state h4 {
      margin-bottom: 10px;
      color: #0f172a;
      font-size: 1.1rem;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0f172a;
      color: white;
      padding: 14px 18px;
      border-radius: 16px;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.22);
      z-index: 50;
    }

    @media (max-width: 1200px) {
      .overview-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 860px) {
      .hero-card,
      .asset-table-card {
        padding: 18px;
      }

      .overview-grid {
        grid-template-columns: 1fr;
      }

      .table-scroll {
        min-width: 0;
      }
    }

    @media (max-width: 700px) {
      .hero-card {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class AssetMonitoringComponent implements OnInit {
  assets: AssetMonitoringRecord[] = [];
  loading = false;
  lastUpdate = '';
  errorMessage = '';
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private monitoringService: MonitoringService) {}

  ngOnInit(): void {
    this.loadAssets();
  }

  ngOnDestroy(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  refresh(): void {
    this.loadAssets(true);
  }

  private loadAssets(showSpinner = true): void {
    this.loading = showSpinner;
    this.errorMessage = '';

    const userEmail = (sessionStorage.getItem('username') || '').trim();
    this.monitoringService.getAssetsByUser(userEmail).subscribe({
      next: (records) => {
        this.assets = records || [];
        this.loading = false;
        this.lastUpdate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.scheduleRefresh();
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load asset monitoring data right now.';
        this.scheduleRefresh();
      }
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    this.refreshTimeout = setTimeout(() => this.loadAssets(false), 20000);
  }

  get onlineCount(): number {
    return this.assets.filter(asset => this.isOnline(asset.last_seen)).length;
  }

  get issueCount(): number {
    return this.assets.filter(asset => asset.primary_issue && asset.primary_issue !== 'No issues').length;
  }

  get averageCpu(): number {
    if (!this.assets.length) return 0;
    return this.assets.reduce((sum, item) => sum + (item.cpu_percent || 0), 0) / this.assets.length;
  }

  isOnline(value?: string): boolean {
    if (!value) return false;
    return Date.now() - new Date(value).getTime() < 5 * 60 * 1000;
  }

  formatTime(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }
}
