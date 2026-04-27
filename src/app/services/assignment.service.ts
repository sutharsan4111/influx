import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, map } from 'rxjs';

/* ===================== MODELS ===================== */

export interface TicketAssignment {
  id?: number;
  zoho_ticket_id: string;
  zoho_ticket_number?: string;
  assigned_users: string[];       // Array of user emails
  primary_assignee: string;       // First user = primary (synced to Zoho)
  assigned_by: string;
  assigned_at: string;
  reassigned_user?: string;
  reassigned_at?: string;
  reassigned_by?: string;
  closed_at?: string;
  closed_by?: string;
  zoho_department_id?: string;
  category?: string;              // Issue category
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface AssignmentPayload {
  zoho_ticket_id: string;
  zoho_ticket_number?: string;
  assigned_users: string[];
  assigned_by: string;
  zoho_department_id?: string;
  category?: string;
  status?: string;
}

export interface ReassignPayload {
  zoho_ticket_id: string;
  new_assigned_users: string[];
  reassigned_by: string;
  category?: string;
}

export interface BulkAssignPayload {
  ticket_ids: string[];
  assigned_users: string[];
  assigned_by: string;
  ticket_categories?: Record<string, string>;
}

export interface GroupMember {
  email: string;
  displayName: string;
}

/* ===================== SERVICE ===================== */

@Injectable({
  providedIn: 'root'
})
export class AssignmentService {
  private apiUrl = '/api/assignments';
  private adminUrl = '/api/admin';

  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = sessionStorage.getItem('accessToken');
    return new HttpHeaders({
      Authorization: `Bearer ${token || ''}`
    });
  }

  /* ================= GET ASSIGNMENT ================= */

  getAssignment(zohoTicketId: string): Observable<TicketAssignment | null> {
    return this.http.get<TicketAssignment>(
      `${this.apiUrl}/${zohoTicketId}`,
      { headers: this.getAuthHeaders() }
    );
  }

  getAssignmentsByUser(userEmail: string): Observable<TicketAssignment[]> {
    return this.http.get<TicketAssignment[]>(
      `${this.apiUrl}/user/${encodeURIComponent(userEmail)}`,
      { headers: this.getAuthHeaders() }
    );
  }

  getAllAssignments(): Observable<TicketAssignment[]> {
    return this.http.get<TicketAssignment[]>(
      this.apiUrl,
      { headers: this.getAuthHeaders() }
    );
  }

  getReportAssignments(): Observable<TicketAssignment[]> {
    return this.http.get<{ assignments: TicketAssignment[] }>(
      `${this.adminUrl}/assignments-report`,
      { headers: this.getAuthHeaders() }
    ).pipe(map(result => result.assignments || []));
  }

  backfillCategories(): Observable<{ total: number; updated: number; failed: number }> {
    return this.http.post<{ total: number; updated: number; failed: number }>(
      `${this.adminUrl}/backfill-categories`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  getGroupMembers(groupEmail: string, graphToken: string): Observable<GroupMember[]> {
    const url = `${this.adminUrl}/group-members?groupEmail=${encodeURIComponent(groupEmail)}`;
    const headers = this.getAuthHeaders().set('x-graph-token', graphToken || '');
    return this.http.get<{ members: GroupMember[] }>(
      url,
      { headers }
    ).pipe(map(result => result.members || []));
  }

  /* ================= ASSIGN TICKET ================= */

  assignTicket(payload: AssignmentPayload): Observable<TicketAssignment> {
    return this.http.post<TicketAssignment>(
      this.apiUrl,
      payload,
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= REASSIGN TICKET ================= */

  reassignTicket(payload: ReassignPayload): Observable<TicketAssignment> {
    return this.http.put<TicketAssignment>(
      `${this.apiUrl}/reassign`,
      payload,
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= BULK ASSIGN ================= */

  bulkAssign(payload: BulkAssignPayload): Observable<{ success: string[]; failed: string[] }> {
    return this.http.post<{ success: string[]; failed: string[] }>(
      `${this.apiUrl}/bulk`,
      payload,
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= CLOSE TICKET ASSIGNMENT ================= */

  closeAssignment(zohoTicketId: string, closedBy: string): Observable<TicketAssignment> {
    return this.http.put<TicketAssignment>(
      `${this.apiUrl}/${zohoTicketId}/close`,
      { closed_by: closedBy },
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= DELETE ASSIGNMENT ================= */

  deleteAssignment(zohoTicketId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/${zohoTicketId}`,
      { headers: this.getAuthHeaders() }
    );
  }

  /* ================= HELPERS ================= */

  isUserAssigned(assignment: TicketAssignment | null, userEmail: string): boolean {
    if (!assignment || !userEmail) return false;
    const normalizedEmail = userEmail.toLowerCase();
    return assignment.assigned_users.some(
      u => u.toLowerCase() === normalizedEmail
    );
  }

  isPrimaryAssignee(assignment: TicketAssignment | null, userEmail: string): boolean {
    if (!assignment || !userEmail) return false;
    return assignment.primary_assignee.toLowerCase() === userEmail.toLowerCase();
  }
}
