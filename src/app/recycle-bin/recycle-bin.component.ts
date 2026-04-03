import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TicketService, RecycleBinTicket } from '../services/ticket.service';
import { MessageService } from '../services/message.service';

@Component({
  selector: 'app-recycle-bin',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="recycle-wrap">
      <div class="hero">
        <div class="hero-left">
          <div class="hero-icon"><i class="fas fa-trash"></i></div>
          <div>
            <h2>Recycle Bin</h2>
            <p>Deleted tickets are automatically removed after 30 days</p>
          </div>
        </div>
        <button class="refresh-btn" (click)="loadRecycleBin()" [disabled]="loading">
          <i class="fas fa-sync-alt" [class.spin]="loading"></i>
          Refresh
        </button>
      </div>

      <div class="table-card">
        <div class="empty" *ngIf="!loading && recycleTickets.length === 0">
          <i class="fas fa-inbox"></i>
          <p>No tickets in recycle bin</p>
        </div>

        <table *ngIf="recycleTickets.length > 0" class="recycle-table">
          <thead>
            <tr>
              <th>TICKET #</th>
              <th>SUBJECT</th>
              <th>EMAIL</th>
              <th>PRIORITY</th>
              <th>DELETED BY</th>
              <th>EXPIRES IN</th>
              <th>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let ticket of recycleTickets">
              <td class="ticket-id">{{ ticket.zoho_ticket_number || ticket.zoho_ticket_id }}</td>
              <td class="subject">{{ ticket.subject || 'No Subject' }}</td>
              <td>{{ ticket.email || 'N/A' }}</td>
              <td>
                <span class="priority" [ngClass]="priorityClass(ticket.priority)">
                  {{ priorityLabel(ticket.priority) }}
                </span>
              </td>
              <td>{{ ticket.deleted_by || 'Unknown' }}</td>
              <td>
                <span class="expires">{{ expiresText(ticket.expires_in_days) }}</span>
              </td>
              <td class="actions">
                <button class="restore-btn" (click)="restore(ticket)">
                  <i class="fas fa-undo"></i>
                  Restore
                </button>
                <button class="delete-btn" (click)="permanentDelete(ticket)">
                  <i class="fas fa-trash"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [`
    .recycle-wrap {
      display: grid;
      gap: 14px;
    }

    .hero {
      background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
      border-radius: 12px;
      padding: 16px;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .hero-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .hero-icon {
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.16);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .hero h2 {
      margin: 0;
      font-size: 1.7rem;
      font-weight: 700;
    }

    .hero p {
      margin: 2px 0 0;
      font-size: 0.95rem;
      opacity: 0.95;
    }

    .refresh-btn {
      border: 1px solid rgba(255, 255, 255, 0.35);
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      border-radius: 8px;
      padding: 9px 14px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .refresh-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }

    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .table-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      overflow: auto;
    }

    .recycle-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 900px;
    }

    .recycle-table th {
      background: #f8fafc;
      color: #64748b;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      text-align: left;
      padding: 12px 14px;
      border-bottom: 1px solid #e2e8f0;
    }

    .recycle-table td {
      padding: 12px 14px;
      border-bottom: 1px solid #f1f5f9;
      color: #334155;
      font-size: 0.92rem;
      vertical-align: middle;
    }

    .ticket-id {
      color: #2563eb;
      font-weight: 600;
      white-space: nowrap;
    }

    .subject {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .priority {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
    }

    .priority.low { background: #dcfce7; color: #15803d; }
    .priority.medium { background: #fef3c7; color: #b45309; }
    .priority.high { background: #ffedd5; color: #c2410c; }
    .priority.sla { background: #fee2e2; color: #b91c1c; }
    .priority.unknown { background: #e2e8f0; color: #475569; }

    .expires {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 7px;
      background: #e2e8f0;
      color: #334155;
      font-size: 0.82rem;
      font-weight: 600;
      white-space: nowrap;
    }

    .actions {
      white-space: nowrap;
      text-align: right;
    }

    .restore-btn,
    .delete-btn {
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 700;
    }

    .restore-btn {
      background: #10b981;
      border-color: #10b981;
      color: #fff;
      padding: 8px 14px;
      margin-right: 8px;
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .restore-btn:hover {
      background: #059669;
      border-color: #059669;
    }

    .delete-btn {
      background: #fff1f2;
      border-color: #fecdd3;
      color: #e11d48;
      padding: 8px 11px;
    }

    .delete-btn:hover {
      background: #ffe4e6;
    }

    .empty {
      padding: 36px 18px;
      text-align: center;
      color: #64748b;
    }

    .empty i {
      font-size: 1.6rem;
      margin-bottom: 8px;
      color: #94a3b8;
    }

    :host-context(.dark-theme) .table-card {
      background: #1e293b;
      border-color: #334155;
    }

    :host-context(.dark-theme) .recycle-table th {
      background: #0f172a;
      color: #94a3b8;
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) .recycle-table td {
      color: #e2e8f0;
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) .expires {
      background: #334155;
      color: #e2e8f0;
    }

    @media (max-width: 900px) {
      .hero {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `]
})
export class RecycleBinComponent implements OnInit {
  recycleTickets: RecycleBinTicket[] = [];
  loading = false;

  constructor(
    private ticketService: TicketService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadRecycleBin();
  }

  loadRecycleBin(): void {
    this.loading = true;
    this.ticketService.getRecycleBinTickets().subscribe({
      next: (res) => {
        this.recycleTickets = res?.data || [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.messageService.error('Failed to load recycle bin');
      }
    });
  }

  restore(ticket: RecycleBinTicket): void {
    const ticketId = ticket.zoho_ticket_id;
    if (!ticketId) return;
    this.ticketService.restoreFromRecycleBin(ticketId).subscribe({
      next: () => {
        this.recycleTickets = this.recycleTickets.filter(t => t.zoho_ticket_id !== ticketId);
        this.messageService.success('Ticket restored');
      },
      error: () => {
        this.messageService.error('Failed to restore ticket');
      }
    });
  }

  permanentDelete(ticket: RecycleBinTicket): void {
    const ticketId = ticket.zoho_ticket_id;
    if (!ticketId) return;

    const ok = window.confirm('Permanently delete this ticket from recycle bin?');
    if (!ok) return;

    this.ticketService.permanentDeleteFromRecycleBin(ticketId).subscribe({
      next: () => {
        this.recycleTickets = this.recycleTickets.filter(t => t.zoho_ticket_id !== ticketId);
        this.messageService.success('Ticket permanently deleted');
      },
      error: () => {
        this.messageService.error('Failed to permanently delete ticket');
      }
    });
  }

  priorityClass(priority?: string): string {
    const value = (priority || '').toLowerCase();
    if (value.includes('sla') || value.includes('critical') || value.includes('urgent')) return 'sla';
    if (value.includes('high')) return 'high';
    if (value.includes('medium')) return 'medium';
    if (value.includes('low')) return 'low';
    return 'unknown';
  }

  priorityLabel(priority?: string): string {
    const value = (priority || '').toLowerCase();
    if (value.includes('sla') || value.includes('critical') || value.includes('urgent')) return 'SLA';
    if (value.includes('high')) return 'High';
    if (value.includes('medium')) return 'Medium';
    if (value.includes('low')) return 'Low';
    return 'Unknown';
  }

  expiresText(days?: number): string {
    const value = Number(days ?? 0);
    if (!Number.isFinite(value) || value <= 0) return '0 days';
    return `${value} day${value === 1 ? '' : 's'}`;
  }
}
