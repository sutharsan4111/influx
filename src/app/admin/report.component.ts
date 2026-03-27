import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import * as XLSX from 'xlsx';

import { AssignmentService, TicketAssignment, GroupMember } from '../services/assignment.service';
import { MsalService } from '../services/msal.service';

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
      <div class="header">
        <div>
          <h2>CloudOps Report</h2>
          <p>Assignments and closures for CloudOps members</p>
        </div>
        <div class="actions">
          <button class="btn" (click)="loadReport()" [disabled]="loading || !isAdmin">Load Report</button>
          <button class="btn btn-primary" (click)="downloadExcel()" [disabled]="loading || summaryRows.length === 0">Download Excel</button>
        </div>
      </div>

      <div class="filters">
        <label>
          From
          <input type="date" [(ngModel)]="startDate" />
        </label>
        <label>
          To
          <input type="date" [(ngModel)]="endDate" />
        </label>
        <span class="group-pill">Group: {{ groupEmail }}</span>
      </div>

      <div class="notice" *ngIf="!isAdmin">
        You do not have access to this report.
      </div>

      <div class="notice" *ngIf="error && isAdmin">
        {{ error }}
      </div>

      <div class="loading" *ngIf="loading">Loading report...</div>

      <!-- Pie Chart Section -->
      <div class="charts-section" *ngIf="!loading && categoryData.length > 0">
        <div class="chart-card">
          <h3>Tickets by Category</h3>
          <div class="chart-container">
            <canvas #pieChart width="280" height="280"></canvas>
            <div class="chart-legend">
              <div class="legend-item" *ngFor="let cat of categoryData">
                <span class="legend-color" [style.background]="cat.color"></span>
                <span class="legend-label">{{ cat.name }}</span>
                <span class="legend-value">{{ cat.count }} ({{ cat.percentage }}%)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section" *ngIf="!loading && summaryRows.length > 0">
        <h3>Summary</h3>
        <table class="report-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Assigned</th>
              <th>Closed</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of summaryRows">
              <td>{{ row.displayName || '—' }}</td>
              <td>{{ row.email }}</td>
              <td>{{ row.assignedCount }}</td>
              <td>{{ row.closedCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="section" *ngIf="!loading && detailRows.length > 0">
        <h3>Details</h3>
        <table class="report-table details">
          <thead>
            <tr>
              <th>Ticket #</th>
              <th>Category</th>
              <th>Primary</th>
              <th>Status</th>
              <th>Assigned At</th>
              <th>Closed By</th>
              <th>Closed At</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let row of detailRows">
              <td>{{ row.ticketNumber }}</td>
              <td>{{ row.category || '—' }}</td>
              <td>{{ row.primaryAssignee }}</td>
              <td>{{ row.status }}</td>
              <td>{{ row.assignedAt }}</td>
              <td>{{ row.closedBy }}</td>
              <td>{{ row.closedAt }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .report-page {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }

    .header h2 {
      margin: 0 0 4px;
      font-size: 22px;
      color: #0f172a;
    }

    .header p {
      margin: 0;
      color: #64748b;
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .btn {
      border: none;
      background: #e2e8f0;
      color: #0f172a;
      padding: 8px 14px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
    }

    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-primary {
      background: #2563eb;
      color: #fff;
    }

    .filters {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .filters label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: #334155;
    }

    .filters input {
      border: 1px solid #cbd5f5;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 13px;
    }

    .group-pill {
      background: #eef2ff;
      color: #4338ca;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 12px;
    }

    .notice {
      padding: 10px 12px;
      background: #fff3cd;
      border: 1px solid #fde68a;
      color: #92400e;
      border-radius: 8px;
      margin-bottom: 12px;
    }

    .loading {
      padding: 10px 12px;
      color: #2563eb;
      font-weight: 600;
    }

    .section {
      margin-top: 18px;
    }

    .section h3 {
      margin: 0 0 10px;
      font-size: 16px;
      color: #0f172a;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      background: #fff;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
    }

    .report-table th,
    .report-table td {
      padding: 10px 12px;
      text-align: left;
      font-size: 13px;
      border-bottom: 1px solid #eef2f6;
      white-space: nowrap;
    }

    .report-table th {
      background: #1e40af;
      color: #fff;
      font-weight: 600;
    }

    .report-table.details td {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Chart Styles */
    .charts-section {
      margin-bottom: 24px;
    }

    .chart-card {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
    }

    .chart-card h3 {
      margin: 0 0 16px;
      font-size: 16px;
      color: #0f172a;
    }

    .chart-container {
      display: flex;
      align-items: center;
      gap: 32px;
      flex-wrap: wrap;
    }

    .chart-legend {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }

    .legend-color {
      width: 14px;
      height: 14px;
      border-radius: 3px;
      flex-shrink: 0;
    }

    .legend-label {
      color: #334155;
      min-width: 140px;
    }

    .legend-value {
      color: #64748b;
      font-weight: 500;
    }

    :host-context(.dark-theme) .chart-card {
      background: #1e293b;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      border: 1px solid #334155;
    }

    :host-context(.dark-theme) .chart-card h3 {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .legend-label {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .legend-value {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .report-page {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .header h2 {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .header p {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .section h3 {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .btn {
      background: #334155;
      color: #e2e8f0;
      border: 1px solid #475569;
    }

    :host-context(.dark-theme) .btn:hover {
      background: #475569;
    }

    :host-context(.dark-theme) .btn-primary {
      background: #2563eb;
      color: #fff;
      border: 1px solid #3b82f6;
    }

    :host-context(.dark-theme) .btn-primary:hover {
      background: #1d4ed8;
    }

    :host-context(.dark-theme) .filters label {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .filters input {
      background: #1e293b;
      color: #e2e8f0;
      border-color: #475569;
    }

    :host-context(.dark-theme) .filters input:focus {
      border-color: #3b82f6;
    }

    :host-context(.dark-theme) .group-pill {
      background: #312e81;
      color: #c7d2fe;
      border: 1px solid #4338ca;
    }

    :host-context(.dark-theme) .notice {
      background: #422006;
      border-color: #854d0e;
      color: #fef3c7;
    }

    :host-context(.dark-theme) .loading {
      color: #60a5fa;
    }

    :host-context(.dark-theme) .report-table {
      background: #1e293b;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      border: 1px solid #334155;
    }

    :host-context(.dark-theme) .report-table th {
      background: #1e3a8a;
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .report-table td {
      border-bottom-color: #334155;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .report-table tbody tr:hover {
      background: #334155;
    }
  `]
})
export class ReportComponent implements OnInit, AfterViewInit {
  @ViewChild('pieChart') pieChartRef!: ElementRef<HTMLCanvasElement>;

  groupEmail = 'cloudops@muraai.com';
  startDate = '';
  endDate = '';

  loading = false;
  error = '';

  groupMembers: GroupMember[] = [];
  summaryRows: SummaryRow[] = [];
  detailRows: DetailRow[] = [];
  categoryData: CategoryData[] = [];

  private readonly reportCacheKey = 'ITSMS_REPORT_CACHE';

  private chartColors = [
    '#2563eb', '#7c3aed', '#db2777', '#ea580c', 
    '#16a34a', '#0891b2', '#4f46e5', '#be123c'
  ];

  get isAdmin(): boolean {
    return (sessionStorage.getItem('role') || '') === 'admin';
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

  ngAfterViewInit(): void {
    // Chart will be drawn after data loads
  }

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
      
      // Draw pie chart after a short delay to ensure canvas is rendered
      setTimeout(() => this.drawPieChart(), 100);
    } catch (err: any) {
      this.error = err?.message || 'Failed to load report.';
      this.summaryRows = [];
      this.detailRows = [];
    } finally {
      this.loading = false;
    }
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

  private drawPieChart(): void {
    if (!this.pieChartRef?.nativeElement || this.categoryData.length === 0) return;

    const canvas = this.pieChartRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 10;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw pie slices
    let startAngle = -Math.PI / 2; // Start from top

    this.categoryData.forEach(cat => {
      const sliceAngle = (cat.count / this.detailRows.length) * 2 * Math.PI;
      
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = cat.color;
      ctx.fill();

      // Draw white border between slices
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();

      startAngle += sliceAngle;
    });

    // Draw center circle for donut effect
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Draw total count in center
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.detailRows.length.toString(), centerX, centerY - 8);
    
    ctx.font = '12px system-ui';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Total', centerX, centerY + 14);
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
        setTimeout(() => this.drawPieChart(), 0);
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
