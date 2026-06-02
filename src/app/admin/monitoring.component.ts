import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';

interface MonitoringDevice {
  device_id: string;
  hostname: string;
  user_name?: string | null;
  user_email?: string | null;
  ip_address?: string | null;
  os_name?: string | null;
  os_version?: string | null;
  os_build?: string | null;
  last_seen?: string | null;
  screen_on?: boolean;
  screen_on_duration?: number;
  active_apps?: string[];
  all_processes?: string[];
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  reported_at?: string | null;
}

interface TelemetrySnapshot extends MonitoringDevice {
  id?: number;
  created_at?: string | null;
}

@Component({
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="monitoring-page">
      <div class="hero">
        <div>
          <p class="eyebrow">Endpoint monitoring</p>
          <h2>Device activity dashboard</h2>
          <p class="subtitle">
            Track screen time, open applications, and device health from the laptops enrolled in Entra and Intune.
          </p>
        </div>

        <button class="refresh-btn" (click)="refresh()" [disabled]="loading">
          <i class="fas fa-sync-alt" [class.spinning]="loading"></i>
          Refresh
        </button>
      </div>

      <div class="summary-grid">
        <article class="summary-card accent-blue">
          <span>Devices</span>
          <strong>{{ devices.length }}</strong>
          <small>{{ onlineCount }} reporting right now</small>
        </article>

        <article class="summary-card accent-green">
          <span>Screen on</span>
          <strong>{{ screenOnCount }}</strong>
          <small>Devices with active screens</small>
        </article>

        <article class="summary-card accent-orange">
          <span>Avg CPU</span>
          <strong>{{ averageCpu | number:'1.0-1' }}%</strong>
          <small>Across latest snapshots</small>
        </article>

        <article class="summary-card accent-purple">
          <span>Avg memory</span>
          <strong>{{ averageMemory | number:'1.0-1' }}%</strong>
          <small>Current working set pressure</small>
        </article>
      </div>

      <section class="content-grid">
        <div class="panel list-panel">
          <div class="panel-header">
            <div>
              <h3>Registered devices</h3>
              <p>Most recent telemetry from each laptop</p>
            </div>
          </div>

          <div class="table-wrap" *ngIf="devices.length; else emptyState">
            <table>
              <thead>
                <tr>
                  <th>Device</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>CPU</th>
                  <th>Memory</th>
                  <th>Screen time</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let device of devices" [class.selected]="selectedDevice?.device_id === device.device_id" (click)="selectDevice(device)">
                  <td>
                    <div class="device-cell">
                      <div class="device-avatar">{{ device.hostname.charAt(0) }}</div>
                      <div>
                        <strong>{{ device.hostname }}</strong>
                        <span>{{ device.ip_address || 'No IP reported' }}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong>{{ device.user_name || 'Unknown' }}</strong>
                    <span>{{ device.user_email || 'No email' }}</span>
                  </td>
                  <td>
                    <span class="status-badge" [class.online]="isOnline(device.last_seen)">
                      {{ isOnline(device.last_seen) ? 'Online' : 'Stale' }}
                    </span>
                  </td>
                  <td>{{ device.cpu_percent || 0 }}%</td>
                  <td>{{ device.memory_percent || 0 }}%</td>
                  <td>{{ formatDuration(device.screen_on_duration || 0) }}</td>
                  <td>{{ formatTime(device.last_seen || device.reported_at) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <ng-template #emptyState>
            <div class="empty-state">
              <h4>No telemetry yet</h4>
              <p>
                When the laptop agent starts posting data, the dashboard will populate automatically.
              </p>
            </div>
          </ng-template>
        </div>

        <aside class="panel detail-panel">
          <div class="panel-header">
            <div>
              <h3>Selected device</h3>
              <p>Live snapshot and recent app usage</p>
            </div>
          </div>

          <ng-container *ngIf="selectedDevice; else pickDevice">
            <div class="device-summary">
              <div class="device-avatar large">{{ selectedDevice.hostname.charAt(0) }}</div>
              <div>
                <h4>{{ selectedDevice.hostname }}</h4>
                <p>{{ selectedDevice.user_name || selectedDevice.user_email || 'No user mapped' }}</p>
              </div>
            </div>

            <div class="stats-row">
              <div>
                <span>CPU</span>
                <strong>{{ selectedDevice.cpu_percent || 0 }}%</strong>
              </div>
              <div>
                <span>Memory</span>
                <strong>{{ selectedDevice.memory_percent || 0 }}%</strong>
              </div>
              <div>
                <span>Disk</span>
                <strong>{{ selectedDevice.disk_percent || 0 }}%</strong>
              </div>
            </div>

            <div class="chips-block">
              <h5>Active apps</h5>
              <div class="chip-list" *ngIf="selectedDevice.active_apps?.length; else noApps">
                <span class="chip" *ngFor="let app of selectedDevice.active_apps">{{ app }}</span>
              </div>
              <ng-template #noApps>
                <p class="muted">No active applications captured in the latest snapshot.</p>
              </ng-template>
            </div>

            <div class="history-block">
              <h5>Recent snapshots</h5>
              <div class="history-item" *ngFor="let snap of deviceHistory">
                <div>
                  <strong>{{ formatTime(snap.reported_at || snap.created_at) }}</strong>
                  <span>{{ snap.screen_on ? 'Screen on' : 'Screen off' }} · {{ formatDuration(snap.screen_on_duration || 0) }}</span>
                </div>
                <small>{{ snap.cpu_percent || 0 }}% CPU / {{ snap.memory_percent || 0 }}% MEM</small>
              </div>
              <p class="muted" *ngIf="deviceHistory.length === 0 && historyLoaded">
                No history yet for this device.
              </p>
            </div>
          </ng-container>

          <ng-template #pickDevice>
            <div class="empty-detail">
              <h4>Select a device</h4>
              <p>Click any row on the left to inspect the most recent snapshot and history.</p>
            </div>
          </ng-template>
        </aside>
      </section>

      <div class="toast" *ngIf="errorMessage">{{ errorMessage }}</div>
    </div>
  `,
  styles: [`
    .monitoring-page {
      padding: 24px;
      max-width: 1600px;
      margin: 0 auto;
      color: #0f172a;
    }

    .hero {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }

    .eyebrow {
      margin: 0 0 6px 0;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 11px;
      font-weight: 700;
      color: #2563eb;
    }

    h2 {
      margin: 0;
      font-size: 30px;
      line-height: 1.1;
    }

    .subtitle {
      max-width: 760px;
      margin: 8px 0 0;
      color: #64748b;
      line-height: 1.6;
    }

    .refresh-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 0;
      border-radius: 999px;
      padding: 11px 16px;
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 100%);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18);
    }

    .refresh-btn:disabled {
      opacity: 0.7;
      cursor: progress;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
    }

    .summary-card {
      background: #fff;
      border-radius: 18px;
      padding: 16px 18px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
    }

    .summary-card span,
    .summary-card small {
      display: block;
      color: #64748b;
    }

    .summary-card strong {
      display: block;
      margin: 8px 0 4px;
      font-size: 32px;
      line-height: 1;
      color: #0f172a;
    }

    .accent-blue { border-top: 4px solid #2563eb; }
    .accent-green { border-top: 4px solid #10b981; }
    .accent-orange { border-top: 4px solid #f59e0b; }
    .accent-purple { border-top: 4px solid #8b5cf6; }

    .content-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.75fr) minmax(320px, 0.95fr);
      gap: 16px;
      align-items: start;
    }

    .panel {
      background: rgba(255, 255, 255, 0.88);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 22px;
      box-shadow: 0 16px 44px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }

    .panel-header {
      padding: 18px 20px 10px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }

    .panel-header h3,
    .panel-header p,
    .device-summary h4,
    .device-summary p,
    .empty-state h4,
    .empty-state p,
    .empty-detail h4,
    .empty-detail p,
    .history-item strong,
    .history-item span,
    .history-item small,
    .chips-block h5,
    .history-block h5 {
      margin: 0;
    }

    .panel-header h3 {
      font-size: 18px;
      color: #0f172a;
    }

    .panel-header p {
      margin-top: 4px;
      color: #64748b;
      font-size: 13px;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th,
    td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.9);
      text-align: left;
      vertical-align: middle;
      font-size: 14px;
    }

    th {
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: #f8fafc;
    }

    tbody tr {
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease;
    }

    tbody tr:hover,
    tbody tr.selected {
      background: #eff6ff;
    }

    .device-cell,
    .device-summary {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .device-cell strong,
    td strong {
      display: block;
      color: #0f172a;
      font-weight: 700;
    }

    .device-cell span,
    td span,
    .history-item span,
    .muted {
      display: block;
      color: #64748b;
      font-size: 12px;
      margin-top: 2px;
    }

    .device-avatar {
      width: 40px;
      height: 40px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, #2563eb, #0f172a);
      color: #fff;
      font-weight: 800;
      flex-shrink: 0;
    }

    .device-avatar.large {
      width: 56px;
      height: 56px;
      border-radius: 18px;
      font-size: 20px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 6px 10px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      font-size: 12px;
      font-weight: 700;
    }

    .status-badge.online {
      background: rgba(16, 185, 129, 0.12);
      color: #047857;
    }

    .detail-panel {
      padding-bottom: 18px;
    }

    .device-summary {
      padding: 18px 20px 0;
    }

    .device-summary h4 {
      font-size: 18px;
      color: #0f172a;
    }

    .device-summary p {
      color: #64748b;
      margin-top: 4px;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      padding: 16px 20px 0;
    }

    .stats-row div {
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 16px;
      padding: 12px;
    }

    .stats-row span,
    .stats-row strong {
      display: block;
    }

    .stats-row span {
      color: #64748b;
      font-size: 12px;
      margin-bottom: 6px;
    }

    .stats-row strong {
      font-size: 20px;
      color: #0f172a;
    }

    .chips-block,
    .history-block {
      padding: 18px 20px 0;
    }

    .chips-block h5,
    .history-block h5 {
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
      margin-bottom: 10px;
    }

    .chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      padding: 7px 10px;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 12px;
      font-weight: 600;
    }

    .history-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid rgba(226, 232, 240, 0.9);
    }

    .history-item:last-child {
      border-bottom: 0;
    }

    .empty-state,
    .empty-detail {
      padding: 28px 20px;
      text-align: center;
      color: #64748b;
    }

    .empty-state h4,
    .empty-detail h4 {
      color: #0f172a;
      margin-bottom: 6px;
    }

    .toast {
      position: fixed;
      right: 24px;
      bottom: 24px;
      background: #0f172a;
      color: #fff;
      padding: 12px 16px;
      border-radius: 14px;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.22);
      max-width: min(420px, calc(100vw - 48px));
      z-index: 50;
    }

    :host-context(.dark-theme) .monitoring-page {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .subtitle,
    :host-context(.dark-theme) .summary-card span,
    :host-context(.dark-theme) .summary-card small,
    :host-context(.dark-theme) .panel-header p,
    :host-context(.dark-theme) .device-cell span,
    :host-context(.dark-theme) td span,
    :host-context(.dark-theme) .history-item span,
    :host-context(.dark-theme) .muted,
    :host-context(.dark-theme) .device-summary p {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .summary-card,
    :host-context(.dark-theme) .panel,
    :host-context(.dark-theme) .stats-row div {
      background: rgba(15, 23, 42, 0.88);
      border-color: rgba(51, 65, 85, 0.9);
    }

    :host-context(.dark-theme) .summary-card strong,
    :host-context(.dark-theme) .panel-header h3,
    :host-context(.dark-theme) .device-summary h4,
    :host-context(.dark-theme) .empty-state h4,
    :host-context(.dark-theme) .empty-detail h4,
    :host-context(.dark-theme) .device-cell strong,
    :host-context(.dark-theme) td strong,
    :host-context(.dark-theme) .stats-row strong {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) th {
      background: #0b1220;
      color: #cbd5e1;
    }

    :host-context(.dark-theme) th,
    :host-context(.dark-theme) td,
    :host-context(.dark-theme) .history-item {
      border-bottom-color: rgba(51, 65, 85, 0.9);
    }

    :host-context(.dark-theme) tbody tr:hover,
    :host-context(.dark-theme) tbody tr.selected {
      background: rgba(37, 99, 235, 0.16);
    }

    :host-context(.dark-theme) .status-badge {
      background: rgba(51, 65, 85, 0.95);
      color: #cbd5e1;
    }

    :host-context(.dark-theme) .status-badge.online {
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
    }

    :host-context(.dark-theme) .chip {
      background: rgba(37, 99, 235, 0.2);
      color: #93c5fd;
    }

    @media (max-width: 1200px) {
      .summary-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .content-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 700px) {
      .monitoring-page {
        padding: 16px;
      }

      .hero {
        flex-direction: column;
      }

      .summary-grid {
        grid-template-columns: 1fr;
      }

      h2 {
        font-size: 24px;
      }

      .stats-row {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class MonitoringComponent implements OnInit, OnDestroy {
  devices: MonitoringDevice[] = [];
  deviceHistory: TelemetrySnapshot[] = [];
  selectedDevice: MonitoringDevice | null = null;
  loading = false;
  historyLoaded = false;
  errorMessage = '';
  private refreshHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    this.refresh();
    this.refreshHandle = setInterval(() => this.loadDevices(false), 30000);
  }

  ngOnDestroy(): void {
    if (this.refreshHandle) {
      clearInterval(this.refreshHandle);
    }
  }

  refresh(): void {
    this.loadDevices(true);
  }

  loadDevices(showSpinner: boolean): void {
    this.loading = showSpinner;
    this.errorMessage = '';

    this.http.get<MonitoringDevice[]>('/api/monitoring/devices').subscribe({
      next: (devices) => {
        this.devices = devices || [];
        this.loading = false;

        if (!this.selectedDevice && this.devices.length > 0) {
          this.selectDevice(this.devices[0]);
        } else if (this.selectedDevice) {
          const refreshed = this.devices.find(device => device.device_id === this.selectedDevice?.device_id);
          if (refreshed) {
            this.selectedDevice = refreshed;
          }
        }
      },
      error: () => {
        this.loading = false;
        this.errorMessage = 'Unable to load monitoring data right now.';
      }
    });
  }

  selectDevice(device: MonitoringDevice): void {
    this.selectedDevice = device;
    this.deviceHistory = [];
    this.historyLoaded = false;

    this.http.get<TelemetrySnapshot[]>(`/api/monitoring/devices/${encodeURIComponent(device.device_id)}/history`).subscribe({
      next: (history) => {
        this.deviceHistory = history || [];
        this.historyLoaded = true;
      },
      error: () => {
        this.deviceHistory = [];
        this.historyLoaded = true;
      }
    });
  }

  get onlineCount(): number {
    return this.devices.filter(device => this.isOnline(device.last_seen)).length;
  }

  get screenOnCount(): number {
    return this.devices.filter(device => Boolean(device.screen_on)).length;
  }

  get averageCpu(): number {
    if (!this.devices.length) return 0;
    return this.devices.reduce((sum, device) => sum + (Number(device.cpu_percent) || 0), 0) / this.devices.length;
  }

  get averageMemory(): number {
    if (!this.devices.length) return 0;
    return this.devices.reduce((sum, device) => sum + (Number(device.memory_percent) || 0), 0) / this.devices.length;
  }

  isOnline(lastSeen?: string | null): boolean {
    if (!lastSeen) {
      return false;
    }

    const diff = Date.now() - new Date(lastSeen).getTime();
    return Number.isFinite(diff) && diff < 5 * 60 * 1000;
  }

  formatTime(value?: string | null): string {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  }

  formatDuration(seconds: number): string {
    const safeSeconds = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);

    if (hours === 0 && minutes === 0) {
      return '< 1 min';
    }

    return `${hours}h ${minutes}m`;
  }
}