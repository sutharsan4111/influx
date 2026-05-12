import { Component, OnInit, ViewChild, ElementRef, AfterViewInit, Input } from '@angular/core';
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

interface MonthlyTrendPoint {
  month: string;
  count: number;
}

interface ResponseAnalystRow {
  email: string;
  displayName: string;
  ticketCount: number;
  avgHours: number;
}

interface ResolutionDistributionRow {
  label: string;
  count: number;
  color: string;
}

interface SimpleCountRow {
  name: string;
  count: number;
}

interface SlaMemberRow {
  email: string;
  displayName: string;
  sla: number;
  tickets: number;
  withinTarget: number;
  color: string;
}

type SortMetric = 'total' | 'assigned' | 'closed' | 'resolution';
type ReportPeriod = 'custom' | 'monthly' | 'quarterly' | 'halfyearly' | 'annual';

@Component({
  selector: 'app-admin-report',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="report-page">
      <!-- ── Notices ── -->
      <div class="notice warn" *ngIf="!isAdmin">You do not have access to this report.</div>
      <div class="notice err"  *ngIf="error && isAdmin">{{ error }}</div>
      <div class="notice info" *ngIf="backfillResult">
        Categories updated — <strong>{{ backfillResult.updated }}</strong> fixed,
        {{ backfillResult.failed }} skipped out of {{ backfillResult.total }}.
      </div>

      <!-- ── Spinner ── -->
      <div class="spinner-wrap" *ngIf="loading">
        <div class="spinner"></div><span>Loading report...</span>
      </div>

      <!-- ── Metric cards ── -->
      <div class="metrics-row" *ngIf="!loading && summaryRows.length > 0">
        <div class="metric-card cyan clickable" [class.active]="activeSortMetric === 'total'" (click)="setSortMetric('total')">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ detailRows.length }}</div>
            <div class="metric-label">Total Tickets</div>
            <div class="metric-sub">{{ startDate }} → {{ endDate }}</div>
          </div>
        </div>
        <div class="metric-card green">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9S3 16.97 3 12 7.03 3 12 3s9 4.03 9 9z"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ slaCompliance }}%</div>
            <div class="metric-label">Critical Compliance</div>
            <div class="metric-sub">Resolved within 24h</div>
          </div>
        </div>
        <div class="metric-card blue clickable" [class.active]="activeSortMetric === 'closed'" (click)="setSortMetric('closed')">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ resolvedPct }}%</div>
            <div class="metric-label">Resolved %</div>
            <div class="metric-sub">{{ closedCount }} of {{ detailRows.length }} closed</div>
          </div>
        </div>
        <div class="metric-card emerald clickable" *ngIf="topAssignee" [class.active]="activeSortMetric === 'assigned'" (click)="setSortMetric('assigned')">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ topAssignee.assignedCount }}</div>
            <div class="metric-label">Top Assignee</div>
            <div class="metric-sub">{{ topAssignee.displayName || topAssignee.email }}</div>
          </div>
        </div>
        <div class="metric-card rose clickable" *ngIf="topCloser" [class.active]="activeSortMetric === 'closed'" (click)="setSortMetric('closed')">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ topCloser.closedCount }}</div>
            <div class="metric-label">Top Closer</div>
            <div class="metric-sub">{{ topCloser.displayName || topCloser.email }}</div>
          </div>
        </div>
        <div class="metric-card amber clickable" [class.active]="activeSortMetric === 'resolution'" (click)="setSortMetric('resolution')">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ avgResolutionHours }}h</div>
            <div class="metric-label">Avg Resolution Time</div>
            <div class="metric-sub">Across closed tickets</div>
          </div>
        </div>
        <div class="metric-card slate">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ openBacklog }}</div>
            <div class="metric-label">Open Backlog</div>
            <div class="metric-sub">Open tickets in selected range</div>
          </div>
        </div>
        <div class="metric-card indigo">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ peakHourLabel }}</div>
            <div class="metric-label">Peak Hour</div>
            <div class="metric-sub">{{ peakHourCount }} tickets</div>
          </div>
        </div>
        <div class="metric-card teal">
          <div class="metric-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div>
            <div class="metric-value">{{ peakDayLabel }}</div>
            <div class="metric-label">Peak Day</div>
            <div class="metric-sub">{{ peakDayCount }} tickets</div>
          </div>
        </div>
      </div>

      <!-- ── Critical & Quality (24h Target) ── -->
      <div class="section" *ngIf="!loading && slaByMember.length > 0">
        <div class="sla-kicker"><span class="sla-kicker-dot"></span>CRITICAL & QUALITY</div>
        <div class="sla-shell">
          <h3 class="sla-main-title">Critical Compliance (24h Target)</h3>

          <div class="sla-grid">
            <div class="sla-overall-card">
              <div class="sla-overall-value">{{ slaCompliance }}%</div>
              <div class="sla-overall-label">Overall Critical Compliance</div>
              <div class="sla-overall-sub">{{ slaWithinTargetCount }} of {{ closedCount }} tickets within 24h</div>
            </div>

            <div class="sla-member-card">
              <div class="sla-member-title">Critical % by Team Member</div>
              <div class="sla-axis">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
              <div class="sla-member-row" *ngFor="let row of slaByMember">
                <span class="sla-member-name">{{ row.displayName || row.email }}</span>
                <div class="sla-member-track">
                  <span class="sla-member-fill" [style.width.%]="row.sla" [style.background]="row.color"></span>
                </div>
                <span class="sla-member-pct">{{ row.sla }}%</span>
              </div>
            </div>
          </div>

          <div class="sla-insights">
            <div class="sla-insight good">
              <div class="sla-insight-title">Top Performers</div>
              <p>{{ topPerformersText }}</p>
            </div>
            <div class="sla-insight alert">
              <div class="sla-insight-title">Action Required</div>
              <p>{{ actionRequiredText }}</p>
            </div>
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

      <!-- ── Resolution by Category ── -->
      <div class="section" *ngIf="!loading && resolutionByCategoryData.length > 0">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Avg Resolution Time by Category
        </div>
        <div class="chart-card resolution-chart-card">
          <div class="chart-title">Hours to resolve — average per category (sorted fastest → slowest)</div>
          <canvas #resolutionChart width="800" height="240"></canvas>
          <div class="res-legend">
            <div class="res-legend-item" *ngFor="let d of resolutionByCategoryData">
              <span class="legend-dot" [style.background]="d.color"></span>
              <span class="legend-name">{{ d.name }}</span>
              <span class="legend-val">{{ d.avgHours }}h</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Monthly Trends ── -->
      <div class="section" *ngIf="!loading && monthlyTrendData.length > 0">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 6 13.5 14.5 8.5 9.5 2 16"/></svg>
          Monthly Ticket Trends
        </div>
        <div class="chart-card resolution-chart-card">
          <div class="chart-title">Tickets created per month</div>
          <canvas #monthlyTrendChart width="800" height="220"></canvas>
          <div class="res-legend">
            <div class="res-legend-item" *ngFor="let m of monthlyTrendData">
              <span class="legend-name">{{ m.month }}</span>
              <span class="legend-val">{{ m.count }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Response Analysis ── -->
      <div class="section" *ngIf="!loading && (fastestResponders.length > 0 || needsImprovementResponders.length > 0)">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 2 2 5-5"/></svg>
          Response Time Analysis
        </div>
        <div class="insights-grid two-col">
          <div class="insight-card success">
            <div class="insight-title">Fastest Responders</div>
            <div class="insight-row" *ngFor="let r of fastestResponders">
              <span>{{ r.displayName || r.email }}</span>
              <strong>{{ r.avgHours }}h</strong>
            </div>
          </div>
          <div class="insight-card warning">
            <div class="insight-title">Needs Improvement</div>
            <div class="insight-row" *ngFor="let r of needsImprovementResponders">
              <span>{{ r.displayName || r.email }}</span>
              <strong>{{ r.avgHours }}h</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Quality & Reopened ── -->
      <div class="section" *ngIf="!loading && (resolutionDistribution.length > 0 || reopenedByOwner.length > 0)">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          Quality & Reopened Tickets
        </div>
        <div class="insights-grid two-col">
          <div class="insight-card">
            <div class="insight-title">Resolution Time Distribution</div>
            <div class="dist-row" *ngFor="let bucket of resolutionDistribution">
              <span class="dist-label">{{ bucket.label }}</span>
              <div class="dist-track">
                <span class="dist-fill" [style.width.%]="getDistributionWidth(bucket.count)" [style.background]="bucket.color"></span>
              </div>
              <strong>{{ bucket.count }}</strong>
            </div>
          </div>
          <div class="insight-card">
            <div class="insight-title">Reopened Tickets by Owner</div>
            <div class="insight-row" *ngFor="let row of reopenedByOwner">
              <span>{{ row.name }}</span>
              <strong>{{ row.count }}</strong>
            </div>
            <div class="empty-state" *ngIf="reopenedByOwner.length === 0">No reopened tickets in this range.</div>
          </div>
        </div>
      </div>

      <!-- ── Top Requesters ── -->
      <div class="section" *ngIf="!loading && topRequesters.length > 0">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          Top Ticket Requesters
        </div>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr><th>#</th><th>Requester</th><th>Tickets</th></tr></thead>
            <tbody>
              <tr *ngFor="let requester of topRequesters; let i = index">
                <td class="rank">{{ i + 1 }}</td>
                <td>{{ requester.name }}</td>
                <td class="bold">{{ requester.count }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ── Summary table ── -->
      <div class="section" *ngIf="!loading && summaryRows.length > 0">
        <div class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          Member Summary ({{ activeSortLabel }}, high to low)
        </div>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>#</th><th>Name</th><th>Email</th>
              <th>Assigned</th><th>Closed</th><th>Total</th>
            </tr></thead>
            <tbody>
              <tr *ngFor="let row of sortedSummaryRows; let i = index">
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
        <div class="table-wrap detail-table-wrap">
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
    .date-filters select {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #0f172a;
      padding: 5px 9px;
      border-radius: 6px;
      font-size: 12px;
    }
    .date-filters input:focus { outline: none; border-color: #06b6d4; }
    .date-filters select:focus { outline: none; border-color: #06b6d4; }
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
      grid-template-columns: repeat(3, 1fr);
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
    .metric-card.clickable { cursor: pointer; }
    .metric-card.clickable.active {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.14);
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
    .metric-card.green  .metric-icon { background: rgba(34,197,94,.13);  color: #16a34a; }
    .metric-card.blue   .metric-icon { background: rgba(59,130,246,.13); color: #2563eb; }
    .metric-card.amber  .metric-icon { background: rgba(245,158,11,.13); color: #d97706; }
    .metric-card.slate  .metric-icon { background: rgba(71,85,105,.12); color: #475569; }
    .metric-card.indigo .metric-icon { background: rgba(79,70,229,.12); color: #4f46e5; }
    .metric-card.teal   .metric-icon { background: rgba(13,148,136,.12); color: #0f766e; }
    .metric-card.green:hover  { border-color: rgba(34,197,94,.4); }
    .metric-card.blue:hover   { border-color: rgba(59,130,246,.4); }
    .metric-card.amber:hover  { border-color: rgba(245,158,11,.4); }
    .metric-card.slate:hover  { border-color: rgba(71,85,105,.4); }
    .metric-card.indigo:hover { border-color: rgba(79,70,229,.4); }
    .metric-card.teal:hover   { border-color: rgba(13,148,136,.4); }
    .metric-card.green   .metric-value { color: #16a34a; }
    .metric-card.blue    .metric-value { color: #2563eb; }
    .metric-card.amber   .metric-value { color: #d97706; }
    .metric-card.slate   .metric-value { color: #334155; }
    .metric-card.indigo  .metric-value { color: #4f46e5; }
    .metric-card.teal    .metric-value { color: #0f766e; }
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
    .resolution-chart-card { padding: 18px; margin: 0; }
    .res-legend {
      display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 10px;
    }
    .res-legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; }

    .insights-grid {
      display: grid;
      gap: 14px;
    }
    .insights-grid.two-col { grid-template-columns: 1fr 1fr; }
    .insight-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px;
    }
    .insight-card.success { border-color: rgba(22, 163, 74, 0.28); }
    .insight-card.warning { border-color: rgba(217, 119, 6, 0.28); }
    .insight-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .insight-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      padding: 7px 0;
      border-bottom: 1px solid #f1f5f9;
      font-size: 12px;
      color: #0f172a;
    }
    .insight-row:last-child { border-bottom: none; }

    .dist-row {
      display: grid;
      grid-template-columns: 112px 1fr auto;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .dist-label { color: #334155; }
    .dist-track {
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
    }
    .dist-fill {
      height: 100%;
      display: block;
      border-radius: 999px;
    }
    .empty-state {
      margin-top: 8px;
      font-size: 12px;
      color: #64748b;
    }
    .bar-legend {
      display: flex; align-items: center; gap: 12px; margin-top: 8px;
      font-size: 11px; color: #475569;
    }
    .bar-key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
    .bar-key.assigned { background: rgba(37,99,235,.8); }
    .bar-key.total    { background: rgba(5,150,105,.45); }

    /* ── Critical block ── */
    .sla-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 18px 0 10px;
      color: #22d3ee;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .sla-kicker-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 2px solid #06b6d4;
      box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.15);
    }
    .sla-shell {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 18px;
      background: #ffffff;
      color: #0f172a;
    }
    .sla-main-title {
      margin: 0 0 14px;
      font-size: 18px;
      color: #0f172a;
      font-weight: 700;
    }
    .sla-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .sla-overall-card,
    .sla-member-card {
      border: 1px solid #dbeafe;
      border-radius: 12px;
      padding: 16px;
      background: #f8fafc;
    }
    .sla-overall-card {
      background: linear-gradient(135deg, #fff1f5 0%, #eef2ff 100%);
      border-color: #fbcfe8;
    }
    .sla-overall-value {
      font-size: 46px;
      line-height: 1;
      font-weight: 700;
      color: #fb7185;
    }
    .sla-overall-label {
      margin-top: 8px;
      font-size: 16px;
      font-weight: 600;
      color: #0f172a;
    }
    .sla-overall-sub {
      margin-top: 8px;
      font-size: 13px;
      color: #64748b;
    }
    .sla-member-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;
      color: #0f172a;
    }
    .sla-axis {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      margin: 0 0 8px 164px;
      color: #64748b;
      font-size: 12px;
    }
    .sla-axis span:last-child { text-align: right; }
    .sla-member-row {
      display: grid;
      grid-template-columns: 154px 1fr 52px;
      align-items: center;
      gap: 10px;
      margin-bottom: 9px;
    }
    .sla-member-name {
      color: #334155;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sla-member-track {
      height: 12px;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
      border: 1px solid #cbd5e1;
    }
    .sla-member-fill {
      height: 100%;
      display: block;
      border-radius: 999px;
      min-width: 4px;
    }
    .sla-member-pct {
      text-align: right;
      font-size: 13px;
      color: #334155;
      font-weight: 600;
    }
    .sla-insights {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .sla-insight {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 16px;
      background: #ffffff;
    }
    .sla-insight-title {
      font-size: clamp(18px, 1.7vw, 28px);
      font-weight: 700;
      margin-bottom: 6px;
    }
    .sla-insight p {
      margin: 0;
      font-size: clamp(14px, 1.1vw, 18px);
      line-height: 1.5;
      color: #334155;
    }
    .sla-insight.good {
      border-color: #99f6e4;
      background: #f0fdfa;
    }
    .sla-insight.good .sla-insight-title { color: #2dd4bf; }
    .sla-insight.alert {
      border-color: #fbcfe8;
      background: #fdf2f8;
    }
    .sla-insight.alert .sla-insight-title { color: #fb7185; }

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
    .detail-table-wrap {
      max-height: 1040px;
      overflow-y: auto;
    }
    .detail-table-wrap .report-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #f8fafc;
    }
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
      .insights-grid.two-col { grid-template-columns: 1fr; }
      .sla-grid { grid-template-columns: 1fr; }
      .sla-insights { grid-template-columns: 1fr; }
      .sla-axis { margin-left: 0; font-size: 11px; }
      .sla-member-row { grid-template-columns: 110px 1fr 44px; }
      .sla-member-name { font-size: 12px; }
      .sla-member-pct { text-align: left; }
    }
    @media (max-width: 600px) {
      .metrics-row { grid-template-columns: 1fr; }
      .page-header { flex-direction: column; }
      .header-actions { align-items: flex-start; }
    }

    /* ════════════════════════════════════════════
       DARK THEME OVERRIDES
       ════════════════════════════════════════════ */
    :host-context(body.dark-theme) .report-page {
      background: #0f172a;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .page-header {
      border-bottom-color: #1f2937;
    }
    :host-context(body.dark-theme) .header-left h2 { color: #f1f5f9; }
    :host-context(body.dark-theme) .header-sub { color: #94a3b8; }
    :host-context(body.dark-theme) .header-label { color: #22d3ee; }
    :host-context(body.dark-theme) .date-filters label { color: #cbd5e1; }
    :host-context(body.dark-theme) .date-filters input {
      background: #0b1220;
      border-color: #334155;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .date-filters select {
      background: #0b1220;
      border-color: #334155;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .date-filters input::placeholder { color: #64748b; }
    :host-context(body.dark-theme) .date-filters input:focus { border-color: #22d3ee; }
    :host-context(body.dark-theme) .date-filters select:focus { border-color: #22d3ee; }
    :host-context(body.dark-theme) .group-pill {
      background: rgba(59, 130, 246, 0.15);
      border-color: rgba(96, 165, 250, 0.35);
      color: #93c5fd;
    }

    /* Buttons */
    :host-context(body.dark-theme) .btn {
      background: #1e293b;
      border-color: #334155;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .btn:hover:not(:disabled) {
      background: #273449;
      border-color: #475569;
      color: #f1f5f9;
    }
    :host-context(body.dark-theme) .btn-backfill {
      background: rgba(8, 145, 178, 0.18);
      border-color: rgba(34, 211, 238, 0.35);
      color: #67e8f9;
    }
    :host-context(body.dark-theme) .btn-backfill:hover:not(:disabled) {
      background: rgba(8, 145, 178, 0.28);
    }
    :host-context(body.dark-theme) .btn-primary {
      background: #2563eb;
      border-color: #3b82f6;
      color: #f0f9ff;
    }
    :host-context(body.dark-theme) .btn-primary:hover:not(:disabled) {
      background: #1d4ed8;
    }

    /* Notices */
    :host-context(body.dark-theme) .notice.warn {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.45);
      color: #fbbf24;
    }
    :host-context(body.dark-theme) .notice.err {
      background: rgba(239, 68, 68, 0.12);
      border-color: rgba(248, 113, 113, 0.45);
      color: #fca5a5;
    }
    :host-context(body.dark-theme) .notice.info {
      background: rgba(59, 130, 246, 0.14);
      border-color: rgba(96, 165, 250, 0.45);
      color: #93c5fd;
    }

    /* Spinner */
    :host-context(body.dark-theme) .spinner-wrap { color: #60a5fa; }
    :host-context(body.dark-theme) .spinner {
      border-color: rgba(96, 165, 250, 0.25);
      border-top-color: #22d3ee;
    }

    /* Metric cards */
    :host-context(body.dark-theme) .metric-card {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .metric-card.clickable.active {
      border-color: #60a5fa;
      box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.22);
    }
    :host-context(body.dark-theme) .metric-card.cyan:hover    { border-color: rgba(34, 211, 238, .55); }
    :host-context(body.dark-theme) .metric-card.violet:hover  { border-color: rgba(167, 139, 250, .55); }
    :host-context(body.dark-theme) .metric-card.emerald:hover { border-color: rgba(52, 211, 153, .55); }
    :host-context(body.dark-theme) .metric-card.rose:hover    { border-color: rgba(251, 113, 133, .55); }
    :host-context(body.dark-theme) .metric-card.green:hover   { border-color: rgba(74, 222, 128, .55); }
    :host-context(body.dark-theme) .metric-card.blue:hover    { border-color: rgba(96, 165, 250, .55); }
    :host-context(body.dark-theme) .metric-card.amber:hover   { border-color: rgba(251, 191, 36, .55); }
    :host-context(body.dark-theme) .metric-card.slate:hover   { border-color: rgba(148, 163, 184, .55); }
    :host-context(body.dark-theme) .metric-card.indigo:hover  { border-color: rgba(129, 140, 248, .55); }
    :host-context(body.dark-theme) .metric-card.teal:hover    { border-color: rgba(45, 212, 191, .55); }
    :host-context(body.dark-theme) .metric-card.cyan    .metric-value { color: #22d3ee; }
    :host-context(body.dark-theme) .metric-card.violet  .metric-value { color: #a78bfa; }
    :host-context(body.dark-theme) .metric-card.emerald .metric-value { color: #34d399; }
    :host-context(body.dark-theme) .metric-card.rose    .metric-value { color: #fb7185; }
    :host-context(body.dark-theme) .metric-card.green   .metric-value { color: #4ade80; }
    :host-context(body.dark-theme) .metric-card.blue    .metric-value { color: #60a5fa; }
    :host-context(body.dark-theme) .metric-card.amber   .metric-value { color: #fbbf24; }
    :host-context(body.dark-theme) .metric-card.slate   .metric-value { color: #cbd5e1; }
    :host-context(body.dark-theme) .metric-card.indigo  .metric-value { color: #818cf8; }
    :host-context(body.dark-theme) .metric-card.teal    .metric-value { color: #2dd4bf; }
    :host-context(body.dark-theme) .metric-label { color: #cbd5e1; }
    :host-context(body.dark-theme) .metric-sub   { color: #94a3b8; }

    /* Charts */
    :host-context(body.dark-theme) .chart-card {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .chart-title { color: #f1f5f9; }
    :host-context(body.dark-theme) .legend-name { color: #cbd5e1; }
    :host-context(body.dark-theme) .legend-val  { color: #f1f5f9; }
    :host-context(body.dark-theme) .legend-pct  { color: #94a3b8; }

    /* Insights */
    :host-context(body.dark-theme) .insight-card {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .insight-card.success { border-color: rgba(52, 211, 153, 0.4); }
    :host-context(body.dark-theme) .insight-card.warning { border-color: rgba(251, 191, 36, 0.4); }
    :host-context(body.dark-theme) .insight-title { color: #cbd5e1; }
    :host-context(body.dark-theme) .insight-row {
      color: #e2e8f0;
      border-bottom-color: #1f2937;
    }

    /* Distributions */
    :host-context(body.dark-theme) .dist-label { color: #cbd5e1; }
    :host-context(body.dark-theme) .dist-track { background: #0b1220; }
    :host-context(body.dark-theme) .empty-state { color: #94a3b8; }
    :host-context(body.dark-theme) .bar-legend  { color: #94a3b8; }

    /* Critical block */
    :host-context(body.dark-theme) .sla-shell {
      background: #1e293b;
      border-color: #334155;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .sla-main-title { color: #f1f5f9; }
    :host-context(body.dark-theme) .sla-overall-card,
    :host-context(body.dark-theme) .sla-member-card {
      background: #0b1220;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .sla-overall-card {
      background: linear-gradient(135deg, rgba(244, 63, 94, 0.12) 0%, rgba(99, 102, 241, 0.16) 100%);
      border-color: rgba(251, 113, 133, 0.35);
    }
    :host-context(body.dark-theme) .sla-overall-value { color: #fb7185; }
    :host-context(body.dark-theme) .sla-overall-label { color: #f1f5f9; }
    :host-context(body.dark-theme) .sla-overall-sub   { color: #94a3b8; }
    :host-context(body.dark-theme) .sla-member-title  { color: #f1f5f9; }
    :host-context(body.dark-theme) .sla-axis          { color: #94a3b8; }
    :host-context(body.dark-theme) .sla-member-name   { color: #cbd5e1; }
    :host-context(body.dark-theme) .sla-member-track {
      background: #0b1220;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .sla-member-pct  { color: #cbd5e1; }
    :host-context(body.dark-theme) .sla-insight {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .sla-insight p { color: #cbd5e1; }
    :host-context(body.dark-theme) .sla-insight.good {
      background: rgba(45, 212, 191, 0.10);
      border-color: rgba(45, 212, 191, 0.35);
    }
    :host-context(body.dark-theme) .sla-insight.alert {
      background: rgba(251, 113, 133, 0.10);
      border-color: rgba(251, 113, 133, 0.35);
    }

    /* Section headers */
    :host-context(body.dark-theme) .section-title  { color: #cbd5e1; }
    :host-context(body.dark-theme) .section-title svg { color: #22d3ee; }
    :host-context(body.dark-theme) .detail-count   { color: #94a3b8; }

    /* Tables */
    :host-context(body.dark-theme) .table-wrap {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .detail-table-wrap .report-table thead th {
      background: #0b1220;
    }
    :host-context(body.dark-theme) .report-table th {
      background: #0b1220;
      color: #cbd5e1;
      border-bottom-color: #334155;
    }
    :host-context(body.dark-theme) .report-table td {
      color: #e2e8f0;
      border-bottom-color: #1f2937;
    }
    :host-context(body.dark-theme) .report-table tbody tr:hover td { background: #273449; }
    :host-context(body.dark-theme) .name-cell { color: #f1f5f9; }
    :host-context(body.dark-theme) .rank      { color: #94a3b8; }
    :host-context(body.dark-theme) .dim       { color: #94a3b8; }
    :host-context(body.dark-theme) .bold      { color: #f1f5f9; }
    :host-context(body.dark-theme) .badge.assigned {
      background: rgba(96, 165, 250, 0.18);
      color: #93c5fd;
    }
    :host-context(body.dark-theme) .badge.closed {
      background: rgba(52, 211, 153, 0.18);
      color: #6ee7b7;
    }
    :host-context(body.dark-theme) .mono { color: #93c5fd; }
    :host-context(body.dark-theme) .cat-pill {
      background: rgba(167, 139, 250, 0.16);
      color: #c4b5fd;
      border-color: rgba(167, 139, 250, 0.35);
    }
    :host-context(body.dark-theme) .status-pill.open   { background: rgba(34, 211, 238, 0.16); color: #67e8f9; }
    :host-context(body.dark-theme) .status-pill.closed { background: rgba(52, 211, 153, 0.16); color: #6ee7b7; }
    :host-context(body.dark-theme) .ts { color: #94a3b8; }
  `]
})
export class ReportComponent implements OnInit, AfterViewInit {
  @ViewChild('pieChart') pieChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barChart') barChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('resolutionChart') resolutionChartRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('monthlyTrendChart') monthlyTrendChartRef!: ElementRef<HTMLCanvasElement>;

  @Input() isEmbedded = false;

  groupEmail = 'cloudops@muraai.com';
  startDate = '';
  endDate = '';
  selectedPeriod: ReportPeriod = 'monthly';

  loading = false;
  backfilling = false;
  error = '';
  backfillResult: { total: number; updated: number; failed: number } | null = null;

  groupMembers: GroupMember[] = [];
  private rawAssignments: TicketAssignment[] = [];
  summaryRows: SummaryRow[] = [];
  detailRows: DetailRow[] = [];
  categoryData: CategoryData[] = [];

  // Resolution & Critical metrics
  slaCompliance = 0;
  resolvedPct = 0;
  avgResolutionHours = 0;
  closedCount = 0;
  resolutionByCategoryData: { name: string; avgHours: number; color: string }[] = [];
  openBacklog = 0;
  peakHourLabel = '-';
  peakHourCount = 0;
  peakDayLabel = '-';
  peakDayCount = 0;
  monthlyTrendData: MonthlyTrendPoint[] = [];
  fastestResponders: ResponseAnalystRow[] = [];
  needsImprovementResponders: ResponseAnalystRow[] = [];
  resolutionDistribution: ResolutionDistributionRow[] = [];
  reopenedByOwner: SimpleCountRow[] = [];
  topRequesters: SimpleCountRow[] = [];
  slaByMember: SlaMemberRow[] = [];
  topSlaPerformers: SlaMemberRow[] = [];
  slaActionRequired: SlaMemberRow[] = [];
  slaWithinTargetCount = 0;

  activeSortMetric: SortMetric = 'total';
  memberAvgResolutionMap: Record<string, number> = {};

  private readonly reportCacheKey = 'ITSMS_REPORT_CACHE';
  private static readonly REPORT_CACHE_TTL_MS = 10 * 60 * 1000;

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

  get activeSortLabel(): string {
    switch (this.activeSortMetric) {
      case 'assigned': return 'Assigned';
      case 'closed': return 'Closed';
      case 'resolution': return 'Resolution Speed';
      default: return 'Total Activity';
    }
  }

  get sortedSummaryRows(): SummaryRow[] {
    const rows = [...this.summaryRows];
    if (this.activeSortMetric === 'assigned') {
      return rows.sort((a, b) => b.assignedCount - a.assignedCount);
    }
    if (this.activeSortMetric === 'closed') {
      return rows.sort((a, b) => b.closedCount - a.closedCount);
    }
    if (this.activeSortMetric === 'resolution') {
      return rows.sort((a, b) => {
        const aAvg = this.memberAvgResolutionMap[a.email] ?? Number.POSITIVE_INFINITY;
        const bAvg = this.memberAvgResolutionMap[b.email] ?? Number.POSITIVE_INFINITY;
        const aScore = Number.isFinite(aAvg) && aAvg > 0 ? a.closedCount / aAvg : 0;
        const bScore = Number.isFinite(bAvg) && bAvg > 0 ? b.closedCount / bAvg : 0;
        return bScore - aScore;
      });
    }
    return rows.sort((a, b) => (b.assignedCount + b.closedCount) - (a.assignedCount + a.closedCount));
  }

  get topPerformersText(): string {
    if (this.topSlaPerformers.length === 0) {
      return 'No Critical data available in this date range.';
    }
    return this.topSlaPerformers
      .map(row => `${row.displayName || row.email} (${row.sla}%)`)
      .join(', ') + ' consistently meet Critical targets';
  }

  get actionRequiredText(): string {
    if (this.slaActionRequired.length === 0) {
      return 'No at-risk members detected for this date range.';
    }
    return this.slaActionRequired
      .map(row => `${row.displayName || row.email} (${row.sla}%)`)
      .join(', ') + ' need workload review or additional support';
  }

  constructor(
    private assignmentService: AssignmentService,
    private msalService: MsalService
  ) {}

  ngOnInit(): void {
    this.applyPresetDateRange('monthly');

    if (this.isAdmin) {
      const loadedFromCache = this.loadReportFromCache(true);
      if (loadedFromCache) {
        // Keep UI instant and refresh in background when cache is stale.
        queueMicrotask(() => {
          this.loadReport(true, true);
        });
      } else {
        this.loadReport();
      }
    }
  }

  ngAfterViewInit(): void {}

  onPeriodChange(): void {
    if (this.selectedPeriod === 'custom') return;
    this.applyPresetDateRange(this.selectedPeriod);
    if (this.rawAssignments.length > 0 && this.groupMembers.length > 0) {
      this.buildReport(this.rawAssignments);
      setTimeout(() => {
        this.drawPieChart();
        this.drawBarChart();
        this.drawResolutionCategoryChart();
        this.drawMonthlyTrendChart();
      }, 100);
      return;
    }
    this.applyDateRange();
  }

  onDateInputChange(): void {
    this.selectedPeriod = 'custom';
  }

  applyDateRange(): void {
    sessionStorage.removeItem(this.reportCacheKey);
    this.loadReport(true);
  }

  async loadReport(forceRefresh = false, silent = false): Promise<void> {
    if (!this.isAdmin) return;

    if (!forceRefresh && this.loadReportFromCache()) {
      return;
    }

    this.loading = !silent;
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
      this.rawAssignments = assignments;
      this.buildReport(assignments);
      this.saveReportToCache();
      setTimeout(() => {
        this.drawPieChart();
        this.drawBarChart();
        this.drawResolutionCategoryChart();
        this.drawMonthlyTrendChart();
      }, 100);
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

  setSortMetric(metric: SortMetric): void {
    this.activeSortMetric = metric;
  }

  getDistributionWidth(count: number): number {
    const max = Math.max(...this.resolutionDistribution.map(item => item.count), 1);
    return Math.max(5, Math.round((count / max) * 100));
  }

  downloadExcel(): void {
    if (this.summaryRows.length === 0) return;

    const overviewSheet = XLSX.utils.json_to_sheet([{
      'Report Period': `${this.startDate} to ${this.endDate}`,
      'Total Tickets': this.detailRows.length,
      'Closed Tickets': this.closedCount,
      'Resolved %': this.resolvedPct + '%',
      'Critical Compliance (within 24h)': this.slaCompliance + '%',
      'Avg Resolution Time (h)': this.avgResolutionHours
    }]);

    const summarySheet = XLSX.utils.json_to_sheet(
      this.summaryRows.map(row => ({
        Name: row.displayName,
        Email: row.email,
        Assigned: row.assignedCount,
        Closed: row.closedCount,
        Total: row.assignedCount + row.closedCount
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

    const categorySheet = XLSX.utils.json_to_sheet(
      this.categoryData.map(cat => ({
        Category: cat.name,
        Count: cat.count,
        'Percentage': cat.percentage + '%'
      }))
    );

    const resolutionSheet = XLSX.utils.json_to_sheet(
      this.resolutionByCategoryData.map(d => ({
        Category: d.name,
        'Avg Resolution Time (h)': d.avgHours
      }))
    );

    const monthlyTrendSheet = XLSX.utils.json_to_sheet(
      this.monthlyTrendData.map(row => ({
        Month: row.month,
        Tickets: row.count
      }))
    );

    const responseAnalysisSheet = XLSX.utils.json_to_sheet(
      [...this.fastestResponders, ...this.needsImprovementResponders]
        .reduce<ResponseAnalystRow[]>((acc, row) => {
          if (!acc.some(existing => existing.email === row.email)) {
            acc.push(row);
          }
          return acc;
        }, [])
        .map(row => ({
          Member: row.displayName || row.email,
          Email: row.email,
          'Closed Tickets': row.ticketCount,
          'Avg Response/Resolution (h)': row.avgHours
        }))
    );

    const qualitySheet = XLSX.utils.json_to_sheet(
      this.resolutionDistribution.map(row => ({
        Bucket: row.label,
        Tickets: row.count
      }))
    );

    const reopenedSheet = XLSX.utils.json_to_sheet(
      this.reopenedByOwner.map(row => ({
        Owner: row.name,
        Reopened: row.count
      }))
    );

    const topRequesterSheet = XLSX.utils.json_to_sheet(
      this.topRequesters.map(row => ({
        Requester: row.name,
        Tickets: row.count
      }))
    );

    const slaByMemberSheet = XLSX.utils.json_to_sheet(
      this.slaByMember.map(row => ({
        Member: row.displayName || row.email,
        Email: row.email,
        'Closed Tickets': row.tickets,
        'Within 24h': row.withinTarget,
        'Critical %': row.sla
      }))
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview');
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Team Summary');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Ticket Details');
    XLSX.utils.book_append_sheet(workbook, categorySheet, 'By Category');
    XLSX.utils.book_append_sheet(workbook, resolutionSheet, 'Resolution Time');
    XLSX.utils.book_append_sheet(workbook, monthlyTrendSheet, 'Monthly Trends');
    XLSX.utils.book_append_sheet(workbook, responseAnalysisSheet, 'Response Analysis');
    XLSX.utils.book_append_sheet(workbook, qualitySheet, 'Resolution Distribution');
    XLSX.utils.book_append_sheet(workbook, reopenedSheet, 'Reopened by Owner');
    XLSX.utils.book_append_sheet(workbook, topRequesterSheet, 'Top Requesters');
    XLSX.utils.book_append_sheet(workbook, slaByMemberSheet, 'Critical by Member');

    const filename = `cloudops-report-${this.startDate}-to-${this.endDate}.xlsx`;
    XLSX.writeFile(workbook, filename);
  }

  private buildReport(assignments: TicketAssignment[]): void {
    const { start, end } = this.getRange();
    const memberMap = new Map<string, GroupMember>();
    const summaryMap = new Map<string, SummaryRow>();
    const categoryMap = new Map<string, number>();
    const details: DetailRow[] = [];
    const allResolutionHours: number[] = [];
    const catResolutionMap = new Map<string, number[]>();
    const hourMap = new Map<number, number>();
    const dayMap = new Map<number, number>();
    const monthMap = new Map<string, number>();
    const requesterMap = new Map<string, number>();
    const reopenedMap = new Map<string, number>();
    const closerResolutionMap = new Map<string, number[]>();

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

        if (assignedAt && assignedInRange) {
          hourMap.set(assignedAt.getHours(), (hourMap.get(assignedAt.getHours()) || 0) + 1);
          dayMap.set(assignedAt.getDay(), (dayMap.get(assignedAt.getDay()) || 0) + 1);

          const monthKey = `${assignedAt.getFullYear()}-${String(assignedAt.getMonth() + 1).padStart(2, '0')}`;
          monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
        }

        const requester = (assignment.assigned_by || '').trim() || 'Unknown';
        requesterMap.set(requester, (requesterMap.get(requester) || 0) + 1);

        if ((assignment.status || '').toLowerCase().includes('reopen')) {
          const owner = assignment.primary_assignee || 'Unknown';
          reopenedMap.set(owner, (reopenedMap.get(owner) || 0) + 1);
        }
        
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

        // Resolution time (only for tickets closed within the date range)
        if (closedInRange && closedByMember && assignedAt && closedAt) {
          const hours = (closedAt.getTime() - assignedAt.getTime()) / 3600000;
          if (hours >= 0) {
            allResolutionHours.push(hours);
            if (!catResolutionMap.has(category)) catResolutionMap.set(category, []);
            catResolutionMap.get(category)!.push(hours);

            if (!closerResolutionMap.has(closedBy)) closerResolutionMap.set(closedBy, []);
            closerResolutionMap.get(closedBy)!.push(hours);
          }
        }
      }
    });

    // Compute resolution & Critical metrics
    const slaThreshold = 24;
    this.closedCount = allResolutionHours.length;
    this.slaWithinTargetCount = allResolutionHours.filter(h => h <= slaThreshold).length;
    this.slaCompliance = allResolutionHours.length > 0
      ? Math.round((this.slaWithinTargetCount / allResolutionHours.length) * 100) : 0;
    this.resolvedPct = details.length > 0
      ? Math.round((allResolutionHours.length / details.length) * 100) : 0;
    this.avgResolutionHours = allResolutionHours.length > 0
      ? Math.round(allResolutionHours.reduce((a, b) => a + b, 0) / allResolutionHours.length * 10) / 10 : 0;

    this.openBacklog = details.filter(d => (d.status || '').toLowerCase() === 'open').length;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const peakHourEntry = Array.from(hourMap.entries()).sort((a, b) => b[1] - a[1])[0];
    const peakDayEntry = Array.from(dayMap.entries()).sort((a, b) => b[1] - a[1])[0];
    this.peakHourLabel = peakHourEntry ? this.formatHourLabel(peakHourEntry[0]) : '-';
    this.peakHourCount = peakHourEntry ? peakHourEntry[1] : 0;
    this.peakDayLabel = peakDayEntry ? dayNames[peakDayEntry[0]] : '-';
    this.peakDayCount = peakDayEntry ? peakDayEntry[1] : 0;

    this.monthlyTrendData = Array.from(monthMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => {
        const [year, monthNumber] = month.split('-');
        const dt = new Date(Number(year), Number(monthNumber) - 1, 1);
        const label = dt.toLocaleString(undefined, { month: 'short', year: '2-digit' });
        return { month: label, count };
      });

    const responseRows: ResponseAnalystRow[] = Array.from(closerResolutionMap.entries())
      .map(([email, hrs]) => ({
        email,
        displayName: memberMap.get(email)?.displayName || email,
        ticketCount: hrs.length,
        avgHours: Math.round((hrs.reduce((a, b) => a + b, 0) / hrs.length) * 10) / 10
      }))
      .filter(row => row.ticketCount > 0)
      .sort((a, b) => a.avgHours - b.avgHours);

    // Get fastest responders (lowest avg hours) - top 5
    this.fastestResponders = responseRows.slice(0, 5);
    
    // Get needs improvement (highest avg hours) - exclude those already in fastest responders
    const fastestEmails = new Set(this.fastestResponders.map(r => r.email));
    this.needsImprovementResponders = responseRows
      .filter(r => !fastestEmails.has(r.email))
      .reverse()
      .slice(0, 5);
    this.sanitizeResponderBuckets();
    this.memberAvgResolutionMap = Object.fromEntries(responseRows.map(row => [row.email, row.avgHours]));

    this.slaByMember = Array.from(closerResolutionMap.entries())
      .map(([email, hrs]) => {
        const withinTarget = hrs.filter(hours => hours <= slaThreshold).length;
        const sla = hrs.length > 0 ? Math.round((withinTarget / hrs.length) * 100) : 0;
        return {
          email,
          displayName: memberMap.get(email)?.displayName || email,
          sla,
          tickets: hrs.length,
          withinTarget,
          color: this.getSlaColor(sla)
        };
      })
      .sort((a, b) => b.sla - a.sla);

    // Top performers: highest SLA (top 3 unique)
    this.topSlaPerformers = this.slaByMember.slice(0, 3);
    
    // Action required: lowest SLA (bottom 3 unique), excluding top performers
    const topPerformerEmails = new Set(this.topSlaPerformers.map(p => p.email));
    this.slaActionRequired = [...this.slaByMember]
      .filter(row => !topPerformerEmails.has(row.email))
      .reverse()
      .slice(0, 3)
      .sort((a, b) => a.sla - b.sla);

    const distributionBuckets: ResolutionDistributionRow[] = [
      { label: '< 1 hour', count: 0, color: '#16a34a' },
      { label: '1-4 hours', count: 0, color: '#0ea5e9' },
      { label: '4-24 hours', count: 0, color: '#f59e0b' },
      { label: '1-3 days', count: 0, color: '#f97316' },
      { label: '3-7 days', count: 0, color: '#ef4444' },
      { label: '> 7 days', count: 0, color: '#b91c1c' }
    ];
    allResolutionHours.forEach(hours => {
      if (hours < 1) distributionBuckets[0].count += 1;
      else if (hours < 4) distributionBuckets[1].count += 1;
      else if (hours < 24) distributionBuckets[2].count += 1;
      else if (hours < 72) distributionBuckets[3].count += 1;
      else if (hours < 168) distributionBuckets[4].count += 1;
      else distributionBuckets[5].count += 1;
    });
    this.resolutionDistribution = distributionBuckets;

    this.reopenedByOwner = Array.from(reopenedMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    this.topRequesters = Array.from(requesterMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    this.resolutionByCategoryData = Array.from(catResolutionMap.entries())
      .map(([name, hours], idx) => ({
        name,
        avgHours: Math.round(hours.reduce((a, b) => a + b, 0) / hours.length * 10) / 10,
        color: this.chartColors[idx % this.chartColors.length]
      }))
      .sort((a, b) => a.avgHours - b.avgHours);

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

  private applyPresetDateRange(period: Exclude<ReportPeriod, 'custom'>): void {
    const now = new Date();
    const start = new Date(now);

    if (period === 'monthly') {
      start.setDate(1);
    } else if (period === 'quarterly') {
      const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
      start.setMonth(quarterStartMonth, 1);
    } else if (period === 'halfyearly') {
      const halfStartMonth = now.getMonth() < 6 ? 0 : 6;
      start.setMonth(halfStartMonth, 1);
    } else {
      start.setMonth(0, 1);
    }

    start.setHours(0, 0, 0, 0);
    this.startDate = this.formatDate(start);
    this.endDate = this.formatDate(now);
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

  /** True when body carries the dark-theme class. Re-evaluated each draw so
   *  charts update correctly when the user toggles the theme. */
  private get isDark(): boolean {
    return document.body.classList.contains('dark-theme');
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
      ctx.strokeStyle = this.isDark ? '#1e293b' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      startAngle += sliceAngle;
    });

    // Donut hole — match the card background so it looks like a real hole.
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.52, 0, 2 * Math.PI);
    ctx.fillStyle = this.isDark ? '#1e293b' : '#ffffff';
    ctx.fill();

    ctx.fillStyle = this.isDark ? '#e2e8f0' : '#0f172a';
    ctx.font = 'bold 22px Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(total.toString(), centerX, centerY - 8);
    ctx.font = '12px Segoe UI, Arial, sans-serif';
    ctx.fillStyle = this.isDark ? '#cbd5e1' : '#64748b';
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
      ctx.fillStyle = this.isDark ? '#cbd5e1' : '#334155';
      ctx.font = '12px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pL - 6, y + barH / 2);

      // Count
      ctx.fillStyle = this.isDark ? '#e2e8f0' : '#0f172a';
      ctx.font = 'bold 12px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText((row.assignedCount + row.closedCount).toString(), pL + totalW + 5, y + barH / 2);
    });
  }

  private drawResolutionCategoryChart(): void {
    if (!this.resolutionChartRef?.nativeElement || this.resolutionByCategoryData.length === 0) return;

    const setup = this.setupHiDpiCanvas(this.resolutionChartRef.nativeElement);
    if (!setup) return;

    const { ctx, width: w, height: h } = setup;
    const rows = this.resolutionByCategoryData.slice(0, 12);
    if (rows.length === 0) return;

    const pL = 140, pR = 80, pT = 8, pB = 16;
    const barAreaW = w - pL - pR;
    const barAreaH = h - pT - pB;
    const rowH = Math.floor(barAreaH / rows.length);
    const barH = Math.max(10, Math.floor(rowH * 0.52));
    const maxVal = Math.max(...rows.map(r => r.avgHours), 1);

    rows.forEach((row, i) => {
      const y = pT + i * rowH + (rowH - barH) / 2;
      const barW = (row.avgHours / maxVal) * barAreaW;

      if (barW > 0) {
        ctx.fillStyle = row.color;
        roundRect(ctx, pL, y, barW, barH, 4);
        ctx.fill();
      }

      // Category label
      const label = row.name.length > 20 ? row.name.slice(0, 18) + '\u2026' : row.name;
      ctx.fillStyle = this.isDark ? '#cbd5e1' : '#334155';
      ctx.font = '12px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pL - 6, y + barH / 2);

      // Value label
      ctx.fillStyle = this.isDark ? '#e2e8f0' : '#0f172a';
      ctx.font = 'bold 11px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(row.avgHours + 'h', pL + barW + 5, y + barH / 2);
    });
  }

  private drawMonthlyTrendChart(): void {
    if (!this.monthlyTrendChartRef?.nativeElement || this.monthlyTrendData.length === 0) return;

    const setup = this.setupHiDpiCanvas(this.monthlyTrendChartRef.nativeElement);
    if (!setup) return;

    const { ctx, width: w, height: h } = setup;
    const points = this.monthlyTrendData;
    const pL = 44, pR = 20, pT = 16, pB = 36;
    const plotW = w - pL - pR;
    const plotH = h - pT - pB;
    const maxY = Math.max(...points.map(p => p.count), 1);

    ctx.strokeStyle = this.isDark ? '#334155' : '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pL, y);
      ctx.lineTo(w - pR, y);
      ctx.stroke();
    }

    if (points.length === 1) {
      const x = pL + plotW / 2;
      const y = pT + plotH - (points[0].count / maxY) * plotH;
      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = pL + (plotW * index) / (points.length - 1);
      const y = pT + plotH - (point.count / maxY) * plotH;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    points.forEach((point, index) => {
      const x = pL + (plotW * index) / (points.length - 1);
      const y = pT + plotH - (point.count / maxY) * plotH;

      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = this.isDark ? '#cbd5e1' : '#64748b';
      ctx.font = '11px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(point.month, x, h - 12);
    });
  }

  private formatHourLabel(hour: number): string {
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const normalized = hour % 12 === 0 ? 12 : hour % 12;
    return `${normalized}${suffix}`;
  }

  private getSlaColor(sla: number): string {
    if (sla >= 60) return '#10b981';
    if (sla >= 35) return '#f59e0b';
    return '#f43f5e';
  }

  private sanitizeResponderBuckets(): void {
    if (!this.fastestResponders.length || !this.needsImprovementResponders.length) return;

    const fastestEmails = new Set(this.fastestResponders.map(row => row.email));
    this.needsImprovementResponders = this.needsImprovementResponders
      .filter(row => !fastestEmails.has(row.email));
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

  private loadReportFromCache(allowStale = false): boolean {
    try {
      const raw = sessionStorage.getItem(this.reportCacheKey);
      if (!raw) return false;

      const cache = JSON.parse(raw);
      if (!cache || cache.groupEmail !== this.groupEmail) return false;
      if (cache.startDate !== this.startDate || cache.endDate !== this.endDate) return false;
      if (!allowStale) {
        if (!cache.timestamp || (Date.now() - cache.timestamp) > ReportComponent.REPORT_CACHE_TTL_MS) {
          return false;
        }
      }

      this.summaryRows = cache.summaryRows || [];
      this.detailRows = cache.detailRows || [];
      this.categoryData = cache.categoryData || [];
      this.slaCompliance = cache.slaCompliance || 0;
      this.resolvedPct = cache.resolvedPct || 0;
      this.avgResolutionHours = cache.avgResolutionHours || 0;
      this.closedCount = cache.closedCount || 0;
      this.resolutionByCategoryData = cache.resolutionByCategoryData || [];
      this.openBacklog = cache.openBacklog || 0;
      this.peakHourLabel = cache.peakHourLabel || '-';
      this.peakHourCount = cache.peakHourCount || 0;
      this.peakDayLabel = cache.peakDayLabel || '-';
      this.peakDayCount = cache.peakDayCount || 0;
      this.monthlyTrendData = cache.monthlyTrendData || [];
      this.fastestResponders = cache.fastestResponders || [];
      this.needsImprovementResponders = cache.needsImprovementResponders || [];
      this.sanitizeResponderBuckets();
      this.resolutionDistribution = cache.resolutionDistribution || [];
      this.reopenedByOwner = cache.reopenedByOwner || [];
      this.topRequesters = cache.topRequesters || [];
      this.memberAvgResolutionMap = cache.memberAvgResolutionMap || {};
      this.slaByMember = cache.slaByMember || [];
      this.topSlaPerformers = cache.topSlaPerformers || [];
      this.slaActionRequired = cache.slaActionRequired || [];
      this.slaWithinTargetCount = cache.slaWithinTargetCount || 0;

      if (this.categoryData.length) {
        setTimeout(() => {
          this.drawPieChart();
          this.drawBarChart();
          this.drawResolutionCategoryChart();
          this.drawMonthlyTrendChart();
        }, 0);
      }

      return true;
    } catch {
      return false;
    }
  }

  private saveReportToCache(): void {
    try {
      const payload = {
        timestamp: Date.now(),
        groupEmail: this.groupEmail,
        startDate: this.startDate,
        endDate: this.endDate,
        summaryRows: this.summaryRows,
        detailRows: this.detailRows,
        categoryData: this.categoryData,
        slaCompliance: this.slaCompliance,
        resolvedPct: this.resolvedPct,
        avgResolutionHours: this.avgResolutionHours,
        closedCount: this.closedCount,
        resolutionByCategoryData: this.resolutionByCategoryData,
        openBacklog: this.openBacklog,
        peakHourLabel: this.peakHourLabel,
        peakHourCount: this.peakHourCount,
        peakDayLabel: this.peakDayLabel,
        peakDayCount: this.peakDayCount,
        monthlyTrendData: this.monthlyTrendData,
        fastestResponders: this.fastestResponders,
        needsImprovementResponders: this.needsImprovementResponders,
        resolutionDistribution: this.resolutionDistribution,
        reopenedByOwner: this.reopenedByOwner,
        topRequesters: this.topRequesters,
        memberAvgResolutionMap: this.memberAvgResolutionMap,
        slaByMember: this.slaByMember,
        topSlaPerformers: this.topSlaPerformers,
        slaActionRequired: this.slaActionRequired,
        slaWithinTargetCount: this.slaWithinTargetCount
      };
      sessionStorage.setItem(this.reportCacheKey, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }
}
