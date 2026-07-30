import { Component, OnInit } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MsalService } from '../services/msal.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterModule, CommonModule, FormsModule],
  template: `
    <div class="sidebar" [class.expanded]="isProfileMenuOpen">

      <!-- MENU -->
      <ul class="menu">
        <li *ngIf="isCloudops()" class="menu-item" routerLink="/dashboard" [class.active]="isActive('/dashboard')">
          <i class="fas fa-home"></i>
          <span>Dashboard</span>
        </li>
        <li *ngIf="isAdmin() || isCloudops()" class="menu-item" routerLink="/tickets" [class.active]="isActive('/tickets')" [queryParams]="isAdmin() ? {tab: 'overview'} : null">
          <i class="fas fa-ticket-alt"></i>
          <span>View Tickets</span>
        </li>
        <li *ngIf="!isAdmin() && !isCloudops()" class="menu-item" routerLink="/tickets" [class.active]="isActive('/tickets')" [queryParams]="{tab: 'my'}">
          <i class="fas fa-ticket-alt"></i>
          <span>My Tickets</span>
        </li>
        <li class="menu-item"
            routerLink="/create-ticket"
            [class.active]="isActive('/create-ticket')">
          <i class="fas fa-plus-circle"></i>
          <span>Create Ticket</span>
        </li>
        <li *ngIf="isAdmin()"
            class="menu-item"
            routerLink="/admin"
            [class.active]="isActive('/admin')">
          <i class="fas fa-cog"></i>
          <span>Admin Panel</span>
        </li>
        <li *ngIf="isCloudops()"
            class="menu-item"
            routerLink="/azure-backup"
            [class.active]="isActive('/azure-backup')">
          <i class="fas fa-cloud"></i>
          <span>Azure Backup</span>
        </li>
        <li *ngIf="isCloudops()"
            class="menu-item"
            routerLink="/cloudops"
            [class.active]="isActive('/cloudops')">
          <i class="fas fa-folder"></i>
          <span>CloudOps Projects</span>
        </li>

        <li *ngIf="isCloudops()"
            class="menu-item"
            routerLink="/infrastructure/ssl"
            [class.active]="isLicenceSection()">
          <i class="fas fa-network-wired"></i>
          <span>Licence</span>
        </li>
        <li class="menu-item"
            routerLink="/recycle-bin"
            [class.active]="isActive('/recycle-bin')">
          <i class="fas fa-trash"></i>
          <span>Recycle Bin</span>
        </li>
      </ul>

      <div class="spacer"></div>

      <!-- PROFILE -->
      <div class="profile-wrapper">
        <div class="profile-box" (click)="toggleProfileMenu()">

          <ng-container *ngIf="profilePhoto; else avatar">
            <img [src]="profilePhoto" class="profile-img" />
          </ng-container>

          <ng-template #avatar>
            <div class="avatar">
              {{ (userName || userEmail || 'U')[0] }}
            </div>
          </ng-template>

          <div class="profile-info">
            <div class="name">
              {{ userName || 'User' }}
              <span class="role-badge" [class.admin]="isAdmin()" [class.cloudops]="isCloudops()">
                {{ roleLabel(role) }}
              </span>
            </div>
            <div class="email">{{ userEmail }}</div>
          </div>
        </div>

        <div class="profile-menu" *ngIf="isProfileMenuOpen">
          <div class="role-switch-block" *ngIf="availableRoles.length > 1" (click)="$event.stopPropagation()">
            <div class="role-switch-label">Switch Role</div>
            <div class="role-pills">
              <button
                *ngFor="let r of availableRoles"
                class="role-pill"
                [class.active]="selectedRole === r"
                (click)="selectedRole = r; $event.stopPropagation()">
                {{ roleLabel(r) }}
              </button>
            </div>
            <button class="role-switch-btn" (click)="switchRole(); $event.stopPropagation()">Apply</button>
          </div>
          <div class="menu-dropdown-item" (click)="openProfile(); $event.stopPropagation()">
            <i class="fas fa-user"></i> Profile
          </div>
          <div class="menu-dropdown-item logout"
               (click)="logout(); $event.stopPropagation()">
            <i class="fas fa-sign-out-alt"></i> Logout
          </div>
        </div>
      </div>

      <!-- PROFILE MODAL -->
      <div class="modal-backdrop" *ngIf="isProfileModalOpen" (click)="closeProfile()">
        <div class="modal-card" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div class="modal-title">My Profile</div>
            <button class="icon-close" (click)="closeProfile()">✕</button>
          </div>

          <div class="modal-body">
            <div class="profile-hero">
              <ng-container *ngIf="profilePhoto; else modalAvatar">
                <img [src]="profilePhoto" class="profile-lg" />
              </ng-container>
              <ng-template #modalAvatar>
                <div class="profile-lg avatar">
                  {{ (userName || userEmail || 'U')[0] }}
                </div>
              </ng-template>

              <div class="profile-meta">
                <div class="profile-name">{{ userName || profile.displayName || 'User' }}</div>
                <div class="profile-email">{{ userEmail || profile.mail || '—' }}</div>
                <div class="profile-role">{{ roleLabel(role) }}</div>
              </div>
            </div>

            <div class="profile-grid">
              <div class="profile-row">
                <span>Mobile</span>
                <strong>{{ profile.mobilePhone || '—' }}</strong>
              </div>
              <div class="profile-row">
                <span>Department</span>
                <strong>{{ profile.department || '—' }}</strong>
              </div>
              <div class="profile-row">
                <span>Job Title</span>
                <strong>{{ profile.jobTitle || '—' }}</strong>
              </div>
              <div class="profile-row">
                <span>Office</span>
                <strong>{{ profile.officeLocation || '—' }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 44px;
      height: 100%;
      overflow: visible;
    }

    .sidebar {
      position: absolute;
      top: 0;
      left: 0;
      width: 44px;
      height: 100%;
      display: flex;
      flex-direction: column;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
      box-sizing: border-box;
      overflow-y: auto;
      overflow-x: hidden;
      border-right: 1px solid #e2e8f0;
      transition: width 0.25s ease, box-shadow 0.25s ease;
      z-index: 10;
    }

    .sidebar:hover,
    .sidebar.expanded {
      width: 154px;
      box-shadow: 6px 0 24px rgba(15, 23, 42, 0.12);
    }

    .menu {
      list-style: none;
      padding: 8px 4px;
      margin: 0;
    }

    .menu-item {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 4px;
      cursor: pointer;
      border-radius: 5px;
      margin-bottom: 2px;
      transition: all 0.2s ease;
      color: #475569;
      font-weight: 500;
      font-size: 0.7rem;
    }

    .sidebar:hover .menu-item,
    .sidebar.expanded .menu-item {
      justify-content: flex-start;
      padding: 6px 10px;
    }

    .menu-item span {
      opacity: 0;
      width: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: opacity 0.15s ease;
    }

    .sidebar:hover .menu-item span,
    .sidebar.expanded .menu-item span {
      opacity: 1;
      width: auto;
    }

    .menu-item i {
      width: 14px;
      text-align: center;
      font-size: 0.7rem;
      color: #64748b;
      transition: color 0.2s ease;
      flex-shrink: 0;
    }

    .menu-item > i:last-child {
      margin-left: auto;
      width: auto;
      font-size: 0.6rem;
    }

    .menu-item.sub-item {
      padding-left: 16px;
      font-size: 0.65rem;
    }

    .menu-item:hover {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      color: #1d4ed8;
    }

    .menu-item:hover i {
      color: #2563eb;
    }

    .menu-item.active {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
    }

    .menu-item.active i {
      color: white;
    }

    /* Below the layout's mobile breakpoint the sidebar stacks statically full-width
       (see main-layout.component.ts) — there's no hover on touch, so disable the
       collapse/expand behavior and always show full labels. */
    @media (max-width: 900px) {
      :host {
        width: 100%;
        height: auto;
      }
      .sidebar {
        position: static;
        width: 100%;
        height: auto;
      }
      .sidebar:hover,
      .sidebar.expanded {
        width: 100%;
        box-shadow: none;
      }
      .menu-item {
        justify-content: flex-start;
      }
      .menu-item span,
      .profile-info {
        opacity: 1;
        width: auto;
      }
    }

    /* Dark Theme Sidebar */
    :host-context(.dark-theme) .sidebar {
      background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
      border-right-color: #334155;
    }

    :host-context(.dark-theme) .menu-item {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .menu-item i {
      color: #64748b;
    }

    :host-context(.dark-theme) .menu-item:hover {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
      color: #93c5fd;
    }

    :host-context(.dark-theme) .menu-item:hover i {
      color: #60a5fa;
    }

    :host-context(.dark-theme) .menu-item.active {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: white;
    }

    :host-context(.dark-theme) .menu-item.active i {
      color: white;
    }

    :host-context(.dark-theme) .profile-box {
      border-top-color: #334155;
      background: rgba(30, 41, 59, 0.5);
    }

    .spacer { flex: 1; }

    /* PROFILE */
    .profile-wrapper {
      position: relative;
      margin-top: auto;
    }

    .profile-box {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      margin: 4px;
      border-radius: 6px;
      background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
      cursor: pointer;
      box-sizing: border-box;
      transition: all 0.2s ease;
    }

    .profile-box:hover {
      background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    }

    .profile-img,
    .avatar {
      width: 24px;
      height: 24px;
      min-width: 24px;
      border-radius: 50%;
      object-fit: cover;
    }

    .avatar {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.65rem;
      box-shadow: 0 2px 5px rgba(59, 130, 246, 0.25);
    }

    .profile-info {
      display: flex;
      flex-direction: column;
      font-size: 9px;
      flex: 1;
      min-width: 0;
      opacity: 0;
      width: 0;
      overflow: hidden;
      white-space: nowrap;
      transition: opacity 0.15s ease;
    }

    .sidebar:hover .profile-info,
    .sidebar.expanded .profile-info {
      opacity: 1;
      width: auto;
      flex: 1;
    }

    .name {
      font-weight: 600;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 3px;
    }

    .email {
      font-size: 8px;
      max-width: 85px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: #64748b;
    }

    :host-context(.dark-theme) .name {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .email {
      color: #94a3b8;
    }

    .role-badge {
      padding: 1px 4px;
      font-size: 7px;
      border-radius: 6px;
      background: linear-gradient(135deg, #e2e8f0 0%, #cbd5e1 100%);
      color: #475569;
      font-weight: 600;
    }

    .role-badge.admin {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
    }

    .role-badge.cloudops {
      background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
      color: #fff;
    }

    .profile-menu {
      position: absolute;
      bottom: 45px;
      left: 4px;
      right: 4px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1);
      z-index: 100;
      overflow: hidden;
    }

    .menu-dropdown-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #475569;
      font-weight: 500;
      font-size: 0.7rem;
    }

    .role-switch-block {
      padding: 8px 10px;
      border-bottom: 1px solid #f1f5f9;
      display: grid;
      gap: 6px;
    }

    .role-switch-label {
      font-size: 0.66rem;
      color: #64748b;
      font-weight: 600;
    }

    .role-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .role-pill {
      padding: 3px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 20px;
      font-size: 0.63rem;
      font-weight: 500;
      color: #475569;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .role-pill:hover {
      border-color: #2563eb;
      color: #2563eb;
      background: #eff6ff;
    }

    .role-pill.active {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border-color: #2563eb;
      color: #fff;
      font-weight: 600;
    }

    .role-switch-btn {
      border: none;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 0.68rem;
      font-weight: 600;
      color: #fff;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      cursor: pointer;
    }

    .menu-dropdown-item:hover {
      background: #f1f5f9;
      color: #1d4ed8;
    }

    .menu-dropdown-item.logout {
      color: #dc2626;
      border-top: 1px solid #f1f5f9;
    }

    .menu-dropdown-item.logout:hover {
      background: #fef2f2;
      color: #b91c1c;
    }

    :host-context(.dark-theme) .profile-menu {
      background: #1e293b;
      border-color: #334155;
    }

    :host-context(.dark-theme) .menu-dropdown-item {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .menu-dropdown-item:hover {
      background: #0f172a;
      color: #60a5fa;
    }

    :host-context(.dark-theme) .menu-dropdown-item.logout {
      border-top-color: #334155;
    }

    /* Modal - HIGHEST Z-INDEX FIX */
    .modal-backdrop {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(15, 23, 42, 0.75) !important;
      backdrop-filter: blur(12px) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      z-index: 2147483647 !important;
      isolation: isolate;
      transform: translateZ(0);
    }

    .modal-card {
      width: 380px;
      background: #fff;
      border-radius: 16px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      animation: modalSlide 0.3s ease;
      position: relative;
      z-index: 2147483647;
    }

    @keyframes modalSlide {
      from { transform: translateY(-20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 18px 20px;
      border-bottom: 1px solid #f1f5f9;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    }

    .modal-title {
      font-weight: 700;
      font-size: 1.1rem;
      color: #1e293b;
    }

    .icon-close {
      border: none;
      background: #e2e8f0;
      cursor: pointer;
      font-size: 14px;
      color: #64748b;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .icon-close:hover {
      background: #dc2626;
      color: white;
    }

    .modal-body { padding: 20px; }

    .profile-hero {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #f1f5f9;
    }

    .profile-lg {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      object-fit: cover;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.5rem;
    }

    .profile-meta { display: grid; gap: 6px; }
    .profile-name { font-weight: 700; font-size: 1.1rem; color: #1e293b; }
    .profile-email { font-size: 13px; color: #64748b; }
    .profile-role { 
      font-size: 12px; 
      color: #2563eb; 
      font-weight: 600;
      background: #dbeafe;
      padding: 4px 10px;
      border-radius: 20px;
      width: fit-content;
    }

    .profile-grid { display: grid; gap: 10px; }
    .profile-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
      color: #64748b;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      padding: 12px 14px;
      border-radius: 10px;
    }
    .profile-row strong { color: #1e293b; font-weight: 600; }

    :host-context(.dark-theme) .modal-card {
      background: #1e293b;
    }

    :host-context(.dark-theme) .modal-header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) .modal-title {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .icon-close {
      background: #334155;
      color: #94a3b8;
    }

    :host-context(.dark-theme) .profile-hero {
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) .profile-name {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .profile-email {
      color: #94a3b8;
    }

    :host-context(.dark-theme) .profile-role {
      background: #1e3a8a;
      color: #93c5fd;
    }

    :host-context(.dark-theme) .profile-row {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #94a3b8;
    }

    :host-context(.dark-theme) .profile-row strong {
      color: #e2e8f0;
    }
  `]
})
export class SidebarComponent implements OnInit {

