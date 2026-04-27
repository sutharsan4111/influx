import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';

import { AssignmentService, TicketAssignment, GroupMember } from '../services/assignment.service';
import { MsalService } from '../services/msal.service';

// Helper: draw rounded rect on canvas (cross-browser safe)
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface SummaryRow {
  email: string;
  displayName: string;
  assignedCount: number;
  closedCount: number;
}

interface DetailRow {
  ticketId: string;
  ticketNumber: string;
  primaryAssignee: string;
  assignedUsers: string;
  assignedAt: string;
  status: string;
  closedBy: string;
  closedAt: string;
  category: string;
}

interface CategoryData {
  name: string;
  count: number;
  percentage: number;
  color: string;
}

@Component({
  selector: 'app-admin-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="report-page">
      <div class="top-bar"></div>

      <!-- ── Header ── -->
      <div class="page-header">
        <div class="header-left">
          <p class="header-label">CLOUDOPS TEAM</p>
          <h2>Performance Report</h2>
          <p class="header-sub">Assignments &amp; closures for CloudOps members</p>
        </div>
        <div class="header-actions">
          <div class="date-filters">
            <label><span>From</span><input type="date" [(ngModel)]="startDate" /></label>
            <label><span>To</span><input type="date" [(ngModel)]="endDate" /></label>
            <span class="group-pill">{{ groupEmail }}</span>
          </div>
          <div class="btn-row">
            <button class="btn btn-secondary" (click)="loadReport()" [disabled]="loading || !isAdmin">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.25"/></svg>
              Load Report
            </button>
            <button class="btn btn-backfill" (click)="backfillCategories()" [disabled]="backfilling || loading || !isAdmin"
              title="Fetch category from Zoho for Uncategorized tickets">
              <svg class="btn-icon" [class.spinning]="backfilling" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 1-9 9"/><path d="M3 12a9 9 0 0 1 9-9"/><polyline points="16 12 21 12 21 7"/></svg>
              {{ backfilling ? 'Backfilling...' : 'Fix Categories' }}
            </button>
            <button class="btn btn-primary" (click)="downloadExcel()" [disabled]="loading || summaryRows.length === 0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Excel
            </button>
          </div>
        </div>
      </div>

      <!-- ── Notices ── -->
      <div class="notice warn" *ngIf="!isAdmin">You do not have access to this report.</div>
      <div class="notice err"  *ngIf="error && isAdmin">{{ error }}</div>
      <div class="notice info" *ngIf="backfillResult">
        Backfill complete — <strong>{{ backfillResult.updated }}</strong> updated,
        {{ backfillResult.failed }} skipped out of {{ backfillResult.total }}.
        Click <em>Load Report</em> to refresh.
      </div>

      <!-- ── Spinner ── -->
      <div class="spinner-wrap" *ngIf="loading">
        <div class="spinner"></div><span>Loading report...</span>
      </div>

      <!-- ── Metric cards ── -->
      <div class="metrics-row" *ngIf="!loading && summaryRows.length > 0">
        <div class="metric-card cyan">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ detailRows.length }}</div>
            <div class="metric-label">Total Tickets</div>
            <div class="metric-sub">{{ startDate }} → {{ endDate }}</div>
          </div>
        </div>
        <div class="metric-card violet">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ summaryRows.length }}</div>
            <div class="metric-label">Members Tracked</div>
            <div class="metric-sub">{{ groupEmail }}</div>
          </div>
        </div>
        <div class="metric-card emerald" *ngIf="topAssignee">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ topAssignee.assignedCount }}</div>
            <div class="metric-label">Top Assignee</div>
            <div class="metric-sub">{{ topAssignee.displayName || topAssignee.email }}</div>
          </div>
        </div>
        <div class="metric-card rose" *ngIf="topCloser">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ topCloser.closedCount }}</div>
            <div class="metric-label">Top Closer</div>
            <div class="metric-sub">{{ topCloser.displayName || topCloser.email }}</div>
          </div>
        </div>
      </div>

      <!-- ── Charts row ── -->
      <div class="charts-row" *ngIf="!loading && categoryData.length > 0">
        <div class="chart-card">
          <div class="chart-title">Tickets by Category</div>
          <div class="donut-wrap">
            <canvas #pieChart width="200" height="200"></canvas>
            <div class="donut-legend">
              <div class="legend-item" *ngFor="let cat of categoryData">
                <span class="legend-dot" [style.background]="cat.color"></span>
                <span class="legend-name">{{ cat.name }}</span>
                <span class="legend-val">{{ cat.count }}</span>
                <span class="legend-pct">({{ cat.percentage }}%)</span>
              </div>
            </div>
          </div>
        </div>
        <div class="chart-card" *ngIf="summaryRows.length > 0">
          <div class="chart-title">Team Workload</div>
          <canvas #barChart width="460" height="200"></canvas>
          <div class="bar-legend">
            <span class="bar-key assigned"></span><span>Assigned</span>
            <span class="bar-key total"></span><span>Closed</span>
          </div>
        </div>
      </div>

      <!-- ── Summary table ── -->
      <div class="section" *ngIf="!loading && summaryRows.length > 0">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          Member Summary
        </div>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>#</th><th>Name</th><th>Email</th>
              <th>Assigned</th><th>Closed</th><th>Total</th>
            </tr></thead>
            <tbody>
              <tr *ngFor="let row of summaryRows; let i = index">
                <td class="rank">{{ i + 1 }}</td>
                <td class="name-cell">
                  <div class="avatar">{{ getInitials(row.displayName || row.email) }}</div>
                  {{ row.displayName || '—' }}
                </td>
                <td class="dim">{{ row.email }}</td>
                <td><span class="badge assigned">{{ row.assignedCount }}</span></td>
                <td><span class="badge closed">{{ row.closedCount }}</span></td>
                <td class="bold">{{ row.assignedCount + row.closedCount }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Detail table ── -->
      <div class="section" *ngIf="!loading && detailRows.length > 0">
        <div class="section-header">
          <div class="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Ticket Details
          </div>
          <span class="detail-count">{{ detailRows.length }} tickets</span>
        </div>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>Ticket #</th><th>Category</th><th>Primary Assignee</th>
              <th>Status</th><th>Assigned At</th><th>Closed By</th><th>Closed At</th>
            </tr></thead>
            <tbody>
              <tr *ngFor="let row of detailRows">
                <td class="mono">{{ row.ticketNumber || row.ticketId }}</td>
                <td><span class="cat-pill">{{ row.category || '—' }}</span></td>
                <td>{{ row.primaryAssignee }}</td>
                <td>
                  <span class="status-pill"
                    [class.open]="row.status.toLowerCase() === 'open'"
                    [class.closed]="row.status.toLowerCase() !== 'open'">
                    {{ row.status }}
                  </span>
                </td>
                <td class="ts">{{ row.assignedAt }}</td>
                <td class="dim">{{ row.closedBy || '—' }}</td>
                <td class="ts">{{ row.closedAt || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .report-page {
      min-height: 100vh;
      background: #f5f8ff;
      color: #0f172a;
      padding-bottom: 40px;
    }

    /* ── Top gradient bar ── */
    .top-bar {
      height: 3px;
      background: linear-gradient(to right, #06b6d4, #8b5cf6, #f43f5e);
    }

    /* ── Header ── */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
      padding: 22px 28px 16px;
      border-bottom: 1px solid #e2e8f0;
    }
    .header-label {
      margin: 0 0 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #06b6d4;
    }
    .header-left h2 {
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 700;
      color: #0f172a;
    }
    .header-sub { margin: 0; font-size: 13px; color: #475569; }

    .header-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 10px;
    }
    .date-filters {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .date-filters label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #334155;
    }
    .date-filters input {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 12px;
    }
    .date-filters input:focus { outline: none; border-color: #06b6d4; }
    .group-pill {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
    }

    /* ── Buttons ── */
    .btn-row { display: flex; gap: 8px; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .btn svg, .btn .btn-icon { width: 14px; height: 14px; flex-shrink: 0; }
    .btn:hover:not(:disabled) { background: #f8fafc; border-color: #94a3b8; color: #0f172a; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-backfill { border-color: #0891b2; background: #ecfeff; color: #0e7490; }
    .btn-backfill:hover:not(:disabled) { background: #cffafe; }
    .btn-primary  { border-color: #1d4ed8; background: #2563eb; color: #eff6ff; }
    .btn-primary:hover:not(:disabled) { background: #2563eb; }

    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { animation: spin 0.9s linear infinite; display: inline-block; }

    /* ── Notices ── */
    .notice { margin: 12px 28px; padding: 10px 14px; border-radius: 8px; font-size: 13px; }
    .notice.warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
    .notice.err  { background: #fef2f2; border: 1px solid #fca5a5; color: #b91c1c; }
    .notice.info { background: #eff6ff; border: 1px solid #93c5fd; color: #1d4ed8; }

    /* ── Spinner ── */
    .spinner-wrap {
      display: flex; align-items: center; gap: 12px;
      padding: 24px 28px; color: #2563eb; font-size: 14px;
    }
    .spinner {
      width: 20px; height: 20px;
      border: 2px solid #bfdbfe;
      border-top-color: #06b6d4;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* ── Metric cards ── */
    .metrics-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      padding: 20px 28px 4px;
    }
    .metric-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
      display: flex;
      gap: 14px;
      align-items: center;
      transition: transform 0.15s, border-color 0.15s;
    }
    .metric-card:hover { transform: translateY(-2px); }
    .metric-icon {
      width: 42px; height: 42px;
      border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .metric-icon svg { width: 20px; height: 20px; }
    .metric-card.cyan   .metric-icon { background: rgba(6,182,212,.13);  color: #06b6d4; }
    .metric-card.violet .metric-icon { background: rgba(139,92,246,.13); color: #8b5cf6; }
    .metric-card.emerald .metric-icon { background: rgba(16,185,129,.13); color: #10b981; }
    .metric-card.rose   .metric-icon { background: rgba(244,63,94,.13);  color: #f43f5e; }
    .metric-card.cyan:hover   { border-color: rgba(6,182,212,.4); }
    .metric-card.violet:hover { border-color: rgba(139,92,246,.4); }
    .metric-card.emerald:hover{ border-color: rgba(16,185,129,.4); }
    .metric-card.rose:hover   { border-color: rgba(244,63,94,.4); }
    .metric-value { font-size: 28px; font-weight: 700; line-height: 1; }
    .metric-card.cyan   .metric-value { color: #06b6d4; }
    .metric-card.violet .metric-value { color: #8b5cf6; }
    .metric-card.emerald .metric-value { color: #10b981; }
    .metric-card.rose   .metric-value { color: #f43f5e; }
    .metric-label { font-size: 12px; color: #334155; margin-top: 3px; }
    .metric-sub   { font-size: 11px; color: #64748b; margin-top: 2px; }

    /* ── Charts row ── */
    .charts-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      padding: 16px 28px;
    }
    .chart-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
    }
    .chart-title {
      font-size: 13px;
      font-weight: 600;
      color: #0f172a;
      margin-bottom: 14px;
    }
    .donut-wrap { display: flex; align-items: center; gap: 18px; }
    .donut-legend { display: flex; flex-direction: column; gap: 7px; }
    .legend-item { display: flex; align-items: center; gap: 7px; font-size: 12px; }
    .legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
    .legend-name { color: #334155; min-width: 106px; }
    .legend-val  { color: #0f172a; font-weight: 600; }
    .legend-pct  { color: #64748b; }
    canvas { display: block; max-width: 100%; }
    .bar-legend {
      display: flex; align-items: center; gap: 12px; margin-top: 8px;
      font-size: 11px; color: #475569;
    }
    .bar-key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
    .bar-key.assigned { background: rgba(37,99,235,.8); }
    .bar-key.total    { background: rgba(5,150,105,.45); }

    /* ── Sections ── */
    .section { padding: 0 28px 4px; }
    .section-header {
      display: flex; align-items: center;
      justify-content: space-between; margin-bottom: 4px;
    }
    .section-title {
      display: flex; align-items: center; gap: 8px;
      margin: 18px 0 10px;
      font-size: 11px; font-weight: 700;
      color: #334155;
      text-transform: uppercase; letter-spacing: 0.08em;
    }
    .section-title svg { width: 15px; height: 15px; color: #06b6d4; }
    .detail-count { font-size: 12px; color: #64748b; }

    /* ── Tables ── */
    .table-wrap { overflow-x: auto; border-radius: 10px; border: 1px solid #e2e8f0; background: #ffffff; }
    .report-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .report-table th {
      background: #f8fafc;
      color: #334155;
      font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.05em;
      padding: 10px 14px; text-align: left;
      border-bottom: 1px solid #e2e8f0;
      white-space: nowrap;
    }
    .report-table td {
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #0f172a;
      white-space: nowrap;
    }
    .report-table tbody tr:last-child td { border-bottom: none; }
    .report-table tbody tr:hover td { background: #f8fafc; }

    .rank  { color: #475569; font-weight: 700; }
    .name-cell {
      display: flex; align-items: center; gap: 8px;
      color: #0f172a; font-weight: 500;
    }
    .avatar {
      width: 26px; height: 26px; border-radius: 50%;
      background: linear-gradient(135deg, #06b6d4, #8b5cf6);
      color: #fff; font-size: 10px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .dim  { color: #64748b; }
    .bold { font-weight: 600; color: #0f172a; }
    .badge {
      display: inline-block; padding: 2px 9px;
      border-radius: 999px; font-size: 11px; font-weight: 700;
    }
    .badge.assigned { background: rgba(37,99,235,.14);  color: #1d4ed8; }
    .badge.closed   { background: rgba(5,150,105,.14); color: #047857; }
    .mono { font-family: monospace; font-size: 12px; color: #1d4ed8; }
    .cat-pill {
      display: inline-block; padding: 2px 8px; border-radius: 6px;
      font-size: 11px;
      background: #f3e8ff; color: #6d28d9;
      border: 1px solid rgba(139,92,246,.25);
    }
    .status-pill {
      display: inline-block; padding: 2px 9px;
      border-radius: 999px; font-size: 11px; font-weight: 600;
    }
    .status-pill.open   { background: #ecfeff; color: #0e7490; }
    .status-pill.closed { background: #ecfdf5; color: #047857; }
    .ts { font-size: 11.5px; color: #64748b; }

    @media (max-width: 900px) {
      .metrics-row { grid-template-columns: repeat(2, 1fr); }
      .charts-row  { grid-template-columns: 1fr; }
    }
    @media (max-width: 600px) {
      .metrics-row { grid-template-columns: 1fr; }
      .page-header { flex-direction: column; }
      .header-actions { align-items: flex-start; }
    }
  `]
})
export class ReportComponent implements OnInit, AfterViewInit {
  @ViewChild('pieChart') pieChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barChart') barChartRef!: ElementRef<HTMLCanvasElement>;

  groupEmail = 'cloudops@muraai.com';
  startDate = '';
  endDate = '';

  loading = false;
  backfilling = false;
  error = '';
  backfillResult: { total: number; updated: number; failed: number } | null = null;

  groupMembers: GroupMember[] = [];
  summaryRows: SummaryRow[] = [];
  detailRows: DetailRow[] = [];
  categoryData: CategoryData[] = [];

  private readonly reportCacheKey = 'ITSMS_REPORT_CACHE';

  private chartColors = [
    '#06b6d4', '#8b5cf6', '#f43f5e', '#f59e0b',
    '#10b981', '#3b82f6', '#ec4899', '#14b8a6'
  ];

  get isAdmin(): boolean {
    return (sessionStorage.getItem('role') || '') === 'admin';
  }

  get topAssignee(): SummaryRow | null {
    return this.summaryRows.reduce<SummaryRow | null>(
      (best, r) => (!best || r.assignedCount > best.assignedCount) ? r : best, null
    );
  }

  get topCloser(): SummaryRow | null {
    return this.summaryRows.reduce<SummaryRow | null>(
      (best, r) => (!best || r.closedCount > best.closedCount) ? r : best, null
    );
  }

  constructor(
    private assignmentService: AssignmentService,
    private msalService: MsalService
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const prior = new Date();
    prior.setDate(today.getDate() - 30);
    this.startDate = this.formatDate(prior);
    this.endDate = this.formatDate(today);

    if (this.isAdmin) {
      if (!this.loadReportFromCache()) {
        this.loadReport();
      }
    }
  }

  ngAfterViewInit(): void {}

  async loadReport(): Promise<void> {
    if (!this.isAdmin) return;

    this.loading = true;
    this.error = '';

    try {
      const graphToken = await this.msalService.getAccessToken([
        'User.Read',
        'GroupMember.Read.All',
        'Group.Read.All'
      ]);

      this.groupMembers = await firstValueFrom(
        this.assignmentService.getGroupMembers(this.groupEmail, graphToken)
      );

      if (this.groupMembers.length === 0) {
        this.error = 'No CloudOps members found.';
        this.summaryRows = [];
        this.detailRows = [];
        return;
      }

      const assignments = await firstValueFrom(this.assignmentService.getReportAssignments());
      this.buildReport(assignments);
      this.saveReportToCache();
      setTimeout(() => { this.drawPieChart(); this.drawBarChart(); }, 100);
    } catch (err: any) {
      this.error = err?.message || 'Failed to load report.';
      this.summaryRows = [];
      this.detailRows = [];
    } finally {
      this.loading = false;
    }
  }

  async backfillCategories(): Promise<void> {
    if (!this.isAdmin || this.backfilling) return;
    this.backfilling = true;
    this.backfillResult = null;
    this.error = '';
    try {
      const result = await firstValueFrom(this.assignmentService.backfillCategories());
      this.backfillResult = result;
      sessionStorage.removeItem(this.reportCacheKey);
      await this.loadReport();
    } catch (err: any) {
      this.error = err?.error?.message || err?.message || 'Backfill failed.';
    } finally {
      this.backfilling = false;
    }
  }

  getInitials(name: string): string {
    return name
      .split(/[\s@.]+/).filter(Boolean).slice(0, 2)
      .map(p => p[0].toUpperCase()).join('');
  }

  downloadExcel(): void {
    if (this.summaryRows.length === 0) return;

    const summarySheet = XLSX.utils.json_to_sheet(
      this.summaryRows.map(row => ({
        Name: row.displayName,
        Email: row.email,
        Assigned: row.assignedCount,
        Closed: row.closedCount
      }))
    );

    const detailSheet = XLSX.utils.json_to_sheet(
      this.detailRows.map(row => ({
        TicketNumber: row.ticketNumber,
        TicketId: row.ticketId,
        Category: row.category,
        PrimaryAssignee: row.primaryAssignee,
        AssignedUsers: row.assignedUsers,
        AssignedAt: row.assignedAt,
        Status: row.status,
        ClosedBy: row.closedBy,
        ClosedAt: row.closedAt
      }))
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Details');

    const filename = `cloudops-report-${this.startDate}-to-${this.endDate}.xlsx`;
    XLSX.writeFile(workbook, filename);
  }

  private buildReport(assignments: TicketAssignment[]): void {
    const { start, end } = this.getRange();
    const memberMap = new Map<string, GroupMember>();
    const summaryMap = new Map<string, SummaryRow>();
    const categoryMap = new Map<string, number>();
    const details: DetailRow[] = [];

    this.groupMembers.forEach(member => {
      const email = member.email.toLowerCase();
      memberMap.set(email, member);
      summaryMap.set(email, {
        email,
        displayName: member.displayName,
        assignedCount: 0,
        closedCount: 0
      });
    });

    assignments.forEach(assignment => {
      const assignedAt = assignment.assigned_at ? new Date(assignment.assigned_at) : null;
      const closedAt = assignment.closed_at ? new Date(assignment.closed_at) : null;
      const assignedInRange = assignedAt && assignedAt >= start && assignedAt <= end;
      const closedInRange = closedAt && closedAt >= start && closedAt <= end;

      const assignedUsers = (assignment.assigned_users || []).map(user => user.toLowerCase());
      const matchedAssigned = assignedUsers.filter(user => memberMap.has(user));
      const closedBy = (assignment.closed_by || '').toLowerCase();
      const closedByMember = closedBy && memberMap.has(closedBy);

      if (assignedInRange && matchedAssigned.length) {
        matchedAssigned.forEach(user => {
          const row = summaryMap.get(user);
          if (row) row.assignedCount += 1;
        });
      }

      if (closedInRange && closedByMember) {
        const row = summaryMap.get(closedBy);
        if (row) row.closedCount += 1;
      }

      if ((assignedInRange && matchedAssigned.length) || (closedInRange && closedByMember)) {
        const category = this.normalizeCategory(assignment.category);
        categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
        
        details.push({
          ticketId: assignment.zoho_ticket_id || '',
          ticketNumber: assignment.zoho_ticket_number || '',
          primaryAssignee: assignment.primary_assignee || '',
          assignedUsers: assignedUsers.join(', '),
          assignedAt: assignedAt ? assignedAt.toLocaleString() : '',
          status: assignment.status || '',
          closedBy: assignment.closed_by || '',
          closedAt: closedAt ? closedAt.toLocaleString() : '',
          category: category
        });
      }
    });

    // Build category data for pie chart
    const totalTickets = details.length;
    this.categoryData = Array.from(categoryMap.entries())
      .map(([name, count], index) => ({
        name,
        count,
        percentage: totalTickets > 0 ? Math.round((count / totalTickets) * 100) : 0,
        color: this.chartColors[index % this.chartColors.length]
      }))
      .sort((a, b) => b.count - a.count);

    this.summaryRows = Array.from(summaryMap.values()).sort((a, b) => {
      const aTotal = a.assignedCount + a.closedCount;
      const bTotal = b.assignedCount + b.closedCount;
      return bTotal - aTotal;
    });

    this.detailRows = details;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private getRange(): { start: Date; end: Date } {
    const start = new Date(`${this.startDate}T00:00:00`);
    const end = new Date(`${this.endDate}T23:59:59.999`);
    return { start, end };
  }

  private setupHiDpiCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || canvas.width));
    const height = Math.max(1, Math.round(rect.height || canvas.height));
    const targetWidth = Math.round(width * dpr);
    const targetHeight = Math.round(height * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    return { ctx, width, height };
  }

  private drawPieChart(): void {
    if (!this.pieChartRef?.nativeElement || this.categoryData.length === 0) return;

    const setup = this.setupHiDpiCanvas(this.pieChartRef.nativeElement);
    if (!setup) return;

    const { ctx, width, height } = setup;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 10;

    let startAngle = -Math.PI / 2;
    const total = this.detailRows.length;

    this.categoryData.forEach(cat => {
      const sliceAngle = (cat.count / total) * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = cat.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      startAngle += sliceAngle;
    });

    // Donut hole
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.52, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 22px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toString(), centerX, centerY - 8);
    ctx.font = '12px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Total', centerX, centerY + 12);
  }

  private drawBarChart(): void {
    if (!this.barChartRef?.nativeElement || this.summaryRows.length === 0) return;

    const setup = this.setupHiDpiCanvas(this.barChartRef.nativeElement);
    if (!setup) return;

    const { ctx, width: w, height: h } = setup;

    const rows = this.summaryRows
      .filter(r => r.assignedCount + r.closedCount > 0)
      .slice(0, 8);
    if (rows.length === 0) return;

    const pL = 96, pR = 28, pT = 8, pB = 20;
    const barAreaW = w - pL - pR;
    const barAreaH = h - pT - pB;
    const rowH = Math.floor(barAreaH / rows.length);
    const barH = Math.max(10, Math.floor(rowH * 0.52));
    const maxVal = Math.max(...rows.map(r => r.assignedCount + r.closedCount), 1);

    rows.forEach((row, i) => {
      const y = pT + i * rowH + (rowH - barH) / 2;
      const totalW = ((row.assignedCount + row.closedCount) / maxVal) * barAreaW;
      const assignedW = (row.assignedCount / (row.assignedCount + row.closedCount)) * totalW;
      const closedW = totalW - assignedW;

      // Closed portion (emerald)
      if (closedW > 0) {
        ctx.fillStyle = 'rgba(5,150,105,0.45)';
        roundRect(ctx, pL + assignedW, y, closedW, barH, 4);
        ctx.fill();
      }
      // Assigned portion (cyan)
      if (assignedW > 0) {
        ctx.fillStyle = 'rgba(37,99,235,0.8)';
        roundRect(ctx, pL, y, assignedW, barH, 4);
        ctx.fill();
      }

      // Name
      const label = (row.displayName || row.email).split('@')[0].slice(0, 13);
      ctx.fillStyle = '#334155';
      ctx.font = '12px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pL - 6, y + barH / 2);

      // Count
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((row.assignedCount + row.closedCount).toString(), pL + totalW + 5, y + barH / 2);
    });
  }

  private normalizeCategory(category?: string): string {
    const trimmed = (category || '').trim();
    if (!trimmed) return 'Uncategorized';

    const lower = trimmed.toLowerCase();
    if (lower === 'uncategory' || lower === 'uncategorized' || lower === 'uncategorised') {
      return 'Uncategorized';
    }

    if (trimmed === lower) {
      return trimmed.replace(/\s+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
    }

    return trimmed;
  }

  private loadReportFromCache(): boolean {
    try {
      const raw = sessionStorage.getItem(this.reportCacheKey);
      if (!raw) return false;

      const cache = JSON.parse(raw);
      if (!cache || cache.groupEmail !== this.groupEmail) return false;
      if (cache.startDate !== this.startDate || cache.endDate !== this.endDate) return false;

      this.summaryRows = cache.summaryRows || [];
      this.detailRows = cache.detailRows || [];
      this.categoryData = cache.categoryData || [];

      if (this.categoryData.length) {
        setTimeout(() => { this.drawPieChart(); this.drawBarChart(); }, 0);
      }

      return true;
    } catch {
      return false;
    }
  }

  private saveReportToCache(): void {
    try {
      const payload = {
        groupEmail: this.groupEmail,
        startDate: this.startDate,
        endDate: this.endDate,
        summaryRows: this.summaryRows,
        detailRows: this.detailRows,
        categoryData: this.categoryData
      };
      sessionStorage.setItem(this.reportCacheKey, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }
}
