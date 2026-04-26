import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { MessageService } from '../services/message.service';
import { LoadingService } from '../services/loading.service';
import { MsalService } from '../services/msal.service';

interface GraphUser {
  id: string;
  email: string;
  displayName: string;
  userPrincipalName: string;
  currentRole: 'admin' | 'user';
  assignedBy?: string;
  assignedAt?: string;
  updatedAt?: string;
}

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  selector: 'app-user-roles',
  template: `
    <div class="user-roles-page">
      <div class="page-header-row">
        <h2>Microsoft User Role Management</h2>
        <button class="btn-refresh" (click)="refreshUsers()" [disabled]="isLoading" title="Refresh">
          <i class="fas fa-sync-alt" [class.spinning]="isLoading"></i>
        </button>
      </div>

      <!-- SEARCH & FILTER -->
      <div class="card filter-card">
        <div class="form-row">
          <input 
            [(ngModel)]="searchText" 
            placeholder="Search by name or email..." 
            (input)="onSearchChange()"
            class="search-input"
          />
          <select [(ngModel)]="filterRole" (change)="onFilterChange()" class="filter-select">
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
          </select>
          <button (click)="goToFirstPage()" [disabled]="currentPage === 1">First</button>
          <button (click)="previousPage()" [disabled]="currentPage === 1">Previous</button>
          <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
          <button (click)="nextPage()" [disabled]="!hasMore">Next</button>
        </div>
      </div>

      <!-- INFO MESSAGE -->
      <div class="info-box">
        <i class="fas fa-info-circle"></i>
        <p>
          <strong>Role Assignment :</strong>
          Users in the <code>cloudops&#64;muraai.com</code> Microsoft group are automatically assigned <strong>Admin</strong> role.
          Below you can override individual user roles in the database. Leave a user unassigned to use their Microsoft group membership.
        </p>
      </div>

      <!-- USERS TABLE -->
      <div class="card table-card">
        <div *ngIf="users.length === 0" class="no-data">
          <p>No users found.</p>
        </div>

        <table *ngIf="users.length > 0">
          <thead>
            <tr>
              <th>Display Name</th>
              <th>Email</th>
              <th>Current Role</th>
              <th>Assigned By</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let user of users" [class.role-admin]="user.currentRole === 'admin'">
              <td>{{ user.displayName }}</td>
              <td class="email-cell">{{ user.email }}</td>
              <td>
                <span class="role-badge" [class]="'role-' + user.currentRole">
                  {{ user.currentRole | uppercase }}
                </span>
              </td>
              <td class="text-small">{{ user.assignedBy || '(Graph)' }}</td>
              <td class="text-small">{{ (user.updatedAt || user.assignedAt) ? (user.updatedAt || user.assignedAt | date:'short') : '(New)' }}</td>
              <td class="actions-cell">
                <select 
                  [(ngModel)]="selectedRoles[user.email]" 
                  class="role-select"
                  (change)="assignRole(user.email, selectedRoles[user.email])"
                >
                  <option value="">-- Select Role --</option>
                  <option value="admin">Admin</option>
                  <option value="user">User</option>
                </select>
                <button 
                  *ngIf="user.assignedBy"
                  (click)="removeRole(user.email)" 
                  class="btn-remove"
                  title="Remove role assignment (revert to Graph)"
                >
                  <i class="fas fa-times"></i>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- PAGINATION -->
      <div class="pagination-footer" *ngIf="users.length > 0">
        <button (click)="previousPage()" [disabled]="currentPage === 1">← Previous</button>
        <span>Page {{ currentPage }} of {{ totalPages }} | Total: {{ totalCount }} users</span>
        <button (click)="nextPage()" [disabled]="!hasMore">Next →</button>
      </div>
    </div>
  `,
  styles: [`
    .user-roles-page {
      padding: 20px;
      background: var(--bg-secondary, #f5f5f5);
      min-height: 100vh;
    }

    .page-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }

    .page-header-row h2 {
      margin: 0;
      color: var(--text-primary, #333);
    }

    .btn-refresh {
      background: var(--primary-color, #007bff);
      color: white;
      border: none;
      padding: 8px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
    }

    .btn-refresh:hover:not(:disabled) {
      background: var(--primary-dark, #0056b3);
    }

    .btn-refresh:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-refresh i.spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .card {
      background: white;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 6px;
      padding: 15px;
      margin-bottom: 15px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }

    .filter-card {
      padding: 20px;
    }

    .form-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 200px;
      padding: 8px 12px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      font-size: 14px;
    }

    .filter-select {
      padding: 8px 12px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: white;
      cursor: pointer;
    }

    .form-row button {
      padding: 8px 12px;
      background: var(--primary-color, #007bff);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }

    .form-row button:hover:not(:disabled) {
      background: var(--primary-dark, #0056b3);
    }

    .form-row button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: var(--disabled-color, #ccc);
    }

    .page-info {
      font-size: 14px;
      color: var(--text-secondary, #666);
      min-width: 120px;
      text-align: center;
    }

    .info-box {
      background: #e7f3ff;
      border-left: 4px solid #007bff;
      padding: 15px;
      margin-bottom: 15px;
      border-radius: 4px;
      font-size: 14px;
      color: #333;
    }

    .info-box i {
      color: #007bff;
      margin-right: 10px;
    }

    .info-box code {
      background: #f0f0f0;
      padding: 2px 4px;
      border-radius: 3px;
      font-family: monospace;
      font-weight: bold;
    }

    .table-card {
      padding: 0;
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    thead {
      background: var(--table-header-bg, #f8f9fa);
      border-bottom: 2px solid var(--border-color, #ddd);
    }

    th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: var(--text-primary, #333);
      font-size: 14px;
    }

    td {
      padding: 12px;
      border-bottom: 1px solid var(--border-color, #eee);
      font-size: 14px;
    }

    tr:hover {
      background: var(--table-hover-bg, #fafbfc);
    }

    tr.role-admin {
      background: #f0f8ff;
    }

    .email-cell {
      font-family: monospace;
      font-size: 12px;
      color: var(--text-secondary, #666);
    }

    .text-small {
      font-size: 12px;
      color: var(--text-secondary, #999);
    }

    .role-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .role-admin {
      background: #d4edda;
      color: #155724;
    }

    .role-user {
      background: #e2e3e5;
      color: #383d41;
    }

    .actions-cell {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .role-select {
      padding: 6px 8px;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 4px;
      background: white;
      cursor: pointer;
      font-size: 12px;
      min-width: 100px;
    }

    .btn-remove {
      background: #dc3545;
      color: white;
      border: none;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .btn-remove:hover {
      background: #c82333;
    }

    .no-data {
      padding: 40px;
      text-align: center;
      color: var(--text-secondary, #999);
    }

    .pagination-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 15px;
      background: white;
      border: 1px solid var(--border-color, #ddd);
      border-radius: 6px;
      margin-bottom: 20px;
    }

    .pagination-footer button {
      padding: 8px 12px;
      background: var(--primary-color, #007bff);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .pagination-footer button:hover:not(:disabled) {
      background: var(--primary-dark, #0056b3);
    }

    .pagination-footer button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      background: #ccc;
    }

    .pagination-footer span {
      font-size: 14px;
      color: var(--text-secondary, #666);
    }
  `]
})
export class UserRolesComponent implements OnInit, OnDestroy {
  allUsers: GraphUser[] = [];
  users: GraphUser[] = [];
  searchText = '';
  filterRole = '';
  currentPage = 1;
  pageSize = 50;
  totalCount = 0;
  hasMore = false;
  isLoading = false;
  selectedRoles: { [email: string]: string } = {};
  
  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private messageService: MessageService,
    private loadingService: LoadingService,
    private msalService: MsalService
  ) {}

  ngOnInit() {
    this.loadUsers();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onSearchChange() {
    this.currentPage = 1;
    this.applyFiltersAndPaging();
  }

  onFilterChange() {
    this.currentPage = 1;
    this.applyFiltersAndPaging();
  }

  async loadUsers() {
    this.isLoading = true;
    this.loadingService.show();
    try {
      const [orgUsers, dbRolesRes] = await Promise.all([
        this.msalService.getOrganizationUsers(),
        firstValueFrom(this.http.get<any>('/api/admin/user-roles').pipe(takeUntil(this.destroy$)))
      ]);

      const roleRows = Array.isArray(dbRolesRes?.users) ? dbRolesRes.users : [];
      const roleMap = new Map<string, any>();
      roleRows.forEach((row: any) => {
        const key = (row.microsoft_email || '').toLowerCase();
        if (key) roleMap.set(key, row);
      });

      const merged: GraphUser[] = (orgUsers || []).map((u: any) => {
        const email = (u.email || '').toLowerCase();
        const roleRow = roleMap.get(email);
        return {
          id: email,
          email,
          displayName: u.displayName || email,
          userPrincipalName: email,
          currentRole: (roleRow?.role || 'user') as 'admin' | 'user',
          assignedBy: roleRow?.assigned_by || undefined,
          assignedAt: roleRow?.assigned_at || undefined,
          updatedAt: roleRow?.updated_at || undefined
        };
      });

      this.allUsers = merged.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
      this.applyFiltersAndPaging();
    } catch (err) {
      console.error('Failed to load Microsoft users:', err);
      this.messageService.error('Failed to load Microsoft users. Verify Graph permissions (User.Read.All).');
    } finally {
      this.isLoading = false;
      this.loadingService.hide();
    }
  }

  private applyFiltersAndPaging() {
    const search = this.searchText.trim().toLowerCase();

    let filtered = [...this.allUsers];
    if (search) {
      filtered = filtered.filter(u =>
        (u.displayName || '').toLowerCase().includes(search) ||
        (u.email || '').toLowerCase().includes(search)
      );
    }

    if (this.filterRole) {
      filtered = filtered.filter(u => u.currentRole === this.filterRole);
    }

    this.totalCount = filtered.length;
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.users = filtered.slice(start, end);
    this.hasMore = end < filtered.length;

    this.users.forEach(user => {
      this.selectedRoles[user.email] = user.currentRole;
    });
  }

  assignRole(email: string, role: string) {
    if (!role) return;

    this.loadingService.show();
    
    const payload = { role, notes: `Assigned via admin panel at ${new Date().toLocaleString()}` };
    
    this.http.post<any>(`/api/admin/users/${encodeURIComponent(email)}/role`, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.messageService.success(`Role updated: ${email} → ${role}`);
          this.loadUsers(); // Refresh to show updated data
          this.loadingService.hide();
        },
        error: (err) => {
          console.error('Failed to assign role:', err);
          this.messageService.error(`Failed to assign role: ${err?.error?.error || 'Unknown error'}`);
          this.selectedRoles[email] = this.users.find(u => u.email === email)?.currentRole || 'user';
          this.loadingService.hide();
        }
      });
  }

  removeRole(email: string) {
    if (!confirm(`Remove role assignment for ${email}?\n\nThis user will revert to their Microsoft group-based role.`)) {
      return;
    }

    this.loadingService.show();
    
    this.http.delete<any>(`/api/admin/users/${encodeURIComponent(email)}/role`)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.messageService.success(`Role assignment removed for ${email}`);
          this.loadUsers(); // Refresh to show updated data
          this.loadingService.hide();
        },
        error: (err) => {
          console.error('Failed to remove role:', err);
          this.messageService.error(`Failed to remove role: ${err?.error?.error || 'Unknown error'}`);
          this.loadingService.hide();
        }
      });
  }

  refreshUsers() {
    this.currentPage = 1;
    this.loadUsers();
  }

  nextPage() {
    if (this.hasMore) {
      this.currentPage++;
      this.applyFiltersAndPaging();
    }
  }

  previousPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.applyFiltersAndPaging();
    }
  }

  goToFirstPage() {
    this.currentPage = 1;
    this.applyFiltersAndPaging();
  }

  get totalPages(): number {
    return Math.ceil(this.totalCount / this.pageSize);
  }
}