  userName = '';
  userEmail = '';
  profilePhoto: string | null = null;
  isProfileMenuOpen = false;
  isProfileModalOpen = false;
  role = '';
  availableRoles: string[] = [];
  selectedRole = '';
  profile = {
    displayName: '',
    mail: '',
    mobilePhone: '',
    department: '',
    jobTitle: '',
    officeLocation: ''
  };

  constructor(
    private router: Router,
    private http: HttpClient,
    private msalService: MsalService
  ) {}

  ngOnInit() {

  // 1️⃣ Try MSAL account first
  const account = this.msalService.getAccount();

  if (account) {
    this.userName = account.name || account.username || '';
    this.userEmail = account.username || '';
    this.loadProfilePhoto();
  } else {
    // 2️⃣ Fallback to normal login (JWT login)
    const email = sessionStorage.getItem('username') || '';
    this.userEmail = email;

    // Show name before @
    this.userName = email ? email.split('@')[0] : '';
  }

  // Always refresh role from sessionStorage
  this.role = this.toVisibleRole(sessionStorage.getItem('role') || '');
  this.availableRoles = this.readStoredRoles();
  this.selectedRole = this.availableRoles.includes(this.role) ? this.role : (this.availableRoles[0] || '');
}


  async openProfile() {
    this.isProfileMenuOpen = false;
    this.isProfileModalOpen = true;
    await this.loadProfileDetails();
  }

