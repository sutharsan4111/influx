import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
<div class="admin-page">

  <div class="page-header-row">
    <div>
      <h2>Local User Management</h2>
    </div>
    <div style="display: flex; gap: 10px;">
      <button class="btn-nav" routerLink="/admin/user-roles" title="Manage Microsoft user roles">
        <i class="fas fa-users-cog"></i> Microsoft User Roles
      </button>
      <button class="btn-refresh" (click)="refreshUsers()" [disabled]="isRefreshing" title="Refresh">
        <i class="fas fa-sync-alt" [class.spinning]="isRefreshing"></i>
      </button>
    </div>
  </div>

  <!-- CREATE USER -->
  <div class="card">
    <div class="form-row">
      <input [(ngModel)]="newEmail" placeholder="Username / Email" />
      <div class="password-field">
        <input [(ngModel)]="newPassword" type="password" placeholder="Password" (input)="validatePassword()" />
        <div class="password-strength" *ngIf="newPassword">
          <div class="strength-bar">
            <div class="strength-fill" [style.width]="passwordStrength + '%'" [class.weak]="passwordStrength < 40" [class.medium]="passwordStrength >= 40 && passwordStrength < 80" [class.strong]="passwordStrength >= 80"></div>
          </div>
          <span class="strength-text" [class.weak]="passwordStrength < 40" [class.medium]="passwordStrength >= 40 && passwordStrength < 80" [class.strong]="passwordStrength >= 80">{{ passwordStrengthText }}</span>
        </div>
        <ul class="password-requirements" *ngIf="newPassword && !isPasswordValid">
          <li [class.valid]="hasMinLength">At least 8 characters</li>
          <li [class.valid]="hasUppercase">Uppercase letter (A-Z)</li>
          <li [class.valid]="hasLowercase">Lowercase letter (a-z)</li>
          <li [class.valid]="hasNumber">Number (0-9)</li>
          <li [class.valid]="hasSpecialChar">Special character (!&#64;#$%^&amp;*)</li>
        </ul>
      </div>
      <select [(ngModel)]="newRole">
        <option value="admin">Admin</option>
        <option value="cloudops">CloudOps</option>
        <option value="product">Product</option>
        <option value="hr">HR</option>
        <option value="support">Support</option>
        <option value="muraai">Muraai</option>
      </select>
      <button (click)="addUser()" [disabled]="!isPasswordValid || !newEmail">Add</button>
    </div>
  </div>

  <!-- USERS TABLE -->
  <div class="card table-card">
    <table>
      <thead>
        <tr>
          <th>Username / Email</th>
          <th>Role</th>
          <th style="width:150px;">Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr *ngFor="let user of users">
          <td>{{ user.email }}</td>
          <td>
            <select [(ngModel)]="user.role" (change)="updateRole(user)">
              <option value="admin">Admin</option>
              <option value="cloudops">CloudOps</option>
              <option value="product">Product</option>
              <option value="hr">HR</option>
              <option value="support">Support</option>
              <option value="muraai">Muraai</option>
            </select>
          </td>
          <td>
            <button class="delete-btn" (click)="deleteUser(user.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- TOAST -->
  <div class="toast" *ngIf="toastMessage">
    {{ toastMessage }}
  </div>

</div>
  `,
  styles: [`
.admin-page {
  padding: 30px;
  max-width: 1200px;
  margin: auto;
}

.page-header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.page-header-row h2 {
  margin: 0;
  font-weight: 600;
  color: #1f2937;
}

.page-header-row .subtitle {
  margin: 5px 0 0 0;
  font-size: 14px;
  color: #6b7280;
}

.btn-nav {
  background: #10b981;
  color: white;
  border: none;
  padding: 8px 12px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.btn-nav:hover {
  background: #059669;
}

.btn-nav i {
  font-size: 14px;
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

.admin-page h2 {
  margin-bottom: 20px;
  font-weight: 600;
  color: #1f2937;
}

/* CARD */
.card {
  background: #ffffff;
  padding: 20px;
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
  margin-bottom: 25px;
}

/* FORM */
.form-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}

input, select {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #d1d5db;
  font-size: 14px;
  min-width: 180px;
  transition: all 0.2s ease;
}

input:focus, select:focus {
  outline: none;
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

/* PRIMARY BUTTON */
button {
  padding: 10px 16px;
  border: none;
  border-radius: 8px;
  background: #2563eb;
  color: white;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

button:hover {
  background: #1e40af;
}

/* DELETE BUTTON */
.delete-btn {
  background: #dc2626;
}

.delete-btn:hover {
  background: #991b1b;
}

/* TABLE */
.table-card table {
  width: 100%;
  border-collapse: collapse;
}

th {
  background: #f9fafb;
  padding: 14px;
  text-align: left;
  font-weight: 600;
  font-size: 14px;
  color: #374151;
}

td {
  padding: 14px;
  border-bottom: 1px solid #f1f5f9;
  font-size: 14px;
}

tr:hover {
  background: #f8fafc;
}

:host-context(.dark-theme) .admin-page h2 {
  color: #e2e8f0;
}

:host-context(.dark-theme) .card {
  background: #0f172a;
  border: 1px solid #1f2937;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
}

:host-context(.dark-theme) input,
:host-context(.dark-theme) select {
  background: #0b1220;
  color: #e2e8f0;
  border-color: #334155;
}

:host-context(.dark-theme) th {
  background: #111827;
  color: #e2e8f0;
}

:host-context(.dark-theme) td {
  color: #e2e8f0;
  border-bottom-color: #1f2937;
}

:host-context(.dark-theme) tr:hover {
  background: #0b1220;
}

/* ROLE SELECT */
td select {
  padding: 6px 10px;
  font-size: 13px;
}

/* TOAST */
.toast {
  position: fixed;
  bottom: 25px;
  right: 25px;
  background: #111827;
  color: white;
  padding: 14px 20px;
  border-radius: 10px;
  font-size: 14px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.2);
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* PASSWORD VALIDATION */
.password-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.password-strength {
  display: flex;
  align-items: center;
  gap: 10px;
}

.strength-bar {
  flex: 1;
  height: 6px;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background 0.3s ease;
}

.strength-fill.weak { background: #ef4444; }
.strength-fill.medium { background: #f59e0b; }
.strength-fill.strong { background: #10b981; }

.strength-text {
  font-size: 12px;
  font-weight: 500;
  min-width: 60px;
}

.strength-text.weak { color: #ef4444; }
.strength-text.medium { color: #f59e0b; }
.strength-text.strong { color: #10b981; }

.password-requirements {
  list-style: none;
  padding: 0;
  margin: 4px 0 0 0;
  font-size: 12px;
}

.password-requirements li {
  color: #ef4444;
  padding: 2px 0;
}

.password-requirements li::before {
  content: '✗ ';
}

.password-requirements li.valid {
  color: #10b981;
}

.password-requirements li.valid::before {
  content: '✓ ';
}

button:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

:host-context(.dark-theme) .strength-bar {
  background: #374151;
}

:host-context(.dark-theme) .password-requirements li {
  color: #f87171;
}

:host-context(.dark-theme) .password-requirements li.valid {
  color: #34d399;
}
`]

})
export class AdminComponent implements OnInit {

  newEmail = '';
  newPassword = '';
  newRole = 'cloudops';

  users: any[] = [];
  toastMessage = '';
  isRefreshing = false;

  // Password validation
  passwordStrength = 0;
  passwordStrengthText = '';
  hasMinLength = false;
  hasUppercase = false;
  hasLowercase = false;
  hasNumber = false;
  hasSpecialChar = false;
  isPasswordValid = false;

  // 🚀 Static cache for users (persists across navigation)
  private static usersCache: { users: any[]; timestamp: number } | null = null;
  private static readonly CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private router: Router) {}

  ngOnInit() {
    if (localStorage.getItem('role') !== 'admin') {
      this.router.navigate(['/dashboard']);
    }
    
    // 🚀 Check if we have valid cached users
    const cache = AdminComponent.usersCache;
    if (cache && Date.now() - cache.timestamp < AdminComponent.CACHE_EXPIRY_MS) {
      this.users = cache.users;
    } else {
      this.loadUsers();
    }
  }

  get token() {
    return localStorage.getItem('accessToken');
  }

  private async authFetch(input: RequestInfo, init: RequestInit = {}) {
    const token = this.token || '';
    const headers = new Headers(init.headers || {});
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const res = await fetch(input, { ...init, headers });

    if (res.status !== 401 && res.status !== 403) {
      return res;
    }

    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) {
      return res;
    }

    const refreshRes = await fetch('/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (!refreshRes.ok) {
      return res;
    }

    const data = await refreshRes.json();
    if (!data?.accessToken) {
      return res;
    }

    localStorage.setItem('accessToken', data.accessToken);
    headers.set('Authorization', `Bearer ${data.accessToken}`);

    return fetch(input, { ...init, headers });
  }

  async loadUsers() {
    const res = await this.authFetch('/api/users');

    if (!res.ok) {
      const text = await res.text();
      this.showToast(text || 'Failed to load users', true);
      this.users = [];
      return;
    }

    this.users = (await res.json()).map((user: any) => ({
      ...user,
      role: user?.role === 'itsm' ? 'cloudops' : user?.role
    }));
    // 🚀 Save to cache
    AdminComponent.usersCache = { users: this.users, timestamp: Date.now() };
  }

  async refreshUsers() {
    this.isRefreshing = true;
    AdminComponent.usersCache = null; // Clear cache
    await this.loadUsers();
    this.isRefreshing = false;
  }

  async addUser() {
    const res = await this.authFetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: this.newEmail,
        password: this.newPassword,
        role: this.newRole
      })
    });

    const data = res.ok ? await res.json() : { message: await res.text() };

    if (res.ok) {
      this.showToast("User created successfully");
      this.newEmail = '';
      this.newPassword = '';
      this.newRole = 'cloudops';
      this.loadUsers();
    } else {
      this.showToast(data.message || "Error occurred", true);
    }
  }

  async updateRole(user: any) {
    const res = await this.authFetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: user.role })
    });
    if (!res.ok) {
      this.showToast(await res.text(), true);
      return;
    }

    this.showToast("Role updated");
    // 🚀 Update cache with new role
    AdminComponent.usersCache = { users: this.users, timestamp: Date.now() };
  }

  async deleteUser(id: number) {
    if (!confirm("Delete this user?")) return;

    const res = await this.authFetch(`/api/users/${id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      this.showToast(await res.text(), true);
      return;
    }

    this.showToast("User deleted");
    this.loadUsers();
  }

  showToast(message: string, error = false) {
    this.toastMessage = message;
    setTimeout(() => this.toastMessage = '', 3000);
  }

  validatePassword() {
    const password = this.newPassword;
    
    // Check individual requirements
    this.hasMinLength = password.length >= 8;
    this.hasUppercase = /[A-Z]/.test(password);
    this.hasLowercase = /[a-z]/.test(password);
    this.hasNumber = /[0-9]/.test(password);
    this.hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    
    // Calculate strength score
    let strength = 0;
    if (this.hasMinLength) strength += 20;
    if (this.hasUppercase) strength += 20;
    if (this.hasLowercase) strength += 20;
    if (this.hasNumber) strength += 20;
    if (this.hasSpecialChar) strength += 20;
    
    // Bonus for longer passwords
    if (password.length >= 12) strength = Math.min(100, strength + 10);
    if (password.length >= 16) strength = Math.min(100, strength + 10);
    
    this.passwordStrength = strength;
    
    // Set strength text
    if (strength < 40) {
      this.passwordStrengthText = 'Weak';
    } else if (strength < 80) {
      this.passwordStrengthText = 'Medium';
    } else {
      this.passwordStrengthText = 'Strong';
    }
    
    // Password is valid only if all requirements are met
    this.isPasswordValid = this.hasMinLength && this.hasUppercase && 
                           this.hasLowercase && this.hasNumber && this.hasSpecialChar;
  }
}

