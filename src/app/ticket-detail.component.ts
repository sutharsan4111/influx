import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { forkJoin, Subject, takeUntil } from 'rxjs';

import { TicketService } from './services/ticket.service';
import { MsalService } from './services/msal.service';
import { MessageService } from './services/message.service';
import { AssignmentService, TicketAssignment } from './services/assignment.service';

@Component({
  selector: 'app-ticket-detail',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrap" *ngIf="!loading; else loadingTpl">

      <!-- HEADER -->
      <div class="hdr">
        <div class="left">
          <button class="back" (click)="back()">← Back</button>
          <span class="pill" [ngClass]="statusClass(ticket?.status)">
            {{ ticket?.status || '—' }}
          </span>
        </div>

        <div class="actions">
          <button class="btn" (click)="reload()">⟳</button>
          <button class="btn primary"
                  (click)="closeTicket()"
                  [disabled]="(ticket?.status || '').toLowerCase().includes('closed')">
            Close
          </button>
        </div>
      </div>

      <div class="subject">
        <h2>{{ ticket?.subject || 'No subject' }}</h2>
        <div class="meta">
          Ticket # {{ ticket?.ticketNumber || ticket?.id || '—' }}
        </div>
      </div>

      <!-- BODY -->
      <div class="body">
        <main class="main">

          <!-- Email Notice --> 
          <div class="email-notice" *ngIf="ticket?.channel === 'Email'">
            <i class="fa fa-envelope"></i>
            <span>This ticket was created via email. Content may be abbreviated.</span>
            <a *ngIf="zohoTicketUrl" [href]="zohoTicketUrl" target="_blank" class="view-zoho-link">
              View full ticket in Zoho <i class="fa fa-external-link"></i>
            </a>
          </div>

          <section class="desc" *ngIf="ticket?.description">
            <h4>Description</h4>
            <div class="desc-body" [innerHTML]="sanitize(ticket?.description)"></div>
          </section>

          <!-- THREADS - Show for all tickets with conversations -->
          <section class="msgs" *ngIf="threads.length > 0">

            <article *ngFor="let t of threads" class="msg">
              <div class="mh">
                <div class="av">
                  {{ (t.authorName || 'U').charAt(0).toUpperCase() }}
                </div>
                <div>
                  <div class="who">{{ t.authorName }}</div>
                  <div class="when">{{ t.createdTime | date:'medium' }}</div>
                </div>
              </div>

              <div class="mb" [innerHTML]="sanitize(t.content)"></div>
              <div class="attachments" *ngIf="t.attachments?.length">
                <div class="attachment" *ngFor="let a of t.attachments">
                  <span class="att-name">{{ a.fileName || a.name || a.id }}</span>
                  <button type="button" class="att-link" (click)="openAttachment(a, 'preview')">Preview</button>
                  <button type="button" class="att-link" (click)="openAttachment(a, 'download')">Download</button>
                </div>
              </div>
            </article>

          </section>

          <!-- REPLY -->
          <section class="reply">
            <h4>Reply</h4>

            <form [formGroup]="replyForm" (ngSubmit)="sendReply()">
              <textarea
                formControlName="body"
                rows="4"
                placeholder="Type your reply...">
              </textarea>

              <div class="reply-files">
                <label class="file-btn">
                  <input type="file" (change)="onReplyFilesSelected($event)" multiple />
                  Add attachments
                </label>
                <div class="file-list" *ngIf="replyFiles.length">
                  <div class="file-item" *ngFor="let file of replyFiles; let i = index">
                    <span>{{ file.name }}</span>
                    <button type="button" class="link" (click)="removeReplyFile(i)">Remove</button>
                  </div>
                </div>
              </div>

              <div class="controls">
                <label>
                  <input type="radio" value="public" formControlName="visibility">
                  Public reply
                </label>

                <label>
                  <input type="radio" value="private" formControlName="visibility">
                  Private note
                </label>
              </div>

              <div class="btns">
                <button type="submit"
                        class="btn primary"
                        [disabled]="replyForm.invalid || sending">
                  {{ sending ? 'Sending...' : 'Send' }}
                </button>
              </div>
            </form>
          </section>

        </main>

        <!-- SIDE PANEL -->
        <aside class="side">
          <div class="panel">
            <div class="row"><strong>Status</strong><span>{{ ticket?.status || '—' }}</span></div>
            <div class="row" *ngIf="closedByText() as closedBy"><strong>Closed By</strong><span>{{ closedBy }}</span></div>
            <div class="row"><strong>Priority</strong><span>{{ priorityLabel(ticket?.priority) }}</span></div>
            <div class="row"><strong>Assigned To</strong><span>{{ assignedToText() }}</span></div>
            <div class="row"><strong>Department</strong><span>{{ ticket?.departmentName || ticket?.departmentId || '—' }}</span></div>
            <div class="row"><strong>Category</strong><span>{{ ticket?.category || '—' }}</span></div>
            <div class="row"><strong>Sub-Category</strong><span>{{ ticket?.subCategory || '—' }}</span></div>
          </div>

          <div class="panel">
            <div class="row"><strong>Contact</strong><span>{{ contactName() }}</span></div>
            <div class="row"><strong>Email</strong><span>{{ ticket?.email || '—' }}</span></div>
            <div class="row"><strong>Phone</strong><span>{{ ticket?.phone || ticket?.contact?.phone || '—' }}</span></div>
          </div>

          <div class="panel">
            <div class="row"><strong>Created</strong><span>{{ ticket?.createdTime | date:'medium' }}</span></div>
            <div class="row"><strong>Due</strong><span>{{ ticket?.dueDate | date:'medium' }}</span></div>
            <div class="row"><strong>Channel</strong><span>{{ ticket?.channel || '—' }}</span></div>
          </div>

          <div class="panel" *ngIf="ticketAttachments.length">
            <div class="row"><strong>Attachments</strong><span>{{ ticketAttachments.length }}</span></div>
            <div class="attachments">
              <div class="attachment" *ngFor="let a of ticketAttachments">
                <span class="att-name">{{ a.fileName || a.name || a.id }}</span>
                <button type="button" class="att-link" (click)="openAttachment(a, 'preview')">Preview</button>
                <button type="button" class="att-link" (click)="openAttachment(a, 'download')">Download</button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>

    <ng-template #loadingTpl>
      <div class="loading">Loading ticket…</div>
    </ng-template>
  `,
  styles: [`
    :host { display:block;font-family:Arial,Helvetica,sans-serif;color:#222;font-size:10px }
    .wrap { padding:8px }
    .hdr { display:flex;justify-content:space-between;align-items:center;margin-bottom:6px }
    .left { display:flex;align-items:center;gap:5px }
    .back { background:none;border:none;color:#0b66d1;cursor:pointer;font-size:10px }
    .pill { padding:2px 6px;border-radius:8px;font-size:9px;font-weight:600;color:#fff }
    .pill.status-open { background:#0b66d1 }
    .pill.status-inprogress { background:#f59e0b }
    .pill.status-resolved { background:#059669 }
    .pill.status-closed { background:#6b7280 }
    .actions { display:flex;gap:4px }
    .btn { padding:3px 7px;border-radius:4px;border:none;cursor:pointer;background:#eef1f5;font-size:9px }
    .btn.primary { background:#0b66d1;color:#fff }
    .body { display:flex;gap:8px }
    .main { flex:1 }
    .side { width:180px;min-width:180px }
    .subject { margin: 3px 0 6px }
    .subject h2 { margin: 0 0 2px; font-size: 12px }
    .meta { color: #6b7280; font-size: 9px }
    .desc { background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:6px;margin-bottom:6px }
    .desc h4 { margin:0 0 4px;font-size:10px }
    .desc-body { white-space: pre-wrap; color:#334155;font-size:10px;line-height:1.35 }
    .email-notice { 
      background: #fef3c7; 
      border: 1px solid #fbbf24; 
      border-radius: 4px; 
      padding: 5px 6px; 
      margin-bottom: 6px; 
      display: flex; 
      align-items: center; 
      gap: 5px; 
      font-size: 9px; 
      color: #92400e;
    }
    .email-notice i { color: #d97706; }
    .view-zoho-link { 
      margin-left: auto; 
      color: #0369a1; 
      text-decoration: none; 
      font-weight: 500;
      white-space: nowrap;
      font-size:9px;
    }
    .view-zoho-link:hover { text-decoration: underline; }
    .panel { background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:6px }
    .panel + .panel { margin-top: 5px }
    .row { display:flex;justify-content:space-between;gap:5px;margin-bottom:4px;font-size:9px }
    .row strong { color:#475569;font-weight:600 }
    .row span { text-align:right;color:#111827;word-break:break-all }
    .msg { background:#fbfdff;padding:6px;border-radius:4px;border:1px solid #e5e7eb;margin-bottom:6px }
    .mh { display:flex;gap:5px;margin-bottom:3px }
    .av { width:20px;height:20px;border-radius:50%;background:#e5edff;color:#0b66d1;
          display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:9px }
    .who { font-size:10px;font-weight:600 }
    .when { font-size:8px;color:#6b7280 }
    .mb {
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.25;
      font-size:10px;
    }
    .attachments { margin-top: 4px; display: grid; gap: 3px; }
    .attachment { display: flex; gap: 5px; align-items: center; font-size: 9px; }
    .att-name { color: #1f2937; font-weight: 600; }
    .att-link { background: none; border: none; color: #0b66d1; cursor: pointer; font-size: 9px; padding: 0; text-decoration: underline; }
    .reply { margin-top: 6px }
    .reply h4 { font-size:10px;margin:0 0 4px }
    textarea { width:100%;border-radius:4px;border:1px solid #ccc;padding:4px;font-size:10px }
    .no-msg { background:#f3f5f7;border-radius:4px;padding:6px;text-align:center;color:#666;font-size:9px }
    .reply-files { margin: 4px 0; }
    .file-btn { display: inline-flex; gap: 4px; align-items: center; font-size: 9px; color:#0b66d1; cursor: pointer; }
    .file-btn input { display: none; }
    .file-list { margin-top: 3px; display: grid; gap: 3px; }
    .file-item { display: flex; justify-content: space-between; align-items: center; font-size: 9px; color: #475569; }
    .link { background: none; border: none; color: #d32f2f; cursor: pointer; font-size: 9px; }
    .controls { display:flex;gap:10px;margin:5px 0;font-size:9px }
    .btns { margin-top:5px }
    @media(max-width:900px){ .body{flex-direction:column}.side{width:100%} }

    :host-context(.dark-theme) { color: #e2e8f0; }

    :host-context(.dark-theme) .meta {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .desc,
    :host-context(.dark-theme) .panel,
    :host-context(.dark-theme) .msg,
    :host-context(.dark-theme) textarea {
      background: #0f172a;
      border-color: #1f2937;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .desc-body,
    :host-context(.dark-theme) .row span,
    :host-context(.dark-theme) .row strong,
    :host-context(.dark-theme) .att-name,
    :host-context(.dark-theme) .file-item {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .msg {
      background: #0b1220;
    }

    :host-context(.dark-theme) .no-msg {
      background: #0b1220;
      color: #94a3b8;
      border: 1px solid #1f2937;
    }

    :host-context(.dark-theme) .av {
      background: #1f2a44;
      color: #93c5fd;
    }

    :host-context(.dark-theme) .btn {
      background: #1f2937;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .btn.primary {
      background: #2563eb;
      color: #fff;
    }

    :host-context(.dark-theme) textarea::placeholder {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .email-notice {
      background: #422006;
      border-color: #854d0e;
      color: #fcd34d;
    }
    :host-context(.dark-theme) .email-notice i { color: #fbbf24; }
    :host-context(.dark-theme) .view-zoho-link { color: #38bdf8; }
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
  replyFiles: File[] = [];
  currentUserEmail = '';
  userRole: 'admin' | 'user' = 'user';

  get isAdmin(): boolean {
    return this.userRole === 'admin';
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
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadTicketAndRelated(showLoading = true): void {
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

    // Parallelize all 3 API calls at once using forkJoin
    forkJoin({
      ticket: this.ticketService.getTicketById(this.ticketId),
      messages: this.ticketService.getTicketMessages(this.ticketId),
      attachments: this.ticketService.getTicketAttachments(this.ticketId)
    }).subscribe({
      next: (results: any) => {
        // All responses arrive at the same time
        this.ticket = this.normalizeTicket(results.ticket);
        
        // Check permissions before displaying ticket
        if (!this.canViewTicket(this.ticket)) {
          this.loading = false;
          this.messageService.error('You do not have permission to view this ticket');
          setTimeout(() => this.router.navigate(['/tickets']), 1500);
          this.cdr.markForCheck();
          return;
        }
        
        // Process messages/threads
        this.threads = (results.messages?.data || []).map((t: any) => ({
          authorName: t.author?.name || 'User',
          content: t.content || t.summary || t.description || '',
          createdTime: t.createdTime,
          attachments: this.normalizeAttachments(t)
        }));
        
        // Process attachments
        this.ticketAttachments = Array.isArray(results.attachments?.data) 
          ? results.attachments.data 
          : [];
        
        // Load Supabase assignment (for org users not in Zoho)
        this.assignmentService.getAssignment(this.ticketId).subscribe({
          next: (assignment) => {
            this.supabaseAssignment = assignment;
            this.cdr.markForCheck();
          },
          error: () => {
            // No assignment found - that's OK
          }
        });
        
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
      return 'SLA';
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
      isPublic: this.replyForm.value.visibility === 'public' ? 'true' : 'false'
    };

    if (payload instanceof FormData) {
      payload.append('content', this.replyForm.value.body!);
      payload.append(
        'isPublic',
        this.replyForm.value.visibility === 'public' ? 'true' : 'false'
      );
      this.replyFiles.forEach(file => payload.append('attachments', file));
    }

    this.ticketService.replyToTicket(this.ticketId, payload).subscribe({
      next: () => {
        this.replyForm.reset({ body: '', visibility: 'public' });
        this.replyFiles = [];
        this.sending = false;
        // 🚀 Use parallel loading instead of sequential
        this.loadTicketAndRelated();
        this.cdr.markForCheck();
      },
      error: () => {
        this.sending = false;
      }
    });
  }

  sanitize(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html);
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

  closeTicket(): void {
    if (!confirm('Close ticket?')) return;
    this.ticketService.closeTicket(this.ticketId, this.currentUserEmail).subscribe(() => {
      this.loadTicket();
    });
  }

  reload(): void {
    this.loadTicket();
  }

  back(): void {
    this.router.navigate(['/tickets']);
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
    if (!id) {
      this.messageService.error('Attachment not found');
      return;
    }

    const filename = (att?.fileName || att?.name || `attachment-${id}`).toString();

    this.ticketService.getAttachmentBlob(this.ticketId, id).subscribe({
      next: (blob: Blob) => {
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
      },
      error: () => this.messageService.error('Attachment download failed')
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
    const storedEmail = sessionStorage.getItem('username') || '';
    this.currentUserEmail = (account?.username || storedEmail || '').trim().toLowerCase();
    
    // Load user role from sessionStorage
    const storedRole = sessionStorage.getItem('role');
    this.userRole = (storedRole === 'admin' ? 'admin' : 'user') as 'admin' | 'user';
  }

  private canViewTicket(ticket: any): boolean {
    // Admin can view all tickets
    if (this.isAdmin) {
      return true;
    }

    // User can only view their own tickets (requester or assignee)
    const requesterEmail = (ticket.email || ticket.contact?.email || '').trim().toLowerCase();
    const assigneeEmail = (ticket.assignedTo || ticket.assignee?.email || '').trim().toLowerCase();

    return requesterEmail === this.currentUserEmail || assigneeEmail === this.currentUserEmail;
  }
}
