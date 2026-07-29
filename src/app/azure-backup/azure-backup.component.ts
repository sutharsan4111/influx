import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MsalService } from '../services/msal.service';
import { AzureBackupService, BackupReport, BackupItem, SubscriptionGroup } from './azure-backup.service';

@Component({
  selector: 'app-azure-backup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="azure-backup-page">
      <div class="page-header">
        <div class="header-left">             
          <div class="brand-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div>
            <h1>Azure Backup</h1>
            <p class="header-subtitle">Azure File Shares & Virtual Machines backup status</p>
          </div>
        </div>
        <div class="header-right">
          <div class="live-indicator" [class.active]="!!lastUpdate">
            <span class="live-dot"></span>
            <span>{{ lastUpdate ? 'Updated ' + lastUpdate : 'Not loaded' }}</span>
          </div>
          <button class="btn-refresh" (click)="refreshReport()" [disabled]="loading" title="Refresh live report from Azure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            {{ loading ? 'Collecting...' : 'Refresh Live' }}
          </button>
        </div>
      </div>

      <div *ngIf="reportError" class="error-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        {{ reportError }}
        <button class="error-close" (click)="reportError = ''">&times;</button>
      </div>

      <div *ngIf="loading && !reportData" class="loading-state">
        <div class="spinner"></div>
        Connecting to Azure and collecting backup data...
      </div>

      <div *ngIf="reportData">
        <div class="summary-row">
          <div class="summary-pill">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            <strong>{{ reportData.totalRecords }}</strong> total items
          </div>
          <div class="summary-pill">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            <strong>{{ reportData.totalVms }}</strong> VMs
          </div>
          <div class="summary-pill">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <strong>{{ reportData.totalFileShares }}</strong> File Shares
          </div>
          <div class="summary-pill green">
            <span class="pill-dot green"></span>
            <strong>{{ reportData.healthy }}</strong> healthy
          </div>
          <div class="summary-pill amber" *ngIf="reportData.warning">
            <span class="pill-dot amber"></span>
            <strong>{{ reportData.warning }}</strong> warning
          </div>
          <div class="summary-pill red" *ngIf="reportData.failed">
            <span class="pill-dot red"></span>
            <strong>{{ reportData.failed }}</strong> failed
          </div>
        </div>

        <div class="filter-bar">
          <select class="filter-select" [(ngModel)]="selectedSubscription" (change)="applyFilters()">
            <option value="">All Subscriptions</option>
            <option *ngFor="let sub of subscriptionNames" [value]="sub">{{ sub }}</option>
          </select>
          
          <div class="consistency-filters">
            <div class="consistency-filter" [class.active]="consistencyFilter === 'Application Consistent'">
              <select class="filter-select consistency-select" [(ngModel)]="consistencyFilter" (change)="applyFilters()">
                <option value="">All Consistency Types</option>
                <option value="Crash Consistent">Crash Consistent</option>
                <option value="File-System Consistent">File-System Consistent</option>
                <option value="Application Consistent">Application Consistent</option>
              </select>
            </div>
          </div>
          
          <span class="filter-count">{{ filteredFileShares.length }} file shares, {{ filteredVMs.length }} VMs</span>
        </div>

        <div class="vm-consistency-block" *ngIf="reportData?.consistencyDetails">
          <span class="block-label">VM Consistency</span>
          <div class="consistency-toggle-row">
            <div class="consistency-toggle application"
                 [class.active]="consistencyFilter === 'Application Consistent'"
                 (click)="setConsistencyFilter('Application Consistent')"
                 title="Application Consistent">
              <span class="toggle-label">Application Consistent</span>
              <span class="toggle-count">{{ reportData.consistencyDetails.application.count || 0 }}</span>
            </div>

            <div class="consistency-toggle crash"
                 [class.active]="consistencyFilter === 'Crash Consistent'"
                 (click)="setConsistencyFilter('Crash Consistent')"
                 title="Crash Consistent">
              <span class="toggle-label">Crash Consistent</span>
              <span class="toggle-count">{{ reportData.consistencyDetails.crash.count || 0 }}</span>
            </div>

            <div class="consistency-toggle filesystem"
                 [class.active]="consistencyFilter === 'File-System Consistent'"
                 (click)="setConsistencyFilter('File-System Consistent')"
                 title="File-System Consistent">
              <span class="toggle-label">File-System Consistent</span>
              <span class="toggle-count">{{ reportData.consistencyDetails.filesystem.count || 0 }}</span>
            </div>
          </div>
        </div>

        <div class="subscription-health-block" *ngIf="reportData?.subscriptions?.length">
          <span class="block-label">Subscription Health</span>
          <div class="subscription-health-row">
            <div class="subscription-card" *ngFor="let sub of reportData.subscriptions">
              <div class="ring-wrap">
                <svg class="ring" width="52" height="52" viewBox="0 0 52 52">
                  <circle class="ring-track" cx="26" cy="26" r="22"></circle>
                  <circle class="ring-value" [class.warn]="healthPercent(sub) < 100 && healthPercent(sub) >= 80" [class.fail]="healthPercent(sub) < 80"
                          cx="26" cy="26" r="22"
                          [attr.stroke-dasharray]="138.2"
                          [attr.stroke-dashoffset]="ringOffset(sub)"></circle>
                </svg>
                <span class="ring-text">{{ healthPercent(sub) }}%</span>
              </div>
              <div class="subscription-info">
                <div class="subscription-name">
                  <span class="status-dot-inline" [class.warn]="sub.warning > 0" [class.fail]="sub.failed > 0"></span>
                  {{ sub.name }}
                </div>
                <div class="subscription-counts">
                  <span class="ok">{{ sub.healthy }} ok</span>
                  <span *ngIf="sub.warning" class="warn">{{ sub.warning }} warn</span>
                  <span *ngIf="sub.failed" class="fail">{{ sub.failed }} fail</span>
                </div>
                <div class="subscription-pills">
                  <span class="mini-pill">{{ sub.vmCount }} VMs</span>
                  <span class="mini-pill">{{ sub.fileShareCount }} File Shares</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <section class="resource-section" *ngIf="filteredFileShares.length > 0">
          <div class="section-header">
            <div class="section-icon file-share">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div class="section-title">
              <h2>Azure File Shares (Azure Storage)</h2>
              <span class="section-count">{{ filteredFileShares.length }} file share(s)</span>
            </div>
          </div>

          <div class="table-scroll">
            <table class="resource-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Subscription</th>
                  <th>Recovery Type</th>
                  <th>Creation Time</th>
                  <th>Last Backup Status</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of filteredFileShares" [class.row-warn]="item.status === 'Warning'" [class.row-fail]="item.status === 'Failed'">
                  <td class="cell-name">
                    <strong>{{ displayResourceName(item) }}</strong>
                    <span class="cell-sub">{{ displayResourceDetail(item) }}</span>
                  </td>
                  <td class="cell-sub-strong">{{ item.subscription }}</td>
                  <td>
                    <span class="recovery-badge">{{ formatRecoveryType(item) }}</span>
                  </td>
                  <td class="cell-time">{{ formatTime(item.latestRecoveryPoint) }}</td>
                  <td>
                    <span class="status-badge" [class.healthy]="item.lastBackupStatus === 'Completed'" [class.warning]="item.lastBackupStatus === 'Warning'" [class.failed]="item.lastBackupStatus === 'Failed'">
                      <span class="status-dot"></span>
                      {{ item.lastBackupStatus || 'N/A' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>


        <section class="resource-section" *ngIf="filteredVMs.length > 0">
          <div class="section-header">
            <div class="section-icon vm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            </div>
            <div class="section-title">
              <h2>Azure Virtual Machines</h2>
              <span class="section-count">{{ filteredVMs.length }} VM(s)</span>
            </div>
          </div>

          <div class="table-scroll">
            <table class="resource-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Resource Group</th>
                  <th>Last Backup Status</th>
                  <th>Consistency</th>
                  <th>Recovery Type</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of filteredVMs" [class.row-warn]="item.status === 'Warning'" [class.row-fail]="item.status === 'Failed'">
                  <td class="cell-name">
                    <strong>{{ displayResourceName(item) }}</strong>
                    <span class="cell-sub">{{ item.vault }}</span>
                  </td>
                  <td class="cell-sub-strong">{{ item.resourceGroup }}</td>
                  <td>
                    <span class="status-badge" [class.healthy]="item.lastBackupStatus === 'Completed'" [class.warning]="item.lastBackupStatus === 'Warning'" [class.failed]="item.lastBackupStatus === 'Failed'">
                      <span class="status-dot"></span>
                      {{ item.lastBackupStatus || 'N/A' }}
                    </span>
                  </td>
                  <td>
                    <span class="consistency-badge" [class]="consistencyClass(item.consistency)">
                      {{ formatConsistency(item) }}
                    </span>
                  </td>
                  <td>
                    <span class="recovery-badge">{{ formatRecoveryType(item) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>


        <div *ngIf="filteredFileShares.length === 0 && filteredVMs.length === 0 && !loading" class="empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <h4>No backup items found</h4>
          <p>Try refreshing the report or changing the filter.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .azure-backup-page { padding: 0 0 24px; }

    .page-header {
      display: flex; justify-content: space-between; align-items: center; gap: 20px;
      background: white; border: 1px solid #e2e8f0; border-radius: 16px;
      padding: 20px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .brand-icon {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, #0ea5e9, #0284c7);
      color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    h1 { margin: 0; font-size: 1.35rem; font-weight: 700; color: #0f172a; }
    .header-subtitle { margin: 2px 0 0; font-size: 0.85rem; color: #64748b; }
    .header-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }

    .live-indicator {
      display: flex; align-items: center; gap: 7px; font-size: 0.78rem; font-weight: 600;
      color: #94a3b8; background: #f8fafc; padding: 8px 14px; border-radius: 8px;
    }
    .live-indicator.active { color: #059669; background: #ecfdf5; }
    .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; }
    .live-indicator.active .live-dot { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.2); animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(16,185,129,0.2); } 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0.08); } }

    .btn-refresh {
      display: inline-flex; align-items: center; gap: 7px; background: #0f172a; color: white;
      border: none; padding: 10px 18px; border-radius: 10px; font-weight: 600;
      font-size: 0.85rem; cursor: pointer; transition: all 0.2s ease;
    }
    .btn-refresh:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.15); }
    .btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

    .error-banner {
      margin-top: 16px; padding: 12px 18px; border-radius: 10px;
      background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;
      font-weight: 500; font-size: 0.88rem; display: flex; align-items: center; gap: 10px;
    }
    .error-close { margin-left: auto; background: none; border: none; color: #dc2626; font-size: 1.2rem; cursor: pointer; padding: 0 4px; }

    .loading-state { margin-top: 40px; text-align: center; color: #64748b; font-size: 0.95rem; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .spinner { width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .summary-row { display: flex; align-items: center; gap: 12px; margin: 20px 0 16px; flex-wrap: wrap; }
    .summary-pill { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: white; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.82rem; color: #475569; font-weight: 500; }
    .summary-pill strong { font-weight: 700; color: #0f172a; font-size: 0.9rem; }
    .pill-dot { width: 7px; height: 7px; border-radius: 50%; }
    .pill-dot.green { background: #16a34a; }
    .pill-dot.amber { background: #d97706; }
    .pill-dot.red { background: #dc2626; }

    .filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .filter-select { padding: 8px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 0.85rem; background: white; color: #334155; cursor: pointer; outline: none; }
    .filter-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
    .filter-count { font-size: 0.82rem; color: #94a3b8; font-weight: 500; margin-left: auto; }

    .consistency-filters { display: flex; gap: 8px; margin-left: 12px; }
    .consistency-select { width: 200px; }

    .block-label { display: block; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 700; margin-bottom: 8px; }

    .vm-consistency-block { margin: 16px 0; }
    .consistency-toggle-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .consistency-toggle {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 16px; border-radius: 10px; font-size: 0.85rem; font-weight: 600;
      cursor: pointer; border: 1.5px solid #e2e8f0; background: white; color: #475569;
      transition: all 0.15s ease;
    }
    .consistency-toggle:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .consistency-toggle.crash { color: #dc2626; }
    .consistency-toggle.filesystem { color: #d97706; }
    .consistency-toggle.application { color: #059669; }
    .consistency-toggle.active { border-color: currentColor; box-shadow: 0 0 0 3px rgba(37,99,235,0.08); background: rgba(37,99,235,0.03); }
    .toggle-count { background: rgba(0,0,0,0.06); padding: 1px 9px; border-radius: 12px; font-size: 0.75rem; font-weight: 700; }

    .subscription-health-block { margin: 16px 0; }
    .subscription-health-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .subscription-card {
      display: flex; align-items: center; gap: 14px; padding: 14px 18px;
      background: white; border: 1px solid #e2e8f0; border-radius: 12px; min-width: 240px; flex: 1 1 240px;
    }
    .ring-wrap { position: relative; width: 52px; height: 52px; flex-shrink: 0; }
    .ring { transform: rotate(-90deg); }
    .ring-track { fill: none; stroke: #f1f5f9; stroke-width: 5; }
    .ring-value { fill: none; stroke: #16a34a; stroke-width: 5; stroke-linecap: round; stroke-dasharray: 138.2; transition: stroke-dashoffset 0.4s ease; }
    .ring-value.warn { stroke: #d97706; }
    .ring-value.fail { stroke: #dc2626; }
    .ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700; color: #0f172a; }
    .subscription-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .subscription-name { font-weight: 700; color: #0f172a; font-size: 0.9rem; display: flex; align-items: center; gap: 7px; }
    .status-dot-inline { width: 8px; height: 8px; border-radius: 50%; background: #16a34a; flex-shrink: 0; }
    .status-dot-inline.warn { background: #d97706; }
    .status-dot-inline.fail { background: #dc2626; }
    .subscription-counts { display: flex; gap: 10px; font-size: 0.76rem; font-weight: 600; }
    .subscription-counts .ok { color: #16a34a; }
    .subscription-counts .warn { color: #d97706; }
    .subscription-counts .fail { color: #dc2626; }
    .subscription-pills { display: flex; gap: 6px; margin-top: 2px; }
    .mini-pill { font-size: 0.68rem; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 9px; border-radius: 20px; }

    .resource-section { margin-bottom: 32px; }
    .section-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding: 16px 20px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .section-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
    .section-icon.file-share { background: linear-gradient(135deg, #06b6d4, #0891b2); }
    .section-icon.vm { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
    .section-title { display: flex; flex-direction: column; gap: 2px; }
    .section-title h2 { margin: 0; font-size: 1.05rem; font-weight: 700; color: #0f172a; }
    .section-count { font-size: 0.78rem; color: #94a3b8; font-weight: 500; }

    .table-scroll { overflow-x: auto; }
    .resource-table { width: 100%; min-width: 780px; border-collapse: collapse; }
    .resource-table th, .resource-table td { padding: 12px 16px; text-align: left; font-size: 0.85rem; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .resource-table th { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; background: #fafbfc; font-weight: 700; }
    .resource-table tbody tr { transition: background 0.15s ease; }
    .resource-table tbody tr:hover { background: #f8faff; }
    .resource-table tbody tr.row-warn { border-left: 3px solid #f59e0b; }
    .resource-table tbody tr.row-fail { border-left: 3px solid #ef4444; }

    .cell-name strong { display: block; color: #0f172a; font-weight: 600; }
    .cell-sub { display: block; font-size: 0.72rem; color: #94a3b8; }
    .cell-time { font-size: 0.82rem; color: #64748b; white-space: nowrap; }
    .cell-sub-strong { font-size: 0.85rem; color: #475569; font-weight: 500; }


    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 0.78rem; font-weight: 600; }
    .status-badge.healthy { background: #ecfdf5; color: #059669; }
    .status-badge.warning { background: #fffbeb; color: #d97706; }
    .status-badge.failed { background: #fef2f2; color: #dc2626; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    .recovery-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; background: #f1f5f9; color: #475569; }

    .consistency-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
    .consistency-badge.app-consistent { background: #ecfdf5; color: #059669; }
    .consistency-badge.crash-consistent { background: #fef2f2; color: #dc2626; }
    .consistency-badge.fs-consistent { background: #fffbeb; color: #d97706; }
    .consistency-badge.unknown { background: #f8fafc; color: #94a3b8; }

    .empty-state { padding: 60px 20px; text-align: center; color: #94a3b8; }
    .empty-state svg { margin-bottom: 16px; }
    .empty-state h4 { margin: 0 0 8px; color: #475569; font-size: 1.05rem; font-weight: 600; }
    .empty-state p { font-size: 0.88rem; max-width: 400px; margin: 0 auto; line-height: 1.6; }

    :host-context(.dark-theme) .page-header { background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155; }
    :host-context(.dark-theme) h1 { color: #e2e8f0; }
    :host-context(.dark-theme) .header-subtitle { color: #94a3b8; }
    :host-context(.dark-theme) .live-indicator { background: #1e293b; color: #94a3b8; }
    :host-context(.dark-theme) .live-indicator.active { background: #052e16; color: #86efac; }
    :host-context(.dark-theme) .error-banner { background: #451a03; border-color: #92400e; color: #fcd34d; }
    :host-context(.dark-theme) .error-close { color: #fcd34d; }
    :host-context(.dark-theme) .summary-pill { background: #1e293b; border-color: #334155; color: #94a3b8; }
    :host-context(.dark-theme) .summary-pill strong { color: #e2e8f0; }
    :host-context(.dark-theme) .filter-select { background: #1e293b; border-color: #475569; color: #e2e8f0; }
    :host-context(.dark-theme) .section-header,
    :host-context(.dark-theme) .resource-table th { background: #0b1220; color: #cbd5e1; border-color: #334155; }
    :host-context(.dark-theme) .resource-table td { border-bottom-color: #334155; color: #cbd5e1; }
    :host-context(.dark-theme) .cell-name strong { color: #e2e8f0; }
    :host-context(.dark-theme) .resource-table tbody tr:hover { background: rgba(37,99,235,0.08); }
    :host-context(.dark-theme) .recovery-badge { background: #334155; color: #cbd5e1; }
    :host-context(.dark-theme) .consistency-summary { background: #1e293b; border-color: #334155; }
    :host-context(.dark-theme) .consistency-badge.crash { background: #451a03; color: #fca5a5; }
    :host-context(.dark-theme) .consistency-badge.filesystem { background: #422006; color: #fcd34d; }
    :host-context(.dark-theme) .consistency-badge.application { background: #052e16; color: #86efac; }
    :host-context(.dark-theme) .badge-count { background: rgba(255,255,255,0.1); }
    :host-context(.dark-theme) .filter-select { background: #1e293b; border-color: #475569; color: #e2e8f0; }
    :host-context(.dark-theme) .empty-state h4 { color: #e2e8f0; }

    @media (max-width: 860px) {
      .page-header { flex-direction: column; align-items: stretch; padding: 18px 20px; }
      .header-right { justify-content: space-between; }
      .filter-bar { flex-direction: column; align-items: stretch; }
      .filter-count { margin-left: 0; }
    }
  `]
})
export class AzureBackupComponent implements OnInit, OnDestroy {
  reportData: BackupReport | null = null;
  loading = false;
  lastUpdate = '';
  errorMessage = '';
  reportError = '';
  selectedSubscription = '';
  consistencyFilter = '';
  private readonly RING_CIRCUMFERENCE = 138.2; // 2 * PI * r(22)
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private statusTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastObservedSuccess = '';

  constructor(
    private backupService: AzureBackupService,
    private msalService: MsalService,
    private router: Router
  ) {}

  ngOnInit(): void {
    // Azure Backup is CloudOps-only. Admins go to the Tickets "Overview" tab,
    // everyone else to their own "My Tickets" view.
    const role = (sessionStorage.getItem('role') || 'user').toLowerCase();
    const isCloudOpsRole = role === 'cloudops' || role === 'itsm';
    if (!isCloudOpsRole) {
      const tab = role === 'admin' ? 'overview' : 'my';
      this.router.navigate(['/tickets'], { queryParams: { tab } });
      return;
    }

    this.loadReport();
    this.pollStatus();
  }

  ngOnDestroy(): void {
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
  }

  refreshReport(): void {
    this.loading = true;
    this.reportError = '';

    const callApi = (azureToken?: string) => {
      this.backupService.runReport(azureToken).subscribe({
        next: (res) => {
          console.log('[AZ-UI] Refresh report response:', res);
          console.log('[AZ-UI] Report data items:', res.report?.items?.length);
          console.log('[AZ-UI] First item:', res.report?.items?.[0]);
          this.reportData = res.report;
          this.loading = false;
          this.lastUpdate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          this.pollStatus();
        },
        error: (err) => {
          this.loading = false;
          this.reportError = err?.error?.error || err?.error?.message || 'Azure collection failed.';
          this.pollStatus();
        }
      });
    };

    this.msalService.getAccessToken(['https://management.azure.com/.default'])
      .then(token => callApi(token))
      .catch(() => callApi());
  }

  private loadReport(): void {
    this.loading = true;
    this.backupService.getReport().subscribe({
      next: (data) => {
        if (data) {
          this.reportData = data;
          this.reportError = '';
        }
        this.loading = false;
        this.lastUpdate = data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      },
      error: (err) => {
        this.loading = false;
        if (!this.reportData) {
          this.reportError = err?.error?.message || err?.error?.error || 'Failed to load the Azure backup report.';
        }
      }
    });
  }

  private pollStatus(): void {
    if (this.statusTimeout) clearTimeout(this.statusTimeout);
    this.backupService.getStatus().subscribe({
      next: (status) => {
        const successChanged = Boolean(status.lastSuccess) && status.lastSuccess !== this.lastObservedSuccess;
        this.lastObservedSuccess = status.lastSuccess || '';
        if (successChanged && !status.running) {
          this.loadReport();
        }
        this.statusTimeout = setTimeout(() => this.pollStatus(), status.running ? 15000 : 60000);
      },
      error: () => {
        this.statusTimeout = setTimeout(() => this.pollStatus(), 60000);
      }
    });
  }

  get subscriptionNames(): string[] {
    return this.reportData?.subscriptions.map(s => s.name) || [];
  }

  get filteredFileShares(): BackupItem[] {
    if (!this.reportData) return [];
    let items = this.reportData.items.filter(i => this.isFileShare(i));
    if (this.selectedSubscription) items = items.filter(i => i.subscription === this.selectedSubscription);
    if (this.consistencyFilter) items = items.filter(i => i.consistency === this.consistencyFilter);
    console.log('[AZ-UI] filteredFileShares:', items.length, 'selectedSub:', this.selectedSubscription, 'consistencyFilter:', this.consistencyFilter);
    return items;
  }

  get filteredVMs(): BackupItem[] {
    if (!this.reportData) return [];
    let items = this.reportData.items.filter(i => this.isVm(i));
    if (this.selectedSubscription) items = items.filter(i => i.subscription === this.selectedSubscription);
    if (this.consistencyFilter) items = items.filter(i => i.consistency === this.consistencyFilter);
    console.log('[AZ-UI] filteredVMs:', items.length, 'selectedSub:', this.selectedSubscription, 'consistencyFilter:', this.consistencyFilter);
    return items;
  }

  applyFilters(): void {}

  setConsistencyFilter(type: string): void {
    this.consistencyFilter = this.consistencyFilter === type ? '' : type;
  }

  healthPercent(sub: SubscriptionGroup): number {
    if (!sub.totalItems) return 100;
    return Math.round((sub.healthy / sub.totalItems) * 100);
  }

  ringOffset(sub: SubscriptionGroup): number {
    const percent = this.healthPercent(sub);
    return this.RING_CIRCUMFERENCE - (this.RING_CIRCUMFERENCE * percent) / 100;
  }

  isFileShare(item: BackupItem): boolean {
    const type = (item.type || '').toLowerCase();
    const recoveryType = (item.recoveryType || '').toLowerCase();
    const resource = `${item.resource || ''} ${item.rawResource || ''}`.toLowerCase();
    return type.includes('file share') || recoveryType === 'azurestorage' || resource.includes('azurefileshare;');
  }

  isVm(item: BackupItem): boolean {
    const type = (item.type || '').toLowerCase();
    const recoveryType = (item.recoveryType || '').toLowerCase();
    const resource = `${item.resource || ''} ${item.rawResource || ''}`.toLowerCase();
    return !this.isFileShare(item) && (type.includes('vm') || recoveryType.includes('iaasvm') || resource.includes('vm;'));
  }

  displayResourceName(item: BackupItem): string {
    const name = item.resource || 'N/A';
    if (this.isVm(item) && name.toLowerCase().startsWith('vm;')) {
      return name.split(';').filter(Boolean).pop() || name;
    }
    if (this.isFileShare(item) && name.toLowerCase().startsWith('azurefileshare;')) {
      return 'Azure File Share';
    }
    return name;
  }

  displayResourceDetail(item: BackupItem): string {
    const raw = item.rawResource || item.resource || '';
    if (this.isFileShare(item)) {
      return raw.toLowerCase().startsWith('azurefileshare;') ? item.resourceGroup : `${item.resourceGroup} / ${item.vault}`;
    }
    return item.vault || item.resourceGroup || '';
  }

  consistencyClass(consistency: string): string {
    const c = this.normalizedConsistencyText(consistency).toLowerCase();
    if (c.includes('application')) return 'app-consistent';
    if (c.includes('crash')) return 'crash-consistent';
    if (c.includes('file')) return 'fs-consistent';
    return 'unknown';
  }

  formatConsistency(item: BackupItem): string {
    const consistency = item.consistency || '';
    const c = (consistency || '').toLowerCase();
    if (c.includes('application')) return 'Application Consistent';
    if (c.includes('crash')) return 'Crash Consistent';
    if (c.includes('file')) return 'File-System Consistent';
    if (this.isFileShare(item)) return 'File-System Consistent';
    if (['passed', 'success', 'succeeded', 'healthy'].includes(c)) return 'N/A';
    return consistency || 'N/A';
  }

  private normalizedConsistencyText(consistency: string): string {
    const c = (consistency || '').toLowerCase();
    if (c.includes('application')) return 'Application Consistent';
    if (c.includes('crash')) return 'Crash Consistent';
    if (c.includes('file')) return 'File-System Consistent';
    return consistency || 'N/A';
  }

  formatRecoveryType(item: BackupItem): string {
    const recoveryType = item.recoveryType || '';
    if (!recoveryType || recoveryType === 'N/A') return 'N/A';
    const rt = recoveryType.toLowerCase();
    if (rt.includes('snapshot') && rt.includes('vault')) return 'Snapshot and Vault-Standard';
    if (rt.includes('snapshot')) return 'Snapshot';
    if (rt.includes('vault')) return 'Vault-Standard';
    if (rt === 'azurestorage' || this.isFileShare(item)) return 'Snapshot';
    if (rt === 'azureiaasvm' || rt === 'iaasvm') return 'Snapshot and Vault-Standard';
    return recoveryType;
  }

  formatTime(value?: string): string {
    if (!value || value === 'N/A') return '—';
    const date = new Date(value);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }
}

















// import { Component, OnInit, OnDestroy } from '@angular/core';
// import { CommonModule } from '@angular/common';
// import { FormsModule } from '@angular/forms';
// import { MsalService } from '../services/msal.service';
// import { AzureBackupService, BackupReport, BackupItem, SubscriptionGroup } from './azure-backup.service';

// @Component({
//   selector: 'app-azure-backup',
//   standalone: true,
//   imports: [CommonModule, FormsModule],
//   template: `
//     <div class="azure-backup-page">
//       <div class="page-header">
//         <div class="header-left">             
//           <div class="brand-icon">
//             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
//           </div>
//           <div>
//             <h1>Azure Backup</h1>
//             <p class="header-subtitle">Azure File Shares & Virtual Machines backup status</p>
//           </div>
//         </div>
//         <div class="header-right">
//           <div class="live-indicator" [class.active]="!!lastUpdate">
//             <span class="live-dot"></span>
//             <span>{{ lastUpdate ? 'Updated ' + lastUpdate : 'Not loaded' }}</span>
//           </div>
//           <button class="btn-refresh" (click)="refreshReport()" [disabled]="loading" title="Refresh live report from Azure">
//             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
//             {{ loading ? 'Collecting...' : 'Refresh Live' }}
//           </button>
//         </div>
//       </div>

//       <div *ngIf="reportError" class="error-banner">
//         <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
//         {{ reportError }}
//         <button class="error-close" (click)="reportError = ''">&times;</button>
//       </div>

//       <div *ngIf="loading && !reportData" class="loading-state">
//         <div class="spinner"></div>
//         Connecting to Azure and collecting backup data...
//       </div>

//       <div *ngIf="reportData">
//         <div class="summary-row">
//           <div class="summary-pill">
//             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
//             <strong>{{ reportData.totalRecords }}</strong> total items
//           </div>
//           <div class="summary-pill">
//             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
//             <strong>{{ reportData.totalVms }}</strong> VMs
//           </div>
//           <div class="summary-pill">
//             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
//             <strong>{{ reportData.totalFileShares }}</strong> File Shares
//           </div>
//           <div class="summary-pill green">
//             <span class="pill-dot green"></span>
//             <strong>{{ reportData.healthy }}</strong> healthy
//           </div>
//           <div class="summary-pill amber" *ngIf="reportData.warning">
//             <span class="pill-dot amber"></span>
//             <strong>{{ reportData.warning }}</strong> warning
//           </div>
//           <div class="summary-pill red" *ngIf="reportData.failed">
//             <span class="pill-dot red"></span>
//             <strong>{{ reportData.failed }}</strong> failed
//           </div>
//         </div>

//         <div class="filter-bar">
//           <select class="filter-select" [(ngModel)]="selectedSubscription" (change)="applyFilters()">
//             <option value="">All Subscriptions</option>
//             <option *ngFor="let sub of subscriptionNames" [value]="sub">{{ sub }}</option>
//           </select>
          
//           <div class="consistency-filters">
//             <div class="consistency-filter" [class.active]="consistencyFilter === 'Application Consistent'">
//               <select class="filter-select consistency-select" [(ngModel)]="consistencyFilter" (change)="applyFilters()">
//                 <option value="">All Consistency Types</option>
//                 <option value="Crash Consistent">Crash Consistent</option>
//                 <option value="File-System Consistent">File-System Consistent</option>
//                 <option value="Application Consistent">Application Consistent</option>
//               </select>
//             </div>
//           </div>
          
//           <span class="filter-count">{{ filteredFileShares.length }} file shares, {{ filteredVMs.length }} VMs</span>
//         </div>

//         <div class="consistency-summary" *ngIf="reportData?.consistencyDetails">
//           <div class="consistency-badge crash" (click)="setConsistencyFilter('Crash Consistent')" [class.active]="consistencyFilter === 'Crash Consistent'" title="Crash Consistent">
//             <span class="badge-dot"></span>
//             <span class="badge-label">Crash Consistent</span>
//             <span class="badge-count">{{ reportData.consistencyDetails.crash.count || 0 }}</span>
//           </div>
//           <div class="consistency-badge filesystem" (click)="setConsistencyFilter('File-System Consistent')" [class.active]="consistencyFilter === 'File-System Consistent'" title="File-System Consistent">
//             <span class="badge-dot"></span>
//             <span class="badge-label">File-System Consistent</span>
//             <span class="badge-count">{{ reportData.consistencyDetails.filesystem.count || 0 }}</span>
//           </div>
//           <div class="consistency-badge application" (click)="setConsistencyFilter('Application Consistent')" [class.active]="consistencyFilter === 'Application Consistent'" title="Application Consistent">
//             <span class="badge-dot"></span>
//             <span class="badge-label">Application Consistent</span>
//             <span class="badge-count">{{ reportData.consistencyDetails.application.count || 0 }}</span>
//           </div>
//         </div>

//         <section class="resource-section" *ngIf="filteredFileShares.length > 0">
//           <div class="section-header">
//             <div class="section-icon file-share">
//               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
//             </div>
//             <div class="section-title">
//               <h2>Azure File Shares (Azure Storage)</h2>
//               <span class="section-count">{{ filteredFileShares.length }} file share(s)</span>
//             </div>
//           </div>

//           <div class="table-scroll">
//             <table class="resource-table">
//               <thead>
//                 <tr>
//                   <th>Name</th>
//                   <th>Subscription</th>
//                   <th>Recovery Type</th>
//                   <th>Creation Time</th>
//                   <th>Last Backup Status</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 <tr *ngFor="let item of filteredFileShares" [class.row-warn]="item.status === 'Warning'" [class.row-fail]="item.status === 'Failed'">
//                   <td class="cell-name">
//                     <strong>{{ displayResourceName(item) }}</strong>
//                     <span class="cell-sub">{{ displayResourceDetail(item) }}</span>
//                   </td>
//                   <td class="cell-sub-strong">{{ item.subscription }}</td>
//                   <td>
//                     <span class="recovery-badge">{{ formatRecoveryType(item) }}</span>
//                   </td>
//                   <td class="cell-time">{{ formatTime(item.latestRecoveryPoint) }}</td>
//                   <td>
//                     <span class="status-badge" [class.healthy]="item.lastBackupStatus === 'Completed'" [class.warning]="item.lastBackupStatus === 'Warning'" [class.failed]="item.lastBackupStatus === 'Failed'">
//                       <span class="status-dot"></span>
//                       {{ item.lastBackupStatus || 'N/A' }}
//                     </span>
//                   </td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>
//         </section>


//         <section class="resource-section" *ngIf="filteredVMs.length > 0">
//           <div class="section-header">
//             <div class="section-icon vm">
//               <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
//             </div>
//             <div class="section-title">
//               <h2>Azure Virtual Machines</h2>
//               <span class="section-count">{{ filteredVMs.length }} VM(s)</span>
//             </div>
//           </div>

//           <div class="table-scroll">
//             <table class="resource-table">
//               <thead>
//                 <tr>
//                   <th>Name</th>
//                   <th>Resource Group</th>
//                   <th>Last Backup Status</th>
//                   <th>Consistency</th>
//                   <th>Recovery Type</th>
//                 </tr>
//               </thead>
//               <tbody>
//                 <tr *ngFor="let item of filteredVMs" [class.row-warn]="item.status === 'Warning'" [class.row-fail]="item.status === 'Failed'">
//                   <td class="cell-name">
//                     <strong>{{ displayResourceName(item) }}</strong>
//                     <span class="cell-sub">{{ item.vault }}</span>
//                   </td>
//                   <td class="cell-sub-strong">{{ item.resourceGroup }}</td>
//                   <td>
//                     <span class="status-badge" [class.healthy]="item.lastBackupStatus === 'Completed'" [class.warning]="item.lastBackupStatus === 'Warning'" [class.failed]="item.lastBackupStatus === 'Failed'">
//                       <span class="status-dot"></span>
//                       {{ item.lastBackupStatus || 'N/A' }}
//                     </span>
//                   </td>
//                   <td>
//                     <span class="consistency-badge" [class]="consistencyClass(item.consistency)">
//                       {{ formatConsistency(item) }}
//                     </span>
//                   </td>
//                   <td>
//                     <span class="recovery-badge">{{ formatRecoveryType(item) }}</span>
//                   </td>
//                 </tr>
//               </tbody>
//             </table>
//           </div>
//         </section>


//         <div *ngIf="filteredFileShares.length === 0 && filteredVMs.length === 0 && !loading" class="empty-state">
//           <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
//           <h4>No backup items found</h4>
//           <p>Try refreshing the report or changing the filter.</p>
//         </div>
//       </div>
//     </div>
//   `,
//   styles: [`
//     .azure-backup-page { padding: 0 0 24px; }

//     .page-header {
//       display: flex; justify-content: space-between; align-items: center; gap: 20px;
//       background: white; border: 1px solid #e2e8f0; border-radius: 16px;
//       padding: 20px 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
//     }
//     .header-left { display: flex; align-items: center; gap: 16px; }
//     .brand-icon {
//       width: 44px; height: 44px; border-radius: 12px;
//       background: linear-gradient(135deg, #0ea5e9, #0284c7);
//       color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
//     }
//     h1 { margin: 0; font-size: 1.35rem; font-weight: 700; color: #0f172a; }
//     .header-subtitle { margin: 2px 0 0; font-size: 0.85rem; color: #64748b; }
//     .header-right { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }

//     .live-indicator {
//       display: flex; align-items: center; gap: 7px; font-size: 0.78rem; font-weight: 600;
//       color: #94a3b8; background: #f8fafc; padding: 8px 14px; border-radius: 8px;
//     }
//     .live-indicator.active { color: #059669; background: #ecfdf5; }
//     .live-dot { width: 7px; height: 7px; border-radius: 50%; background: #cbd5e1; }
//     .live-indicator.active .live-dot { background: #10b981; box-shadow: 0 0 0 3px rgba(16,185,129,0.2); animation: pulse 2s ease-in-out infinite; }
//     @keyframes pulse { 0%,100% { box-shadow: 0 0 0 3px rgba(16,185,129,0.2); } 50% { box-shadow: 0 0 0 6px rgba(16,185,129,0.08); } }

//     .btn-refresh {
//       display: inline-flex; align-items: center; gap: 7px; background: #0f172a; color: white;
//       border: none; padding: 10px 18px; border-radius: 10px; font-weight: 600;
//       font-size: 0.85rem; cursor: pointer; transition: all 0.2s ease;
//     }
//     .btn-refresh:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(15,23,42,0.15); }
//     .btn-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

//     .error-banner {
//       margin-top: 16px; padding: 12px 18px; border-radius: 10px;
//       background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;
//       font-weight: 500; font-size: 0.88rem; display: flex; align-items: center; gap: 10px;
//     }
//     .error-close { margin-left: auto; background: none; border: none; color: #dc2626; font-size: 1.2rem; cursor: pointer; padding: 0 4px; }

//     .loading-state { margin-top: 40px; text-align: center; color: #64748b; font-size: 0.95rem; display: flex; flex-direction: column; align-items: center; gap: 16px; }
//     .spinner { width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: #2563eb; border-radius: 50%; animation: spin 0.7s linear infinite; }
//     @keyframes spin { to { transform: rotate(360deg); } }

//     .summary-row { display: flex; align-items: center; gap: 12px; margin: 20px 0 16px; flex-wrap: wrap; }
//     .summary-pill { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px; background: white; border: 1px solid #e2e8f0; border-radius: 10px; font-size: 0.82rem; color: #475569; font-weight: 500; }
//     .summary-pill strong { font-weight: 700; color: #0f172a; font-size: 0.9rem; }
//     .pill-dot { width: 7px; height: 7px; border-radius: 50%; }
//     .pill-dot.green { background: #16a34a; }
//     .pill-dot.amber { background: #d97706; }
//     .pill-dot.red { background: #dc2626; }

//     .filter-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
//     .filter-select { padding: 8px 14px; border: 1.5px solid #e2e8f0; border-radius: 8px; font-size: 0.85rem; background: white; color: #334155; cursor: pointer; outline: none; }
//     .filter-select:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59,130,246,0.15); }
//     .filter-count { font-size: 0.82rem; color: #94a3b8; font-weight: 500; margin-left: auto; }

//     .consistency-filters { display: flex; gap: 8px; margin-left: 12px; }
//     .consistency-select { width: 200px; }

//     .consistency-summary { display: flex; gap: 10px; margin: 16px 0; padding: 12px 16px; background: white; border: 1px solid #e2e8f0; border-radius: 10px; flex-wrap: wrap; }
//     .consistency-badge { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; cursor: pointer; transition: all 0.2s ease; border: 2px solid transparent; }
//     .consistency-badge:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
//     .consistency-badge.active { border-color: currentColor; box-shadow: 0 0 0 2px rgba(255,255,255,0.8), 0 4px 12px rgba(0,0,0,0.1); }
//     .consistency-badge.crash { background: #fef2f2; color: #dc2626; }
//     .consistency-badge.filesystem { background: #fffbeb; color: #d97706; }
//     .consistency-badge.application { background: #ecfdf5; color: #059669; }
//     .badge-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
//     .badge-count { background: rgba(0,0,0,0.1); padding: 2px 8px; border-radius: 12px; font-size: 0.72rem; font-weight: 700; }

//     .resource-section { margin-bottom: 32px; }
//     .section-header { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding: 16px 20px; background: white; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
//     .section-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; }
//     .section-icon.file-share { background: linear-gradient(135deg, #06b6d4, #0891b2); }
//     .section-icon.vm { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
//     .section-title { display: flex; flex-direction: column; gap: 2px; }
//     .section-title h2 { margin: 0; font-size: 1.05rem; font-weight: 700; color: #0f172a; }
//     .section-count { font-size: 0.78rem; color: #94a3b8; font-weight: 500; }

//     .table-scroll { overflow-x: auto; }
//     .resource-table { width: 100%; min-width: 780px; border-collapse: collapse; }
//     .resource-table th, .resource-table td { padding: 12px 16px; text-align: left; font-size: 0.85rem; color: #334155; border-bottom: 1px solid #f1f5f9; }
//     .resource-table th { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; background: #fafbfc; font-weight: 700; }
//     .resource-table tbody tr { transition: background 0.15s ease; }
//     .resource-table tbody tr:hover { background: #f8faff; }
//     .resource-table tbody tr.row-warn { border-left: 3px solid #f59e0b; }
//     .resource-table tbody tr.row-fail { border-left: 3px solid #ef4444; }

//     .cell-name strong { display: block; color: #0f172a; font-weight: 600; }
//     .cell-sub { display: block; font-size: 0.72rem; color: #94a3b8; }
//     .cell-time { font-size: 0.82rem; color: #64748b; white-space: nowrap; }
//     .cell-sub-strong { font-size: 0.85rem; color: #475569; font-weight: 500; }


//     .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 20px; font-size: 0.78rem; font-weight: 600; }
//     .status-badge.healthy { background: #ecfdf5; color: #059669; }
//     .status-badge.warning { background: #fffbeb; color: #d97706; }
//     .status-badge.failed { background: #fef2f2; color: #dc2626; }
//     .status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

//     .recovery-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; background: #f1f5f9; color: #475569; }

//     .consistency-badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
//     .consistency-badge.app-consistent { background: #ecfdf5; color: #059669; }
//     .consistency-badge.crash-consistent { background: #fef2f2; color: #dc2626; }
//     .consistency-badge.fs-consistent { background: #fffbeb; color: #d97706; }
//     .consistency-badge.unknown { background: #f8fafc; color: #94a3b8; }

//     .empty-state { padding: 60px 20px; text-align: center; color: #94a3b8; }
//     .empty-state svg { margin-bottom: 16px; }
//     .empty-state h4 { margin: 0 0 8px; color: #475569; font-size: 1.05rem; font-weight: 600; }
//     .empty-state p { font-size: 0.88rem; max-width: 400px; margin: 0 auto; line-height: 1.6; }

//     :host-context(.dark-theme) .page-header { background: linear-gradient(135deg, #0f172a, #1e293b); border-color: #334155; }
//     :host-context(.dark-theme) h1 { color: #e2e8f0; }
//     :host-context(.dark-theme) .header-subtitle { color: #94a3b8; }
//     :host-context(.dark-theme) .live-indicator { background: #1e293b; color: #94a3b8; }
//     :host-context(.dark-theme) .live-indicator.active { background: #052e16; color: #86efac; }
//     :host-context(.dark-theme) .error-banner { background: #451a03; border-color: #92400e; color: #fcd34d; }
//     :host-context(.dark-theme) .error-close { color: #fcd34d; }
//     :host-context(.dark-theme) .summary-pill { background: #1e293b; border-color: #334155; color: #94a3b8; }
//     :host-context(.dark-theme) .summary-pill strong { color: #e2e8f0; }
//     :host-context(.dark-theme) .filter-select { background: #1e293b; border-color: #475569; color: #e2e8f0; }
//     :host-context(.dark-theme) .section-header,
//     :host-context(.dark-theme) .resource-table th { background: #0b1220; color: #cbd5e1; border-color: #334155; }
//     :host-context(.dark-theme) .resource-table td { border-bottom-color: #334155; color: #cbd5e1; }
//     :host-context(.dark-theme) .cell-name strong { color: #e2e8f0; }
//     :host-context(.dark-theme) .resource-table tbody tr:hover { background: rgba(37,99,235,0.08); }
//     :host-context(.dark-theme) .recovery-badge { background: #334155; color: #cbd5e1; }
//     :host-context(.dark-theme) .consistency-summary { background: #1e293b; border-color: #334155; }
//     :host-context(.dark-theme) .consistency-badge.crash { background: #451a03; color: #fca5a5; }
//     :host-context(.dark-theme) .consistency-badge.filesystem { background: #422006; color: #fcd34d; }
//     :host-context(.dark-theme) .consistency-badge.application { background: #052e16; color: #86efac; }
//     :host-context(.dark-theme) .badge-count { background: rgba(255,255,255,0.1); }
//     :host-context(.dark-theme) .filter-select { background: #1e293b; border-color: #475569; color: #e2e8f0; }
//     :host-context(.dark-theme) .empty-state h4 { color: #e2e8f0; }

//     @media (max-width: 860px) {
//       .page-header { flex-direction: column; align-items: stretch; padding: 18px 20px; }
//       .header-right { justify-content: space-between; }
//       .filter-bar { flex-direction: column; align-items: stretch; }
//       .filter-count { margin-left: 0; }
//     }
//   `]
// })
// export class AzureBackupComponent implements OnInit, OnDestroy {
//   reportData: BackupReport | null = null;
//   loading = false;
//   lastUpdate = '';
//   errorMessage = '';
//   reportError = '';
//   selectedSubscription = '';
//   consistencyFilter = '';
//   private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
//   private statusTimeout: ReturnType<typeof setTimeout> | null = null;
//   private lastObservedSuccess = '';

//   constructor(
//     private backupService: AzureBackupService,
//     private msalService: MsalService
//   ) {}

//   ngOnInit(): void {
//     this.loadReport();
//     this.pollStatus();
//   }

//   ngOnDestroy(): void {
//     if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
//     if (this.statusTimeout) clearTimeout(this.statusTimeout);
//   }

//   refreshReport(): void {
//     this.loading = true;
//     this.reportError = '';

//     const callApi = (azureToken?: string) => {
//       this.backupService.runReport(azureToken).subscribe({
//         next: (res) => {
//           this.reportData = res.report;
//           this.loading = false;
//           this.lastUpdate = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
//           this.pollStatus();
//         },
//         error: (err) => {
//           this.loading = false;
//           this.reportError = err?.error?.error || err?.error?.message || 'Azure collection failed.';
//           this.pollStatus();
//         }
//       });
//     };

//     this.msalService.getAccessToken(['https://management.azure.com/.default'])
//       .then(token => callApi(token))
//       .catch(() => callApi());
//   }

//   private loadReport(): void {
//     this.loading = true;
//     this.backupService.getReport().subscribe({
//       next: (data) => {
//         this.reportData = data;
//         this.loading = false;
//         this.lastUpdate = data.generatedAt ? new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
//       },
//       error: () => {
//         this.loading = false;
//         this.reportData = null;
//       }
//     });
//   }

//   private pollStatus(): void {
//     if (this.statusTimeout) clearTimeout(this.statusTimeout);
//     this.backupService.getStatus().subscribe({
//       next: (status) => {
//         const successChanged = Boolean(status.lastSuccess) && status.lastSuccess !== this.lastObservedSuccess;
//         this.lastObservedSuccess = status.lastSuccess || '';
//         if (successChanged && !status.running) {
//           this.loadReport();
//         }
//         this.statusTimeout = setTimeout(() => this.pollStatus(), status.running ? 15000 : 60000);
//       },
//       error: () => {
//         this.statusTimeout = setTimeout(() => this.pollStatus(), 60000);
//       }
//     });
//   }

//   get subscriptionNames(): string[] {
//     return this.reportData?.subscriptions.map(s => s.name) || [];
//   }

//   get filteredFileShares(): BackupItem[] {
//     if (!this.reportData) return [];
//     let items = this.reportData.items.filter(i => this.isFileShare(i));
//     if (this.selectedSubscription) items = items.filter(i => i.subscription === this.selectedSubscription);
//     if (this.consistencyFilter) items = items.filter(i => i.consistency === this.consistencyFilter);
//     return items;
//   }

//   get filteredVMs(): BackupItem[] {
//     if (!this.reportData) return [];
//     let items = this.reportData.items.filter(i => this.isVm(i));
//     if (this.selectedSubscription) items = items.filter(i => i.subscription === this.selectedSubscription);
//     if (this.consistencyFilter) items = items.filter(i => i.consistency === this.consistencyFilter);
//     return items;
//   }

//   applyFilters(): void {}

//   setConsistencyFilter(type: string): void {
//     this.consistencyFilter = this.consistencyFilter === type ? '' : type;
//   }

//   isFileShare(item: BackupItem): boolean {
//     const type = (item.type || '').toLowerCase();
//     const recoveryType = (item.recoveryType || '').toLowerCase();
//     const resource = `${item.resource || ''} ${item.rawResource || ''}`.toLowerCase();
//     return type.includes('file share') || recoveryType === 'azurestorage' || resource.includes('azurefileshare;');
//   }

//   isVm(item: BackupItem): boolean {
//     const type = (item.type || '').toLowerCase();
//     const recoveryType = (item.recoveryType || '').toLowerCase();
//     const resource = `${item.resource || ''} ${item.rawResource || ''}`.toLowerCase();
//     return !this.isFileShare(item) && (type.includes('vm') || recoveryType.includes('iaasvm') || resource.includes('vm;'));
//   }

//   displayResourceName(item: BackupItem): string {
//     const name = item.resource || 'N/A';
//     if (this.isVm(item) && name.toLowerCase().startsWith('vm;')) {
//       return name.split(';').filter(Boolean).pop() || name;
//     }
//     if (this.isFileShare(item) && name.toLowerCase().startsWith('azurefileshare;')) {
//       return 'Azure File Share';
//     }
//     return name;
//   }

//   displayResourceDetail(item: BackupItem): string {
//     const raw = item.rawResource || item.resource || '';
//     if (this.isFileShare(item)) {
//       return raw.toLowerCase().startsWith('azurefileshare;') ? item.resourceGroup : `${item.resourceGroup} / ${item.vault}`;
//     }
//     return item.vault || item.resourceGroup || '';
//   }

//   consistencyClass(consistency: string): string {
//     const c = this.normalizedConsistencyText(consistency).toLowerCase();
//     if (c.includes('application')) return 'app-consistent';
//     if (c.includes('crash')) return 'crash-consistent';
//     if (c.includes('file')) return 'fs-consistent';
//     return 'unknown';
//   }

//   formatConsistency(item: BackupItem): string {
//     const consistency = item.consistency || '';
//     const c = (consistency || '').toLowerCase();
//     if (c.includes('application')) return 'Application Consistent';
//     if (c.includes('crash')) return 'Crash Consistent';
//     if (c.includes('file')) return 'File-System Consistent';
//     if (this.isFileShare(item)) return 'File-System Consistent';
//     if (['passed', 'success', 'succeeded', 'healthy'].includes(c)) return 'N/A';
//     return consistency || 'N/A';
//   }

//   private normalizedConsistencyText(consistency: string): string {
//     const c = (consistency || '').toLowerCase();
//     if (c.includes('application')) return 'Application Consistent';
//     if (c.includes('crash')) return 'Crash Consistent';
//     if (c.includes('file')) return 'File-System Consistent';
//     return consistency || 'N/A';
//   }

//   formatRecoveryType(item: BackupItem): string {
//     const recoveryType = item.recoveryType || '';
//     if (!recoveryType || recoveryType === 'N/A') return 'N/A';
//     const rt = recoveryType.toLowerCase();
//     if (rt.includes('snapshot') && rt.includes('vault')) return 'Snapshot and Vault-Standard';
//     if (rt.includes('snapshot')) return 'Snapshot';
//     if (rt.includes('vault')) return 'Vault-Standard';
//     if (rt === 'azurestorage' || this.isFileShare(item)) return 'Snapshot';
//     if (rt === 'azureiaasvm' || rt === 'iaasvm') return 'Snapshot and Vault-Standard';
//     return recoveryType;
//   }

//   formatTime(value?: string): string {
//     if (!value || value === 'N/A') return '—';
//     const date = new Date(value);
//     return isNaN(date.getTime()) ? '—' : date.toLocaleString();
//   }
// }
