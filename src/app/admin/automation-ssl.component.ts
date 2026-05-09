import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import {
  AutomationSslEntry,
  AutomationSslMonitoredUrl,
  AutomationSslService
} from '../services/automation-ssl.service';
import { MessageService } from '../services/message.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="automation-ssl-page">
      <div class="page-header-row">
        <h2>Automation SSL</h2>
        <div class="header-actions">
          <select [(ngModel)]="viewMode" (change)="onViewModeChanged()">
            <option value="monitored">All Monitored URLs</option>
            <option value="tickets">Ticket History</option>
          </select>

          <select *ngIf="viewMode === 'tickets'" [(ngModel)]="selectedStatus" (change)="loadEntries(true)">
            <option value="open">Open</option>
            <option value="pending">Pending</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>

          <button class="btn-refresh" (click)="refreshCurrentView()" [disabled]="isLoading">
            <i class="fas fa-sync" [class.spinning]="isLoading"></i>
            {{ isLoading ? 'Loading...' : 'Refresh' }}
          </button>
        </div>
      </div>

      <p class="page-description" *ngIf="viewMode === 'monitored'">
        Live view of all monitored URLs and their current SSL expiry.
      </p>
      <p class="page-description" *ngIf="viewMode === 'tickets'">
        Historical automation SSL tickets created from milestone alerts.
      </p>

      <div class="table-card" *ngIf="viewMode === 'monitored'">
        <table>
          <thead>
            <tr>
              <th>SNO</th>
              <th>Client</th>
              <th>Environment</th>
              <th>Application</th>
              <th>URL</th>
              <th>Responsible</th>
              <th>Hostname</th>
              <th>IP Address</th>
              <th>Version</th>
              <th>SSL Expiry</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of monitoredUrls; let i = index">
              <td>{{ i + 1 }}</td>
              <td>{{ item.client || '-' }}</td>
              <td>{{ item.environment || '-' }}</td>
              <td>{{ item.application || '-' }}</td>
              <td>
                <a *ngIf="item.ssl_url" [href]="item.ssl_url" target="_blank" rel="noopener noreferrer">
                  {{ item.ssl_url }}
                </a>
                <span *ngIf="!item.ssl_url">-</span>
              </td>
              <td>{{ item.responsible_email || item.responsible || '-' }}</td>
              <td>{{ item.hostname || '-' }}</td>
              <td>{{ item.ip_address || '-' }}</td>
              <td>{{ item.version || '-' }}</td>
              <td>
                {{ item.estimated_expiry_on ? (item.estimated_expiry_on | date:'yyyy-MM-dd') : '-' }}
                <span class="badge" [ngClass]="expiryClass(item.estimated_days_to_expiry)">
                  {{ expiryLabel(item.estimated_days_to_expiry) }}
                </span>
              </td>
            </tr>
            <tr *ngIf="monitoredUrls.length === 0">
              <td colspan="10" class="empty">No monitored URL data found.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="table-card" *ngIf="viewMode === 'tickets'">
        <table>
          <thead>
            <tr>
              <th>SNO</th>
              <th>Client</th>
              <th>Environment</th>
              <th>Application</th>
              <th>URL</th>
              <th>Responsible</th>
              <th>Milestone</th>
              <th>Estimated Expiry</th>
              <th>Status</th>
              <th>Ticket</th>
              <th>Alert Created</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of entries; let i = index">
              <td>{{ i + 1 }}</td>
              <td>{{ item.client || '-' }}</td>
              <td>{{ item.environment || '-' }}</td>
              <td>{{ item.application || '-' }}</td>
              <td>
                <a *ngIf="item.ssl_url" [href]="item.ssl_url" target="_blank" rel="noopener noreferrer">
                  {{ item.ssl_url }}
                </a>
                <span *ngIf="!item.ssl_url">-</span>
              </td>
              <td>{{ item.responsible_email || item.responsible || '-' }}</td>
              <td>{{ item.milestone_days }} day(s)</td>
              <td>
                {{ item.estimated_expiry_on ? (item.estimated_expiry_on | date:'yyyy-MM-dd') : '-' }}
                <span class="badge" [ngClass]="expiryClass(item.estimated_days_to_expiry)">
                  {{ expiryLabel(item.estimated_days_to_expiry) }}
                </span>
              </td>
              <td>
                <span class="status" [ngClass]="statusClass(item.status)">{{ item.status || '-' }}</span>
              </td>
              <td>{{ item.zoho_ticket_number || item.zoho_ticket_id || '-' }}</td>
              <td>{{ item.created_at | date:'yyyy-MM-dd HH:mm' }}</td>
            </tr>
            <tr *ngIf="entries.length === 0">
              <td colspan="11" class="empty">No automation SSL ticket records found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .automation-ssl-page {
      padding: 22px;
      max-width: 1400px;
      margin: 0 auto;
    }

    .page-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      gap: 10px;
      flex-wrap: wrap;
    }

    .page-header-row h2 {
      margin: 0;
      color: #1f2937;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .page-description {
      margin: -4px 0 14px;
      color: #64748b;
      font-size: 13px;
    }

    .header-actions select {
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 6px 10px;
      background: #fff;
      color: #1f2937;
      font-size: 13px;
    }

    .btn-refresh {
      border: 1px solid #dbeafe;
      color: #1d4ed8;
      background: #eff6ff;
      border-radius: 8px;
      padding: 7px 12px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }

    .btn-refresh:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .spinning {
      animation: spin 0.9s linear infinite;
    }

    .table-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      overflow: auto;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1100px;
    }

    th,
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #eef2f7;
      text-align: left;
      vertical-align: middle;
      font-size: 13px;
      color: #334155;
    }

    th {
      background: #f8fafc;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
    }

    td a {
      color: #2563eb;
      text-decoration: none;
      word-break: break-all;
    }

    td a:hover {
      text-decoration: underline;
    }

    .status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .status-open {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .status-pending {
      background: #fef3c7;
      color: #92400e;
    }

    .status-closed,
    .status-superseded {
      background: #e5e7eb;
      color: #374151;
    }

    .status-default {
      background: #e2e8f0;
      color: #334155;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 700;
      margin-left: 6px;
      white-space: nowrap;
    }

    .badge-ok {
      background: #dcfce7;
      color: #166534;
    }

    .badge-warn {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-danger {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-expired {
      background: #e5e7eb;
      color: #1f2937;
    }

    .empty {
      text-align: center;
      color: #64748b;
      padding: 16px;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    :host-context(.dark-theme) .automation-ssl-page h2 {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .table-card {
      background: #0f172a;
      border-color: #334155;
    }

    :host-context(.dark-theme) th {
      background: #1e293b;
      color: #e2e8f0;
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) td {
      color: #cbd5e1;
      border-bottom-color: #1e293b;
    }

    :host-context(.dark-theme) .header-actions select {
      background: #0f172a;
      color: #e2e8f0;
      border-color: #334155;
    }

    :host-context(.dark-theme) .btn-refresh {
      background: #1e3a8a;
      border-color: #1d4ed8;
      color: #dbeafe;
    }
  `]
})
export class AutomationSslComponent implements OnInit {
  entries: AutomationSslEntry[] = [];
  monitoredUrls: AutomationSslMonitoredUrl[] = [];
  viewMode: 'monitored' | 'tickets' = 'monitored';
  selectedStatus = 'open';
  isLoading = false;

  constructor(
    private automationSslService: AutomationSslService,
    private messageService: MessageService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.loadMonitoredUrls(false);
  }

  async onViewModeChanged(): Promise<void> {
    if (this.viewMode === 'monitored') {
      await this.loadMonitoredUrls(false);
      return;
    }
    await this.loadEntries(false);
  }

  async refreshCurrentView(): Promise<void> {
    if (this.viewMode === 'monitored') {
      await this.loadMonitoredUrls(true);
      return;
    }
    await this.loadEntries(true);
  }

  async loadMonitoredUrls(forceRefresh: boolean): Promise<void> {
    this.isLoading = true;
    try {
      this.monitoredUrls = await firstValueFrom(
        this.automationSslService.getMonitoredUrls(forceRefresh)
      );
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to load monitored automation SSL URLs');
    } finally {
      this.isLoading = false;
    }
  }

  async loadEntries(forceRefresh: boolean): Promise<void> {
    this.isLoading = true;
    try {
      this.entries = await firstValueFrom(
        this.automationSslService.getEntries(this.selectedStatus, forceRefresh)
      );
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to load automation SSL records');
    } finally {
      this.isLoading = false;
    }
  }

  statusClass(status: string): string {
    const normalized = (status || '').toLowerCase();
    if (normalized === 'open') return 'status-open';
    if (normalized === 'pending') return 'status-pending';
    if (normalized === 'closed') return 'status-closed';
    if (normalized === 'superseded') return 'status-superseded';
    return 'status-default';
  }

  expiryClass(days: number | undefined): string {
    if (days === undefined || days === null) return 'badge-expired';
    if (days < 0) return 'badge-expired';
    if (days <= 1) return 'badge-danger';
    if (days <= 7) return 'badge-warn';
    return 'badge-ok';
  }

  expiryLabel(days: number | undefined): string {
    if (days === undefined || days === null) return 'Unknown';
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    if (days === 0) return 'Expires today';
    return `${days}d left`;
  }
}
