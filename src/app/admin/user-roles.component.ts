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
  currentRole: string;
  roles: string[];
  assignedBy?: string;
  assignedAt?: string;
  updatedAt?: string;
}

interface GroupOption {
  value: string;
  label: string;
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
          <select [(ngModel)]="selectedGroup" (change)="onGroupChange()" class="filter-select">
            <option value="">All Users</option>
            <option *ngFor="let g of availableGroups" [value]="g.value">{{ g.label }}</option>
          </select>
          <select [(ngModel)]="filterRole" (change)="onFilterChange()" class="filter-select">
            <option value="">All Roles</option>
            <option *ngFor="let role of availableRoles" [value]="role">{{ roleLabel(role) }}</option>
          </select>
          <button (click)="goToFirstPage()" [disabled]="currentPage === 1">First</button>
          <button (click)="previousPage()" [disabled]="currentPage === 1">Previous</button>
          <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
          <button (click)="nextPage()" [disabled]="!hasMore">Next</button>
        </div>
      </div>

      <!-- USERS TABLE -->
      <div class="card table-card">
        <div class="bulk-toolbar" *ngIf="users.length > 0">
          <label class="bulk-select-all">
            <input type="checkbox" [checked]="selectAllUsers" (change)="toggleSelectAllUsers($event)" />
            Select all visible users
          </label>
          <div class="bulk-role-checkboxes">
            <label *ngFor="let r of availableRoles" class="role-checkbox-label" [class.checked]="isBulkRoleSelected(r)">
              <input type="checkbox" [checked]="isBulkRoleSelected(r)" (change)="toggleBulkRole(r, $event)" />
              {{ roleLabel(r) }}
            </label>
          </div>
          <button class="btn-save" (click)="applyBulkRoles()" [disabled]="selectedUsersCount === 0 || bulkRoles.length === 0">
            Apply to {{ selectedUsersCount }} selected
          </button>
        </div>

        <div *ngIf="users.length === 0" class="no-data">
          <p>No users found.</p>
        </div>

        <table *ngIf="users.length > 0">
          <thead>
            <tr>
              <th style="width: 44px;"></th>
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
              <td>
                <input type="checkbox" [checked]="isUserSelected(user.email)" (change)="toggleUserSelection(user.email, $event)" />
              </td>
              <td>{{ user.displayName }}</td>
              <td class="email-cell">{{ user.email }}</td>
              <td>
                <span class="role-badge" [class]="'role-' + user.currentRole">
                  {{ roleLabel(user.currentRole) }}
                </span>
              </td>
              <td class="text-small">{{ user.assignedBy || '(Graph)' }}</td>
              <td class="text-small">{{ (user.updatedAt || user.assignedAt) ? (user.updatedAt || user.assignedAt | date:'short') : '(New)' }}</td>
              <td class="actions-cell">
                <div class="role-checkboxes">
                  <label *ngFor="let r of availableRoles" class="role-checkbox-label" [class.checked]="isRoleSelected(user.email, r)">
                    <input type="checkbox"
                      [checked]="isRoleSelected(user.email, r)"
                      (change)="toggleRole(user.email, r, $event)"
                    />
                    {{ roleLabel(r) }}
                  </label>
                </div>
                <div class="action-buttons">
                  <button class="btn-save" (click)="assignRoles(user.email)">Save</button>
                  <button 
                    *ngIf="user.assignedBy || (user.roles.length || 0) > 0"
                    (click)="removeRole(user.email)" 
                    class="btn-remove"
                    title="Remove role assignment (revert to Graph)"
                  >
                    <i class="fas fa-times"></i> Reset
                  </button>
                </div>
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

    .bulk-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding: 12px;
      border-bottom: 1px solid var(--border-color, #ddd);
      background: #f8fafc;
    }

    .bulk-select-all {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-primary, #334155);
      font-weight: 600;
    }

