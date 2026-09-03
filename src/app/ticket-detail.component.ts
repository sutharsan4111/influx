import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormsModule, FormBuilder, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { forkJoin, Subject, takeUntil, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { TicketService } from './services/ticket.service';
import { MsalService } from './services/msal.service';
import { MessageService } from './services/message.service';
import { AssignmentService, TicketAssignment } from './services/assignment.service';

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page-wrap" *ngIf="!loading; else loadingTpl">

      <!-- ── TOP ACTION BAR ── -->
      <div class="top-bar">
        <div class="breadcrumb">
          <button class="bc-link" (click)="navigateTo('/dashboard')">
            <i class="fas fa-home"></i> Dashboard
          </button>
          <i class="fas fa-chevron-right bc-sep"></i>
          <button class="bc-link" (click)="back()">
            <i class="fas fa-ticket-alt"></i> Tickets
          </button>
          <i class="fas fa-chevron-right bc-sep"></i>
          <span class="bc-current">#{{ ticket?.ticketNumber || ticket?.id || '—' }}</span>
        </div>
        <div class="top-actions">
          <ng-container *ngIf="userRole === 'admin' || userRole === 'cloudops' || userRole === 'itsm'">
            <button class="ta-btn ta-assign-btn" (click)="openAssignDialog()" [disabled]="actionLoading">
              <i class="fas fa-user-plus"></i> Assign
            </button>
          </ng-container>
          <div class="status-select-wrap">
            <div class="status-select-inner" [class.is-loading]="actionLoading">
              <span class="status-dot" [ngClass]="statusClass(ticket?.status)"></span>
              <select class="status-select" [(ngModel)]="selectedStatus" (ngModelChange)="onStatusChange($event)" [disabled]="actionLoading">
                <option *ngFor="let s of availableStatuses" [value]="s">{{ s }}</option>
              </select>
              <i class="fas fa-spinner fa-spin" *ngIf="actionLoading"></i>
              <i class="fas fa-chevron-down" *ngIf="!actionLoading"></i>
            </div>
          </div>
          <button class="ta-btn icon-only" (click)="reload()" title="Refresh">
            <i class="fas fa-sync-alt"></i>
          </button>
        </div>
      </div>

      <!-- Assign Dialog -->
      <div class="assign-overlay" *ngIf="showAssignDialog" (click)="closeAssignDialog()">
        <div class="assign-dialog" (click)="$event.stopPropagation()">
          <div class="assign-dialog-hdr">
            <span>Assign Ticket</span>
            <small class="assign-ticket-ref">Ticket #{{ ticket?.ticketNumber || ticket?.id }}</small>
            <button class="close-dlg" (click)="closeAssignDialog()"><i class="fas fa-times"></i></button>
          </div>
          <div class="assign-dialog-search">
            <input type="text" placeholder="Search users..."
                   [(ngModel)]="userSearchTerm"
                   (input)="filterAssignUsers()" />
          </div>
          <div class="assign-selected-chips" *ngIf="selectedAssignees.length > 0">
            <span class="assign-chip" *ngFor="let email of selectedAssignees">
              {{ getAssignUserDisplayName(email) }}
              <button class="chip-remove" (click)="removeAssignee(email)">×</button>
            </span>
          </div>
          <div class="assign-users-list">
            <div class="assign-user-item"
                 *ngFor="let user of filteredAssignUsers"
                 [class.selected]="isAssigneeSelected(user.email)"
                 (click)="toggleAssignee(user.email)">
              <input type="checkbox"
                     [checked]="isAssigneeSelected(user.email)"
                     (click)="$event.stopPropagation()" />
              <div class="assign-user-info">
                <span class="assign-user-name">{{ user.displayName || user.email }}</span>
                <span class="assign-user-email">{{ user.email }}</span>
              </div>
            </div>
            <div class="assign-no-users" *ngIf="filteredAssignUsers.length === 0 && !loadingAssignUsers">No users found</div>
            <div class="assign-loading" *ngIf="loadingAssignUsers">Loading users…</div>
          </div>
          <div class="assign-dialog-footer">
            <button class="act-btn close-btn" (click)="closeAssignDialog()">Cancel</button>
            <button class="act-btn assign-btn" (click)="confirmAssign()"
                    [disabled]="actionLoading || selectedAssignees.length === 0">
              <i class="fas fa-check"></i> {{ supabaseAssignment ? 'Reassign' : 'Assign' }}
            </button>
          </div>
        </div>
      </div>

      <!-- ── TICKET HEADER CARD ── -->
      <div class="ticket-hdr-card">
        <div class="thc-top">
          <div class="thc-badges">
            <span class="t-number"># {{ ticket?.ticketNumber || ticket?.id || '—' }}</span>
            <span class="status-pill" [ngClass]="statusClass(ticket?.status)">{{ ticket?.status || '—' }}</span>
            <span class="priority-pill" [ngClass]="priorityClass(ticket?.priority)">
              <i class="fas fa-flag"></i> {{ priorityLabel(ticket?.priority) }}
            </span>
            <span class="channel-pill" *ngIf="ticket?.channel">
              <i class="fas fa-satellite-dish"></i> {{ ticket?.channel }}
            </span>
          </div>
        </div>
        <h1 class="thc-subject">{{ ticket?.subject || 'No Subject' }}</h1>
        <div class="thc-meta">
          <span><i class="fas fa-user-circle"></i> {{ contactName() }}</span>
          <span *ngIf="ticket?.email"><i class="fas fa-envelope"></i> {{ ticket?.email }}</span>
          <span><i class="fas fa-calendar-plus"></i> {{ ticket?.createdTime | date:'MMM d, y, h:mm a' }}</span>
          <span *ngIf="ticket?.dueDate" class="due-date">
            <i class="fas fa-calendar-check"></i> Due {{ ticket?.dueDate | date:'MMM d, y' }}
          </span>
        </div>
      </div>

      <!-- ── BODY LAYOUT ── -->
      <div class="body-layout">

        <!-- ── MAIN COLUMN ── -->
        <main class="main-col">

          <!-- Conversation Thread -->
          <div class="card conversation-card" *ngIf="threads.length > 0">
            <div class="card-hdr">
              <div class="card-hdr-left">
                <i class="fas fa-comments"></i>
                <span>Conversation</span>
                <span class="count-badge">{{ threads.length }}</span>
              </div>
            </div>
            <div class="thread-list">
              <div class="thread-item" *ngFor="let t of threads; let i = index" [class.private-thread]="t.isPublic === false">
                <div class="thread-avatar">{{ (t.authorName || 'U').charAt(0).toUpperCase() }}</div>
                <div class="thread-bubble">
                  <div class="thread-meta">
                    <span class="thread-author">{{ t.authorName }}</span>
                    <span class="private-badge" *ngIf="t.isPublic === false"><i class="fas fa-lock"></i> Private Note</span>
                    <span class="thread-time">{{ t.createdTime | date:'MMM d, y · h:mm a' }}</span>
                  </div>
                  <div class="thread-body" [innerHTML]="renderContent(t.content)"></div>
                  <div class="att-list" *ngIf="t.attachments?.length">
                    <div class="att-chip" *ngFor="let a of t.attachments">
                      <i class="fas fa-paperclip"></i>
                      <span class="att-name">{{ a.fileName || a.name || a.id }}</span>
                      <button type="button" class="att-action" (click)="openAttachment(a, 'preview')">
                        <i class="fas fa-eye"></i>
                      </button>
                      <button type="button" class="att-action" (click)="openAttachment(a, 'download')">
                        <i class="fas fa-download"></i>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Reply Form -->
          <div class="card reply-card">
            <div class="card-hdr">
              <div class="card-hdr-left">
                <i class="fas fa-reply"></i>
                <span>Reply</span>
              </div>
            </div>
            <div class="reply-body">
              <form [formGroup]="replyForm" (ngSubmit)="sendReply()">
                <div class="visibility-toggle">
                  <label class="vis-opt" [class.active]="replyForm.value.visibility === 'public'">
                    <input type="radio" value="public" formControlName="visibility">
                    <i class="fas fa-globe"></i> Public Reply
                  </label>
                  <label class="vis-opt" [class.active]="replyForm.value.visibility === 'private'">
                    <input type="radio" value="private" formControlName="visibility">
                    <i class="fas fa-lock"></i> Private Note
                  </label>
                </div>
                <textarea
                  formControlName="body"
                  rows="5"
                  placeholder="Write your reply here...">
                </textarea>
                <div class="reply-footer">
                  <div class="reply-attach-area">
                    <label class="attach-label">
                      <input type="file" (change)="onReplyFilesSelected($event)" multiple />
                      <i class="fas fa-paperclip"></i> Attach Files
                    </label>
                    <div class="attached-files" *ngIf="replyFiles.length">
                      <div class="attached-file" *ngFor="let file of replyFiles; let i = index">
                        <i class="fas fa-file-alt"></i>
                        <span>{{ file.name }}</span>
                        <button type="button" class="rm-file" (click)="removeReplyFile(i)">
                          <i class="fas fa-times"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                  <button type="submit" class="send-btn" [disabled]="replyForm.invalid || sending">
                    <i class="fas fa-paper-plane"></i>
                    {{ sending ? 'Sending…' : 'Send Reply' }}
                  </button>
                </div>
              </form>
            </div>
          </div>

        </main>

        <!-- ── SIDE COLUMN ── -->
        <aside class="side-col">

          <!-- Ticket Details -->
          <div class="card info-card">
            <div class="card-hdr">
              <div class="card-hdr-left"><i class="fas fa-info-circle"></i><span>Ticket Details</span></div>
            </div>
            <div class="info-body">
              <div class="info-row">
                <span class="info-label">Status</span>
                <span class="status-pill sm" [ngClass]="statusClass(ticket?.status)">{{ ticket?.status || '—' }}</span>
              </div>
              <div class="info-row" *ngIf="closedByText() as closedBy">
                <span class="info-label">Closed By</span>
                <span class="info-value">{{ closedBy }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Priority</span>
                <span class="priority-pill sm" [ngClass]="priorityClass(ticket?.priority)">{{ priorityLabel(ticket?.priority) }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Assigned To</span>
                <span class="info-value assignee">
                  <i class="fas fa-user-check"></i> {{ assignedToText() }}
                </span>
              </div>
              <div class="info-row">
                <span class="info-label">Department</span>
                <span class="info-value">{{ ticket?.departmentName || ticket?.departmentId || '—' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Category</span>
                <span class="info-value">{{ ticket?.category || '—' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Sub-Category</span>
                <span class="info-value">{{ ticket?.subCategory || '—' }}</span>
              </div>
            </div>
          </div>

          <!-- Contact Info -->
          <div class="card info-card">
            <div class="card-hdr">
              <div class="card-hdr-left"><i class="fas fa-user"></i><span>Contact</span></div>
            </div>
            <div class="info-body">
              <div class="info-row">
                <span class="info-label">Name</span>
                <span class="info-value">{{ contactName() }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email</span>
                <span class="info-value email-val">{{ ticket?.email || '—' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Phone</span>
                <span class="info-value">{{ ticket?.phone || ticket?.contact?.phone || '—' }}</span>
              </div>
            </div>
          </div>

          <!-- Timeline -->
          <div class="card info-card">
            <div class="card-hdr">
              <div class="card-hdr-left"><i class="fas fa-calendar-alt"></i><span>Timeline</span></div>
            </div>
            <div class="info-body">
              <div class="info-row">
                <span class="info-label">Created</span>
                <span class="info-value">{{ ticket?.createdTime | date:'MMM d, y, h:mm a' }}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Due Date</span>
                <span class="info-value" [class.overdue]="ticket?.dueDate && isOverdue(ticket.dueDate)">
                  {{ (ticket?.dueDate | date:'MMM d, y, h:mm a') || '—' }}
                </span>
              </div>
              <div class="info-row">
                <span class="info-label">Channel</span>
                <span class="info-value">{{ ticket?.channel || '—' }}</span>
              </div>
            </div>
          </div>

          <!-- Attachments -->
          <div class="card info-card" *ngIf="ticketAttachments.length">
            <div class="card-hdr">
              <div class="card-hdr-left">
                <i class="fas fa-paperclip"></i>
                <span>Attachments</span>
                <span class="count-badge">{{ ticketAttachments.length }}</span>
              </div>
            </div>
            <div class="info-body">
              <div class="att-chip" *ngFor="let a of ticketAttachments">
                <i class="fas fa-file-alt"></i>
                <span class="att-name">{{ a.fileName || a.name || a.id }}</span>
                <button type="button" class="att-action" (click)="openAttachment(a, 'preview')">
                  <i class="fas fa-eye"></i>
                </button>
                <button type="button" class="att-action" (click)="openAttachment(a, 'download')">
                  <i class="fas fa-download"></i>
                </button>
              </div>
            </div>
          </div>

        </aside>
      </div>
    </div>

    <ng-template #loadingTpl>
      <div class="loading-state">
        <div class="ls-spinner"></div>
        <p>Loading ticket…</p>
      </div>
    </ng-template>
  `,
  styles: [`
    /* ── Host & Layout ── */
    :host {
      display: block;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #0f172a;
      font-size: 13px;
      background: #f8fafc;
      min-height: 100%;
    }

    .page-wrap {
      padding: 0;
      max-width: 100%;
    }

    /* ── Top Action Bar ── */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      gap: 12px;
      flex-wrap: wrap;
    }

    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .bc-link {
      background: none;
      border: none;
      color: #3b82f6;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s, color 0.15s;
    }

    .bc-link:hover { background: #eff6ff; color: #1d4ed8; }

    .bc-sep {
      color: #cbd5e1;
      font-size: 10px;
    }

    .bc-current {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ta-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #ffffff;
      color: #374151;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.18s;
      white-space: nowrap;
    }

    .ta-btn:hover {
      border-color: #3b82f6;
      color: #1d4ed8;
      background: #eff6ff;
    }

    .ta-btn.primary {
      background: #2563eb;
      border-color: #2563eb;
      color: #ffffff;
    }

    .ta-btn.primary:hover {
      background: #1d4ed8;
      border-color: #1d4ed8;
      color: #ffffff;
    }

    .ta-btn.icon-only {
      padding: 7px 10px;
    }

    .ta-btn.ta-assign-btn {
      background: #7c3aed;
      border-color: #7c3aed;
      color: #fff;
    }
    .ta-btn.ta-assign-btn:hover:not(:disabled) {
      background: #6d28d9;
      border-color: #6d28d9;
    }
    .ta-btn:disabled { opacity: 0.55; cursor: not-allowed; }

    .act-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 18px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s;
    }
    .act-btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .assign-btn { background: #7c3aed; color: #fff; }
    .assign-btn:hover:not(:disabled) { background: #6d28d9; }

    /* ── Status Select ── */
    .status-select-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-select-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .status-select-inner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      border: 1.5px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      cursor: pointer;
      transition: border-color 0.18s;
      min-width: 150px;
    }
    .status-select-inner:hover { border-color: #3b82f6; }
    .status-select-inner.is-loading { opacity: 0.65; }
    .status-dot {
      width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
    }
    .status-dot.status-open { background: #3b82f6; }
    .status-dot.status-inprogress { background: #d97706; }
    .status-dot.status-resolved, .status-dot.status-closed { background: #64748b; }
    .status-select {
      flex: 1;
      border: none;
      background: transparent;
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      cursor: pointer;
      outline: none;
      appearance: none;
      -webkit-appearance: none;
    }
    .status-select-inner i { color: #94a3b8; font-size: 11px; }

    /* ── Private Note Badge ── */
    .private-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .private-thread .thread-bubble {
      background: #fffbeb !important;
      border-left: 3px solid #f59e0b !important;
    }

    /* ── Assign Dialog ── */
    .assign-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45);
      display: flex; align-items: center; justify-content: center; z-index: 9999;
    }
    .assign-dialog {
      background: #fff; border-radius: 14px; width: 460px; max-width: 95vw;
      box-shadow: 0 20px 60px rgba(0,0,0,0.22); overflow: hidden;
      display: flex; flex-direction: column; max-height: 90vh;
    }
    .assign-dialog-hdr {
      display: flex; align-items: center; gap: 8px;
      padding: 14px 18px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      font-weight: 600; color: #1e293b;
    }
    .assign-ticket-ref {
      font-size: 11px; color: #94a3b8; font-weight: 400; margin-left: auto; margin-right: 8px;
    }
    .close-dlg {
      background: none; border: none; cursor: pointer; color: #64748b; font-size: 15px;
    }
    .assign-dialog-search {
      padding: 10px 14px 4px;
    }
    .assign-dialog-search input {
      width: 100%; padding: 7px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
      font-size: 13px; color: #1e293b; outline: none; box-sizing: border-box;
    }
    .assign-dialog-search input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.12); }
    .assign-selected-chips {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 14px 2px;
    }
    .assign-chip {
      display: inline-flex; align-items: center; gap: 4px;
      background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;
      padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 500;
    }
    .chip-remove {
      background: none; border: none; cursor: pointer; color: #3b82f6; font-size: 14px;
      padding: 0; line-height: 1; margin-left: 2px;
    }
    .assign-users-list {
      overflow-y: auto; max-height: 300px; padding: 4px 8px;
    }
    .assign-user-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 10px; border-radius: 8px; cursor: pointer;
      transition: background 0.15s;
    }
    .assign-user-item:hover { background: #f0f9ff; }
    .assign-user-item.selected { background: #eff6ff; }
    .assign-user-info { display: flex; flex-direction: column; }
    .assign-user-name { font-size: 13px; color: #1e293b; font-weight: 500; }
    .assign-user-email { font-size: 11px; color: #94a3b8; }
    .assign-no-users { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }
    .assign-loading { padding: 16px; text-align: center; color: #94a3b8; font-size: 13px; }
    .assign-dialog-footer {
      display: flex; gap: 10px; justify-content: flex-end;
      padding: 12px 18px; border-top: 1px solid #e2e8f0;
    }
    .ticket-hdr-card {
      background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%);
      color: #ffffff;
      padding: 16px 16px 14px;
      margin-bottom: 0;
    }

    .thc-top { margin-bottom: 8px; }

    .thc-badges {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .t-number {
      font-family: monospace;
      font-size: 12px;
      font-weight: 700;
      background: rgba(255,255,255,0.18);
      padding: 3px 8px;
      border-radius: 4px;
      letter-spacing: 0.5px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: capitalize;
      letter-spacing: 0.02em;
    }

    .status-pill.status-open { background: #dbeafe; color: #1d4ed8; }
    .status-pill.status-inprogress { background: #fef3c7; color: #b45309; }
    .status-pill.status-resolved { background: #dcfce7; color: #15803d; }
    .status-pill.status-closed { background: #f1f5f9; color: #475569; }

    /* Ticket header card - white pills on blue bg */
    .ticket-hdr-card .status-pill.status-open { background: rgba(219,234,254,0.9); color: #1e3a8a; }
    .ticket-hdr-card .status-pill.status-inprogress { background: rgba(254,243,199,0.9); color: #92400e; }
    .ticket-hdr-card .status-pill.status-resolved { background: rgba(220,252,231,0.9); color: #14532d; }
    .ticket-hdr-card .status-pill.status-closed { background: rgba(241,245,249,0.85); color: #475569; }

    .priority-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
    }

    .ticket-hdr-card .priority-pill.priority-sla { background: rgba(254,226,226,0.9); color: #991b1b; }
    .ticket-hdr-card .priority-pill.priority-high { background: rgba(255,237,213,0.9); color: #9a3412; }
    .ticket-hdr-card .priority-pill.priority-medium { background: rgba(254,249,195,0.9); color: #854d0e; }
    .ticket-hdr-card .priority-pill.priority-low { background: rgba(220,252,231,0.9); color: #14532d; }
    .ticket-hdr-card .priority-pill.priority-unknown { background: rgba(241,245,249,0.85); color: #475569; }

    .priority-pill.priority-sla { background: #fee2e2; color: #dc2626; }
    .priority-pill.priority-high { background: #ffedd5; color: #ea580c; }
    .priority-pill.priority-medium { background: #fef3c7; color: #d97706; }
    .priority-pill.priority-low { background: #dcfce7; color: #16a34a; }
    .priority-pill.priority-unknown { background: #f1f5f9; color: #64748b; }

    .status-pill.sm, .priority-pill.sm {
      font-size: 10.5px;
      padding: 2px 8px;
    }

    .channel-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255,255,255,0.18);
      padding: 3px 8px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 600;
    }

    .thc-subject {
      font-size: 18px;
      font-weight: 700;
      margin: 8px 0 10px;
      color: #ffffff;
      line-height: 1.35;
    }

    .thc-meta {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 11.5px;
      color: rgba(255,255,255,0.8);
    }

    .thc-meta i { margin-right: 3px; opacity: 0.8; }

    .due-date { color: #fde68a; }

    /* ── Body Layout ── */
    .body-layout {
      display: grid;
      grid-template-columns: 1fr 248px;
      gap: 12px;
      padding: 12px;
      align-items: start;
    }

    .main-col {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    .side-col {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }

    /* ── Cards ── */
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }

    .card-hdr {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #f1f5f9;
      background: #f8fafc;
    }

    .card-hdr-left {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
    }

    .card-hdr-left i { color: #3b82f6; font-size: 12px; }

    .count-badge {
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 10px;
    }

    /* ── Conversation Thread ── */
    .thread-list {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .thread-item {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .thread-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      flex-shrink: 0;
    }

    .thread-bubble {
      flex: 1;
      min-width: 0;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 0 10px 10px 10px;
      padding: 10px 12px;
    }

    .thread-meta {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 6px;
    }

    .thread-author {
      font-size: 12px;
      font-weight: 700;
      color: #1e293b;
    }

    .thread-time {
      font-size: 10.5px;
      color: #94a3b8;
    }

    .thread-body {
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.6;
      font-size: 13px;
      color: #1f2937;
    }

    :host ::ng-deep .thread-body p { margin: 0 0 8px; }
    :host ::ng-deep .thread-body p:last-child { margin-bottom: 0; }
    :host ::ng-deep .thread-body a { color: #2563eb; text-decoration: underline; }
    :host ::ng-deep .thread-body img { max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 6px; }
    :host ::ng-deep .thread-body table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 8px 0; }
    :host ::ng-deep .thread-body td, :host ::ng-deep .thread-body th { border: 1px solid #e2e8f0; padding: 6px 8px; }
    :host ::ng-deep .thread-body blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding: 4px 10px; color: #64748b; }
    :host ::ng-deep .thread-body hr { border: none; border-top: 1px solid #e2e8f0; margin: 10px 0; }
    :host ::ng-deep .thread-body ul, :host ::ng-deep .thread-body ol { margin: 4px 0; padding-left: 24px; list-style-position: outside; }
    :host ::ng-deep .thread-body ol { list-style-type: decimal; }
    :host ::ng-deep .thread-body ul { list-style-type: disc; }
    :host ::ng-deep .thread-body li { margin: 4px 0; }
    :host ::ng-deep .thread-body h1, :host ::ng-deep .thread-body h2, :host ::ng-deep .thread-body h3 { margin: 8px 0 4px; }

    /* ── Attachment chips ── */
    .att-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
    }

    .att-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      background: #f1f5f9;
      border-radius: 6px;
      font-size: 11.5px;
    }

    .att-chip i { color: #64748b; flex-shrink: 0; }

    .att-name {
      flex: 1;
      min-width: 0;
      overflow-wrap: anywhere;
      white-space: normal;
      color: #1e293b;
      font-weight: 500;
    }

    .att-action {
      background: none;
      border: 1px solid #e2e8f0;
      color: #3b82f6;
      cursor: pointer;
      font-size: 11px;
      padding: 3px 7px;
      border-radius: 4px;
      transition: all 0.15s;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .att-action:hover { background: #eff6ff; border-color: #3b82f6; }

    /* ── Reply Card ── */
    .reply-body { padding: 14px; }

    .visibility-toggle {
      display: flex;
      gap: 0;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 10px;
      width: fit-content;
    }

    .vis-opt {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      transition: all 0.15s;
      border: none;
      background: #f8fafc;
      user-select: none;
    }

    .vis-opt input { display: none; }
    .vis-opt:hover { color: #2563eb; background: #eff6ff; }
    .vis-opt.active { color: #2563eb; background: #dbeafe; font-weight: 600; }
    .vis-opt + .vis-opt { border-left: 1px solid #e2e8f0; }

    textarea {
      width: 100%;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      resize: vertical;
      box-sizing: border-box;
      font-family: inherit;
      color: #1e293b;
      transition: border-color 0.15s;
    }

    textarea:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59,130,246,0.12);
    }

    .reply-footer {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-top: 10px;
      flex-wrap: wrap;
    }

    .reply-attach-area { flex: 1; }

    .attach-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      font-size: 12px;
      color: #3b82f6;
      cursor: pointer;
      transition: all 0.15s;
    }

    .attach-label input { display: none; }
    .attach-label:hover { border-color: #3b82f6; background: #eff6ff; }

    .attached-files {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 6px;
    }

    .attached-file {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: #374151;
      background: #f1f5f9;
      padding: 4px 8px;
      border-radius: 5px;
    }

    .attached-file i { color: #3b82f6; }

    .rm-file {
      background: none;
      border: none;
      color: #ef4444;
      cursor: pointer;
      margin-left: auto;
      padding: 0 2px;
      font-size: 11px;
    }

    .send-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 20px;
      background: #2563eb;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.18s;
      white-space: nowrap;
    }

    .send-btn:hover:not(:disabled) { background: #1d4ed8; }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Info Cards (sidebar) ── */
    .info-card .card-hdr { background: #ffffff; }
    .info-card .card-hdr-left { font-size: 12px; }

    .info-body {
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .info-row {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .info-label {
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .info-value {
      font-size: 12.5px;
      color: #1e293b;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    .info-value.assignee {
      display: flex;
      align-items: center;
      gap: 5px;
      color: #2563eb;
    }

    .info-value.email-val { color: #2563eb; }

    .info-value.overdue { color: #dc2626; font-weight: 600; }

    /* ── Loading State ── */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 64px 24px;
      gap: 16px;
      color: #64748b;
    }

    .ls-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e2e8f0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* ── Responsive ── */
    @media (max-width: 900px) {
      .body-layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 600px) {
      .top-bar { flex-direction: column; align-items: flex-start; }
      .ta-btn span { display: none; }
      .thc-subject { font-size: 16px; }
    }

    /* ════════════════════════════════════════════
       DARK THEME OVERRIDES
       ════════════════════════════════════════════ */
    :host-context(body.dark-theme) {
      color: #e2e8f0;
      background: #0f172a;
    }

    :host-context(body.dark-theme) .top-bar {
      background: #1e293b;
      border-bottom-color: #334155;
    }

    :host-context(body.dark-theme) .bc-link { color: #60a5fa; }
    :host-context(body.dark-theme) .bc-link:hover { background: rgba(96,165,250,0.12); color: #93c5fd; }
    :host-context(body.dark-theme) .bc-current { color: #94a3b8; }
    :host-context(body.dark-theme) .bc-sep { color: #475569; }

    :host-context(body.dark-theme) .ta-btn {
      background: #1e293b;
      border-color: #334155;
      color: #cbd5e1;
    }
    :host-context(body.dark-theme) .ta-btn:hover { border-color: #60a5fa; color: #60a5fa; background: rgba(96,165,250,0.1); }
    :host-context(body.dark-theme) .ta-btn.primary { background: #2563eb; border-color: #3b82f6; color: #f0f9ff; }
    :host-context(body.dark-theme) .ta-btn.primary:hover { background: #1d4ed8; }

    :host-context(body.dark-theme) .ticket-hdr-card {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
    }

    :host-context(body.dark-theme) .body-layout { background: transparent; }

    :host-context(body.dark-theme) .card {
      background: #1e293b;
      border-color: #334155;
    }

    :host-context(body.dark-theme) .card-hdr {
      background: #0f172a;
      border-bottom-color: #334155;
    }

    :host-context(body.dark-theme) .card-hdr-left { color: #cbd5e1; }

    :host-context(body.dark-theme) .thread-bubble {
      background: #0f172a;
      border-color: #334155;
    }

    :host-context(body.dark-theme) .thread-author { color: #f1f5f9; }
    :host-context(body.dark-theme) .thread-body { color: #e2e8f0; }
    :host-context(body.dark-theme) ::ng-deep .thread-body a { color: #60a5fa; }
    :host-context(body.dark-theme) ::ng-deep .thread-body td, :host-context(body.dark-theme) ::ng-deep .thread-body th { border-color: #334155; }
    :host-context(body.dark-theme) ::ng-deep .thread-body blockquote { border-left-color: #475569; color: #94a3b8; }
    :host-context(body.dark-theme) ::ng-deep .thread-body img { box-shadow: 0 2px 8px rgba(0,0,0,0.4); }

    :host-context(body.dark-theme) .att-chip { background: #0f172a; }
    :host-context(body.dark-theme) .att-name { color: #e2e8f0; }
    :host-context(body.dark-theme) .att-action { border-color: #334155; color: #60a5fa; }
    :host-context(body.dark-theme) .att-action:hover { background: rgba(96,165,250,0.1); border-color: #60a5fa; }

    :host-context(body.dark-theme) .visibility-toggle { border-color: #334155; }
    :host-context(body.dark-theme) .vis-opt { background: #0f172a; color: #94a3b8; }
    :host-context(body.dark-theme) .vis-opt:hover { background: rgba(96,165,250,0.1); color: #60a5fa; }
    :host-context(body.dark-theme) .vis-opt.active { background: rgba(37,99,235,0.25); color: #60a5fa; }
    :host-context(body.dark-theme) .vis-opt + .vis-opt { border-left-color: #334155; }

    :host-context(body.dark-theme) textarea { background: #0f172a; border-color: #334155; color: #e2e8f0; }
    :host-context(body.dark-theme) textarea::placeholder { color: #475569; }
    :host-context(body.dark-theme) textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96,165,250,0.14); }

    :host-context(body.dark-theme) .attach-label { border-color: #334155; color: #60a5fa; }
    :host-context(body.dark-theme) .attach-label:hover { background: rgba(96,165,250,0.1); border-color: #60a5fa; }
    :host-context(body.dark-theme) .attached-file { background: #0f172a; color: #cbd5e1; }

    :host-context(body.dark-theme) .info-label { color: #64748b; }
    :host-context(body.dark-theme) .info-value { color: #f1f5f9; }
    :host-context(body.dark-theme) .info-value.assignee { color: #60a5fa; }
    :host-context(body.dark-theme) .info-value.email-val { color: #60a5fa; }

    :host-context(body.dark-theme) .status-pill.status-open { background: rgba(30,58,138,0.6); color: #93c5fd; }
    :host-context(body.dark-theme) .status-pill.status-inprogress { background: rgba(120,53,15,0.5); color: #fde68a; }
    :host-context(body.dark-theme) .status-pill.status-resolved { background: rgba(20,83,45,0.5); color: #86efac; }
    :host-context(body.dark-theme) .status-pill.status-closed { background: rgba(51,65,85,0.6); color: #94a3b8; }

    :host-context(body.dark-theme) .priority-pill.priority-sla { background: rgba(153,27,27,0.4); color: #fca5a5; }
    :host-context(body.dark-theme) .priority-pill.priority-high { background: rgba(154,52,18,0.4); color: #fdba74; }
    :host-context(body.dark-theme) .priority-pill.priority-medium { background: rgba(133,77,14,0.4); color: #fde68a; }
    :host-context(body.dark-theme) .priority-pill.priority-low { background: rgba(20,83,45,0.4); color: #86efac; }
    :host-context(body.dark-theme) .priority-pill.priority-unknown { background: rgba(51,65,85,0.5); color: #94a3b8; }

    :host-context(body.dark-theme) .att-list { border-top-color: #334155; }
    :host-context(body.dark-theme) .count-badge { background: rgba(37,99,235,0.3); color: #93c5fd; }

    :host-context(body.dark-theme) .loading-state { color: #64748b; }
    :host-context(body.dark-theme) .ls-spinner { border-color: #334155; border-top-color: #60a5fa; }
  `]
})
export class TicketDetailComponent implements OnInit, OnDestroy {

  ticketId!: string;
  ticket: any;
  threads: any[] = [];
  ticketAttachments: any[] = [];
  supabaseAssignment: TicketAssignment | null = null;
  loading = true;
  sending = false;
  actionLoading = false;
  selectedStatus = 'Open';
  availableStatuses: string[] = ['Open', 'In Progress', 'Closed'];
  showAssignDialog = false;
  assignEmails = '';
  // User-picker state for assign dialog
  selectedAssignees: string[] = [];
  allAssignUsers: { email: string; displayName: string }[] = [];
  filteredAssignUsers: { email: string; displayName: string }[] = [];
  userSearchTerm = '';
  loadingAssignUsers = false;
  replyFiles: File[] = [];
  currentUserEmail = '';
  currentUserName = '';
  userRole: 'admin' | 'cloudops' | 'itsm' | 'product' | 'hr' | 'support' | 'muraai' | 'user' = 'user';
  private readonly elevatedRoles = new Set(['admin', 'cloudops', 'itsm']);
  private inlineObjectUrls: string[] = [];

  get isAdmin(): boolean {
    return this.elevatedRoles.has(this.userRole);
  }

  get zohoTicketUrl(): string | null {
    if (!this.ticketId) return null;
    // Zoho Desk ticket URL - using zoho.in for India region
    // Format: https://desk.zoho.in/support/{portal}/ShowHomePage.do#Cases/dv/{ticketId}
    // Using generic desk URL that redirects to the portal
    return `https://desk.zoho.in/agent#/tickets/${this.ticketId}/details`;
  }

  private destroy$ = new Subject<void>();
  private readonly ticketCachePrefix = 'ITSMS_TICKET_DETAIL_';

  replyForm = this.fb.group({
    body: ['', Validators.required],
    visibility: ['public']
  });

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private ticketService: TicketService,
    private msalService: MsalService,
    private messageService: MessageService,
    private assignmentService: AssignmentService
  ) {}

  ngOnInit(): void {
    this.initCurrentUser();
    this.loadAssignableUsers();
    this.loadZohoStatuses();
    
    // 🚀 FIXED: Subscribe to route params to handle ticket navigation
    // This will emit whenever the route parameter changes
    this.route.params
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const newTicketId = params['id'];
        
        // Only load if ticket ID actually changed
        if (newTicketId && newTicketId !== this.ticketId) {
          this.ticketId = newTicketId;
          const usedCache = this.loadFromCache(newTicketId);
          this.loadTicketAndRelated(!usedCache);
        } else if (newTicketId && !this.ticketId) {
          // First time loading
          this.ticketId = newTicketId;
          const usedCache = this.loadFromCache(newTicketId);
          this.loadTicketAndRelated(!usedCache);
        }
      });
  }

  ngOnDestroy(): void {
    this.revokeInlineObjectUrls();
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTicketAndRelated(showLoading = true): void {
    this.revokeInlineObjectUrls();

    // 🚀 Reset state before loading new ticket
    if (showLoading) {
      this.loading = true;
      this.ticket = null;
      this.threads = [];
      this.ticketAttachments = [];
      this.supabaseAssignment = null;
    } else {
      this.loading = false;
    }
    this.replyForm.reset({ body: '', visibility: 'public' });
    this.replyFiles = [];
    this.cdr.markForCheck();

    // Parallelize all 4 API calls at once (including Supabase assignment)
    forkJoin({
      ticket: this.ticketService.getTicketById(this.ticketId),
      messages: this.ticketService.getTicketMessages(this.ticketId),
      attachments: this.ticketService.getTicketAttachments(this.ticketId),
      assignment: this.assignmentService.getAssignment(this.ticketId).pipe(catchError(() => of(null)))
    }).subscribe({
      next: (results: any) => {
        // All responses arrive at the same time
        this.ticket = this.normalizeTicket(results.ticket);
        this.selectedStatus = this.normalizeStatusForDropdown(this.ticket?.status);
        this.supabaseAssignment = results.assignment;
        
        // Check permissions AFTER loading both Zoho and Supabase data
        if (!this.canViewTicket(this.ticket)) {
          console.warn('Ticket permission heuristic mismatch', {
            ticketId: this.ticketId,
            currentUserEmail: this.currentUserEmail
          });
        }
        
        // Process messages/threads
        this.threads = (results.messages?.data || []).map((t: any) => ({
          authorName: t.resolvedAuthorName
            || t.commenter?.name
            || [t.commenter?.firstName, t.commenter?.lastName].filter(Boolean).join(' ')
            || t.author?.name
            || [t.author?.firstName, t.author?.lastName].filter(Boolean).join(' ')
            || t.fromName
            || t.from
            || t.fromEmailAddress
            || t.commenter?.email
            || t.author?.email
            || 'Unknown',
          content: t.content || t.description || t.summary || '',
          createdTime: t.createdTime,
          isPublic: t.isPublic,
          attachments: this.normalizeAttachments(t)
        }));

        this.resolveInlineImagesInThreads();
        
        // Process attachments
        this.ticketAttachments = Array.isArray(results.attachments?.data) 
          ? results.attachments.data 
          : [];
        
        this.saveToCache(this.ticketId);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load ticket details', err);
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  loadTicket(): void {
    this.loadTicketAndRelated();
  }

  priorityLabel(priority?: string): string {
    const value = (priority || '').trim();
    if (!value) return '—';

    const lower = value.toLowerCase();
    if (lower.includes('sla') || lower.includes('urgent') || lower.includes('critical')) {
      return 'Critical';
    }
    if (lower.includes('high')) return 'High';
    if (lower.includes('medium')) return 'Medium';
    if (lower.includes('low')) return 'Low';
    return value;
  }

  private loadFromCache(ticketId: string): boolean {
    try {
      const raw = sessionStorage.getItem(this.ticketCachePrefix + ticketId);
      if (!raw) return false;

      const cache = JSON.parse(raw);
      if (!cache) return false;

      this.ticket = cache.ticket || null;
      this.threads = cache.threads || [];
      this.ticketAttachments = cache.ticketAttachments || [];
      this.loading = false;
      this.cdr.markForCheck();
      return true;
    } catch {
      return false;
    }
  }

  private saveToCache(ticketId: string): void {
    try {
      const payload = {
        ticket: this.ticket,
        threads: this.threads,
        ticketAttachments: this.ticketAttachments
      };
      sessionStorage.setItem(this.ticketCachePrefix + ticketId, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }



  sendReply(): void {
    if (this.replyForm.invalid) return;

    this.sending = true;
    const hasFiles = this.replyFiles.length > 0;
    const payload = hasFiles ? new FormData() : {
      content: this.replyForm.value.body,
      isPublic: this.replyForm.value.visibility === 'public' ? 'true' : 'false',
      senderName: this.currentUserName
    };

    if (payload instanceof FormData) {
      payload.append('content', this.replyForm.value.body!);
      payload.append(
        'isPublic',
        this.replyForm.value.visibility === 'public' ? 'true' : 'false'
      );
      payload.append('senderName', this.currentUserName);
      this.replyFiles.forEach(file => payload.append('attachments', file));
    }

    this.ticketService.replyToTicket(this.ticketId, payload).subscribe({
      next: () => {
        this.replyForm.reset({ body: '', visibility: 'public' });
        this.replyFiles = [];
        this.sending = false;
        this.messageService.success('Reply sent successfully');
        // 🚀 Use parallel loading instead of sequential
        this.loadTicketAndRelated();
        this.cdr.markForCheck();
      },
      error: (err: any) => {
        this.sending = false;
        const apiError = err?.error;
        const detail = apiError?.message || apiError?.error || err?.message || 'Failed to send reply';
        this.messageService.error(detail);
        this.cdr.markForCheck();
      }
    });
  }

  sanitize(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  renderContent(content: string): SafeHtml {
    if (!content) return this.sanitizer.bypassSecurityTrustHtml('');
    // If content contains HTML tags, use as-is; otherwise convert newlines to <br>
    const isHtml = /<[a-z][\s\S]*>/i.test(content);
    const processed = isHtml ? content : content.replace(/\r\n/g, '<br>').replace(/\n/g, '<br>');
    return this.sanitizer.bypassSecurityTrustHtml(processed);
  }

  private resolveInlineImagesInThreads(): void {
    this.threads.forEach((thread: any, threadIndex: number) => {
      const html = (thread?.content || '').toString();
      const attachments = Array.isArray(thread?.attachments) ? thread.attachments : [];
      if (!html || !/<img\b/i.test(html)) return;

      const doc = new DOMParser().parseFromString(html, 'text/html');
      const images = Array.from(doc.querySelectorAll('img'));
      if (!images.length) return;

      const targets: Array<{ imageIndex: number; attachmentId?: string; path?: string }> = [];
      const usedAttachmentIds = new Set<string>();

      images.forEach((img, imageIndex) => {
        const src = (img.getAttribute('src') || '').trim();
        if (!src || /^data:|^blob:/i.test(src)) return;

        let attachment: any | null = null;

        if (/^cid:/i.test(src)) {
          attachment = this.findAttachmentForCid(src, attachments);
        }

        if (!attachment) {
          const attachmentIdFromSrc = this.extractAttachmentIdFromSrc(src);
          if (attachmentIdFromSrc) {
            attachment = this.findAttachmentById(attachmentIdFromSrc, attachments);
          }
        }

        const attachmentId = (attachment?.id || attachment?.attachmentId || '').toString();
        if (attachmentId) {
          targets.push({ imageIndex, attachmentId });
          usedAttachmentIds.add(attachmentId);
          return;
        }

        const pathFromSrc = this.extractZohoPathFromSrc(src);
        if (pathFromSrc) {
          targets.push({ imageIndex, path: pathFromSrc });
        }
      });

      // Fallback: map unresolved images to available image attachments by order.
      const imageAttachments = attachments.filter((a: any) => this.isImageAttachment(a));
      if (imageAttachments.length) {
        const unresolved = images
          .map((_, imageIndex) => imageIndex)
          .filter((imageIndex) => !targets.some(t => t.imageIndex === imageIndex));

        unresolved.forEach((imageIndex) => {
          const next = imageAttachments.find((a: any) => {
            const id = (a?.id || a?.attachmentId || '').toString();
            return !!id && !usedAttachmentIds.has(id);
          });

          const attachmentId = (next?.id || next?.attachmentId || '').toString();
          if (!attachmentId) return;

          targets.push({ imageIndex, attachmentId });
          usedAttachmentIds.add(attachmentId);
        });
      }

      const uniqueAttachmentIds = Array.from(new Set(targets.map(t => t.attachmentId).filter(Boolean) as string[]));
      const uniquePaths = Array.from(new Set(targets.map(t => t.path).filter(Boolean) as string[]));
      if (!uniqueAttachmentIds.length && !uniquePaths.length) return;

      const requests: any[] = uniqueAttachmentIds.map((attachmentId) =>
        this.ticketService.getAttachmentBlob(this.ticketId, attachmentId).pipe(
          map((blob: Blob) => {
            const objectUrl = URL.createObjectURL(blob);
            this.inlineObjectUrls.push(objectUrl);
            return { attachmentId, objectUrl };
          }),
          catchError(() => of(null))
        )
      );

      uniquePaths.forEach((path) => {
        requests.push(
          this.ticketService.getZohoContentByPath(path).pipe(
            map((blob: Blob) => {
              const objectUrl = URL.createObjectURL(blob);
              this.inlineObjectUrls.push(objectUrl);
              return { path, objectUrl };
            }),
            catchError(() => of(null))
          )
        );
      });

      forkJoin(requests).subscribe((results: any[]) => {
        const urlByAttachmentId = new Map<string, string>();
        const urlByPath = new Map<string, string>();
        results.filter(Boolean).forEach((item: any) => {
          if (item.attachmentId) {
            urlByAttachmentId.set(item.attachmentId, item.objectUrl);
          }
          if (item.path) {
            urlByPath.set(item.path, item.objectUrl);
          }
        });

        targets.forEach((target) => {
          let objectUrl = '';
          if (target.attachmentId) {
            objectUrl = urlByAttachmentId.get(target.attachmentId) || '';
          }
          if (!objectUrl && target.path) {
            objectUrl = urlByPath.get(target.path) || '';
          }
          if (!objectUrl) return;
          images[target.imageIndex]?.setAttribute('src', objectUrl);
        });

        this.threads[threadIndex] = {
          ...this.threads[threadIndex],
          content: doc.body.innerHTML
        };
        this.cdr.markForCheck();
      });
    });
  }

  private findAttachmentForCid(cid: string, attachments: any[]): any | null {
    const normalize = (value: any) => (value || '')
      .toString()
      .trim()
      .replace(/^cid:/i, '')
      .replace(/[<>]/g, '')
      .toLowerCase();

    const normalizedCid = normalize(cid);
    if (!normalizedCid) return null;

    const byContentId = attachments.find((a: any) => {
      const candidates = [a?.contentId, a?.contentID, a?.content_id, a?.cid, a?.content];
      return candidates.some((c: any) => normalize(c) === normalizedCid);
    });
    if (byContentId) return byContentId;

    // Outlook often uses filename-like cid; fallback by file name match
    const byName = attachments.find((a: any) => {
      const name = normalize(a?.fileName || a?.name || '');
      return !!name && (normalizedCid.includes(name) || name.includes(normalizedCid));
    });
    return byName || null;
  }

  private extractAttachmentIdFromSrc(src: string): string | null {
    if (!src) return null;

    const fromPath = src.match(/\/attachments\/([^\/?#]+)/i);
    if (fromPath?.[1]) return fromPath[1];

    const fromQuery = src.match(/[?&](?:attachmentId|id)=([^&#]+)/i);
    if (fromQuery?.[1]) return decodeURIComponent(fromQuery[1]);

    return null;
  }

  private extractZohoPathFromSrc(src: string): string | null {
    if (!src) return null;

    const cleaned = src.trim();

    if (cleaned.startsWith('/api/v1/')) {
      return cleaned;
    }

    if (/^https?:\/\//i.test(cleaned)) {
      try {
        const parsed = new URL(cleaned);
        const pathname = parsed.pathname || '';
        if (pathname.toLowerCase().includes('/api/v1/')) {
          return `${pathname}${parsed.search || ''}`;
        }
      } catch {
        return null;
      }
    }

    return null;
  }

  private extractZohoPathFromAttachment(att: any): string | null {
    const candidates = [
      att?.href,
      att?.downloadUrl,
      att?.contentUrl,
      att?.url,
      att?.link,
      att?.path
    ];

    for (const candidate of candidates) {
      const path = this.extractZohoPathFromSrc((candidate || '').toString());
      if (path) return path;
    }

    return null;
  }

  private findAttachmentById(attachmentId: string, attachments: any[]): any | null {
    const id = (attachmentId || '').toString().trim();
    if (!id) return null;
    return attachments.find((a: any) => {
      const candidateId = (a?.id || a?.attachmentId || '').toString().trim();
      return candidateId === id;
    }) || null;
  }

  private isImageAttachment(att: any): boolean {
    const contentType = (att?.contentType || att?.mimeType || att?.type || '').toString().toLowerCase();
    if (contentType.startsWith('image/')) return true;

    const fileName = (att?.fileName || att?.name || '').toString().toLowerCase();
    return /\.(png|jpg|jpeg|gif|bmp|webp|svg)$/.test(fileName);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private revokeInlineObjectUrls(): void {
    this.inlineObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.inlineObjectUrls = [];
  }

  onReplyFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.replyFiles = [...this.replyFiles, ...files];
    input.value = '';
  }

  removeReplyFile(index: number): void {
    this.replyFiles.splice(index, 1);
  }

  normalizeStatusForDropdown(status?: string): string {
    const s = (status || '').toLowerCase();
    if (s.includes('progress')) return 'In Progress';
    if (s.includes('closed') || s.includes('resolved')) return 'Closed';
    return 'Open';
  }

  private clearTicketCache(): void {
    try { sessionStorage.removeItem(this.ticketCachePrefix + this.ticketId); } catch {}
  }

  isStatus(check: string): boolean {
    const s = (this.ticket?.status || '').toLowerCase();
    return s.includes(check);
  }

  onStatusChange(status: string): void {
    if (!status || !this.ticket) return;
    const prev = this.selectedStatus;
    const prevTicketStatus = this.ticket.status; // save for error revert
    this.actionLoading = true;
    this.cdr.markForCheck();

    let obs$: any;
    if (status === 'Closed') {
      obs$ = this.ticketService.closeTicket(this.ticketId, this.currentUserEmail);
    } else if (status === 'In Progress') {
      obs$ = this.ticketService.inProgressTicket(this.ticketId);
    } else {
      obs$ = this.ticketService.openTicket(this.ticketId);
    }

    obs$.subscribe({
      next: () => {
        this.actionLoading = false;
        // Optimistic local update so UI reflects the change immediately
        if (this.ticket) {
          this.ticket = { ...this.ticket, status };
        }
        this.cdr.markForCheck();
        this.clearTicketCache();
        this.messageService.success(`Status updated to ${status}`);
        // Delay reload to allow Zoho to propagate the status change
        setTimeout(() => {
          this.loadTicketAndRelated(false);
        }, 1500);
      },
      error: (err: any) => {
        this.actionLoading = false;
        this.selectedStatus = prev; // revert dropdown
        if (this.ticket) this.ticket = { ...this.ticket, status: prevTicketStatus }; // revert ticket.status
        const msg = err?.error?.error || err?.error?.message || 'Failed to update status';
        this.messageService.error(msg);
        this.cdr.markForCheck();
      }
    });
  }

  closeTicket(): void {
    this.onStatusChange('Closed');
  }

  openTicket(): void {
    this.onStatusChange('Open');
  }

  markInProgress(): void {
    this.onStatusChange('In Progress');
  }

  loadAssignableUsers(): void {
    this.loadingAssignUsers = true;
    this.msalService.getOrganizationUsers().then((users: { email: string; displayName: string }[]) => {
      this.allAssignUsers = users;
      this.filteredAssignUsers = [...users];
      this.loadingAssignUsers = false;
      this.cdr.markForCheck();
    }).catch(() => {
      this.loadingAssignUsers = false;
      this.cdr.markForCheck();
    });
  }

  loadZohoStatuses(): void {
    this.ticketService.getZohoStatuses().subscribe({
      next: (statuses) => {
        if (statuses?.length) this.availableStatuses = statuses;
        this.cdr.markForCheck();
      },
      error: () => {} // keep defaults
    });
  }

  filterAssignUsers(): void {
    const term = (this.userSearchTerm || '').toLowerCase();
    this.filteredAssignUsers = this.allAssignUsers.filter(u =>
      u.email.toLowerCase().includes(term) ||
      (u.displayName || '').toLowerCase().includes(term)
    );
    this.cdr.markForCheck();
  }

  isAssigneeSelected(email: string): boolean {
    return this.selectedAssignees.includes(email);
  }

  toggleAssignee(email: string): void {
    const idx = this.selectedAssignees.indexOf(email);
    if (idx >= 0) {
      this.selectedAssignees.splice(idx, 1);
    } else {
      this.selectedAssignees.push(email);
    }
    this.cdr.markForCheck();
  }

  removeAssignee(email: string): void {
    this.selectedAssignees = this.selectedAssignees.filter(e => e !== email);
    this.cdr.markForCheck();
  }

  getAssignUserDisplayName(email: string): string {
    const user = this.allAssignUsers.find(u => u.email === email);
    return user?.displayName || email;
  }

  openAssignDialog(): void {
    this.selectedAssignees = [...(this.supabaseAssignment?.assigned_users || [])];
    this.userSearchTerm = '';
    this.filteredAssignUsers = [...this.allAssignUsers];
    this.showAssignDialog = true;
    this.cdr.markForCheck();
  }

  closeAssignDialog(): void {
    this.showAssignDialog = false;
    this.cdr.markForCheck();
  }

  confirmAssign(): void {
    if (!this.selectedAssignees.length) return;
    this.actionLoading = true;

    const call$ = this.supabaseAssignment
      ? this.assignmentService.reassignTicket({
          zoho_ticket_id: this.ticketId,
          new_assigned_users: this.selectedAssignees,
          reassigned_by: this.currentUserEmail
        })
      : this.assignmentService.assignTicket({
          zoho_ticket_id: this.ticketId,
          assigned_users: this.selectedAssignees,
          assigned_by: this.currentUserEmail
        });

    call$.subscribe({
      next: () => {
        this.actionLoading = false;
        this.showAssignDialog = false;
        this.loadTicket();
        this.messageService.success('Ticket assigned successfully');
        this.cdr.markForCheck();
      },
      error: () => {
        this.actionLoading = false;
        this.messageService.error('Failed to assign ticket');
        this.cdr.markForCheck();
      }
    });
  }

  reload(): void {
    this.loadTicket();
  }

  back(): void {
    const tab = (this.route.snapshot.queryParamMap.get('tab') || '').toLowerCase().trim();
    const myStatus = (this.route.snapshot.queryParamMap.get('myStatus') || '').toLowerCase().trim();

    const queryParams: Record<string, string> = {};
    if (tab) queryParams['tab'] = tab;
    if (myStatus) queryParams['myStatus'] = myStatus;

    this.router.navigate(['/tickets'], { queryParams });
  }

  navigateTo(path: string): void {
    this.router.navigate([path]);
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

  isOverdue(dueDate?: string): boolean {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  }

  statusClass(status?: string): string {
    if (!status) return 'status-open';
    const s = status.toLowerCase();
    if (s.includes('progress')) return 'status-inprogress';
    if (s.includes('resolved')) return 'status-resolved';
    if (s.includes('closed')) return 'status-closed';
    return 'status-open';
  }

  openAttachment(att: any, mode: 'preview' | 'download'): void {
    const id = att?.id || att?.attachmentId;
    const path = this.extractZohoPathFromAttachment(att);

    if (!id && !path) {
      this.messageService.error('Attachment not found');
      return;
    }

    const filename = (att?.fileName || att?.name || `attachment-${id || 'file'}`).toString();

    const handleBlob = (blob: Blob) => {
      const url = URL.createObjectURL(blob);

      if (mode === 'preview') {
        const previewLink = document.createElement('a');
        previewLink.href = url;
        previewLink.target = '_blank';
        previewLink.rel = 'noopener';
        previewLink.click();
      } else {
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = filename;
        downloadLink.click();
      }

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const fallbackToPath = () => {
      if (!path) {
        this.messageService.error('Attachment download failed');
        return;
      }

      this.ticketService.getZohoContentByPath(path).subscribe({
        next: (blob: Blob) => handleBlob(blob),
        error: () => this.messageService.error('Attachment download failed')
      });
    };

    if (!id) {
      fallbackToPath();
      return;
    }

    this.ticketService.getAttachmentBlob(this.ticketId, id).subscribe({
      next: (blob: Blob) => handleBlob(blob),
      error: () => fallbackToPath()
    });
  }

  private normalizeAttachments(thread: any): any[] {
    if (Array.isArray(thread?.attachments)) return thread.attachments;
    if (Array.isArray(thread?.attachment?.data)) return thread.attachment.data;
    if (Array.isArray(thread?.attachments?.data)) return thread.attachments.data;
    return [];
  }

  private normalizeTicket(res: any): any {
    const t = res?.data ?? res ?? {};
    return {
      ...t,
      email: t.email || t.contact?.email || t.contact?.emailAddress || t.contact?.secondaryEmail,
      assignedTo: t.assignedTo || t.assignee?.name || t.assignee?.email || t.assignee?.emailId,
      ticketNumber: t.ticketNumber || t.displayId || t.id
    };
  }

  contactName(): string {
    const first = this.ticket?.contact?.firstName || '';
    const last = this.ticket?.contact?.lastName || '';
    const name = `${first} ${last}`.trim();
    return name || this.ticket?.contact?.name || '—';
  }

  closedByText(): string {
    const status = (this.ticket?.status || '').toLowerCase();
    if (!status.includes('closed') && !status.includes('resolved')) return '';
    return this.ticketService.resolveClosedBy(this.ticket);
  }

  assignedToText(): string {
    const status = (this.ticket?.status || '').toLowerCase();
    const closedBy = this.ticketService.resolveClosedBy(this.ticket).trim();
    if ((status.includes('closed') || status.includes('resolved')) && closedBy) {
      return closedBy;
    }
    
    // Check Supabase assignment first (supports org users)
    if (this.supabaseAssignment?.assigned_users?.length) {
      return this.supabaseAssignment.assigned_users.join(', ');
    }
    
    return this.ticket?.assignedTo || 'Unassigned';
  }

  private initCurrentUser(): void {
    const account = this.msalService.getAccount();
    const storedEmail = localStorage.getItem('username') || '';
    this.currentUserEmail = (account?.username || storedEmail || '').trim().toLowerCase();
    this.currentUserName = account?.name || this.currentUserEmail.split('@')[0] || 'Unknown';
    // Capitalize first letter
    if (this.currentUserName) {
      this.currentUserName = this.currentUserName.charAt(0).toUpperCase() + this.currentUserName.slice(1);
    }
    
    // Load user role from sessionStorage
    const storedRole = (localStorage.getItem('role') || 'user').toLowerCase();
    this.userRole = (this.elevatedRoles.has(storedRole)
      ? storedRole
      : 'user') as 'admin' | 'cloudops' | 'itsm' | 'product' | 'hr' | 'support' | 'muraai' | 'user';
  }

  private canViewTicket(ticket: any): boolean {
    // Admin can view all tickets
    if (this.isAdmin) {
      return true;
    }

    // User can view if they are:
    // 1. The requester (contact email matches)
    const requesterEmail = (ticket.email || ticket.contact?.email || '').trim().toLowerCase();
    if (requesterEmail === this.currentUserEmail) {
      return true;
    }

    // 2. The assignee in Zoho
    const assigneeEmail = (ticket.assignedTo || ticket.assignee?.email || '').trim().toLowerCase();
    if (assigneeEmail === this.currentUserEmail) {
      return true;
    }

    // 3. Assigned via Supabase (multi-agent assignment)
    if (this.supabaseAssignment?.assigned_users?.some(u => u.toLowerCase() === this.currentUserEmail)) {
      return true;
    }

    return false;
  }
}
