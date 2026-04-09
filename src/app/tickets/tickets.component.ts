import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Subject, Subscription, firstValueFrom, interval } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { TicketService, Ticket } from '../services/ticket.service';
import { AssignmentService, TicketAssignment } from '../services/assignment.service';
import { LoadingService } from '../services/loading.service';
import { MessageService } from '../services/message.service';
import { MsalService } from '../services/msal.service';
import { IhubService } from '../services/ihub.service';
import { SslService } from '../services/ssl.service';

@Component({
  selector: 'app-tickets',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ticket-tabs">
      <div class="tab-left">
        <div
          class="tab"
          [class.active]="selectedTab === 'open'"
          [class.hidden]="!isAdmin"
          (click)="switchTab('open')"
          *ngIf="isAdmin">
          Open Tickets
        </div>

        <div
          class="tab"
          [class.active]="selectedTab === 'closed'"
          [class.hidden]="!isAdmin"
          (click)="switchTab('closed')"
          *ngIf="isAdmin">
          Closed Tickets
        </div>

        <div
          class="tab"
          [class.active]="selectedTab === 'my'"
          (click)="switchTab('my')">
          My Tickets
        </div>
      </div>

      <div class="tab-right">
        <button class="btn btn-refresh" (click)="refreshCurrentTab()" [disabled]="isRefreshing" title="Refresh">
          <i class="fas fa-sync-alt" [class.spinning]="isRefreshing"></i>
        </button>
        <button *ngIf="selectedTickets.size > 0 && isAdmin"
                class="btn btn-bulk-assign"
                (click)="openBulkAssignDialog()">
          <i class="fas fa-users"></i> Bulk Reassign ({{ selectedTickets.size }})
        </button>
        <div class="search-bar">
          <input
            type="search"
            placeholder="Search ticket #, id, subject, or email"
            (input)="onSearchChange($any($event.target).value)" />
        </div>
      </div>
    </div>

    <div class="sub-tabs-row" *ngIf="selectedTab === 'my'">
      <div class="sub-tabs">
        <div class="sub-tab"
             [class.active]="myStatus === 'open'"
             (click)="switchMyStatus('open')">
          My Open
        </div>
        <div class="sub-tab"
             [class.active]="myStatus === 'closed'"
             (click)="switchMyStatus('closed')">
          My Closed
        </div>
      </div>
    </div>
    <div class="loading" *ngIf="loadingService.loading$ | async">
  Loading tickets...
</div>

    <div class="table-wrap" *ngIf="filteredTickets.length > 0; else noTickets">
      <table class="tickets-table">
        <thead>
          <tr>
            <th class="checkbox-col" *ngIf="isAdmin">
              <input type="checkbox" 
                     [checked]="isAllSelected()"
                     (change)="toggleSelectAll($event)" />
            </th>
            <th>Ticket #</th>
            <th>Subject</th>
            <th>Email</th>
            <th>Assigned To</th>
            <th class="priority-col">Priority</th>
            <th class="status-col">Status</th>
            <th class="actions-col">Actions</th>
          </tr>
        </thead>

        <tbody>
          <tr *ngFor="let ticket of filteredTickets">
            <td class="checkbox-col" *ngIf="isAdmin">
              <input type="checkbox"
                     [checked]="selectedTickets.has(ticket.id || ticket.ticketId || '')"
                     (change)="toggleSelectTicket(ticket.id || ticket.ticketId || '')" />
            </td>
            <td
              class="mono clickable"
              (click)="viewTicket(ticket.id || ticket.ticketId || '')">
              {{ ticket.ticketNumber || ticket.id }}
            </td>

            <td
              class="subject clickable"
              (click)="viewTicket(ticket.id || ticket.ticketId || '')">
              {{ ticket.subject || 'No Subject' }}
            </td>

            <td>{{ ticket.email || ticket.contact?.email || 'N/A' }}</td>
            <td>
              {{ assignedToDisplay(ticket) }}
              <div class="multi-assignees" *ngIf="getMultiAssignees(ticket) as assignees">
                <span *ngIf="assignees.length > 1" class="badge-count">+{{ assignees.length - 1 }} more</span>
              </div>
            </td>

            <td class="priority-col">
              <div class="priority-indicator" [ngClass]="priorityClass(ticket.priority)" [title]="priorityLabel(ticket.priority)">
                <svg viewBox="0 0 100 60" class="priority-gauge">
                  <path class="gauge-bg" d="M10,50 A40,40 0 0,1 90,50" />
                  <path class="gauge-fill" d="M10,50 A40,40 0 0,1 90,50" />
                  <line class="gauge-needle" x1="50" y1="50" x2="50" y2="18" />
                  <circle class="gauge-center" cx="50" cy="50" r="5" />
                </svg>
                <span class="priority-text">{{ priorityLabel(ticket.priority) }}</span>
              </div>
            </td>

            <td class="status-col">
              <span class="status" [ngClass]="statusClass(ticket.status)">
                {{ ticket.status || 'Unknown' }}
              </span>
            </td>

            <td class="actions-col">
              <div class="action-buttons">
                <button class="btn btn-assign"
                        *ngIf="isAdmin && !isTicketAssigned(ticket)"
                        (click)="openAssignDialog(ticket.id || ticket.ticketId || '', ticket.ticketNumber || ticket.id || '')">
                  Assign
                </button>

                <button class="btn btn-reassign"
                        *ngIf="canReassign(ticket)"
                        (click)="openReassignDialog(ticket.id || ticket.ticketId || '')">
                  Reassign
                </button>

                <button class="btn btn-update"
                        (click)="updateTicket(ticket.id || ticket.ticketId || '')">
                  Update
                </button>

                <button *ngIf="isCorrectStatus(ticket, 'open')"
                        class="btn btn-close"
                        (click)="closeTicket(ticket.id || ticket.ticketId || '')">
                  Close
                </button>

                <button *ngIf="isCorrectStatus(ticket, 'closed')"
                        class="btn btn-open"
                        (click)="openTicket(ticket.id || ticket.ticketId || '')">
                  Open
                </button>

                <button class="btn btn-delete"
                        (click)="moveToRecycleBin(ticket)">
                  Delete
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ng-template #noTickets>
      <div class="no-tickets">
        <div *ngIf="searchTerm" class="empty-search">
          <i class="fas fa-search"></i>
          <p>No tickets match "{{ searchTerm }}"</p>
          <small>Try different keywords or check your search term</small>
        </div>
        <div *ngIf="!searchTerm" class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No tickets found</p>
        </div>
      </div>
    </ng-template>

    <div class="pagination-controls" *ngIf="filteredTickets.length > 0 && !searchTerm">
      <button (click)="prevPage()" 
              [disabled]="selectedTab === 'my' ? 
                (myStatus === 'open' ? myTicketsOpenPage === 1 : myTicketsClosedPage === 1) : 
                (currentPage === 1)">
        ⬅ Previous
      </button>
      <span>Page {{ selectedTab === 'my' ? 
                     (myStatus === 'open' ? myTicketsOpenPage : myTicketsClosedPage) : 
                     currentPage }}</span>
      <button (click)="nextPage()" 
              [disabled]="selectedTab === 'my' ? 
                (myStatus === 'open' ? !myTicketsOpenHasMore : !myTicketsClosedHasMore) : 
                !hasMore">
        Next ➡
      </button>
    </div>

    <div class="modal-backdrop" *ngIf="showCloseDialog || showUpdateDialog || showAssignDialog || showBulkAssignDialog">
      <div class="modal-card" role="dialog" aria-modal="true">
        <ng-container *ngIf="showCloseDialog">
          <h2>Close Ticket</h2>
          <p>Are you sure you want to close this ticket?</p>
          <label class="modal-label" *ngIf="closeRequiresNewExpiry">
            New {{ closingTicketType === 'IHUB' ? 'IHUB' : 'SSL' }} Expiry Date
            <input type="date" [(ngModel)]="closeNewExpiryDate" />
          </label>
          <div class="modal-actions">
            <button class="btn btn-secondary" (click)="cancelDialogs()">Cancel</button>
            <button class="btn btn-danger" (click)="confirmClose()">Close Ticket</button>
          </div>
        </ng-container>

        <ng-container *ngIf="showUpdateDialog">
          <h2>Update Ticket</h2>
          <label class="modal-label">
            Status
            <select [(ngModel)]="updateStatus">
              <option value="">Select status</option>
              <option *ngFor="let s of statusOptions" [value]="s">{{ s }}</option>
            </select>
          </label>
          <label class="modal-label">
            Priority
            <select [(ngModel)]="updatePriority">
              <option value="">Select priority</option>
              <option *ngFor="let p of priorityOptions" [value]="p">{{ p }}</option>
            </select>
          </label>
          <div class="modal-actions">
            <button class="btn btn-secondary" (click)="cancelDialogs()">Cancel</button>
            <button class="btn btn-primary" (click)="confirmUpdate()">Update</button>
          </div>
        </ng-container>

        <!-- Single Ticket Assign/Reassign Dialog -->
        <ng-container *ngIf="showAssignDialog">
          <h2>{{ isReassigning ? 'Reassign' : 'Assign' }} Ticket</h2>
          <p class="assign-ticket-info">Ticket #{{ assignTicketNumber }}</p>
          
          <div class="search-users">
            <input type="text" 
                   placeholder="Search users..." 
                   [(ngModel)]="userSearchTerm"
                   (input)="filterUsers()" />
          </div>
          
          <div class="selected-chips" *ngIf="selectedAssignees.length > 0">
            <span class="chip" *ngFor="let email of selectedAssignees">
              {{ getUserDisplayName(email) }}
              <button class="chip-remove" (click)="removeAssignee(email)">×</button>
            </span>
          </div>
          
          <div class="users-list">
            <div class="user-item" 
                 *ngFor="let user of filteredUsers"
                 [class.selected]="isUserSelected(user.email)"
                 (click)="toggleUserSelection(user.email)">
              <input type="checkbox" 
                     [checked]="isUserSelected(user.email)"
                     (click)="$event.stopPropagation()" />
              <div class="user-info">
                <span class="user-name">{{ user.displayName || user.email }}</span>
                <span class="user-email">{{ user.email }}</span>
              </div>
            </div>
            <div class="no-users" *ngIf="filteredUsers.length === 0 && !loadingUsers">
              No users found
            </div>
            <div class="loading-users" *ngIf="loadingUsers">
              Loading users...
            </div>
          </div>
          
          <div class="modal-actions">
            <button class="btn btn-secondary" (click)="cancelDialogs()">Cancel</button>
            <button class="btn btn-primary" 
                    (click)="confirmAssign()"
                    [disabled]="selectedAssignees.length === 0">
              {{ isReassigning ? 'Reassign' : 'Assign' }}
            </button>
          </div>
        </ng-container>

        <!-- Bulk Assign Dialog -->
        <ng-container *ngIf="showBulkAssignDialog">
          <h2>Bulk Assign Tickets</h2>
          <p>{{ selectedTickets.size }} ticket(s) selected</p>
          
          <div class="search-users">
            <input type="text" 
                   placeholder="Search users..." 
                   [(ngModel)]="bulkUserSearchTerm"
                   (input)="filterBulkUsers()" />
          </div>
          
          <div class="selected-chips" *ngIf="bulkAssignees.length > 0">
            <span class="chip" *ngFor="let email of bulkAssignees">
              {{ getUserDisplayName(email) }}
              <button class="chip-remove" (click)="removeBulkAssignee(email)">×</button>
            </span>
          </div>
          
          <div class="users-list">
            <div class="user-item" 
                 *ngFor="let user of filteredBulkUsers"
                 [class.selected]="isBulkUserSelected(user.email)"
                 (click)="toggleBulkUserSelection(user.email)">
              <input type="checkbox" 
                     [checked]="isBulkUserSelected(user.email)"
                     (click)="$event.stopPropagation()" />
              <div class="user-info">
                <span class="user-name">{{ user.displayName || user.email }}</span>
                <span class="user-email">{{ user.email }}</span>
              </div>
            </div>
            <div class="no-users" *ngIf="filteredBulkUsers.length === 0 && !loadingUsers">
              No users found
            </div>
          </div>
          <div class="modal-actions">
            <button class="btn btn-secondary" (click)="cancelDialogs()">Cancel</button>
            <button class="btn btn-primary" 
                    (click)="confirmBulkAssign()"
                    [disabled]="bulkAssignees.length === 0">
              Assign {{ selectedTickets.size }} Tickets
            </button>
          </div>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 0;
    }

    /* Page Header */
    .page-header {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      border-radius: 16px;
      padding: 20px 24px;
      margin-bottom: 20px;
      color: white;
    }

    .page-header h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 0 0 4px 0;
    }

    .page-header p {
      margin: 0;
      opacity: 0.85;
      font-size: 0.9rem;
    }

    /* Tabs Container */
    .ticket-tabs {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      padding: 6px 10px;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
    }

    :host-context(.dark-theme) .ticket-tabs {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }

    .tab-left {
      display: flex;
      gap: 4px;
    }

    .tab-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .sub-tabs-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 3px 0 8px;
    }

    .sub-tabs {
      display: flex;
      gap: 4px;
    }

    .sub-tab {
      padding: 4px 10px;
      cursor: pointer;
      color: #64748b;
      background: #f1f5f9;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 500;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }

    .sub-tab:hover {
      background: #e2e8f0;
      color: #1e3a8a;
    }

    .sub-tab.active {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      font-weight: 600;
      box-shadow: 0 3px 10px rgba(59, 130, 246, 0.3);
    }

    :host-context(.dark-theme) .sub-tab {
      background: #1e293b;
      color: #94a3b8;
    }

    :host-context(.dark-theme) .sub-tab:hover {
      background: #334155;
      color: #60a5fa;
    }

    :host-context(.dark-theme) .sub-tab.active {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
    }

    .tab {
      padding: 5px 10px;
      cursor: pointer;
      color: #64748b;
      border-radius: 5px;
      font-size: 10px;
      font-weight: 500;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      border: none;
    }

    .tab:hover {
      background: rgba(59, 130, 246, 0.1);
      color: #2563eb;
    }

    .tab.active {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      font-weight: 600;
      box-shadow: 0 3px 10px rgba(59, 130, 246, 0.3);
    }

    :host-context(.dark-theme) .tab {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .tab:hover {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }

    :host-context(.dark-theme) .tab.active {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    }

    .search-bar input[type="search"] {
      padding: 5px 10px;
      border: 1.5px solid #e2e8f0;
      border-radius: 6px;
      width: 180px;
      font-size: 10px;
      outline: none;
      background: white;
      transition: all 0.2s ease;
    }

    .search-bar input[type="search"]:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    :host-context(.dark-theme) .search-bar input[type="search"] {
      background: #0f172a;
      border-color: #334155;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .search-bar input[type="search"]:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25);
    }

    /* Table Container */
    .table-wrap {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      overflow: hidden;
      width: 100%;
      max-width: 100%;
      margin-top: 0;
      border: 1px solid #e2e8f0;
    }

    :host-context(.dark-theme) .table-wrap {
      background: #0f172a;
      border-color: #1e293b;
      box-shadow: 0 3px 14px rgba(0, 0, 0, 0.25);
    }

    .tickets-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 700px;
      table-layout: auto;
    }

    .tickets-table thead th {
      background: #2b69ce;
      color: #fff;
      padding: 7px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      position: relative;
      z-index: 1;
    }

    .tickets-table thead th:first-child {
      border-top-left-radius: 6px;
    }

    .tickets-table thead th:last-child {
      border-top-right-radius: 6px;
    }

    .tickets-table tbody td {
      padding: 6px 8px;
      border-bottom: 1px solid #f1f5f9;
      white-space: normal;
      overflow-wrap: anywhere;
      font-size: 10px;
    }

    :host-context(.dark-theme) .tickets-table tbody td {
      border-bottom-color: #1e293b;
    }

    .tickets-table td.actions-col {
      overflow: visible;
      white-space: nowrap;
    }

    .tickets-table tbody tr {
      transition: all 0.2s ease;
    }

    .tickets-table tbody tr:hover {
      background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);
    }

    :host-context(.dark-theme) .tickets-table tbody tr:hover {
      background: linear-gradient(135deg, #1e293b 0%, #1e3a5f 100%);
    }

    .mono {
      font-family: 'SF Mono', Monaco, monospace;
      font-weight: 600;
      color: #3b82f6;
    }

    .subject {
      max-width: 280px;
      white-space: normal;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    }

    .clickable {
      cursor: pointer;
      color: inherit;
      text-decoration: none;
    }

    .clickable:hover {
      text-decoration: underline;
      color: #2563eb;
    }

    .status {
      padding: 4px 8px;
      border-radius: 14px;
      font-size: 9px;
      font-weight: 700;
      color: #fff;
      display: inline-block;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .loading {
      padding: 28px;
      text-align: center;
      font-weight: 600;
      color: #3b82f6;
      font-size: 12px;
    }

    .status.open { 
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.35);
    }
    .status.inprogress { 
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.35);
    }
    .status.resolved { 
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.35);
    }
    .status.closed { 
      background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
      box-shadow: 0 2px 8px rgba(107, 114, 128, 0.35);
    }
    .status.unknown { background: #9ca3af; }

    /* Priority Indicator Styles */
    .priority-col {
      width: 70px;
      text-align: center;
    }

    .priority-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    .priority-gauge {
      width: 32px;
      height: 20px;
    }

    .gauge-bg {
      fill: none;
      stroke: #e2e8f0;
      stroke-width: 8;
      stroke-linecap: round;
    }

    .gauge-fill {
      fill: none;
      stroke: currentColor;
      stroke-width: 8;
      stroke-linecap: round;
      stroke-dasharray: 126;
      stroke-dashoffset: 126;
    }

    .gauge-needle {
      stroke: #334155;
      stroke-width: 2;
      stroke-linecap: round;
      transform-origin: 50px 50px;
    }

    .gauge-center {
      fill: #334155;
    }

    .priority-text {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      white-space: nowrap;
    }

    /* SLA Priority - Critical (needle far right) */
    .priority-indicator.priority-sla {
      color: #dc2626;
    }
    .priority-indicator.priority-sla .gauge-fill {
      stroke-dashoffset: 0;
    }
    .priority-indicator.priority-sla .gauge-needle {
      transform: rotate(70deg);
    }
    .priority-indicator.priority-sla .priority-text {
      color: #dc2626;
      background: #fef2f2;
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* High Priority (needle right of center) */
    .priority-indicator.priority-high {
      color: #ea580c;
    }
    .priority-indicator.priority-high .gauge-fill {
      stroke-dashoffset: 32;
    }
    .priority-indicator.priority-high .gauge-needle {
      transform: rotate(35deg);
    }
    .priority-indicator.priority-high .priority-text {
      color: #ea580c;
      background: #fff7ed;
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* Medium Priority (needle center) */
    .priority-indicator.priority-medium {
      color: #f59e0b;
    }
    .priority-indicator.priority-medium .gauge-fill {
      stroke-dashoffset: 63;
    }
    .priority-indicator.priority-medium .gauge-needle {
      transform: rotate(0deg);
    }
    .priority-indicator.priority-medium .priority-text {
      color: #b45309;
      background: #fffbeb;
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* Low Priority (needle left) */
    .priority-indicator.priority-low {
      color: #22c55e;
    }
    .priority-indicator.priority-low .gauge-fill {
      stroke-dashoffset: 95;
    }
    .priority-indicator.priority-low .gauge-needle {
      transform: rotate(-35deg);
    }
    .priority-indicator.priority-low .priority-text {
      color: #16a34a;
      background: #f0fdf4;
      padding: 2px 8px;
      border-radius: 10px;
    }

    /* Unknown Priority */
    .priority-indicator.priority-unknown {
      color: #94a3b8;
    }
    .priority-indicator.priority-unknown .gauge-fill {
      stroke-dashoffset: 126;
    }
    .priority-indicator.priority-unknown .gauge-needle {
      transform: rotate(-70deg);
    }
    .priority-indicator.priority-unknown .priority-text {
      color: #64748b;
      background: #f8fafc;
      padding: 2px 8px;
      border-radius: 10px;
    }

    :host-context(.dark-theme) .gauge-bg {
      stroke: #334155;
    }
    :host-context(.dark-theme) .gauge-needle,
    :host-context(.dark-theme) .gauge-center {
      stroke: #94a3b8;
      fill: #94a3b8;
    }

    :host-context(.dark-theme) .priority-indicator.priority-sla .priority-text {
      background: rgba(220, 38, 38, 0.2);
      color: #fca5a5;
    }
    :host-context(.dark-theme) .priority-indicator.priority-high .priority-text {
      background: rgba(234, 88, 12, 0.2);
      color: #fdba74;
    }
    :host-context(.dark-theme) .priority-indicator.priority-medium .priority-text {
      background: rgba(245, 158, 11, 0.2);
      color: #fcd34d;
    }
    :host-context(.dark-theme) .priority-indicator.priority-low .priority-text {
      background: rgba(34, 197, 94, 0.2);
      color: #86efac;
    }
    :host-context(.dark-theme) .priority-indicator.priority-unknown .priority-text {
      background: rgba(148, 163, 184, 0.2);
      color: #cbd5e1;
    }

    .actions-col {
      text-align: right;
      min-width: 160px;
      width: auto;
    }

    .status-col {
      width: 80px;
      white-space: nowrap;
    }

    .tickets-table th.status-col,
    .tickets-table td.status-col,
    .tickets-table th.actions-col,
    .tickets-table td.actions-col,
    .tickets-table th.priority-col,
    .tickets-table td.priority-col {
      padding-left: 8px;
      padding-right: 8px;
    }

    /* Button Styles */
    .btn {
      border: none;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 9px;
      font-weight: 600;
      cursor: pointer;
      margin-left: 4px;
      transition: all 0.2s ease;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }

    .btn-update {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      color: #2563eb;
      border: 1px solid #bfdbfe;
    }

    .btn-update:hover {
      background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.2);
    }

    .btn-assign {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      color: #059669;
      border: 1px solid #a7f3d0;
    }

    .btn-assign:hover {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);
    }

    .btn-reassign {
      background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%);
      color: #ea580c;
      border: 1px solid #fed7aa;
    }

    .btn-reassign:hover {
      background: linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%);
      box-shadow: 0 2px 6px rgba(234, 88, 12, 0.2);
    }

    .btn-refresh {
      background: #fff;
      color: #0284c7;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 5px;
      font-size: 12px;
      border: 1px solid #0284c7;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-refresh:hover:not(:disabled) {
      background: #f0f9ff;
    }

    .btn-refresh:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-refresh .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .btn-bulk-assign {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
      color: #fff;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 8px;
      font-weight: 600;
      box-shadow: 0 3px 10px rgba(124, 58, 237, 0.3);
    }

    .btn-bulk-assign:hover {
      background: linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(124, 58, 237, 0.45);
    }

    .checkbox-col {
      width: 36px;
      text-align: center;
    }

    .checkbox-col input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: #3b82f6;
    }

    .multi-assignees {
      margin-top: 2px;
    }

    .badge-count {
      font-size: 9px;
      background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%);
      color: #4338ca;
      padding: 2px 6px;
      border-radius: 10px;
      font-weight: 600;
    }

    .multi-select {
      min-height: 120px;
      width: 100%;
    }

    .hint {
      font-size: 12px;
      color: #6b7280;
      margin: 4px 0 12px;
    }

    .assign-ticket-info {
      font-weight: 700;
      color: #3b82f6;
      margin-bottom: 16px;
      font-size: 15px;
    }

    .search-users {
      margin-bottom: 16px;
    }

    .search-users input {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }

    .search-users input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
    }

    .selected-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
      color: #1d4ed8;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
    }

    .chip-remove {
      background: none;
      border: none;
      color: #1d4ed8;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 2px;
      transition: color 0.2s ease;
    }

    .chip-remove:hover {
      color: #dc2626;
    }

    .users-list {
      max-height: 220px;
      overflow-y: auto;
      border: 2px solid #e5e7eb;
      border-radius: 12px;
      margin-bottom: 16px;
    }

    .user-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      cursor: pointer;
      border-bottom: 1px solid #f1f5f9;
      transition: all 0.2s ease;
    }

    .user-item:last-child {
      border-bottom: none;
    }

    .user-item:hover {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    }

    .user-item.selected {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    }

    .user-item input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #3b82f6;
    }

    .user-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .user-name {
      font-weight: 600;
      color: #1f2937;
    }

    .user-email {
      font-size: 12px;
      color: #6b7280;
    }

    .no-users, .loading-users {
      padding: 24px;
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }

    :host-context(.dark-theme) .users-list {
      border-color: #334155;
    }

    :host-context(.dark-theme) .user-item {
      border-bottom-color: #1e293b;
    }

    :host-context(.dark-theme) .user-item:hover {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
    }

    :host-context(.dark-theme) .user-item.selected {
      background: linear-gradient(135deg, #1e3a5f 0%, #1e40af33 100%);
    }

    :host-context(.dark-theme) .user-name {
      color: #e5e7eb;
    }

    :host-context(.dark-theme) .chip {
      background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%);
      color: #93c5fd;
    }

    .btn-close {
      background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
      color: #dc2626;
      border: 1px solid #fecaca;
    }

    .btn-close:hover {
      background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
      box-shadow: 0 2px 6px rgba(220, 38, 38, 0.2);
    }

    .btn-open {
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      color: #059669;
      border: 1px solid #a7f3d0;
    }

    .btn-open:hover {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.2);
    }

    .btn-delete {
      background: linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%);
      color: #e11d48;
      border: 1px solid #fecdd3;
    }

    .btn-delete:hover {
      background: linear-gradient(135deg, #ffe4e6 0%, #fecdd3 100%);
      box-shadow: 0 2px 6px rgba(225, 29, 72, 0.25);
    }

    :host-context(.dark-theme) .btn-assign {
      background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
      color: #6ee7b7;
      border-color: #065f46;
    }

    :host-context(.dark-theme) .btn-update {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
      color: #93c5fd;
      border-color: #1e40af;
    }

    :host-context(.dark-theme) .btn-reassign {
      background: linear-gradient(135deg, #7c2d12 0%, #9a3412 100%);
      color: #fdba74;
      border-color: #9a3412;
    }

    :host-context(.dark-theme) .btn-open {
      background: linear-gradient(135deg, #064e3b 0%, #065f46 100%);
      color: #86efac;
      border-color: #065f46;
    }

    :host-context(.dark-theme) .btn-close {
      background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%);
      color: #fca5a5;
      border-color: #991b1b;
    }

    :host-context(.dark-theme) .btn-delete {
      background: linear-gradient(135deg, #881337 0%, #9f1239 100%);
      color: #fda4af;
      border-color: #9f1239;
    }

    :host-context(.dark-theme) .btn-bulk-assign {
      background: linear-gradient(135deg, #581c87 0%, #6b21a8 100%);
      color: #e9d5ff;
    }

    :host-context(.dark-theme) .btn-bulk-assign:hover {
      background: linear-gradient(135deg, #4c1d95 0%, #581c87 100%);
    }

    .no-tickets {
      padding: 48px 32px;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }

    .empty-search, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .empty-search i, .empty-state i {
      font-size: 32px;
      color: #cbd5e1;
      opacity: 0.6;
    }

    .empty-search p, .empty-state p {
      margin: 0;
      font-size: 14px;
      font-weight: 500;
      color: #475569;
    }

    .empty-search small {
      display: block;
      font-size: 11px;
      color: #94a3b8;
      margin-top: 4px;
    }

    :host-context(.dark-theme) .empty-search i,
    :host-context(.dark-theme) .empty-state i {
      color: #475569;
    }

    :host-context(.dark-theme) .empty-search p,
    :host-context(.dark-theme) .empty-state p {
      color: #cbd5e1;
    }

    .action-buttons {
      display: flex;
      flex-wrap: nowrap;
      gap: 6px;
      align-items: center;
      justify-content: flex-end;
    }

    .action-buttons .btn {
      padding: 4px 8px;
      font-size: 9px;
      white-space: nowrap;
      margin-left: 0;
    }

    .pagination-controls {
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: center;
      margin-top: 14px;
      padding: 10px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 10px;
    }

    .pagination-controls button {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      font-weight: 600;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .pagination-controls button:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 3px 10px rgba(59, 130, 246, 0.3);
    }

    .pagination-controls button:disabled {
      background: #cbd5e1;
      cursor: not-allowed;
    }

    .pagination-controls span {
      font-weight: 600;
      font-size: 11px;
      color: #334155;
    }

    :host-context(.dark-theme) .pagination-controls {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    }

    :host-context(.dark-theme) .pagination-controls span {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .pagination-controls button:disabled {
      background: #334155;
    }

    /* Modal Styles */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    }

    .modal-card {
      background: white;
      border-radius: 16px;
      padding: 24px;
      width: 400px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
      animation: modalSlide 0.3s ease;
    }

    @keyframes modalSlide {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-card h2 {
      margin: 0 0 12px;
      font-size: 20px;
      color: #1e293b;
      font-weight: 700;
    }

    .modal-card p {
      margin: 0 0 20px;
      color: #64748b;
    }

    .modal-label {
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 14px;
      color: #475569;
      margin-bottom: 16px;
      font-weight: 600;
    }

    .modal-label input,
    .modal-label select {
      padding: 12px 14px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      background: white;
      transition: all 0.2s ease;
    }

    .modal-label input:focus,
    .modal-label select:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15);
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }

    .btn-secondary {
      background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
      color: #475569;
      border: 1px solid #cbd5e1;
    }

    .btn-secondary:hover {
      background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
    }

    .btn-danger {
      background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(220, 38, 38, 0.35);
    }

    .btn-danger:hover {
      background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
    }

    .btn-primary {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
    }

    .btn-primary:disabled {
      background: #94a3b8;
      box-shadow: none;
      cursor: not-allowed;
    }

    :host-context(.dark-theme) .modal-card {
      background: #0f172a;
      border: 1px solid #1e293b;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
    }

    :host-context(.dark-theme) .modal-card h2 {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .modal-card p,
    :host-context(.dark-theme) .modal-label {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .modal-label input,
    :host-context(.dark-theme) .modal-label select {
      background: #1e293b;
      color: #e2e8f0;
      border-color: #334155;
    }

    :host-context(.dark-theme) .btn-secondary {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      color: #e2e8f0;
      border-color: #475569;
    }

    :host-context(.dark-theme) .search-users input {
      background: #1e293b;
      border-color: #334155;
      color: #e2e8f0;
    }

    @media (max-width: 880px) {
      .tickets-table {
        min-width: 0;
      }

      .tickets-table thead {
        display: none;
      }

      .tickets-table tbody tr {
        display: block;
        margin-bottom: 12px;
        border: 1px solid #eef2f6;
        border-radius: 8px;
      }

      .tickets-table tbody td {
        display: block;
        width: 100%;
      }

      .actions-col {
        text-align: left;
      }
    }
  `]
})
export class TicketsComponent implements OnInit, OnDestroy {

  tickets: Ticket[] = [];
  filteredTickets: Ticket[] = [];

  selectedTab: 'open' | 'closed' | 'my' = 'open';
  myStatus: 'open' | 'closed' = 'open';
  currentPage = 1;
  limit = 25;
  hasMore = false;

  // 🔥 Separate pagination for My Tickets
  myTicketsOpenPage = 1;
  myTicketsClosedPage = 1;
  myTicketsOpenHasMore = false;
  myTicketsClosedHasMore = false;
  myTicketsOpenAll: Ticket[] = [];
  myTicketsClosedAll: Ticket[] = [];
  myTicketsOpenLastApiPage = 0;
  myTicketsClosedLastApiPage = 0;

  currentUserEmail = '';
  currentUserName = '';
  allowedRequesterEmails: string[] = [];
  userRole: 'admin' | 'user' = 'user';

  get isAdmin(): boolean {
    return this.userRole === 'admin';
  }

  searchTerm = '';
  private searchTerm$ = new Subject<string>();
  private searchSub?: Subscription;
  private searchCache = new Map<string, Ticket[]>(); // 🚀 Cache search results
  private isInitialLoad = true; // Track if first load or tab switch
  isRefreshing = false;

  showCloseDialog = false;
  showUpdateDialog = false;
  activeTicketId = '';
  closeNewExpiryDate = '';
  closeRequiresNewExpiry = false;
  closingTicketType = '';
  updateStatus = '';
  updatePriority = '';

  statusOptions = ['Open', 'In Progress', 'Resolved', 'Closed'];
  priorityOptions = ['SLA', 'High', 'Medium', 'Low'];

  // ================= ASSIGNMENT STATE =================
  showAssignDialog = false;
  showBulkAssignDialog = false;
  isReassigning = false;
  assignTicketId = '';
  assignTicketNumber = '';
  selectedAssignees: string[] = [];
  bulkAssignees: string[] = [];
  allUsers: { email: string; displayName: string }[] = [];
  filteredUsers: { email: string; displayName: string }[] = [];
  filteredBulkUsers: { email: string; displayName: string }[] = [];
  userSearchTerm = '';
  bulkUserSearchTerm = '';
  loadingUsers = false;
  selectedTickets = new Set<string>();
  assignmentsMap = new Map<string, TicketAssignment>();

  constructor(
    private ticketService: TicketService,
    private assignmentService: AssignmentService,
    public loadingService: LoadingService,
    private messageService: MessageService,
    private msalService: MsalService,
    private ihubService: IhubService,
    private sslService: SslService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  async ngOnInit(): Promise<void> {
    await this.initCurrentUser();
    
    // 🔥 Restore tab state from sessionStorage (persists across refresh/back navigation)
    const savedTab = sessionStorage.getItem('ITSM_SELECTED_TAB') as 'open' | 'closed' | 'my' | null;
    const savedMyStatus = sessionStorage.getItem('ITSM_MY_STATUS') as 'open' | 'closed' | null;
    
    if (savedTab && ['open', 'closed', 'my'].includes(savedTab)) {
      this.selectedTab = savedTab;
    } else {
      // Set default tab based on user role
      this.selectedTab = this.isAdmin ? 'open' : 'my';
    }
    
    if (savedMyStatus && ['open', 'closed'].includes(savedMyStatus)) {
      this.myStatus = savedMyStatus;
    }
    
    // Load assignments first (needed for "My Tickets" filtering)
    await this.loadAssignmentsAsync();
    
    // 🚀 Try to restore from service-level cache first (persists across navigation)
    const cacheKey = this.selectedTab === 'my' ? `my_${this.myStatus}` : this.selectedTab;
    const cached = this.ticketService.getTabCache(cacheKey);
    
    if (cached) {
      // Restore from cache - no loading needed
      this.filteredTickets = cached.tickets;
      if (this.selectedTab === 'my') {
        if (this.myStatus === 'open') {
          this.myTicketsOpenPage = cached.page;
          this.myTicketsOpenHasMore = cached.hasMore;
        } else {
          this.myTicketsClosedPage = cached.page;
          this.myTicketsClosedHasMore = cached.hasMore;
        }
        // Restore my tickets all arrays if available
        if (cached.myTicketsOpenAll) this.myTicketsOpenAll = cached.myTicketsOpenAll;
        if (cached.myTicketsClosedAll) this.myTicketsClosedAll = cached.myTicketsClosedAll;
        if (cached.myTicketsOpenLastApiPage !== undefined) this.myTicketsOpenLastApiPage = cached.myTicketsOpenLastApiPage;
        if (cached.myTicketsClosedLastApiPage !== undefined) this.myTicketsClosedLastApiPage = cached.myTicketsClosedLastApiPage;
      } else {
        this.currentPage = cached.page;
        this.hasMore = cached.hasMore;
      }
      this.cdr.markForCheck();
    } else {
      // No cache, load fresh
      this.loadTickets();
    }
    
    this.loadAssignableUsers();

    // After initial load, we're no longer on first load
    setTimeout(() => {
      this.isInitialLoad = false;
    }, 500);

    this.searchSub = this.searchTerm$
      .pipe(debounceTime(500), distinctUntilChanged())
      .subscribe(term => {
        this.searchTerm = term.trim().toLowerCase();
        this.currentPage = 1;
        this.loadTickets();
      });

    // ✅ AUTO-REFRESH DISABLED - Data now cached with smart expiration
    // Initial page load shows loading indicator
    // Tab switches load fresh data silently (no loading indicator)
  }

  ngOnDestroy(): void {
    this.searchSub?.unsubscribe();
    // 🚀 Save current state to service-level cache before component is destroyed
    this.saveToServiceCache();
  }

  onSearchChange(value: string): void {
    this.searchTerm$.next(value || '');
  }

  switchTab(tab: 'open' | 'closed' | 'my'): void {
    if (this.selectedTab === tab) return;
    
    // 🚀 Save current tab state to service cache before switching
    this.saveToServiceCache();
    
    this.selectedTab = tab;
    
    // 🔥 Persist to sessionStorage for refresh/back navigation
    sessionStorage.setItem('ITSM_SELECTED_TAB', tab);
    
    // 🚀 Try to restore from service cache
    const cacheKey = tab === 'my' ? `my_${this.myStatus}` : tab;
    const cached = this.ticketService.getTabCache(cacheKey);
    
    if (cached) {
      // Restore from cache - no loading indicator needed
      this.filteredTickets = cached.tickets;
      if (tab === 'my') {
        if (this.myStatus === 'open') {
          this.myTicketsOpenPage = cached.page;
          this.myTicketsOpenHasMore = cached.hasMore;
        } else {
          this.myTicketsClosedPage = cached.page;
          this.myTicketsClosedHasMore = cached.hasMore;
        }
        // Restore my tickets arrays
        if (cached.myTicketsOpenAll) this.myTicketsOpenAll = cached.myTicketsOpenAll;
        if (cached.myTicketsClosedAll) this.myTicketsClosedAll = cached.myTicketsClosedAll;
        if (cached.myTicketsOpenLastApiPage !== undefined) this.myTicketsOpenLastApiPage = cached.myTicketsOpenLastApiPage;
        if (cached.myTicketsClosedLastApiPage !== undefined) this.myTicketsClosedLastApiPage = cached.myTicketsClosedLastApiPage;
      } else {
        this.currentPage = cached.page;
        this.hasMore = cached.hasMore;
      }
      this.cdr.markForCheck();
      return;
    }
    
    // No valid cache, reset and load fresh
    this.currentPage = 1;
    if (tab === 'my') {
      this.myTicketsOpenPage = 1;
      this.myTicketsClosedPage = 1;
      this.myTicketsOpenLastApiPage = 0;
      this.myTicketsClosedLastApiPage = 0;
      this.myTicketsOpenAll = [];
      this.myTicketsClosedAll = [];
    }
    this.loadTickets(true);
  }


  switchMyStatus(status: 'open' | 'closed'): void {
    if (this.myStatus === status) return;
    
    // 🚀 Save current my-status state to service cache before switching
    this.saveToServiceCache();
    
    this.myStatus = status;
    
    // 🔥 Persist to sessionStorage for refresh/back navigation
    sessionStorage.setItem('ITSM_MY_STATUS', status);
    
    // 🚀 Try to restore from service cache
    const cacheKey = `my_${status}`;
    const cached = this.ticketService.getTabCache(cacheKey);
    
    if (cached) {
      // Restore from cache - no loading indicator needed
      this.filteredTickets = cached.tickets;
      if (status === 'open') {
        this.myTicketsOpenPage = cached.page;
        this.myTicketsOpenHasMore = cached.hasMore;
        if (cached.myTicketsOpenAll) this.myTicketsOpenAll = cached.myTicketsOpenAll;
        if (cached.myTicketsOpenLastApiPage !== undefined) this.myTicketsOpenLastApiPage = cached.myTicketsOpenLastApiPage;
      } else {
        this.myTicketsClosedPage = cached.page;
        this.myTicketsClosedHasMore = cached.hasMore;
        if (cached.myTicketsClosedAll) this.myTicketsClosedAll = cached.myTicketsClosedAll;
        if (cached.myTicketsClosedLastApiPage !== undefined) this.myTicketsClosedLastApiPage = cached.myTicketsClosedLastApiPage;
      }
      this.cdr.markForCheck();
      return;
    }
    
    // No valid cache, load fresh
    if (status === 'open') {
      this.myTicketsOpenPage = 1;
      this.myTicketsOpenLastApiPage = 0;
      this.myTicketsOpenAll = [];
    } else {
      this.myTicketsClosedPage = 1;
      this.myTicketsClosedLastApiPage = 0;
      this.myTicketsClosedAll = [];
    }
    this.loadTickets(true);
  }


  /* ================= GLOBAL SEARCH ================= */

  private async globalSearchAllPages(
    term: string,
    status?: 'open' | 'closed',
    filter?: (ticket: Ticket) => boolean
  ): Promise<Ticket[]> {
    let page = 1;
    let hasMore = true;
    const allResults: Ticket[] = [];
    let maxPages = 10; // Limit search to 10 pages for better performance

    const searchLower = term.toLowerCase();

    while (hasMore && maxPages > 0) {
      try {
        const res = await firstValueFrom(
          this.ticketService.getTickets(page, this.limit, status, term)
        );

        const data: Ticket[] = res?.data || [];

        if (!data || data.length === 0) {
          break;
        }

        // Client-side search filter as fallback (in case API search doesn't work)
        const searchFiltered = data.filter((t: Ticket) =>
          (t.ticketNumber && t.ticketNumber.toLowerCase().includes(searchLower)) ||
          (t.id && t.id.toLowerCase().includes(searchLower)) ||
          (t.ticketId && t.ticketId.toLowerCase().includes(searchLower)) ||
          (t.subject && t.subject.toLowerCase().includes(searchLower)) ||
          (t.email && t.email.toLowerCase().includes(searchLower)) ||
          (t.contact?.email && t.contact.email.toLowerCase().includes(searchLower)) ||
          (t.assignedTo && t.assignedTo.toLowerCase().includes(searchLower))
        );

        // Apply custom filter if provided (e.g., for "my tickets")
        const filtered = filter ? searchFiltered.filter(filter) : searchFiltered;
        allResults.push(...filtered);

        hasMore = !!res?.hasMore;
        page++;
        maxPages--;
      } catch (err) {
        console.error('Search error on page', page, ':', err);
        break;
      }
    }

    return allResults;
  }

  /* ================= REFRESH ================= */
  
  refreshCurrentTab(): void {
    this.isRefreshing = true;
    // Clear ALL caches
    this.ticketService.clearAllCache();
    this.ticketService.invalidateTabCache();
    this.searchCache.clear();
    // Reset my tickets arrays so fresh data is fetched
    this.myTicketsOpenAll = [];
    this.myTicketsClosedAll = [];
    this.myTicketsOpenLastApiPage = 0;
    this.myTicketsClosedLastApiPage = 0;
    this.myTicketsOpenPage = 1;
    this.myTicketsClosedPage = 1;
    this.loadTickets(true).finally(() => {
      this.isRefreshing = false;
      this.cdr.markForCheck();
    });
  }

  /* ================= CORE ================= */

async loadTickets(showLoadingIndicator = true): Promise<void> {
  // Only show loading on initial page load, not on tab switches
  if (showLoadingIndicator) {
    this.loadingService.show();
    // Clear current tickets to show loading state
    this.filteredTickets = [];
    this.cdr.markForCheck();
  }

  // If there's a search term, perform search with caching
  if (this.searchTerm) {
    try {
      // Create cache key combining search term, role, and user
      const roleKey = this.isAdmin ? 'admin' : 'user';
      const cacheKey = `${roleKey}|${this.currentUserEmail}|${this.searchTerm}`;
      
      let searchResults: Ticket[] = [];

      // Check cache first
      if (this.searchCache.has(cacheKey)) {
        searchResults = this.searchCache.get(cacheKey) || [];
      } else {
        // Not in cache, perform search
        if (this.isAdmin) {
          // Admin global search: all tickets across all statuses
          searchResults = await this.globalSearchAllPages(
            this.searchTerm,
            undefined
          );
        } else {
          // User global search: only their tickets across all statuses
          searchResults = await this.globalSearchAllPages(
            this.searchTerm,
            undefined,
            (ticket: Ticket) => this.isMyTicket(ticket)
          );
        }
        
        // Cache the results
        this.searchCache.set(cacheKey, searchResults);
      }

      this.filteredTickets = searchResults;
      this.cdr.markForCheck();
      this.loadingService.hide();
    } catch (err) {
      console.error('Search failed:', err);
      this.messageService.error('Search failed');
      this.loadingService.hide();
    }
    return;
  }

  // No search term - use regular pagination
  if (this.selectedTab === 'my') {
    await this.loadMyTickets();
    this.saveToServiceCache(); // 🚀 Save to cache after loading
    this.loadingService.hide();
  } else {
    this.ticketService
      .getTickets(this.currentPage, this.limit, this.selectedTab as 'open' | 'closed')
      .subscribe({
        next: res => {
          const data: Ticket[] = res.data || [];

          this.filteredTickets = data.filter((t: Ticket) =>
            this.isCorrectStatus(t, this.selectedTab as 'open' | 'closed')
          );

          this.hasMore = !!res.hasMore;
          this.saveToServiceCache(); // 🚀 Save to cache after loading
          this.cdr.markForCheck();
          this.loadingService.hide();   // ✅ move here
        },
        error: () => {
          this.messageService.error('Failed to load tickets');
          this.loadingService.hide();   // ✅ move here
        }
      });
  }
}

  // 🚀 Save to service-level cache (persists across navigation)
  private saveToServiceCache(): void {
    const cacheKey = this.selectedTab === 'my' ? `my_${this.myStatus}` : this.selectedTab;
    const page = this.selectedTab === 'my' 
      ? (this.myStatus === 'open' ? this.myTicketsOpenPage : this.myTicketsClosedPage)
      : this.currentPage;
    const hasMore = this.selectedTab === 'my'
      ? (this.myStatus === 'open' ? this.myTicketsOpenHasMore : this.myTicketsClosedHasMore)
      : this.hasMore;
    
    this.ticketService.setTabCache(cacheKey, {
      tickets: [...this.filteredTickets],
      page,
      hasMore,
      myTicketsOpenAll: [...this.myTicketsOpenAll],
      myTicketsClosedAll: [...this.myTicketsClosedAll],
      myTicketsOpenLastApiPage: this.myTicketsOpenLastApiPage,
      myTicketsClosedLastApiPage: this.myTicketsClosedLastApiPage
    });
  }

  // Clear all tab caches (called on explicit refresh)
  clearTabCache(): void {
    this.ticketService.invalidateTabCache();
    this.searchCache.clear();
  }


  private loadStandardTickets(): void {
    this.tickets = [];
    this.filteredTickets = [];
    this.cdr.markForCheck();

    const statusParam = this.selectedTab as 'open' | 'closed';

    this.ticketService
      .getTickets(this.currentPage, this.limit, statusParam)
      .subscribe({
        next: res => {
          const data: Ticket[] = res.data || [];
          
          // Apply client-side filtering by status to ensure correct display
          this.filteredTickets = data.filter((t: Ticket) => 
            this.isCorrectStatus(t, statusParam)
          );

          this.hasMore = !!res.hasMore;
          this.cdr.markForCheck();
        },
        error: () => {
          this.messageService.error('Failed to load tickets');
        }
      });
  }

  private async loadMyTickets(): Promise<void> {
    // 🔥 Load "my" tickets using server-side filtering by email
    this.cdr.markForCheck();

    const pageSize = 25; // Display size per page
    
    try {
      // Select cache and state based on status
      const cache = this.myStatus === 'open' ? this.myTicketsOpenAll : this.myTicketsClosedAll;
      const currentPage = this.myStatus === 'open' ? this.myTicketsOpenPage : this.myTicketsClosedPage;
      const lastApiPage = this.myStatus === 'open' ? this.myTicketsOpenLastApiPage : this.myTicketsClosedLastApiPage;
      
      // Calculate what we need
      const neededIndex = (currentPage - 1) * pageSize + pageSize;
      
      // If cache has enough, just slice and display (instant)
      if (cache.length >= neededIndex) {
        const startIdx = (currentPage - 1) * pageSize;
        this.filteredTickets = cache.slice(startIdx, neededIndex);
        this.cdr.markForCheck();
        return;
      }

      // Use server-side filtering by user email
      let allMyTickets = [...cache];
      let currentApiPage = lastApiPage + 1;
      let hasMoreOnServer = true;

      // Server does the filtering now, so each page returns only our tickets
      while (allMyTickets.length < neededIndex && hasMoreOnServer && currentApiPage <= 20) {
        try {
          const res = await firstValueFrom(
            this.ticketService.getTickets(currentApiPage, pageSize, this.myStatus, undefined, this.currentUserEmail)
          );

          const data: Ticket[] = res?.data || [];
          // Server already filtered by email, just verify status
          const newMyTickets = data.filter(t => this.isCorrectStatus(t, this.myStatus));
          
          allMyTickets = [...allMyTickets, ...newMyTickets];
          hasMoreOnServer = !!res?.hasMore;
          currentApiPage++;
        } catch (pageErr) {
          console.error(`Error loading API page ${currentApiPage}:`, pageErr);
          hasMoreOnServer = false;
          break;
        }
      }

      // Update cache and tracking
      if (this.myStatus === 'open') {
        this.myTicketsOpenAll = allMyTickets;
        this.myTicketsOpenLastApiPage = currentApiPage - 1;
        this.myTicketsOpenHasMore = allMyTickets.length > neededIndex || hasMoreOnServer;
      } else {
        this.myTicketsClosedAll = allMyTickets;
        this.myTicketsClosedLastApiPage = currentApiPage - 1;
        this.myTicketsClosedHasMore = allMyTickets.length > neededIndex || hasMoreOnServer;
      }

      // Display current page
      const startIdx = (currentPage - 1) * pageSize;
      this.filteredTickets = allMyTickets.slice(startIdx, neededIndex);
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load my tickets:', err);
      this.messageService.error('Failed to load your tickets');
    }
  }

  private myLoadSeq = 0;

 

  // 🔥 Helper to ensure we only show tickets with the correct status
  isCorrectStatus(ticket: Ticket, status: 'open' | 'closed'): boolean {
    const ticketStatus = (ticket.status || '').toLowerCase();
    
    if (status === 'open') {
      return ticketStatus.includes('open') || ticketStatus.includes('progress');
    } else {
      return ticketStatus.includes('closed') || ticketStatus.includes('resolved');
    }
  }

  nextPage(): void {
    if (this.searchTerm) return;
    
    if (this.selectedTab === 'my') {
      // 🔥 For My Tickets, handle pagination separately for open/closed
      if (this.myStatus === 'open') {
        if (this.myTicketsOpenHasMore) {
          this.myTicketsOpenPage++;
          this.loadTickets();
        }
      } else {
        if (this.myTicketsClosedHasMore) {
          this.myTicketsClosedPage++;
          this.loadTickets();
        }
      }
    } else {
      // Standard pagination for regular tabs
      if (!this.hasMore) return;
      this.currentPage++;
      this.loadTickets();
    }
  }

  prevPage(): void {
    if (this.searchTerm) return;
    
    if (this.selectedTab === 'my') {
      // 🔥 For My Tickets, handle pagination separately for open/closed
      if (this.myStatus === 'open') {
        if (this.myTicketsOpenPage > 1) {
          this.myTicketsOpenPage--;
          this.loadTickets();
        }
      } else {
        if (this.myTicketsClosedPage > 1) {
          this.myTicketsClosedPage--;
          this.loadTickets();
        }
      }
    } else {
      // Standard pagination for regular tabs
      if (this.currentPage === 1) return;
      this.currentPage--;
      this.loadTickets();
    }
  }

  updateTicket(ticketId: string): void {
    if (!ticketId) return;
    this.activeTicketId = ticketId;
    this.updateStatus = '';
    this.updatePriority = '';
    this.showUpdateDialog = true;
  }

  closeTicket(ticketId: string): void {
    if (!ticketId) return;
    this.activeTicketId = ticketId;
    const selectedTicket = this.filteredTickets.find(t => (t.id || t.ticketId || '') === ticketId);
    const assignment = this.assignmentsMap.get(ticketId);
    const category = (assignment?.category || '').toUpperCase();
    this.closingTicketType = category;
    const subject = (selectedTicket?.subject || '').toUpperCase();
    const isAutomationSslTicket = category === 'SSL' && subject.includes('[SSL][AUTOMATION]');
    this.closeRequiresNewExpiry = category === 'IHUB' || (category === 'SSL' && !isAutomationSslTicket);
    this.closeNewExpiryDate = '';
    this.showCloseDialog = true;
  }

  openTicket(ticketId: string): void {
    if (!ticketId) return;
    this.ticketService.openTicket(ticketId).subscribe({
      next: () => {
        // Remove reopened ticket from current view immediately
        const openedTicket = this.filteredTickets.find(t => t.id === ticketId || t.ticketId === ticketId);
        this.filteredTickets = this.filteredTickets.filter(t => (t.id || t.ticketId) !== ticketId);
        // Remove from closed caches
        this.myTicketsClosedAll = this.myTicketsClosedAll.filter(t => (t.id || t.ticketId) !== ticketId);
        // Add to open caches if we have the ticket data
        if (openedTicket) {
          openedTicket.status = 'Open';
          this.myTicketsOpenAll.unshift(openedTicket);
        }
        // INVALIDATE ALL CACHE
        this.ticketService.clearAllCache();
        this.ticketService.invalidateTabCache();
        this.messageService.success('Ticket reopened');
        this.cdr.markForCheck();
      },
      error: () => this.messageService.error('Reopen failed')
    });
  }

  moveToRecycleBin(ticket: Ticket): void {
    const ticketId = (ticket.id || ticket.ticketId || '').toString();
    if (!ticketId) return;

    const ok = window.confirm('Move this ticket to recycle bin?');
    if (!ok) return;

    this.ticketService.moveToRecycleBin(ticketId, ticket).subscribe({
      next: () => {
        this.filteredTickets = this.filteredTickets.filter(t => (t.id || t.ticketId) !== ticketId);
        this.tickets = this.tickets.filter(t => (t.id || t.ticketId) !== ticketId);
        this.myTicketsOpenAll = this.myTicketsOpenAll.filter(t => (t.id || t.ticketId) !== ticketId);
        this.myTicketsClosedAll = this.myTicketsClosedAll.filter(t => (t.id || t.ticketId) !== ticketId);
        this.ticketService.clearAllCache();
        this.ticketService.invalidateTabCache();
        this.messageService.success('Ticket moved to recycle bin');
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.messageService.error(this.describeError(err, 'Failed to move ticket to recycle bin'));
      }
    });
  }

  cancelDialogs(): void {
    this.showCloseDialog = false;
    this.showUpdateDialog = false;
    this.showAssignDialog = false;
    this.showBulkAssignDialog = false;
    this.isReassigning = false;
    this.activeTicketId = '';
    this.closeNewExpiryDate = '';
    this.closeRequiresNewExpiry = false;
    this.closingTicketType = '';
    this.assignTicketId = '';
    this.assignTicketNumber = '';
    this.updateStatus = '';
    this.updatePriority = '';
    this.selectedAssignees = [];
    this.bulkAssignees = [];
    this.userSearchTerm = '';
    this.bulkUserSearchTerm = '';
    this.filteredUsers = [...this.allUsers];
    this.filteredBulkUsers = [...this.allUsers];
  }

  confirmClose(): void {
    if (!this.activeTicketId) return;

    if (this.closeRequiresNewExpiry && !this.closeNewExpiryDate) {
      const dateType = this.closingTicketType === 'IHUB' ? 'IHUB' : 'SSL';
      this.messageService.error(`New ${dateType} expiry date is required for ticket closure`);
      return;
    }

    let closeRequest$;
    if (this.closingTicketType === 'IHUB') {
      closeRequest$ = this.ihubService.closeIhubTicket(this.activeTicketId, this.closeNewExpiryDate);
    } else if (this.closingTicketType === 'SSL') {
      closeRequest$ = this.sslService.closeAlertTicket(this.activeTicketId, this.closeNewExpiryDate);
    } else {
      closeRequest$ = this.ticketService.closeTicket(this.activeTicketId, this.currentUserEmail);
    }

    closeRequest$.subscribe({
      next: () => {
        // Remove closed ticket from current view immediately
        const closedTicket = this.filteredTickets.find(t => t.id === this.activeTicketId || t.ticketId === this.activeTicketId);
        this.filteredTickets = this.filteredTickets.filter(t => (t.id || t.ticketId) !== this.activeTicketId);
        // Remove from open caches
        this.myTicketsOpenAll = this.myTicketsOpenAll.filter(t => (t.id || t.ticketId) !== this.activeTicketId);
        // Add to closed caches if we have the ticket data
        if (closedTicket) {
          closedTicket.status = 'Closed';
          if (this.currentUserEmail) closedTicket.closedBy = this.currentUserEmail;
          this.myTicketsClosedAll.unshift(closedTicket);
        }
        // INVALIDATE ALL CACHE
        this.ticketService.clearAllCache();
        this.ticketService.invalidateTabCache();
        this.messageService.success('Ticket closed');
        this.cdr.markForCheck();
        this.cancelDialogs();
      },
      error: (err: any) => this.messageService.error(this.describeError(err, 'Close failed'))
    });
  }

  confirmUpdate(): void {
    if (!this.activeTicketId) return;
    const status = this.updateStatus.trim();
    const priority = this.updatePriority.trim();
    if (!status && !priority) {
      this.messageService.error('Enter status or priority');
      return;
    }

    const data: any = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;

    this.ticketService.updateTicket(this.activeTicketId, data).subscribe({
      next: () => {
        const updatedTicket = this.filteredTickets.find(t => t.id === this.activeTicketId || t.ticketId === this.activeTicketId);
        if (updatedTicket) {
          if (priority) updatedTicket.priority = priority;
          if (status) {
            const oldStatus = (updatedTicket.status || '').toLowerCase();
            const newStatus = status.toLowerCase();
            updatedTicket.status = status;
            // If status changed between open/closed, remove from current view
            const wasOpen = oldStatus.includes('open') || oldStatus.includes('progress');
            const nowClosed = newStatus.includes('closed') || newStatus.includes('resolved');
            const wasClosed = oldStatus.includes('closed') || oldStatus.includes('resolved');
            const nowOpen = newStatus.includes('open') || newStatus.includes('progress');
            if ((wasOpen && nowClosed) || (wasClosed && nowOpen)) {
              this.filteredTickets = this.filteredTickets.filter(t => (t.id || t.ticketId) !== this.activeTicketId);
            }
          }
          this.cdr.markForCheck();
        }
        // INVALIDATE ALL CACHE
        this.ticketService.clearAllCache();
        this.ticketService.invalidateTabCache();
        this.messageService.success('Ticket updated');
        this.cancelDialogs();
      },
      error: () => this.messageService.error('Update failed')
    });
  }

  viewTicket(ticketId: string): void {
    if (!ticketId) return;

    // Admin can view all tickets
    if (this.isAdmin) {
      this.router.navigate(['/tickets', ticketId]);
      return;
    }

    // User can only view tickets from "My Tickets" tab
    if (this.selectedTab !== 'my') {
      this.messageService.error('You can only view tickets from "My Tickets" tab');
      return;
    }

    // Check if the ticket belongs to the user
    const ticket = this.filteredTickets.find(t => (t.id || t.ticketId) === ticketId);
    if (ticket && this.isMyTicket(ticket)) {
      this.router.navigate(['/tickets', ticketId]);
    } else {
      this.messageService.error('You do not have permission to view this ticket');
    }
  }

  statusClass(status?: string): string {
    if (!status) return 'unknown';
    const s = status.toLowerCase();
    if (s.includes('open')) return 'open';
    if (s.includes('progress')) return 'inprogress';
    if (s.includes('resolved')) return 'resolved';
    if (s.includes('closed')) return 'closed';
    return 'unknown';
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

  closedByFor(ticket: Ticket): string {
    const status = (ticket?.status || '').toLowerCase();
    if (!status.includes('closed') && !status.includes('resolved')) return '';
    return this.ticketService.resolveClosedBy(ticket);
  }

  assignedToDisplay(ticket: Ticket): string {
    const ticketId = ticket?.id || ticket?.ticketId || '';
    
    // Check Supabase assignment first (multi-agent source of truth)
    const assignment = this.assignmentsMap.get(ticketId);
    if (assignment && assignment.primary_assignee) {
      return assignment.primary_assignee;
    }

    // Fallback to Zoho data
    const status = (ticket?.status || '').toLowerCase();
    const closedBy = this.ticketService.resolveClosedBy(ticket).trim();
    if ((status.includes('closed') || status.includes('resolved')) && closedBy) {
      return closedBy;
    }
    return ticket.assignedTo || 'Unassigned';
  }

  private async initCurrentUser(): Promise<void> {
    const account = this.msalService.getAccount();
    const storedEmail = sessionStorage.getItem('username') || '';
    const storedName = sessionStorage.getItem('displayName') || '';

    this.currentUserEmail = (account?.username || storedEmail || '').trim().toLowerCase();
    this.currentUserName = (account?.name || storedName || '').trim().toLowerCase();

    // Load user role from sessionStorage
    const storedRole = sessionStorage.getItem('role');
    this.userRole = (storedRole === 'admin' ? 'admin' : 'user') as 'admin' | 'user';

    const allowed = new Set<string>();
    if (this.currentUserEmail) allowed.add(this.currentUserEmail);

    try {
      await this.msalService.ensureInitialized();
      const groupMails = await this.msalService.getUserGroupMails();
      groupMails.forEach(mail => allowed.add(mail));
    } catch {
      // ignore group load failures
    }

    this.allowedRequesterEmails = Array.from(allowed);
  }

  private isMyTicket(ticket: Ticket): boolean {
    const ticketId = ticket.id || ticket.ticketId || '';
    const userEmail = (this.currentUserEmail || '').trim().toLowerCase();

    // Check Zoho requester email
    const requesterEmail =
      (ticket.email || ticket.contact?.email || '').trim().toLowerCase();

    // Check Zoho assignee email
    const assigneeEmail =
      (ticket.assignedTo ||
       ticket.assignee?.email ||
       '').trim().toLowerCase();

    // Check Supabase assignment (multi-agent)
    const assignment = this.assignmentsMap.get(ticketId);
    const isSupabaseAssignee = assignment?.assigned_users?.some(
      u => u.toLowerCase() === userEmail
    ) || false;

    return requesterEmail === userEmail || assigneeEmail === userEmail || isSupabaseAssignee;
  }


  private describeError(err: any, fallback: string): string {
    const message = err?.error?.message || err?.message;
    if (message) return message;

    const details = err?.error?.details;
    if (!details) return fallback;

    if (typeof details === 'string') return details;
    try {
      return JSON.stringify(details);
    } catch {
      return fallback;
    }
  }

  // ================= ASSIGNMENT METHODS =================

  async loadAssignableUsers(): Promise<void> {
    this.loadingUsers = true;
    try {
      const users = await this.msalService.getOrganizationUsers();
      this.allUsers = users;
      this.filteredUsers = [...users];
      this.filteredBulkUsers = [...users];
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load MSAL users:', err);
    } finally {
      this.loadingUsers = false;
      this.cdr.markForCheck();
    }
  }

  filterUsers(): void {
    const term = this.userSearchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredUsers = [...this.allUsers];
    } else {
      this.filteredUsers = this.allUsers.filter(u =>
        u.email.toLowerCase().includes(term) ||
        u.displayName.toLowerCase().includes(term)
      );
    }
    this.cdr.markForCheck();
  }

  filterBulkUsers(): void {
    const term = this.bulkUserSearchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredBulkUsers = [...this.allUsers];
    } else {
      this.filteredBulkUsers = this.allUsers.filter(u =>
        u.email.toLowerCase().includes(term) ||
        u.displayName.toLowerCase().includes(term)
      );
    }
    this.cdr.markForCheck();
  }

  getUserDisplayName(email: string): string {
    const user = this.allUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
    return user?.displayName || email;
  }

  isUserSelected(email: string): boolean {
    return this.selectedAssignees.some(e => e.toLowerCase() === email.toLowerCase());
  }

  isBulkUserSelected(email: string): boolean {
    return this.bulkAssignees.some(e => e.toLowerCase() === email.toLowerCase());
  }

  toggleUserSelection(email: string): void {
    const index = this.selectedAssignees.findIndex(e => e.toLowerCase() === email.toLowerCase());
    if (index >= 0) {
      this.selectedAssignees.splice(index, 1);
    } else {
      this.selectedAssignees.push(email);
    }
    this.cdr.markForCheck();
  }

  toggleBulkUserSelection(email: string): void {
    const index = this.bulkAssignees.findIndex(e => e.toLowerCase() === email.toLowerCase());
    if (index >= 0) {
      this.bulkAssignees.splice(index, 1);
    } else {
      this.bulkAssignees.push(email);
    }
    this.cdr.markForCheck();
  }

  removeAssignee(email: string): void {
    const index = this.selectedAssignees.findIndex(e => e.toLowerCase() === email.toLowerCase());
    if (index >= 0) {
      this.selectedAssignees.splice(index, 1);
      this.cdr.markForCheck();
    }
  }

  removeBulkAssignee(email: string): void {
    const index = this.bulkAssignees.findIndex(e => e.toLowerCase() === email.toLowerCase());
    if (index >= 0) {
      this.bulkAssignees.splice(index, 1);
      this.cdr.markForCheck();
    }
  }

  loadAssignments(): void {
    this.assignmentService.getAllAssignments().subscribe({
      next: assignments => {
        this.assignmentsMap.clear();
        assignments.forEach(a => this.assignmentsMap.set(a.zoho_ticket_id, a));
        this.cdr.markForCheck();
      },
      error: () => console.error('Failed to load assignments')
    });
  }

  async loadAssignmentsAsync(): Promise<void> {
    try {
      const assignments = await firstValueFrom(this.assignmentService.getAllAssignments());
      this.assignmentsMap.clear();
      assignments.forEach(a => this.assignmentsMap.set(a.zoho_ticket_id, a));
      this.cdr.markForCheck();
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  }

  getAssignment(ticketId: string): TicketAssignment | undefined {
    return this.assignmentsMap.get(ticketId);
  }

  isTicketAssigned(ticket: Ticket): boolean {
    const ticketId = ticket.id || ticket.ticketId || '';
    const assignment = this.assignmentsMap.get(ticketId);
    return !!assignment && assignment.assigned_users.length > 0;
  }

  getMultiAssignees(ticket: Ticket): string[] {
    const ticketId = ticket.id || ticket.ticketId || '';
    const assignment = this.assignmentsMap.get(ticketId);
    return assignment?.assigned_users || [];
  }

  canReassign(ticket: Ticket): boolean {
    const ticketId = ticket.id || ticket.ticketId || '';
    const assignment = this.assignmentsMap.get(ticketId);
    if (!assignment) return false;

    // Admin can reassign any assigned ticket
    if (this.isAdmin) return true;

    // User can only reassign if they are the current assignee
    const userEmail = this.currentUserEmail.toLowerCase();
    return assignment.assigned_users.some(u => u.toLowerCase() === userEmail);
  }

  // Selection methods for bulk assign
  toggleSelectTicket(ticketId: string): void {
    if (this.selectedTickets.has(ticketId)) {
      this.selectedTickets.delete(ticketId);
    } else {
      this.selectedTickets.add(ticketId);
    }
    this.cdr.markForCheck();
  }

  toggleSelectAll(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.filteredTickets.forEach(t => {
        const id = t.id || t.ticketId || '';
        if (id) this.selectedTickets.add(id);
      });
    } else {
      this.selectedTickets.clear();
    }
    this.cdr.markForCheck();
  }

  isAllSelected(): boolean {
    if (this.filteredTickets.length === 0) return false;
    return this.filteredTickets.every(t => 
      this.selectedTickets.has(t.id || t.ticketId || '')
    );
  }

  // Dialog openers
  openAssignDialog(ticketId: string, ticketNumber: string): void {
    this.assignTicketId = ticketId;
    this.assignTicketNumber = ticketNumber;
    this.isReassigning = false;
    this.selectedAssignees = [];
    this.userSearchTerm = '';
    this.filteredUsers = [...this.allUsers];
    this.showAssignDialog = true;
  }

  openReassignDialog(ticketId: string): void {
    const ticket = this.filteredTickets.find(t => (t.id || t.ticketId) === ticketId);
    this.assignTicketId = ticketId;
    this.assignTicketNumber = ticket?.ticketNumber || ticket?.id || ticketId;
    this.isReassigning = true;
    this.userSearchTerm = '';
    this.filteredUsers = [...this.allUsers];
    
    // Pre-select current assignees
    const assignment = this.assignmentsMap.get(ticketId);
    this.selectedAssignees = assignment?.assigned_users || [];
    this.showAssignDialog = true;
  }

  openBulkAssignDialog(): void {
    if (this.selectedTickets.size === 0) {
      this.messageService.error('Select at least one ticket');
      return;
    }
    this.bulkAssignees = [];
    this.bulkUserSearchTerm = '';
    this.filteredBulkUsers = [...this.allUsers];
    this.showBulkAssignDialog = true;
  }

  // Confirm actions
  async confirmAssign(): Promise<void> {
    if (this.selectedAssignees.length === 0) {
      this.messageService.error('Select at least one agent');
      return;
    }

    this.loadingService.show();

    try {
      if (this.isReassigning) {
        await firstValueFrom(this.assignmentService.reassignTicket({
          zoho_ticket_id: this.assignTicketId,
          new_assigned_users: this.selectedAssignees,
          reassigned_by: this.currentUserEmail
        }));
        this.messageService.success('Ticket reassigned successfully');
      } else {
        const ticket = this.filteredTickets.find(t => (t.id || t.ticketId) === this.assignTicketId);
        const category = this.normalizeCategoryValue(ticket?.category);
        await firstValueFrom(this.assignmentService.assignTicket({
          zoho_ticket_id: this.assignTicketId,
          zoho_ticket_number: ticket?.ticketNumber,
          assigned_users: this.selectedAssignees,
          assigned_by: this.currentUserEmail,
          ...(category ? { category } : {})
        }));
        this.messageService.success('Ticket assigned successfully');
      }

      this.loadAssignments();
      this.cancelDialogs();
    } catch (err) {
      this.messageService.error(this.isReassigning ? 'Reassignment failed' : 'Assignment failed');
    } finally {
      this.loadingService.hide();
    }
  }

  async confirmBulkAssign(): Promise<void> {
    if (this.bulkAssignees.length === 0) {
      this.messageService.error('Select at least one agent');
      return;
    }

    this.loadingService.show();

    try {
      const ticketCategories: Record<string, string> = {};
      this.selectedTickets.forEach(ticketId => {
        const ticket = this.filteredTickets.find(t => (t.id || t.ticketId) === ticketId);
        const category = this.normalizeCategoryValue(ticket?.category);
        if (category) ticketCategories[ticketId] = category;
      });

      const result = await firstValueFrom(this.assignmentService.bulkAssign({
        ticket_ids: Array.from(this.selectedTickets),
        assigned_users: this.bulkAssignees,
        assigned_by: this.currentUserEmail,
        ticket_categories: Object.keys(ticketCategories).length ? ticketCategories : undefined
      }));

      if (result.success.length > 0) {
        this.messageService.success(`${result.success.length} ticket(s) assigned successfully`);
      }
      if (result.failed.length > 0) {
        this.messageService.error(`${result.failed.length} ticket(s) failed to assign`);
      }

      this.selectedTickets.clear();
      this.loadAssignments();
      this.cancelDialogs();
    } catch (err) {
      this.messageService.error('Bulk assignment failed');
    } finally {
      this.loadingService.hide();
    }
  }

  private normalizeCategoryValue(category?: string): string {
    return (category || '').trim();
  }
}