    .bulk-role-checkboxes {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      flex: 1;
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

    .role-select-multi {
      min-width: 160px;
      min-height: 72px;
    }

    .btn-save {
      background: #16a34a;
      color: #fff;
      border: none;
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .btn-save:hover {
      background: #15803d;
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

    .role-checkboxes {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      margin-bottom: 6px;
    }

    .role-checkbox-label {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px 3px 6px;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      font-size: 12px;
      color: #475569;
      cursor: pointer;
      background: #f8fafc;
      transition: all 0.15s ease;
      user-select: none;
    }

    .role-checkbox-label:hover {
      border-color: #2563eb;
      color: #2563eb;
      background: #eff6ff;
    }

    .role-checkbox-label.checked {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border-color: #2563eb;
      color: #fff;
    }

    .role-checkbox-label input[type="checkbox"] {
      width: 12px;
      height: 12px;
      accent-color: #2563eb;
      cursor: pointer;
    }

    .action-buttons {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    /* ════════════════════════════════════════════
       DARK THEME OVERRIDES
       ════════════════════════════════════════════ */
    :host-context(body.dark-theme) .user-roles-page {
      background: #0f172a;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .page-header-row h2 { color: #f1f5f9; }

    :host-context(body.dark-theme) .btn-refresh {
      background: #2563eb;
      color: #f0f9ff;
    }
    :host-context(body.dark-theme) .btn-refresh:hover:not(:disabled) {
      background: #1d4ed8;
    }

    /* Cards */
    :host-context(body.dark-theme) .card {
      background: #1e293b;
      border-color: #334155;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
      color: #e2e8f0;
    }

    /* Inputs */
    :host-context(body.dark-theme) .search-input,
    :host-context(body.dark-theme) .filter-select,
    :host-context(body.dark-theme) .role-select {
      background: #0b1220;
      border-color: #334155;
      color: #e2e8f0;
    }
    :host-context(body.dark-theme) .search-input::placeholder { color: #64748b; }
    :host-context(body.dark-theme) .search-input:focus,
    :host-context(body.dark-theme) .filter-select:focus,
    :host-context(body.dark-theme) .role-select:focus {
      outline: none;
      border-color: #60a5fa;
    }

    :host-context(body.dark-theme) .form-row button {
      background: #2563eb;
      color: #f0f9ff;
    }
    :host-context(body.dark-theme) .form-row button:hover:not(:disabled) {
      background: #1d4ed8;
    }
    :host-context(body.dark-theme) .form-row button:disabled {
      background: #334155;
      color: #64748b;
    }

    :host-context(body.dark-theme) .page-info { color: #94a3b8; }

    /* Info box */
    :host-context(body.dark-theme) .info-box {
      background: rgba(59, 130, 246, 0.12);
      border-left-color: #60a5fa;
      color: #cbd5e1;
    }
    :host-context(body.dark-theme) .info-box i { color: #60a5fa; }
    :host-context(body.dark-theme) .info-box code {
      background: #0b1220;
      color: #f1f5f9;
      border: 1px solid #334155;
    }

    /* Table */
    :host-context(body.dark-theme) .table-card { background: #1e293b; }
    :host-context(body.dark-theme) .bulk-toolbar {
      background: #0b1220;
      border-bottom-color: #334155;
    }
    :host-context(body.dark-theme) .bulk-select-all {
      color: #cbd5e1;
    }
    :host-context(body.dark-theme) thead {
      background: #0b1220;
      border-bottom-color: #334155;
    }
    :host-context(body.dark-theme) th {
      color: #cbd5e1;
      background: #0b1220;
    }
    :host-context(body.dark-theme) td {
      color: #e2e8f0;
      border-bottom-color: #1f2937;
    }
    :host-context(body.dark-theme) tr:hover { background: #273449; }
    :host-context(body.dark-theme) tr.role-admin { background: rgba(59, 130, 246, 0.10); }
    :host-context(body.dark-theme) tr.role-admin:hover { background: rgba(59, 130, 246, 0.18); }

    :host-context(body.dark-theme) .email-cell { color: #94a3b8; }
    :host-context(body.dark-theme) .text-small { color: #64748b; }

    /* Role badges */
    :host-context(body.dark-theme) .role-badge.role-admin {
      background: rgba(52, 211, 153, 0.18);
      color: #6ee7b7;
    }
    :host-context(body.dark-theme) .role-badge.role-user {
      background: rgba(148, 163, 184, 0.18);
      color: #cbd5e1;
    }

    :host-context(body.dark-theme) .role-checkbox-label {
      background: #0b1220;
      border-color: #334155;
      color: #94a3b8;
    }
    :host-context(body.dark-theme) .role-checkbox-label:hover {
      border-color: #60a5fa;
      color: #60a5fa;
      background: #1e3a8a22;
    }
    :host-context(body.dark-theme) .role-checkbox-label.checked {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border-color: #3b82f6;
      color: #fff;
    }

    /* Action buttons */
    :host-context(body.dark-theme) .btn-remove {
      background: #b91c1c;
      color: #fee2e2;
    }
    :host-context(body.dark-theme) .btn-remove:hover { background: #991b1b; }

    :host-context(body.dark-theme) .no-data { color: #94a3b8; }

    /* Pagination footer */
    :host-context(body.dark-theme) .pagination-footer {
      background: #1e293b;
      border-color: #334155;
    }
    :host-context(body.dark-theme) .pagination-footer button {
      background: #2563eb;
      color: #f0f9ff;
    }
    :host-context(body.dark-theme) .pagination-footer button:hover:not(:disabled) {
      background: #1d4ed8;
    }
    :host-context(body.dark-theme) .pagination-footer button:disabled {
      background: #334155;
      color: #64748b;
    }
    :host-context(body.dark-theme) .pagination-footer span { color: #cbd5e1; }
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
  selectedRoles: { [email: string]: string[] } = {};
  availableGroups: GroupOption[] = [];
  selectedGroup = '';
  selectAllUsers = false;
  bulkRoles: string[] = [];
  selectedUserEmails = new Set<string>();
  private dbRoleMap = new Map<string, any>();
  readonly availableRoles = ['admin', 'cloudops', 'product', 'hr', 'support', 'muraai'];
  
  private destroy$ = new Subject<void>();

  constructor(
    private http: HttpClient,
    private messageService: MessageService,
    private loadingService: LoadingService,
    private msalService: MsalService
  ) {}

  ngOnInit() {
    this.loadUsers();
    this.loadGroups();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async onSearchChange() {
    this.currentPage = 1;
    this.applyFiltersAndPaging();

    // If no direct user match, try interpreting the query as a Microsoft group and
    // show the group's members for role assignment.
    await this.tryLoadGroupMembersForSearch();
  }

  async onGroupChange() {
    this.currentPage = 1;
    this.selectedUserEmails.clear();
    this.selectAllUsers = false;

    if (!this.selectedGroup) {
      await this.loadUsers();
      return;
    }

    this.searchText = '';
    await this.loadMembersForGroup(this.selectedGroup, true);
  }

  private async loadGroups() {
    try {
      const directoryGroups = await this.msalService.getDirectoryGroups();
      this.availableGroups = (directoryGroups || []).map(g => {
        const value = (g.email || g.displayName || '').trim();
        const label = g.email
          ? `${g.displayName} (${g.email})`
          : g.displayName;
        return { value, label };
      }).filter(g => !!g.value);
    } catch (err) {
      console.warn('Failed to load directory groups, falling back to user groups:', err);
      try {
        const userGroups = await this.msalService.getUserGroups();
        this.availableGroups = (userGroups || []).map(g => {
          const value = (g.email || g.displayName || '').trim();
          const label = g.email
            ? `${g.displayName || g.email} (${g.email})`
            : (g.displayName || 'Unnamed Group');
          return { value, label };
        }).filter(g => !!g.value);
      } catch (fallbackErr) {
        console.warn('Failed to load Microsoft groups:', fallbackErr);
        this.availableGroups = [];
      }
    }
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
      this.dbRoleMap = roleMap;

      const merged: GraphUser[] = (orgUsers || []).map((u: any) => {
        const email = (u.email || '').toLowerCase();
        const roleRow = roleMap.get(email);
        const roles = this.normalizeRoles(Array.isArray(roleRow?.roles)
          ? roleRow.roles
          : [roleRow?.role]);
        return {
          id: email,
          email,
          displayName: u.displayName || email,
          userPrincipalName: email,
          currentRole: this.pickPrimaryRole(roles),
          roles,
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
      filtered = filtered.filter(u => (u.roles || []).includes(this.filterRole));
    }

    this.totalCount = filtered.length;
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    this.users = filtered.slice(start, end);
    this.hasMore = end < filtered.length;

    this.users.forEach(user => {
      this.selectedRoles[user.email] = [...(user.roles || [])];
    });

    // Keep bulk-selection only for currently visible users.
    const visible = new Set(this.users.map(u => u.email));
    this.selectedUserEmails.forEach(email => {
      if (!visible.has(email)) {
        this.selectedUserEmails.delete(email);
      }
    });
    this.syncSelectAllFlag();
  }

  private async tryLoadGroupMembersForSearch(): Promise<void> {
    const search = this.searchText.trim();
    if (!search) return;
    if (this.users.length > 0) return;

    // Avoid Graph lookups for very short free text. Group lookups are useful for
    // full group email (foo@bar.com) or meaningful display names.
    const normalized = search.toLowerCase();
    const looksLikeGroupEmail = normalized.includes('@') && normalized.includes('.');
    const looksLikeGroupName = normalized.length >= 5;
    if (!looksLikeGroupEmail && !looksLikeGroupName) return;

    try {
      this.isLoading = true;
      const members = await this.msalService.getGroupMembersByEmail(search);
      if (!members.length) return;

      const merged = this.mapMembersToUsers(members);
      this.allUsers = merged;
      this.applyFiltersAndPaging();

      this.messageService.success(`Loaded ${merged.length} member(s) from group ${search}`);
    } catch (err) {
      // Silent fallback: if group lookup fails, keep "No users found" state.
      // This avoids noisy errors while the admin types normal search text.
      console.warn('Group lookup fallback failed:', err);
    } finally {
      this.isLoading = false;
    }
  }

  private async loadMembersForGroup(groupIdentifier: string, showMessage = false): Promise<void> {
    this.isLoading = true;
    this.loadingService.show();
    try {
      const members = await this.msalService.getGroupMembersByEmail(groupIdentifier);
      const merged = this.mapMembersToUsers(members);

      this.allUsers = merged;
      this.applyFiltersAndPaging();

      if (showMessage) {
        this.messageService.success(`Loaded ${merged.length} member(s) from group ${groupIdentifier}`);
      }
    } catch (err) {
      console.error('Failed to load group members:', err);
      this.allUsers = [];
      this.users = [];
      this.totalCount = 0;
      this.hasMore = false;
      this.messageService.error('Failed to load members for selected group.');
    } finally {
      this.isLoading = false;
      this.loadingService.hide();
    }
  }

  private mapMembersToUsers(members: Array<{ email: string; displayName: string }>): GraphUser[] {
    return (members || []).map((m: any) => {
      const email = (m.email || '').toLowerCase();
      const roleRow = this.dbRoleMap.get(email);
      const roles = this.normalizeRoles(Array.isArray(roleRow?.roles)
        ? roleRow.roles
        : [roleRow?.role]);

      return {
        id: email,
        email,
        displayName: m.displayName || email,
        userPrincipalName: email,
        currentRole: this.pickPrimaryRole(roles),
        roles,
        assignedBy: roleRow?.assigned_by || undefined,
        assignedAt: roleRow?.assigned_at || undefined,
        updatedAt: roleRow?.updated_at || undefined
      };
    }).sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
  }

  isUserSelected(email: string): boolean {
    return this.selectedUserEmails.has(email);
  }

  toggleUserSelection(email: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.selectedUserEmails.add(email);
    } else {
      this.selectedUserEmails.delete(email);
    }
    this.syncSelectAllFlag();
  }

  toggleSelectAllUsers(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.selectAllUsers = checked;
    this.selectedUserEmails.clear();
    if (checked) {
      this.users.forEach(u => this.selectedUserEmails.add(u.email));
    }
  }

  private syncSelectAllFlag() {
    this.selectAllUsers = this.users.length > 0 && this.users.every(u => this.selectedUserEmails.has(u.email));
  }

  get selectedUsersCount(): number {
    return this.selectedUserEmails.size;
  }

  isBulkRoleSelected(role: string): boolean {
    return this.bulkRoles.includes(role);
  }

  toggleBulkRole(role: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const current = [...this.bulkRoles];
    if (checked && !current.includes(role)) {
      current.push(role);
    }
    if (!checked) {
      const idx = current.indexOf(role);
      if (idx > -1) current.splice(idx, 1);
    }
    this.bulkRoles = this.normalizeRoles(current);
  }

  async applyBulkRoles() {
    const roles = this.normalizeRoles(this.bulkRoles);
    const emails = Array.from(this.selectedUserEmails);
    if (!roles.length || !emails.length) return;

    this.loadingService.show();
    let successCount = 0;
    let failCount = 0;

    for (const email of emails) {
      try {
        await firstValueFrom(this.http.post<any>(`/api/admin/users/${encodeURIComponent(email)}/role`, {
          roles,
          role: this.pickPrimaryRole(roles),
          notes: `Bulk assigned via admin panel at ${new Date().toLocaleString()}`
        }).pipe(takeUntil(this.destroy$)));
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0 && failCount === 0) {
      this.messageService.success(`Roles applied to ${successCount} user(s).`);
    } else if (successCount > 0) {
      this.messageService.success(`Roles applied to ${successCount} user(s), ${failCount} failed.`);
    } else {
      this.messageService.error('Bulk role assignment failed for selected users.');
    }

    this.loadingService.hide();
    this.selectedUserEmails.clear();
    this.selectAllUsers = false;

    if (this.selectedGroup) {
      await this.loadMembersForGroup(this.selectedGroup);
    } else {
      await this.loadUsers();
    }
  }

  isRoleSelected(email: string, role: string): boolean {
    return (this.selectedRoles[email] || []).includes(role);
  }

  toggleRole(email: string, role: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.selectedRoles[email] ? [...this.selectedRoles[email]] : [];
    if (checked) {
      if (!current.includes(role)) current.push(role);
    } else {
      const idx = current.indexOf(role);
      if (idx > -1) current.splice(idx, 1);
    }
    this.selectedRoles[email] = current;
  }

  assignRoles(email: string) {
    const roles = this.normalizeRoles(Array.isArray(this.selectedRoles[email]) ? this.selectedRoles[email] : []);
    if (!roles.length) return;

    this.loadingService.show();
    const payload = {
      roles,
      role: this.pickPrimaryRole(roles),
      notes: `Assigned via admin panel at ${new Date().toLocaleString()}`
    };
    
    this.http.post<any>(`/api/admin/users/${encodeURIComponent(email)}/role`, payload)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.messageService.success(`Roles updated: ${email} → ${roles.join(', ')}`);
          this.loadUsers(); // Refresh to show updated data
          this.loadingService.hide();
        },
        error: (err) => {
          console.error('Failed to assign role:', err);
          this.messageService.error(`Failed to assign role: ${err?.error?.error || 'Unknown error'}`);
          this.selectedRoles[email] = this.users.find(u => u.email === email)?.roles || [];
          this.loadingService.hide();
        }
      });
  }

  private normalizeRoles(roles: string[]): string[] {
    return [...new Set(
      (roles || [])
        .map(role => (role || '').toString().trim().toLowerCase())
        .map(role => role === 'itsm' ? 'cloudops' : role)
        .filter(role => ['admin', 'cloudops', 'product', 'hr', 'support', 'muraai'].includes(role))
    )];
  }

  roleLabel(role: string): string {
    const map: Record<string, string> = {
      admin: 'Admin',
      cloudops: 'CloudOps',
      itsm: 'CloudOps',
      product: 'Product',
      hr: 'HR',
      support: 'Support',
      muraai: 'Muraai'
    };
    return map[(role || '').toLowerCase()] || 'Unassigned';
  }

  private pickPrimaryRole(roles: string[]): string {
    const rank = ['admin', 'cloudops', 'support', 'product', 'hr', 'muraai'];
    const set = new Set(this.normalizeRoles(roles));
    for (const r of rank) {
      if (set.has(r)) return r;
    }
    return '';
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
    if (this.selectedGroup) {
      this.onGroupChange();
      return;
    }
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
