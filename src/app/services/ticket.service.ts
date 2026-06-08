import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  Observable,
  catchError,
  throwError,
  shareReplay,
  tap,
  switchMap,
  of,
  map
} from 'rxjs';
import { AssignmentService } from './assignment.service';

/* ===================== MODELS ===================== */

export interface Ticket {
  id?: string;
  ticketId?: string;
  ticketNumber?: string;
  subject?: string;
  status?: string;
  priority?: string;
  category?: string;
  subCategory?: string;
  email?: string;
  assignedTo?: string;
  closedBy?: string;

  contact?: {
    email?: string;
    lastName?: string;
  };

  assignee?: {                 
    id?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    photoURL?: string;
  };

  description?: string;
  departmentId?: string;

  // Supabase assignment fields (multi-agent)
  supabaseAssignment?: {
    assigned_users: string[];
    primary_assignee: string;
    assigned_at: string;
    reassigned_user?: string;
    reassigned_at?: string;
  };
}

export interface AssignableUser {
  id: number;
  email: string;
  role: string;
}

export interface RecycleBinTicket {
  zoho_ticket_id: string;
  zoho_ticket_number?: string;
  subject?: string;
  email?: string;
  priority?: string;
  deleted_by?: string;
  deleted_at?: string;
  expires_at?: string;
  expires_in_days?: number;
}

// 🚀 Tab cache interface for persisting ticket list state across navigation
export interface TabCacheEntry {
  tickets: Ticket[];
  page: number;
  hasMore: boolean;
  timestamp: number;
  // For My Tickets
  myTicketsOpenAll?: Ticket[];
  myTicketsClosedAll?: Ticket[];
  myTicketsOpenLastApiPage?: number;
  myTicketsClosedLastApiPage?: number;
}

/* ===================== SERVICE ===================== */

@Injectable({
  providedIn: 'root'
})
export class TicketService {
  private getAuthHeaders(): HttpHeaders {
  const token = sessionStorage.getItem('accessToken');

  return new HttpHeaders({
    Authorization: `Bearer ${token || ''}`
  });
}
  private apiUrl = '/api/tickets';
  private readonly closedByStorageKey = 'ITSMS_CLOSED_BY';

  private ticketsCache = new Map<string, Observable<any>>();
  private ticketCountsCache?: Observable<any>;
  
  // Cache with timestamp to prevent excessive reloading
  private ticketsCacheWithTime = new Map<string, { data: Observable<any>, timestamp: number }>();
  private cacheDurationMs = 15 * 60 * 1000; // 15 minutes cache - reduced API calls
  private myTicketsCacheDurationMs = 5 * 60 * 1000; // 5 minutes for personal bucket (was 60s)
  private countsCacheDurationMs = 30 * 60 * 1000; // 30 minutes for dashboard counts (was 2 min)
  private countsCacheTime = 0;

  // 🚀 GLOBAL TAB CACHE - persists across navigation (component destroy/recreate)
  private globalTabCache = new Map<string, TabCacheEntry>();
  private readonly TAB_CACHE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes (was 5)
  private readonly MY_TAB_CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes for My Tickets tab (was 60s)

  constructor(private http: HttpClient, private assignmentService: AssignmentService) {}

  /* ================= LOGIN ================= */

  login(data: any) {
    return this.http.post('/login', data);
  }

  /* ================= CREATE ================= */

  createTicket(ticket: Partial<Ticket> | FormData) {
    return this.http.post(this.apiUrl, ticket);
  }

  /* ================= LIST ================= */

  getTickets(
    page = 1,
    limit = 27,
    status?: 'open' | 'closed',
    search?: string,
    filterByEmail?: string,
    filterType?: 'all' | 'assigned' | 'raised',
    departmentId?: string,
    forceRefresh = false
  ): Observable<any> {

    const params: string[] = [
      `page=${page}`,
      `limit=${limit}`
    ];

    if (status) params.push(`status=${status}`);
    if (search) params.push(`search=${encodeURIComponent(search)}`);
    if (filterByEmail) params.push(`filterByEmail=${encodeURIComponent(filterByEmail)}`);
    if (filterType && filterType !== 'all') params.push(`filterType=${filterType}`);
    if (departmentId) params.push(`departmentId=${departmentId}`);
    if (forceRefresh) params.push('refresh=true');

    const cacheKey = params.join('&');
    const effectiveCacheDurationMs = filterByEmail
      ? this.myTicketsCacheDurationMs
      : this.cacheDurationMs;

    // Check if we have valid cached data (not expired)
    const cached = this.ticketsCacheWithTime.get(cacheKey);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < effectiveCacheDurationMs) {
      return cached.data;
    }

