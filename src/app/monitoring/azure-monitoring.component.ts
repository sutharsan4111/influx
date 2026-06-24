import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonitoringService, AzureMetricRecord } from './monitoring.service';

@Component({
  selector: 'app-azure-monitoring',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="azure-page">
      <div class="hero-card">
        <div>
          <p class="eyebrow">Azure Monitoring</p>
          <h2>Near real-time Azure resource telemetry</h2>
          <p class="hero-copy">Live health metrics for Azure subscriptions and resources tied to the current user.
            Data refreshes automatically with minimal latency.</p>
        </div>
        <div class="hero-actions">
          <button class="refresh-btn" (click)="refresh()" [disabled]="loading">
            {{ loading ? 'Refreshing...' : 'Refresh now' }}
          </button>
          <button class="refresh-btn" style="margin-left:12px;background:linear-gradient(135deg,#0f172a 0%,#4f46e5 100%)" (click)="runBackupReport()" [disabled]="reportLoading">
            {{ reportLoading ? 'Running report...' : 'Run Backup Report' }}
          </button>
        </div>
      </div>

      <section class="azure-summary-grid">
        <article class="stat-card accent-cyan">
          <span>Azure resources</span>
          <strong>{{ resources.length }}</strong>
          <small>Monitored for your account</small>
        </article>
        <article class="stat-card accent-teal">
          <span>Healthy</span>
          <strong>{{ healthyCount }}</strong>
          <small>Resource status is nominal</small>
        </article>
        <article class="stat-card accent-amber">
          <span>Alerts</span>
          <strong>{{ alertCount }}</strong>
          <small>Resources needing immediate attention</small>
        </article>
        <article class="stat-card accent-indigo">
          <span>Average CPU</span>
          <strong>{{ averageCpu | number:'1.0-0' }}%</strong>
          <small>Across active Azure-hosted resources</small>
        </article>
      </section>

      <div class="resource-panel">
        <div class="panel-header">
          <div>
            <h3>Resource inventory</h3>
            <p>Live status and performance metrics for Azure VMs, databases, and app services.</p>
          </div>
          <div class="panel-meta">Last update {{ lastUpdate || 'never' }}</div>
        </div>

        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Resource</th>
                <th>Type</th>
                <th>Region</th>
                <th>Status</th>
                <th>CPU</th>
                <th>Memory</th>
                <th>Storage</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let resource of resources" [class.alert]="resource.status !== 'Healthy'">
                <td>
                  <strong>{{ resource.resource_name }}</strong>
                  <span>{{ resource.resource_id }}</span>
                </td>
                <td>{{ resource.resource_type }}</td>
                <td>{{ resource.region }}</td>
                <td><span class="status-badge" [class.healthy]="resource.status === 'Healthy'">{{ resource.status }}</span></td>
                <td>{{ resource.cpu_percent || 0 }}%</td>
                <td>{{ resource.memory_percent || 0 }}%</td>
                <td>{{ resource.storage_gb ? (resource.storage_gb + ' GB') : '—' }}</td>
                <td>{{ formatTime(resource.last_updated) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="empty-state" *ngIf="!loading && resources.length === 0">
          <h4>No Azure resources found</h4>
          <p>There are no Azure resources assigned to this user or no metrics currently available.</p>
        </div>
      </div>

      <div class="report-panel" *ngIf="reportData">
        <h3>Azure Backup Report (parsed)</h3>
        <div *ngFor="let sub of reportData.subscriptions">
          <h4>{{ sub.name }} <small>({{ sub.id }})</small></h4>
          <div *ngFor="let v of sub.vaults" style="margin-left:12px;padding:8px;border-left:2px solid #e6eefc;margin-bottom:8px;">
            <strong>Vault: {{ v.name }}</strong> <small>RG: {{ v.resourceGroup }}</small>
            <div>VM backups processed: {{ v.vmBackupsProcessed }}</div>
            <div>File Share backups processed: {{ v.fileShareBackupsProcessed }}</div>
            <div *ngIf="v.items?.length">Protected items:</div>
            <ul>
              <li *ngFor="let it of v.items">{{ it.item }} — {{ it.details }} ({{ it.recoveryPoints }} RPs) [{{ it.tag }}]</li>
            </ul>
          </div>
        </div>
      </div>

      <div class="toast" *ngIf="errorMessage">{{ errorMessage }}</div>
    </div>
  `,
  styles: [`
    .azure-page { padding: 0 0 24px; }

    .hero-card {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 24px;
      background: linear-gradient(180deg, #ffffff 0%, #eff7ff 100%);
      border: 1px solid #e2e8f0;
      border-radius: 22px;
      padding: 24px;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
    }

    .eyebrow {
      margin: 0 0 8px;
      font-size: 11px;
      color: #0e7490;
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
      background: linear-gradient(135deg, #0e7490 0%, #0f172a 100%);
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

    .azure-summary-grid {
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

    .accent-cyan { border-top: 4px solid #0ea5e9; }
    .accent-teal { border-top: 4px solid #14b8a6; }
    .accent-amber { border-top: 4px solid #f59e0b; }
    .accent-indigo { border-top: 4px solid #6366f1; }

    .resource-panel {
      background: white;
      border-radius: 24px;
      padding: 22px;
      border: 1px solid rgba(226, 232, 240, 0.9);
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08);
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: center;
      margin-bottom: 18px;
      flex-wrap: wrap;
    }

    .panel-header h3 {
      margin: 0;
      font-size: 1.1rem;
      color: #0f172a;
    }

    .panel-header p {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 0.92rem;
    }

    .panel-meta {
      color: #2563eb;
      font-weight: 700;
      font-size: 0.9rem;
    }

    .table-scroll {
      overflow-x: auto;
      border-radius: 18px;
    }

    table {
      width: 100%;
      min-width: 960px;
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

    tbody tr.alert {
      background: rgba(251, 191, 36, 0.1);
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
      background: #f8fafc;
      color: #475569;
    }

    .status-badge.healthy {
      background: rgba(16, 185, 129, 0.16);
      color: #047857;
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
      .azure-summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 860px) {
      .hero-card,
      .resource-panel {
        padding: 18px;
      }

      .cloud-grid,
      .azure-summary-grid {
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
export class AzureMonitoringComponent implements OnInit {
  resources: AzureMetricRecord[] = [];
  loading = false;
  lastUpdate = '';
  errorMessage = '';
  reportLoading = false;
  reportData: any = null;
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private monitoringService: MonitoringService) {}

  ngOnInit(): void {
    this.loadResources();
  }

  ngOnDestroy(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
  }

  refresh(): void {
    this.loadResources(true);
  }

  runBackupReport(): void {
    this.reportLoading = true;
    this.reportData = null;
    this.monitoringService.runBackupReport().subscribe({
      next: () => {
        // fetch parsed log afterwards
        this.monitoringService.getBackupReportLog().subscribe({
          next: (data) => {
            this.reportData = data;
            this.reportLoading = false;
          },
          error: (err) => {
            console.error('Failed to fetch parsed report:', err);
            this.reportLoading = false;
            this.errorMessage = 'Report run completed but failed to retrieve parsed data.';
          }
        });
      },
      error: (err) => {
        console.error('Run report failed:', err);
        this.reportLoading = false;
        this.errorMessage = 'Failed to run backup report.';
      }
    });
  }

  private loadResources(showSpinner = true): void {
    this.loading = showSpinner;
    this.errorMessage = '';

    const userEmail = (sessionStorage.getItem('username') || '').trim();
    this.monitoringService.getAzureResourcesByUser(userEmail).subscribe({
      next: (records) => {
        this.resources = records || [];
        this.loading = false;
        this.lastUpdate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        this.scheduleRefresh();
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load Azure monitoring data right now.';
        this.scheduleRefresh();
      }
    });
  }

  private scheduleRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    this.refreshTimeout = setTimeout(() => this.loadResources(false), 15000);
  }

  get healthyCount(): number {
    return this.resources.filter(resource => resource.status === 'Healthy').length;
  }

  get alertCount(): number {
    return this.resources.filter(resource => resource.status !== 'Healthy').length;
  }

  get averageCpu(): number {
    if (!this.resources.length) return 0;
    return this.resources.reduce((sum, r) => sum + (r.cpu_percent || 0), 0) / this.resources.length;
  }

  formatTime(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }
}