  closeProfile() {
    this.isProfileModalOpen = false;
  }

  toggleProfileMenu() {
    this.availableRoles = this.readStoredRoles();
    if (!this.availableRoles.includes(this.selectedRole)) {
      this.selectedRole = this.availableRoles.includes(this.role) ? this.role : (this.availableRoles[0] || '');
    }
    this.isProfileMenuOpen = !this.isProfileMenuOpen;
  }

  private toVisibleRole(role: string): string {
    const normalized = (role || '').toString().toLowerCase();
    if (normalized === 'itsm') return 'cloudops';
    return normalized === 'user' ? '' : normalized;
  }

  private getAuthHeaders() {
    const token = sessionStorage.getItem('accessToken') || '';
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
  }

  private readStoredRoles(): string[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem('roles') || '[]');
      if (!Array.isArray(parsed)) return this.getVisibleRoles([this.role]);
      const normalized = parsed.map((r: any) => (r || '').toString().toLowerCase()).filter(Boolean);
      const visible = this.getVisibleRoles(normalized);
      return visible.length ? visible : this.getVisibleRoles([this.role]);
    } catch {
      return this.getVisibleRoles([this.role]);
    }
  }

  private getVisibleRoles(roles: string[]): string[] {
    // Filter to only show admin and cloudops roles
    const visible = (roles || [])
      .map(role => role === 'itsm' ? 'cloudops' : role)
      .filter(role => role && role !== 'user' && (role === 'admin' || role === 'cloudops'));
    
    return [...new Set(visible)];
  }

  roleLabel(role: string): string {
    const map: Record<string, string> = {
      admin: 'Admin',
      cloudops: 'CloudOps',
      itsm: 'CloudOps',
      product: 'Product',
      hr: 'HR',
      support: 'Support',
      muraai: 'Muraai',
      user: 'User'
    };
    return map[(role || '').toLowerCase()] || 'User';
  }

  switchRole() {
    if (!this.selectedRole || this.selectedRole === this.role) {
      this.isProfileMenuOpen = false;
      return;
    }

    this.http.post<any>('/api/auth/switch-role', { role: this.selectedRole }, {
      headers: this.getAuthHeaders()
    }).subscribe({
      next: (data) => {
        if (data?.accessToken) sessionStorage.setItem('accessToken', data.accessToken);
        if (data?.refreshToken) sessionStorage.setItem('refreshToken', data.refreshToken);
        if (data?.role) {
          sessionStorage.setItem('role', data.role);
          this.role = this.toVisibleRole(data.role);
        }
        if (Array.isArray(data?.roles)) {
          sessionStorage.setItem('roles', JSON.stringify(data.roles));
          this.availableRoles = this.getVisibleRoles(data.roles);
        }
        this.isProfileMenuOpen = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err) => {
        console.error('Role switch failed', err);
      }
    });
  }

  // ✅ FIXED LOGOUT (APP-ONLY)
  logout() {
    this.isProfileMenuOpen = false;

    sessionStorage.clear();
    localStorage.removeItem('ITSMS_USERS'); // optional

    this.msalService.logout();

    this.router.navigate(['/login']);
  }

  loadProfilePhoto() {
    this.msalService.ensureInitialized().then(async () => {
      const account = this.msalService.getAccount();
      if (!account) {
        this.profilePhoto = null;
        return;
      }

      try {
        const token = await this.msalService.getAccessToken(['User.Read']);
        this.http.get(
          'https://graph.microsoft.com/v1.0/me/photo/$value',
          {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'blob',
            observe: 'response'
          }
        ).subscribe({
          next: (response) => {
            if (response.status === 200 && response.body) {
              this.profilePhoto = URL.createObjectURL(response.body);
              return;
            }
            this.profilePhoto = null;
          },
          error: () => {
            this.profilePhoto = null;
          }
        });
      } catch {
        this.profilePhoto = null;
      }
    });
  }

  private async loadProfileDetails(): Promise<void> {
    try {
      const token = await this.msalService.getAccessToken(['User.Read']);
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=displayName,mail,mobilePhone,department,jobTitle,officeLocation',
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) return;
      const data = await response.json();

      this.profile = {
        displayName: data?.displayName || '',
        mail: data?.mail || data?.userPrincipalName || '',
        mobilePhone: data?.mobilePhone || '',
        department: data?.department || '',
        jobTitle: data?.jobTitle || '',
        officeLocation: data?.officeLocation || ''
      };
    } catch {
      // ignore profile load failures
    }
  }

  isActive(route: string) {
    return this.router.url === route;
  }

  isAdminSection() {
    return this.router.url.startsWith('/admin');
  }

  isLicenceSection() {
    return this.router.url.startsWith('/infrastructure') || this.router.url.startsWith('/ssl') || this.router.url.startsWith('/ihub') || this.router.url.startsWith('/automation-ssl');
  }

  isAdmin() { return this.role === 'admin'; }
  isCloudops() { return this.role === 'cloudops' || this.role === 'itsm'; }
  isUser() { return this.role === 'user'; }
}
