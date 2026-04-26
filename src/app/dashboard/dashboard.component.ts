import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TicketService, Ticket } from '../services/ticket.service';
import { LoadingService } from '../services/loading.service';
import { MessageService } from '../services/message.service';
import { MsalService } from '../services/msal.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Welcome Banner -->
    <div class="welcome-banner">
      <div class="welcome-content">
        <div class="welcome-text">
          <h1>{{ greeting }}, {{ userName }}!</h1>
          <p>{{ currentDate }}</p>
        </div>
        <div class="welcome-stats">
          <span class="stat-pill">
            <i class="fas fa-ticket-alt"></i>
            {{ openedCount }} {{ isAdmin ? 'open tickets' : 'my open tickets' }}
          </span>
          <span class="stat-pill urgent" *ngIf="slaAlertCount > 0">
            <i class="fas fa-exclamation-triangle"></i>
            {{ slaAlertCount }} need attention
          </span>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->  
    <div class="quick-actions">
      <button class="action-btn primary" (click)="navigateTo('/create-ticket')">
        <i class="fas fa-plus-circle"></i>
        <span>Create Ticket</span>
      </button>
      <button class="action-btn" (click)="navigateTo('/tickets')">
        <i class="fas fa-list"></i>
        <span>{{ isAdmin ? 'View All Tickets' : 'View My Tickets' }}</span>
      </button>
      <button class="action-btn" (click)="refreshDashboard()">
        <i class="fas fa-sync-alt" [class.spinning]="isRefreshing"></i>
        <span>Refresh</span>
      </button>
    </div>

    <!-- Metrics Cards -->
    <div class="metrics-grid">
      <div class="metric-card open" (click)="navigateWithFilter('open')">
        <div class="metric-icon">
          <i class="fas fa-folder-open"></i>
        </div>
        <div class="metric-content">
          <h3>{{ isAdmin ? 'Open Tickets' : 'My Open Tickets' }}</h3>
          <div class="metric-value" *ngIf="!countsLoading">{{ openedCount | number }}</div>
          <div class="skeleton-value" *ngIf="countsLoading"><span class="shimmer"></span></div>
          <div class="metric-trend up" *ngIf="openTrend > 0">
          </div>
        </div>
      </div>

      <div class="metric-card closed" (click)="navigateWithFilter('closed')">
        <div class="metric-icon">
          <i class="fas fa-check-circle"></i>
        </div>
        <div class="metric-content">
          <h3>{{ isAdmin ? 'Closed Tickets' : 'My Closed Tickets' }}</h3>
          <div class="metric-value" *ngIf="!countsLoading">{{ closedCount | number }}</div>
          <div class="skeleton-value" *ngIf="countsLoading"><span class="shimmer"></span></div>
          <div class="metric-trend up">
          </div>
        </div>
      </div>

      <div class="metric-card resolved" (click)="navigateWithFilter('sla')">
        <div class="metric-icon">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <div class="metric-content">
          <h3>My SLA Open</h3>
          <div class="metric-value" *ngIf="!countsLoading">{{ slaCount | number }}</div>
          <div class="skeleton-value" *ngIf="countsLoading"><span class="shimmer"></span></div>
          <div class="metric-subtext">Urgent/Critical assigned to me</div>
        </div>
      </div>

      <div class="metric-card assigned" (click)="navigateWithFilter('assigned')">
        <div class="metric-icon">
          <i class="fas fa-user-check"></i>
        </div>
        <div class="metric-content">
          <h3>Assigned to Me</h3>
          <div class="metric-value" *ngIf="!countsLoading">{{ assignedCount | number }}</div>
          <div class="skeleton-value" *ngIf="countsLoading"><span class="shimmer"></span></div>
          <div class="metric-subtext">My open assigned tickets</div>
        </div>
      </div>
    </div>

    <!-- Dashboard Grid -->
    <div class="dashboard-grid">
      <!-- Left Column -->
      <div class="dashboard-main">
        
        <!-- SLA Alerts -->
        <div class="card sla-alerts" *ngIf="slaTickets.length > 0">
          <div class="card-header">
            <h2><i class="fas fa-exclamation-triangle"></i> SLA Alerts</h2>
            <span class="alert-count">{{ slaTickets.length }}</span>
          </div>
          <div class="sla-list">
            <div class="sla-item" *ngFor="let ticket of slaTickets" (click)="openTicket(ticket)">
              <div class="sla-badge critical">URGENT</div>
              <div class="sla-info">
                <div class="sla-subject">{{ ticket.subject || 'No Subject' }}</div>
                <div class="sla-meta">#{{ ticket.ticketNumber || ticket.id }}</div>
              </div>
              <i class="fas fa-chevron-right"></i>
            </div>
          </div>
        </div>

        <!-- Tabs & Table -->
        <div class="card tickets-card">
          <div class="card-header with-tabs">
            <div class="tabs">
              <button class="tab" [class.active]="selectedTab === 'open'" (click)="changeTab('open')">
                <i class="fas fa-inbox"></i> Open Tickets
              </button>
              <button class="tab" [class.active]="selectedTab === 'closed'" (click)="changeTab('closed')">
                <i class="fas fa-archive"></i> Closed Tickets
              </button>
            </div>
          </div>

          <div *ngIf="filteredTickets.length === 0" class="empty-state">
            <i class="fas fa-inbox"></i>
            <p>No tickets found</p>
          </div>

          <table *ngIf="filteredTickets.length > 0" class="ticket-table">
            <thead>
              <tr>
                <th>Ticket #</th>
                <th>Subject</th>
                <th>Priority</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let ticket of filteredTickets" (click)="openTicket(ticket)" class="clickable">
                <td class="ticket-number">#{{ ticket.ticketNumber || ticket.id }}</td>
                <td class="ticket-subject">{{ ticket.subject || 'No Subject' }}</td>
                <td>
                  <span class="priority-badge" [ngClass]="priorityClass(ticket.priority)">
                    {{ priorityLabel(ticket.priority) }}
                  </span>
                </td>
                <td>
                  <span class="status-badge" [ngClass]="statusClass(ticket.status)">
                    {{ ticket.status || 'Unknown' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Right Column -->
      <div class="dashboard-sidebar">
        
        <!-- Priority Distribution -->
        <div class="card priority-chart">
          <div class="card-header">
            <h2><i class="fas fa-chart-bar"></i> Priority Distribution</h2>
          </div>
          <div class="chart-bars">
            <div class="chart-row">
              <span class="chart-label">Critical/SLA</span>
              <div class="chart-bar-wrap">
                <div class="chart-bar critical" [style.width.%]="priorityStats.critical"></div>
              </div>
              <span class="chart-value">{{ priorityStats.criticalCount }}</span>
            </div>
            <div class="chart-row">
              <span class="chart-label">High</span>
              <div class="chart-bar-wrap">
                <div class="chart-bar high" [style.width.%]="priorityStats.high"></div>
              </div>
              <span class="chart-value">{{ priorityStats.highCount }}</span>
            </div>
            <div class="chart-row">
              <span class="chart-label">Medium</span>
              <div class="chart-bar-wrap">
                <div class="chart-bar medium" [style.width.%]="priorityStats.medium"></div>
              </div>
              <span class="chart-value">{{ priorityStats.mediumCount }}</span>
            </div>
            <div class="chart-row">
              <span class="chart-label">Low</span>
              <div class="chart-bar-wrap">
                <div class="chart-bar low" [style.width.%]="priorityStats.low"></div>
              </div>
              <span class="chart-value">{{ priorityStats.lowCount }}</span>
            </div>
          </div>
        </div>

        <!-- Recent Activity -->
        <div class="card activity-feed">
          <div class="card-header">
            <h2><i class="fas fa-history"></i> Recent Activity</h2>
          </div>
          <div class="activity-list">
            <div class="activity-item" *ngFor="let activity of recentActivity">
              <div class="activity-icon" [ngClass]="activity.type">
                <i [class]="activity.icon"></i>
              </div>
              <div class="activity-content">
                <p class="activity-text">{{ activity.text }}</p>
                <span class="activity-time">{{ activity.time }}</span>
              </div>
            </div>
            <div class="empty-activity" *ngIf="recentActivity.length === 0">
              <i class="fas fa-clock"></i>
              <p>No recent activity</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SSL Monitoring -->
    <div class="card ssl-monitoring-card">
      <div class="card-header">
        <h2><i class="fas fa-shield-alt"></i> SSL Monitoring</h2>
        <button class="grafana-open-btn" (click)="openGrafanaMonitoring()" [disabled]="!grafanaDashboardUrl">
          <i class="fas fa-external-link-alt"></i>
          Open Grafana
        </button>
      </div>

      <div class="grafana-empty" *ngIf="!grafanaDashboardUrl">
        <p>Grafana URL is not configured.</p>
        <p class="hint">Set browser localStorage key GRAFANA_SSL_DASHBOARD_URL to your Grafana dashboard URL, then refresh this page.</p>
      </div>

      <div class="grafana-frame-wrap" *ngIf="grafanaDashboardUrl">
        <iframe
          class="grafana-frame"
          [src]="safeGrafanaDashboardUrl"
          title="SSL Monitoring Dashboard"
          loading="lazy">
        </iframe>
      </div>
    </div>
  `,
  styles: [`
    /* Welcome Banner */
    .welcome-banner {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      color: white;
    }

    .welcome-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .welcome-text h1 {
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0 0 2px 0;
    }

    .welcome-text p {
      margin: 0;
      opacity: 0.85;
      font-size: 0.75rem;
    }

    .welcome-stats {
      display: flex;
      gap: 8px;
    }

    .stat-pill {
      background: rgba(255,255,255,0.2);
      padding: 5px 10px;
      border-radius: 14px;
      font-size: 0.7rem;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .stat-pill.urgent {
      background: rgba(239, 68, 68, 0.9);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    /* Quick Actions */
    .quick-actions {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .action-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: white;
      color: #374151;
      font-weight: 500;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .action-btn:hover {
      border-color: #3b82f6;
      color: #3b82f6;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.15);
    }

    .action-btn.primary {
      background: #3b82f6;
      border-color: #3b82f6;
      color: white;
    }

    .action-btn.primary:hover {
      background: #2563eb;
      border-color: #2563eb;
      color: white;
    }

    .action-btn i.spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }

    .metric-card {
      background: white;
      border-radius: 10px;
      padding: 12px;
      display: flex;
      gap: 10px;
      align-items: flex-start;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      border: 1px solid #f1f5f9;
      cursor: pointer;
      transition: all 0.2s;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.08);
    }

    .metric-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .metric-card.open .metric-icon { background: #dbeafe; color: #2563eb; }
    .metric-card.closed .metric-icon { background: #dcfce7; color: #16a34a; }
    .metric-card.resolved .metric-icon { background: #f3e8ff; color: #9333ea; }
    .metric-card.assigned .metric-icon { background: #fef3c7; color: #d97706; }

    .metric-content h3 {
      font-size: 0.7rem;
      color: #64748b;
      font-weight: 500;
      margin: 0 0 2px 0;
    }

    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: #1e293b;
      line-height: 1.1;
      animation: countFadeIn 0.4s ease-out;
    }

    @keyframes countFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .skeleton-value {
      height: 1.4rem;
      width: 60px;
      border-radius: 6px;
      overflow: hidden;
      background: #e2e8f0;
    }

    .skeleton-value .shimmer {
      display: block;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .metric-trend {
      font-size: 0.65rem;
      display: flex;
      align-items: center;
      gap: 3px;
      margin-top: 3px;
    }

    .metric-trend.up { color: #16a34a; }
    .metric-trend.down { color: #dc2626; }
    .metric-trend.neutral { color: #64748b; }

    .metric-subtext {
      font-size: 0.65rem;
      color: #94a3b8;
      margin-top: 3px;
    }

    /* Dashboard Grid */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr 260px;
      gap: 16px;
    }

    @media (max-width: 1024px) {
      .dashboard-grid { grid-template-columns: 1fr; }
    }

    /* Card Base */
    .card {
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.05);
      border: 1px solid #f1f5f9;
      overflow: hidden;
    }

    .card-header {
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-header h2 {
      font-size: 0.8rem;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-header h2 i { color: #3b82f6; }

    /* SLA Alerts */
    .sla-alerts {
      margin-bottom: 14px;
      border-left: 3px solid #ef4444;
    }

    .sla-alerts .card-header { background: #fef2f2; }
    .sla-alerts .card-header h2 { color: #dc2626; }
    .sla-alerts .card-header h2 i { color: #dc2626; }

    .alert-count {
      background: #dc2626;
      color: white;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 0.65rem;
      font-weight: 600;
    }

    .sla-list { padding: 6px; }

    .sla-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .sla-item:hover { background: #fef2f2; }

    .sla-badge {
      padding: 3px 6px;
      border-radius: 3px;
      font-size: 0.55rem;
      font-weight: 700;
      text-transform: uppercase;
    }

    .sla-badge.critical { background: #dc2626; color: white; }

    .sla-info { flex: 1; min-width: 0; }

    .sla-subject {
      font-weight: 500;
      font-size: 0.75rem;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .sla-meta { font-size: 0.65rem; color: #64748b; }
    .sla-item > i { color: #cbd5e1; font-size: 0.7rem; }

    /* Tabs */
    .card-header.with-tabs { padding: 0; border-bottom: none; }
    .tabs { display: flex; width: 100%; }

    .tab {
      flex: 1;
      padding: 10px 14px;
      border: none;
      background: none;
      font-size: 0.75rem;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }

    .tab:hover { color: #3b82f6; background: #f8fafc; }
    .tab.active { color: #3b82f6; border-bottom-color: #3b82f6; background: #f8fafc; }

    /* Ticket Table */
    .tickets-card { margin-bottom: 14px; }

    .ticket-table {
      width: 100%;
      border-collapse: collapse;
    }

    .ticket-table th {
      background: #f8fafc;
      padding: 10px 12px;
      text-align: left;
      font-size: 0.65rem;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .ticket-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 0.75rem;
    }

    .ticket-table tr.clickable {
      cursor: pointer;
      transition: background 0.15s;
    }

    .ticket-table tr.clickable:hover { background: #f8fafc; }

    .ticket-number { font-weight: 600; color: #3b82f6; }

    .ticket-subject {
      color: #334155;
      max-width: 220px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Status & Priority Badges */
    .status-badge, .priority-badge {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 14px;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: capitalize;
    }

    .status-badge.status-open { background: #dbeafe; color: #1d4ed8; }
    .status-badge.status-in-progress { background: #fef3c7; color: #b45309; }
    .status-badge.status-closed { background: #dcfce7; color: #15803d; }
    .status-badge.status-resolved { background: #f3e8ff; color: #7c3aed; }

    .priority-badge.priority-sla { background: #fee2e2; color: #dc2626; }
    .priority-badge.priority-high { background: #ffedd5; color: #ea580c; }
    .priority-badge.priority-medium { background: #fef3c7; color: #d97706; }
    .priority-badge.priority-low { background: #dcfce7; color: #16a34a; }
    .priority-badge.priority-unknown { background: #f1f5f9; color: #64748b; }

    /* Empty State */
    .empty-state {
      padding: 32px 16px;
      text-align: center;
      color: #94a3b8;
    }

    .empty-state i { font-size: 2rem; margin-bottom: 8px; }

    /* Priority Chart */
    .chart-bars { padding: 10px 14px; }

    .chart-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    .chart-row:last-child { margin-bottom: 0; }
    .chart-label { width: 60px; font-size: 0.7rem; color: #64748b; }

    .chart-bar-wrap {
      flex: 1;
      height: 8px;
      background: #f1f5f9;
      border-radius: 4px;
      overflow: hidden;
    }

    .chart-bar {
      height: 100%;
      border-radius: 4px;
      transition: width 0.5s ease;
    }

    .chart-bar.critical { background: #dc2626; }
    .chart-bar.high { background: #ea580c; }
    .chart-bar.medium { background: #f59e0b; }
    .chart-bar.low { background: #22c55e; }

    .chart-value {
      width: 24px;
      font-size: 0.7rem;
      font-weight: 600;
      color: #334155;
      text-align: right;
    }

    /* Activity Feed */
    .activity-list {
      padding: 8px 12px;
      max-height: 240px;
      overflow-y: auto;
    }

    .activity-item {
      display: flex;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid #f1f5f9;
    }

    .activity-item:last-child { border-bottom: none; }

    .activity-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.65rem;
      flex-shrink: 0;
    }

    .activity-icon.created { background: #dbeafe; color: #2563eb; }
    .activity-icon.updated { background: #fef3c7; color: #d97706; }
    .activity-icon.closed { background: #dcfce7; color: #16a34a; }
    .activity-icon.assigned { background: #f3e8ff; color: #9333ea; }

    .activity-content { flex: 1; min-width: 0; }

    .activity-text {
      font-size: 0.7rem;
      color: #334155;
      margin: 0 0 1px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .activity-time { font-size: 0.6rem; color: #94a3b8; }

    .empty-activity {
      text-align: center;
      padding: 16px;
      color: #94a3b8;
    }

    .empty-activity i { font-size: 1.5rem; margin-bottom: 6px; }

    /* Dark Theme */
    :host-context(.dark-theme) .welcome-banner {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
    }

    :host-context(.dark-theme) .action-btn {
      background: #1e293b;
      border-color: #334155;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .action-btn:hover {
      border-color: #3b82f6;
      color: #60a5fa;
    }

    :host-context(.dark-theme) .action-btn.primary {
      background: #2563eb;
      border-color: #2563eb;
    }

    :host-context(.dark-theme) .metric-card,
    :host-context(.dark-theme) .card {
      background: #1e293b;
      border-color: #334155;
    }

    :host-context(.dark-theme) .metric-value,
    :host-context(.dark-theme) .metric-content h3,
    :host-context(.dark-theme) .card-header h2 { color: #e2e8f0; }

    :host-context(.dark-theme) .ticket-table th {
      background: #0f172a;
      color: #94a3b8;
    }

    :host-context(.dark-theme) .ticket-table td {
      border-color: #334155;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .ticket-table tr.clickable:hover { background: #0f172a; }
    :host-context(.dark-theme) .ticket-number { color: #60a5fa; }
    :host-context(.dark-theme) .ticket-subject { color: #cbd5e1; }
    :host-context(.dark-theme) .tab { color: #94a3b8; }

    :host-context(.dark-theme) .tab:hover,
    :host-context(.dark-theme) .tab.active {
      color: #60a5fa;
      background: #0f172a;
    }

    :host-context(.dark-theme) .chart-label,
    :host-context(.dark-theme) .chart-value { color: #cbd5e1; }
    :host-context(.dark-theme) .chart-bar-wrap { background: #334155; }
    :host-context(.dark-theme) .activity-text { color: #e2e8f0; }

    :host-context(.dark-theme) .sla-alerts .card-header {
      background: rgba(239, 68, 68, 0.15);
    }

    :host-context(.dark-theme) .sla-item:hover { background: rgba(239, 68, 68, 0.1); }
    :host-context(.dark-theme) .sla-subject { color: #e2e8f0; }
    :host-context(.dark-theme) .card-header { border-color: #334155; }
    :host-context(.dark-theme) .activity-item { border-color: #334155; }

    /* SSL Monitoring */
    .ssl-monitoring-card {
      margin-top: 16px;
    }

    .grafana-open-btn {
      border: 1px solid #dbeafe;
      background: #eff6ff;
      color: #1d4ed8;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.72rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .grafana-open-btn:hover:not(:disabled) {
      background: #dbeafe;
      border-color: #bfdbfe;
    }

    .grafana-open-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .grafana-empty {
      padding: 18px 14px;
      color: #475569;
      font-size: 0.8rem;
      border-top: 1px solid #f1f5f9;
    }

    .grafana-empty .hint {
      margin-top: 6px;
      color: #64748b;
      font-size: 0.72rem;
    }

    .grafana-frame-wrap {
      border-top: 1px solid #f1f5f9;
      padding: 8px;
      background: #f8fafc;
    }

    .grafana-frame {
      width: 100%;
      min-height: 520px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
    }

    :host-context(.dark-theme) .grafana-open-btn {
      background: #1e293b;
      border-color: #334155;
      color: #93c5fd;
    }

    :host-context(.dark-theme) .grafana-open-btn:hover:not(:disabled) {
      background: #0f172a;
      border-color: #475569;
    }

    :host-context(.dark-theme) .grafana-empty {
      border-top-color: #334155;
      color: #cbd5e1;
    }

    :host-context(.dark-theme) .grafana-empty .hint {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .grafana-frame-wrap {
      background: #0f172a;
      border-top-color: #334155;
    }

    :host-context(.dark-theme) .grafana-frame {
      background: #0f172a;
      border-color: #334155;
    }
  `]
})
export class DashboardComponent implements OnInit, OnDestroy {

  private get COUNT_CACHE_KEY(): string {
    const userEmail = sessionStorage.getItem('username') || 'guest';
    const userRole = sessionStorage.getItem('role') || 'user';
    return `dashboard_ticket_counts_${userRole}_${userEmail}`;
  }

  private get TICKETS_CACHE_KEY(): string {
    const userEmail = sessionStorage.getItem('username') || 'guest';
    const userRole = sessionStorage.getItem('role') || 'user';
    return `dashboard_tickets_${userRole}_${userEmail}_${this.selectedTab}`;
  }

  private get TICKETS_CACHE_KEY_BASE(): string {
    const userEmail = sessionStorage.getItem('username') || 'guest';
    const userRole = sessionStorage.getItem('role') || 'user';
    return `dashboard_tickets_${userRole}_${userEmail}`;
  }

  tickets: Ticket[] = [];
  filteredTickets: Ticket[] = [];
  slaTickets: Ticket[] = [];
  selectedTab: 'open' | 'closed' = 'open';

  openedCount = 0;
  closedCount = 0;
  resolvedCount = 0;
  assignedCount = 0;
  slaCount = 0;
  slaAlertCount = 0;

  // Trend indicators
  openTrend = 5;
  closedTrend = 12;

  // User info
  userName = '';
  userRole = 'user';
  currentUserEmail = '';
  greeting = '';
  currentDate = '';

  // Priority stats
  priorityStats = {
    critical: 0, criticalCount: 0,
    high: 0, highCount: 0,
    medium: 0, mediumCount: 0,
    low: 0, lowCount: 0
  };

  // Recent activity
  recentActivity: { type: string; icon: string; text: string; time: string }[] = [];

  isRefreshing = false;
  countsLoading = true;
  grafanaDashboardUrl = '';
  safeGrafanaDashboardUrl?: SafeResourceUrl;

  constructor(
    private ticketService: TicketService,
    private loadingService: LoadingService,
    private messageService: MessageService,
    private msalService: MsalService,
    private sanitizer: DomSanitizer,
    private router: Router
  ) {}

  ngOnInit() {
    this.initUserInfo();
    this.setGreeting();
    this.setCurrentDate();

    // Clean up old cache keys (before per-user caching was added)
    localStorage.removeItem('dashboard_ticket_counts');

    const cached = localStorage.getItem(this.COUNT_CACHE_KEY);
    if (cached) {
      try {
        this.applyCounts(JSON.parse(cached));
        this.countsLoading = false; // Don't show skeleton if we have cached data
      } catch {
        localStorage.removeItem(this.COUNT_CACHE_KEY);
      }
    }

    const cachedTickets = localStorage.getItem(this.TICKETS_CACHE_KEY);
    if (cachedTickets) {
      try {
        this.tickets = JSON.parse(cachedTickets) || [];
        this.filterTickets();
        this.calculatePriorityStats();
        this.findSLATickets();
        this.generateRecentActivity();
      } catch {
        localStorage.removeItem(this.TICKETS_CACHE_KEY);
      }
    }

    // Refresh in background without showing full-page loading on route revisit.
    this.loadCounts(true, false);
    this.loadTickets(true);
    this.initGrafanaMonitoring();
  }

  ngOnDestroy() {}

  get isAdmin(): boolean {
    return this.userRole === 'admin';
  }

  initUserInfo() {
    this.userRole = (sessionStorage.getItem('role') || 'user').toLowerCase();
    this.currentUserEmail = (sessionStorage.getItem('username') || '').toLowerCase().trim();
    const account = this.msalService.getAccount();
    if (account) {
      this.userName = account.name || account.username?.split('@')[0] || 'User';
      if (!this.currentUserEmail) {
        this.currentUserEmail = (account.username || '').toLowerCase().trim();
      }
    } else {
      const email = sessionStorage.getItem('username') || '';
      this.userName = email ? email.split('@')[0] : 'User';
    }
    this.userName = this.userName.charAt(0).toUpperCase() + this.userName.slice(1);
  }

  setGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) this.greeting = 'Good Morning';
    else if (hour < 17) this.greeting = 'Good Afternoon';
    else this.greeting = 'Good Evening';
  }

  setCurrentDate() {
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    };
    this.currentDate = new Date().toLocaleDateString('en-US', options);
  }

  loadCounts(silent = false, forceRefresh = false) {
    if (forceRefresh || this.countsLoading) {
      this.countsLoading = true;
    }
    this.ticketService.getTicketCounts(forceRefresh).subscribe({
      next: counts => {
        this.applyCounts(counts);
        this.countsLoading = false;
        localStorage.setItem(this.COUNT_CACHE_KEY, JSON.stringify(counts));
      },
      error: () => {
        this.countsLoading = false;
        if (!silent) this.messageService.error('Failed to load ticket counts');
      }
    });
  }

  private applyCounts(counts: any) {
    this.openedCount = counts.open ?? this.openedCount;
    this.closedCount = counts.closed ?? this.closedCount;
    this.resolvedCount = counts.resolved ?? this.resolvedCount;
    this.assignedCount = counts.assigned ?? this.assignedCount;
    this.slaCount = counts.sla ?? this.slaCount;
  }

  loadTickets(silent = false) {
    if (!silent) {
      this.loadingService.show();
    }
    const filterEmail = !this.isAdmin ? this.currentUserEmail : undefined;
    // 50 records is enough for dashboard widgets and faster than 100.
    this.ticketService.getTickets(1, 50, this.selectedTab, undefined, filterEmail).subscribe({
      next: res => {
        this.tickets = res.data || [];
        this.filterTickets();
        this.calculatePriorityStats();
        this.findSLATickets();
        this.generateRecentActivity();
        localStorage.setItem(this.TICKETS_CACHE_KEY, JSON.stringify(this.tickets));
        if (!silent) {
          this.loadingService.hide();
        }
      },
      error: () => {
        if (!silent) {
          this.messageService.error('Failed to load tickets');
          this.loadingService.hide();
        }
      }
    });
  }

  filterTickets() {
    const isOpen = (s?: string) => ['open', 'in progress'].includes((s || '').toLowerCase());
    const isClosed = (s?: string) => ['closed', 'resolved'].includes((s || '').toLowerCase());

    this.filteredTickets = this.selectedTab === 'open'
      ? this.tickets.filter(t => isOpen(t.status))
      : this.tickets.filter(t => isClosed(t.status));
    this.filteredTickets = this.filteredTickets.slice(0, 10);
  }

  calculatePriorityStats() {
    const isOpen = (s?: string) => ['open', 'in progress'].includes((s || '').toLowerCase());
    const openTickets = this.tickets.filter(t => isOpen(t.status));

    let critical = 0, high = 0, medium = 0, low = 0;
    openTickets.forEach(t => {
      const p = (t.priority || '').toLowerCase();
      if (p.includes('sla') || p.includes('urgent') || p.includes('critical')) critical++;
      else if (p.includes('high')) high++;
      else if (p.includes('medium')) medium++;
      else if (p.includes('low')) low++;
    });

    const total = Math.max(critical + high + medium + low, 1);
    this.priorityStats = {
      critical: Math.round((critical / total) * 100), criticalCount: critical,
      high: Math.round((high / total) * 100), highCount: high,
      medium: Math.round((medium / total) * 100), mediumCount: medium,
      low: Math.round((low / total) * 100), lowCount: low
    };
  }

  findSLATickets() {
    const isOpen = (s?: string) => ['open', 'in progress'].includes((s || '').toLowerCase());
    this.slaTickets = this.tickets.filter(t => {
      const p = (t.priority || '').toLowerCase();
      return isOpen(t.status) && (p.includes('sla') || p.includes('urgent') || p.includes('critical'));
    }).slice(0, 5);
    this.slaAlertCount = this.slaTickets.length;
  }

  generateRecentActivity() {
    this.recentActivity = this.tickets.slice(0, 5).map(t => {
      const status = (t.status || '').toLowerCase();
      let type = 'created', icon = 'fas fa-plus';

      if (status === 'closed' || status === 'resolved') { type = 'closed'; icon = 'fas fa-check'; }
      else if (status === 'in progress') { type = 'updated'; icon = 'fas fa-edit'; }
      else if (t.assignedTo) { type = 'assigned'; icon = 'fas fa-user'; }

      return {
        type, icon,
        text: `Ticket #${t.ticketNumber || t.id} - ${(t.subject || 'No Subject').substring(0, 35)}...`,
        time: 'Recently'
      };
    });
  }

  changeTab(tab: 'open' | 'closed') {
    this.selectedTab = tab;
    const cachedTickets = localStorage.getItem(this.TICKETS_CACHE_KEY);
    if (cachedTickets) {
      try {
        this.tickets = JSON.parse(cachedTickets) || [];
        this.filterTickets();
        this.calculatePriorityStats();
        this.findSLATickets();
        this.generateRecentActivity();
      } catch {
        localStorage.removeItem(this.TICKETS_CACHE_KEY);
      }
    }
    this.loadTickets(true);
  }

  refreshDashboard() {
    this.isRefreshing = true;
    this.ticketService.clearAllCache();
    localStorage.removeItem(`${this.TICKETS_CACHE_KEY_BASE}_open`);
    localStorage.removeItem(`${this.TICKETS_CACHE_KEY_BASE}_closed`);
    this.loadCounts(false, true);
    this.loadTickets(false);
    this.initGrafanaMonitoring();
    setTimeout(() => this.isRefreshing = false, 2000);
  }

  private initGrafanaMonitoring() {
    const urlFromWindow = ((window as any).__env?.GRAFANA_SSL_DASHBOARD_URL || '').trim();
    const urlFromStorage = (localStorage.getItem('GRAFANA_SSL_DASHBOARD_URL') || '').trim();
    this.grafanaDashboardUrl = urlFromWindow || urlFromStorage;

    this.safeGrafanaDashboardUrl = this.grafanaDashboardUrl
      ? this.sanitizer.bypassSecurityTrustResourceUrl(this.grafanaDashboardUrl)
      : undefined;
  }

  openGrafanaMonitoring() {
    if (!this.grafanaDashboardUrl) {
      this.messageService.error('Grafana dashboard URL is not configured');
      return;
    }

    window.open(this.grafanaDashboardUrl, '_blank', 'noopener,noreferrer');
  }

  navigateTo(path: string) { this.router.navigate([path]); }
  navigateWithFilter(status: string) { this.router.navigate(['/tickets'], { queryParams: { status } }); }

  openTicket(ticket: Ticket) {
    const id = ticket.ticketId || ticket.id;
    if (id) this.router.navigate(['/tickets', id]);
  }

  priorityClass(priority?: string): string {
    const value = (priority || '').trim().toLowerCase();
    if (!value) return 'priority-unknown';
    if (value.includes('sla') || value.includes('urgent') || value.includes('critical')) return 'priority-sla';
    if (value.includes('high')) return 'priority-high';
    if (value.includes('medium')) return 'priority-medium';
    if (value.includes('low')) return 'priority-low';
    return 'priority-unknown';
  }

  priorityLabel(priority?: string): string {
    const value = (priority || '').trim().toLowerCase();
    if (!value) return '—';
    if (value.includes('sla') || value.includes('urgent') || value.includes('critical')) return 'SLA';
    if (value.includes('high')) return 'High';
    if (value.includes('medium')) return 'Medium';
    if (value.includes('low')) return 'Low';
    return priority || '—';
  }

  statusClass(status?: string): string {
    const value = (status || '').trim().toLowerCase();
    if (value === 'open') return 'status-open';
    if (value === 'in progress') return 'status-in-progress';
    if (value === 'closed') return 'status-closed';
    if (value === 'resolved') return 'status-resolved';
    return 'status-open';
  }
}