    // Cache expired or doesn't exist, fetch fresh data
    const req$ = this.http
  .get<any>(
    `${this.apiUrl}?${params.join('&')}`,
    { headers: this.getAuthHeaders() }
  )

      .pipe(
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError(err => {
          this.ticketsCacheWithTime.delete(cacheKey);
          return throwError(() => err);
        })
      );

    // Store with timestamp
    this.ticketsCacheWithTime.set(cacheKey, { data: req$, timestamp: Date.now() });
    return req$;
  }

  /* ================= SINGLE TICKET ================= */

  getTicketById(ticketId: string): Observable<any> {
    return this.http.get<any>(
  `${this.apiUrl}/${ticketId}`,
  { headers: this.getAuthHeaders() }
);

  }

  getZohoStatuses(): Observable<string[]> {
    return this.http.get<string[]>('/api/zoho/statuses', { headers: this.getAuthHeaders() });
  }

  getDepartments(): Observable<{ id: string; name: string }[]> {
    return this.http.get<{ id: string; name: string }[]>('/api/zoho/departments', { headers: this.getAuthHeaders() });
  }

  /* ================= CONVERSATIONS (FIXED) ================= */

  getTicketMessages(ticketId: string): Observable<any> {
    // ✅ CORRECT ZOHO API
    return this.http.get<any>(
  `${this.apiUrl}/${ticketId}/conversations`,
  { headers: this.getAuthHeaders() }
);
  }

  /* ================= REPLY ================= */

  replyToTicket(ticketId: string, payload: FormData | any) {
    return this.http.post(
  `${this.apiUrl}/${ticketId}/reply`,
  payload,
  { headers: this.getAuthHeaders() }
);

  }

  /* ================= ATTACHMENTS ================= */

  getTicketAttachments(ticketId: string) {return this.http.get<any>(
  `${this.apiUrl}/${ticketId}/attachments`,
  { headers: this.getAuthHeaders() }
);

  }

  getAttachmentBlob(ticketId: string, attachmentId: string) {
    return this.http.get(
      `${this.apiUrl}/${ticketId}/attachments/${attachmentId}`,
      { headers: this.getAuthHeaders(), responseType: 'blob' }
    );
  }

  getZohoContentByPath(path: string) {
    return this.http.get(
      `/api/zoho-content?path=${encodeURIComponent(path)}`,
      { headers: this.getAuthHeaders(), responseType: 'blob' }
    );
  }

  uploadTicketAttachments(ticketId: string, files: File[]) {
    const fd = new FormData();
    files.forEach(file => fd.append('attachments', file));
    return this.http.post<any>(
  `${this.apiUrl}/${ticketId}/attachments`,
  fd,
  { headers: this.getAuthHeaders() }
);

  }

  /* ================= UPDATE ================= */

  updateTicket(ticketId: string, ticket: Partial<Ticket>) {return this.http.patch(
  `${this.apiUrl}/${ticketId}`,
  ticket,
  { headers: this.getAuthHeaders() }
);

  }

  closeTicket(ticketId: string, closedBy?: string) {
    const normalizedClosedBy = (closedBy || '').trim().toLowerCase();
    const basePayload: Partial<Ticket> = {
      status: 'Closed'
    };

    return this.updateTicket(ticketId, basePayload).pipe(
      catchError(err => {
        if (err?.status === 422) {
          return this.updateTicket(ticketId, { status: 'Resolved' });
        }
        return throwError(() => err);
      }),
      switchMap(result => {
        if (!normalizedClosedBy) return of(result);
        return this.assignmentService
          .closeAssignment(ticketId, normalizedClosedBy)
          .pipe(
            map(() => result),
            catchError(() => of(result))
          );
      }),
      tap(() => {
        if (normalizedClosedBy) {
          this.setClosedBy(ticketId, normalizedClosedBy);
        }
      })
    );
  }

  openTicket(ticketId: string) {
    return this.updateTicket(ticketId, { status: 'Open' });
  }

  inProgressTicket(ticketId: string) {
    return this.updateTicket(ticketId, { status: 'In Progress' });
  }

  /* ================= COUNTS ================= */

  getTicketCounts(forceRefresh = false, departmentId?: string): Observable<any> {

  // If force refresh requested or cache is expired
  if (forceRefresh || (Date.now() - this.countsCacheTime) > this.countsCacheDurationMs) {
    this.ticketCountsCache = undefined;
    this.countsCacheTime = 0;
  }

  // Invalidate cache if departmentId changed
  const cacheKeyDept = departmentId || '';
  if ((this as any)._lastCountsDept !== cacheKeyDept) {
    this.ticketCountsCache = undefined;
    this.countsCacheTime = 0;
    (this as any)._lastCountsDept = cacheKeyDept;
  }

  if (!this.ticketCountsCache) {
    const params = departmentId ? `?departmentId=${departmentId}` : '';
    this.ticketCountsCache = this.http
      .get<any>(
        `${this.apiUrl}/counts${params}`,
        { headers: this.getAuthHeaders() }
      )
      .pipe(
        tap(() => {
          this.countsCacheTime = Date.now();
        }),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  return this.ticketCountsCache;
}


  /* ================= CACHE ================= */

  clearAllCache() {
    this.ticketsCache.clear();
    this.ticketsCacheWithTime.clear();
    this.ticketCountsCache = undefined;
    this.countsCacheTime = 0;
  }

  invalidateUserTicketCache(filterByEmail: string, status?: 'open' | 'closed'): void {
    const normalizedEmail = (filterByEmail || '').trim().toLowerCase();
    if (!normalizedEmail) return;

    const encodedEmail = encodeURIComponent(normalizedEmail);
    for (const key of Array.from(this.ticketsCacheWithTime.keys())) {
      const matchesUser = key.includes(`filterByEmail=${encodedEmail}`);
      const matchesStatus = !status || key.includes(`status=${status}`);
      if (matchesUser && matchesStatus) {
        this.ticketsCacheWithTime.delete(key);
      }
    }
  }

  resolveClosedBy(ticket: any): string {
    const direct =
      (ticket?.closedBy || ticket?.closed_by || ticket?.closedByEmail || ticket?.closed_by_email || '').toString();
    if (direct) return direct;

    const id = ticket?.id || ticket?.ticketId;
    return id ? this.getClosedBy(id) : '';
  }

  private getClosedBy(ticketId: string): string {
    const map = this.readClosedByMap();
    return map[ticketId] || '';
  }

  private setClosedBy(ticketId: string, email: string): void {
    if (!ticketId || !email) return;
    const map = this.readClosedByMap();
    map[ticketId] = email;
    this.writeClosedByMap(map);
  }

  private readClosedByMap(): Record<string, string> {
    try {
      const raw = localStorage.getItem(this.closedByStorageKey) || '{}';
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writeClosedByMap(map: Record<string, string>): void {
    try {
      localStorage.setItem(this.closedByStorageKey, JSON.stringify(map));
    } catch {
      // ignore storage errors
    }
  }

  /* ================= ASSIGNABLE USERS ================= */

  getAssignableUsers(): Observable<AssignableUser[]> {
    return this.http.get<AssignableUser[]>(
      '/api/assignable-users',
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= RECYCLE BIN ================= */

  moveToRecycleBin(ticketId: string, ticket?: Partial<Ticket>): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/${ticketId}/recycle`,
      { ticket: ticket || null },
      { headers: this.getAuthHeaders() }
    );
  }

  getRecycleBinTickets(): Observable<{ data: RecycleBinTicket[] }> {
    return this.http.get<{ data: RecycleBinTicket[] }>(
      `${this.apiUrl}/recycle-bin`,
      { headers: this.getAuthHeaders() }
    );
  }

  restoreFromRecycleBin(ticketId: string): Observable<any> {
    return this.http.post(
      `${this.apiUrl}/recycle-bin/${ticketId}/restore`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  permanentDeleteFromRecycleBin(ticketId: string): Observable<any> {
    return this.http.delete(
      `${this.apiUrl}/recycle-bin/${ticketId}`,
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= GLOBAL TAB CACHE ================= */
  // This cache persists across navigation (when component is destroyed and recreated)

  getTabCache(key: string): TabCacheEntry | null {
    const cached = this.globalTabCache.get(key);
    if (!cached) return null;
    const ttl = key.startsWith('my_') ? this.MY_TAB_CACHE_EXPIRY_MS : this.TAB_CACHE_EXPIRY_MS;
    if (Date.now() - cached.timestamp > ttl) {
      this.globalTabCache.delete(key);
      return null;
    }
    return cached;
  }

  setTabCache(key: string, entry: Omit<TabCacheEntry, 'timestamp'>): void {
    this.globalTabCache.set(key, {
      ...entry,
      timestamp: Date.now()
    });
  }

  invalidateTabCache(keys?: string[]): void {
    if (keys) {
      keys.forEach(key => this.globalTabCache.delete(key));
    } else {
      this.globalTabCache.clear();
    }
  }

  hasValidTabCache(key: string): boolean {
    return this.getTabCache(key) !== null;
  }
}
