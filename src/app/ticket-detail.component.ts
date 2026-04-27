import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
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

          <!-- THREADS - Show for all tickets with conversations -->
          <section class="msgs" *ngIf="threads.length > 0">

            <article *ngFor="let t of threads" class="msg">
              <div class="mh">
                <div class="av">
                  {{ (t.authorName || 'U').charAt(0).toUpperCase() }}
                </div>
                <div>
                  <div class="who">{{ t.authorName }}</div>
                  <div class="when">{{ t.createdTime | date:'MMM d, y, h:mm a' }}</div>
                </div>
              </div>

              <div class="mb" [innerHTML]="renderContent(t.content)"></div>
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
            <div class="row"><strong>Created</strong><span>{{ ticket?.createdTime | date:'MMM d, y, h:mm a' }}</span></div>
            <div class="row"><strong>Due</strong><span>{{ ticket?.dueDate | date:'MMM d, y, h:mm a' }}</span></div>
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
    :host { display:block;font-family:Arial,Helvetica,sans-serif;color:#222;font-size:13px }
    .wrap { padding:8px }
    .hdr { display:flex;justify-content:space-between;align-items:center;margin-bottom:6px }
    .left { display:flex;align-items:center;gap:5px }
    .back { background:none;border:none;color:#0b66d1;cursor:pointer;font-size:12px }
    .pill { padding:3px 8px;border-radius:8px;font-size:11px;font-weight:600;color:#fff }
    .pill.status-open { background:#0b66d1 }
    .pill.status-inprogress { background:#f59e0b }
    .pill.status-resolved { background:#059669 }
    .pill.status-closed { background:#6b7280 }
    .actions { display:flex;gap:4px }
    .btn { padding:4px 10px;border-radius:4px;border:none;cursor:pointer;background:#eef1f5;font-size:12px }
    .btn.primary { background:#0b66d1;color:#fff }
    .body { display:flex;gap:10px }
    .main { flex:1;min-width:0;overflow:hidden }
    .side { width:220px;min-width:220px;flex-shrink:0 }
    .subject { margin: 4px 0 8px }
    .subject h2 { margin: 0 0 2px; font-size: 15px; font-weight: 600 }
    .meta { color: #6b7280; font-size: 11px }
    .desc { background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-bottom:8px;overflow:hidden }
    .desc h4 { margin:0 0 6px;font-size:12px;color:#374151 }
    .desc-body { color:#1f2937;font-size:13px;line-height:1.6;word-break:break-word;overflow-wrap:anywhere;overflow-x:auto;max-width:100% }
    :host ::ng-deep .desc-body img { max-width: 100%; height: auto; display: block; margin: 16px 0; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    :host ::ng-deep .desc-body p { margin: 0 0 10px; }
    :host ::ng-deep .desc-body p img { margin: 12px 0; }
    :host ::ng-deep .desc-body p:last-child { margin-bottom: 0; }
    :host ::ng-deep .desc-body a { color: #0b66d1; text-decoration: underline; transition: color 0.2s; }
    :host ::ng-deep .desc-body a:hover { color: #1d4ed8; }
    :host ::ng-deep .desc-body table { border-collapse: collapse; margin: 12px 0; max-width: 100%; }
    :host ::ng-deep .desc-body table td, :host ::ng-deep .desc-body table th { padding: 8px; border: 1px solid #e5e7eb; white-space: nowrap; }
    :host ::ng-deep .desc-body ol, :host ::ng-deep .desc-body ul { margin: 4px 0; padding-left: 24px; list-style-position: outside; }
    :host ::ng-deep .desc-body ol { list-style-type: decimal; }
    :host ::ng-deep .desc-body ul { list-style-type: disc; }
    :host ::ng-deep .desc-body li { margin: 4px 0; }

    .panel { background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:10px }
    .panel + .panel { margin-top: 8px }
    .row { display:flex;flex-direction:column;gap:1px;margin-bottom:8px }
    .row:last-child { margin-bottom:0 }
    .row strong { color:#6b7280;font-weight:500;font-size:10px;text-transform:uppercase;letter-spacing:0.03em }
    .row span { color:#111827;font-size:12px;word-break:break-word;overflow-wrap:anywhere }
    .msg { background:#fbfdff;padding:8px;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:8px }
    .mh { display:flex;gap:6px;margin-bottom:6px;align-items:center }
    .av { width:24px;height:24px;border-radius:50%;background:#e5edff;color:#0b66d1;
          display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:10px;flex-shrink:0 }
    .who { font-size:11px;font-weight:600 }
    .when { font-size:9px;color:#6b7280 }
    .mb {
      word-break: break-word;
      overflow-wrap: anywhere;
      line-height: 1.5;
      font-size: 13px;
      color: #1f2937;
      padding: 4px 0;
    }
    :host ::ng-deep .mb p { margin: 0 0 8px; }
    :host ::ng-deep .mb p:last-child { margin-bottom: 0; }
    :host ::ng-deep .mb a { color: #0b66d1; text-decoration: underline; }
    :host ::ng-deep .mb img { max-width: 100%; height: auto; display: block; margin: 8px 0; }
    :host ::ng-deep .mb table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
    :host ::ng-deep .mb td, :host ::ng-deep .mb th { border: 1px solid #e5e7eb; padding: 6px 8px; }
    :host ::ng-deep .mb blockquote { border-left: 3px solid #d1d5db; margin: 8px 0; padding: 4px 10px; color: #6b7280; }
    :host ::ng-deep .mb hr { border: none; border-top: 1px solid #e5e7eb; margin: 10px 0; }
    :host ::ng-deep .mb ul, :host ::ng-deep .mb ol { margin: 4px 0; padding-left: 24px; list-style-position: outside; }
    :host ::ng-deep .mb ol { list-style-type: decimal; }
    :host ::ng-deep .mb ul { list-style-type: disc; }
    :host ::ng-deep .mb li { margin: 4px 0; }
    :host ::ng-deep .mb h1, :host ::ng-deep .mb h2, :host ::ng-deep .mb h3, :host ::ng-deep .mb h4, :host ::ng-deep .mb h5, :host ::ng-deep .mb h6 { margin: 8px 0 4px; }
    .attachments { margin-top: 6px; display: grid; gap: 4px; }
    .attachment {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 6px;
      align-items: center;
      font-size: 12px;
    }
    .att-name {
      color: #1f2937;
      font-weight: 600;
      min-width: 0;
      overflow-wrap: anywhere;
      white-space: normal;
    }
    .att-link {
      background: none;
      border: none;
      color: #0b66d1;
      cursor: pointer;
      font-size: 12px;
      padding: 0;
      text-decoration: underline;
      white-space: nowrap;
    }
    .reply { margin-top: 8px }
    .reply h4 { font-size:13px;margin:0 0 6px;font-weight:600 }
    textarea { width:100%;border-radius:6px;border:1px solid #d1d5db;padding:8px;font-size:13px;resize:vertical }
    .no-msg { background:#f3f5f7;border-radius:4px;padding:6px;text-align:center;color:#666;font-size:9px }
    .reply-files { margin: 4px 0; }
    .file-btn { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; color:#0b66d1; cursor: pointer; }
    .file-btn input { display: none; }
    .file-list { margin-top: 3px; display: grid; gap: 3px; }
    .file-item { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #475569; }
    .link { background: none; border: none; color: #d32f2f; cursor: pointer; font-size: 12px; }
    .controls { display:flex;gap:12px;margin:6px 0;font-size:12px }
    .btns { margin-top:6px }
    @media(max-width:900px){ .body{flex-direction:column}.side{width:100%;min-width:unset} }

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
  currentUserName = '';
  userRole: 'admin' | 'user' = 'user';
  private inlineObjectUrls: string[] = [];

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
    const storedEmail = sessionStorage.getItem('username') || '';
    this.currentUserEmail = (account?.username || storedEmail || '').trim().toLowerCase();
    this.currentUserName = account?.name || this.currentUserEmail.split('@')[0] || 'Unknown';
    // Capitalize first letter
    if (this.currentUserName) {
      this.currentUserName = this.currentUserName.charAt(0).toUpperCase() + this.currentUserName.slice(1);
    }
    
    // Load user role from sessionStorage
    const storedRole = sessionStorage.getItem('role');
    this.userRole = (storedRole === 'admin' ? 'admin' : 'user') as 'admin' | 'user';
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
