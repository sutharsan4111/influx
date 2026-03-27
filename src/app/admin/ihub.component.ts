import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { IhubAsset, IhubResponsiblePerson, IhubService } from '../services/ihub.service';
import { MsalService } from '../services/msal.service';
import { MessageService } from '../services/message.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="ihub-page">
      <div class="page-header-row">
        <h2>IHUB</h2>
        <div class="header-actions">
          <button class="btn-check" (click)="runExpiryCheck()" title="Run Expiry Check" [disabled]="isRunningCheck">
            <i class="fas fa-clock" [class.spinning]="isRunningCheck"></i>
            {{ isRunningCheck ? 'Checking...' : 'Run Check' }}
          </button>
          <button class="btn-add" (click)="openAddModal()" title="Add IHUB">
            <i class="fas fa-plus"></i>
          </button>
        </div>
      </div>

      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Environment</th>
              <th>Hostname</th>
              <th>IP Address</th>
              <th>IHUB Version</th>
              <th>License Expiry</th>
              <th>Responsible Person</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let item of assets">
              <td>{{ item.client }}</td>
              <td>{{ item.environment }}</td>
              <td>{{ item.hostname }}</td>
              <td>{{ item.ip_address }}</td>
              <td>{{ item.ihub_version || '-' }}</td>
              <td>
                {{ item.license_expiry | date:'yyyy-MM-dd' }}
                <span class="badge" [ngClass]="expiryClass(item.days_to_expiry)">
                  {{ expiryLabel(item.days_to_expiry) }}
                </span>
              </td>
              <td>{{ item.responsible_person_name || item.responsible_person_email }}</td>
              <td>
                <button class="btn-edit" (click)="openEditModal(item)">Edit</button>
                <button class="btn-delete" (click)="deleteAsset(item)">Delete</button>
              </td>
            </tr>
            <tr *ngIf="assets.length === 0">
              <td colspan="8" class="empty">No IHUB records found.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal-backdrop" *ngIf="showModal" (click)="closeModal()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <h3>{{ editingId ? 'Edit IHUB' : 'Add IHUB' }}</h3>

        <div class="grid">
          <label>
            Client
            <input [(ngModel)]="form.client" />
          </label>

          <label>
            Environment
            <input [(ngModel)]="form.environment" />
          </label>

          <label>
            Hostname
            <input [(ngModel)]="form.hostname" />
          </label>

          <label>
            IP Address
            <input [(ngModel)]="form.ip_address" />
          </label>

          <label>
            IHUB Version
            <input [(ngModel)]="form.ihub_version" />
          </label>

          <label>
            License Expiry
            <input type="date" [(ngModel)]="form.license_expiry" />
          </label>

          <label class="full">
            Responsible Person
            <select [(ngModel)]="form.responsible_person_email" (change)="onResponsibleChanged()">
              <option value="">Select responsible person</option>
              <option *ngFor="let person of responsiblePeople" [value]="person.email">
                {{ person.displayName || person.email }} ({{ person.email }})
              </option>
            </select>
          </label>
        </div>

        <div class="actions">
          <button class="btn-secondary" (click)="closeModal()">Cancel</button>
          <button class="btn-primary" (click)="save()">Save</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .ihub-page {
      padding: 22px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .page-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .page-header-row h2 {
      margin: 0;
      color: #1f2937;
    }

    .btn-add {
      width: 34px;
      height: 34px;
      border: none;
      border-radius: 50%;
      background: #2563eb;
      color: #fff;
      cursor: pointer;
      font-size: 14px;
    }

    .table-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      overflow: auto;
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 980px;
    }

    th {
      background: #f8fafc;
      color: #334155;
      text-align: left;
      font-size: 12px;
      padding: 10px;
    }

    td {
      font-size: 12px;
      padding: 10px;
      border-bottom: 1px solid #f1f5f9;
    }

    .empty {
      text-align: center;
      color: #64748b;
      padding: 20px;
    }

    .btn-edit {
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      background: #eff6ff;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 11px;
      cursor: pointer;
      margin-right: 6px;
    }

    .btn-delete {
      border: 1px solid #fecaca;
      color: #b91c1c;
      background: #fef2f2;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 11px;
      cursor: pointer;
    }

    .badge {
      margin-left: 8px;
      border-radius: 12px;
      padding: 2px 8px;
      font-size: 10px;
      font-weight: 600;
    }

    .badge.safe {
      background: #dcfce7;
      color: #166534;
    }

    .badge.warn {
      background: #fef3c7;
      color: #92400e;
    }

    .badge.alert {
      background: #fee2e2;
      color: #991b1b;
    }

    .header-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .btn-check {
      border: 1px solid #dbeafe;
      color: #1d4ed8;
      background: #eff6ff;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      transition: all 0.2s ease;
    }

    .btn-check:hover:not(:disabled) {
      background: #dbeafe;
      color: #1e40af;
    }

    .btn-check:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-check i.spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999;
    }

    .modal-card {
      background: #fff;
      border-radius: 12px;
      width: 760px;
      max-width: calc(100vw - 24px);
      padding: 20px;
    }

    .modal-card h3 {
      margin: 0 0 14px;
      color: #1e293b;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .grid label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      color: #334155;
      font-weight: 600;
    }

    .grid label.full {
      grid-column: 1 / -1;
    }

    input,
    select {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 9px 10px;
      font-size: 13px;
    }

    .actions {
      margin-top: 14px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .btn-secondary,
    .btn-primary {
      border: none;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      cursor: pointer;
    }

    .btn-secondary {
      background: #e2e8f0;
      color: #334155;
    }

    .btn-primary {
      background: #2563eb;
      color: #fff;
    }

    @media (max-width: 900px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class IhubComponent implements OnInit {
  assets: IhubAsset[] = [];
  responsiblePeople: IhubResponsiblePerson[] = [];

  showModal = false;
  editingId: number | null = null;
  isRunningCheck = false;

  form: IhubAsset = this.emptyForm();

  constructor(
    private router: Router,
    private ihubService: IhubService,
    private msalService: MsalService,
    private messageService: MessageService
  ) {}

  async ngOnInit(): Promise<void> {
    const role = (sessionStorage.getItem('role') || '').toLowerCase();
    if (role !== 'admin') {
      this.router.navigate(['/dashboard']);
      return;
    }

    await this.loadResponsiblePeople();
    await this.loadAssets();
  }

  async loadAssets(): Promise<void> {
    try {
      this.assets = await firstValueFrom(this.ihubService.getAssets());
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to load IHUB assets');
    }
  }

  async loadResponsiblePeople(): Promise<void> {
    const groupCandidates = ['cloudops@murai.com', 'cloudops@muraai.com'];
    try {
      const graphToken = await this.msalService.getAccessToken([
        'User.Read',
        'GroupMember.Read.All',
        'Group.Read.All'
      ]);
      let members: IhubResponsiblePerson[] = [];

      for (const groupMail of groupCandidates) {
        const result = await firstValueFrom(
          this.ihubService.getResponsiblePeople(groupMail, graphToken)
        );
        members = result?.members || [];
        if (members.length > 0) break;
      }

      if (members.length > 0) {
        this.responsiblePeople = members.sort((a, b) =>
          (a.displayName || a.email).localeCompare(b.displayName || b.email)
        );
        return;
      }

      const fallbackUsers = await firstValueFrom(this.ihubService.getAssignableUsersFallback());
      this.responsiblePeople = (fallbackUsers || []).map(u => ({
        email: u.email,
        displayName: u.email
      }));

      if (this.responsiblePeople.length > 0) {
        this.messageService.error('CloudOps group has no members in Graph. Showing app users as fallback.');
      } else {
        this.messageService.error('No responsible users found.');
      }
    } catch {
      try {
        const fallbackUsers = await firstValueFrom(this.ihubService.getAssignableUsersFallback());
        this.responsiblePeople = (fallbackUsers || []).map(u => ({
          email: u.email,
          displayName: u.email
        }));
        if (this.responsiblePeople.length > 0) {
          this.messageService.error('Graph group lookup failed. Showing app users as fallback.');
        } else {
          this.messageService.error('Failed to load responsible users.');
        }
      } catch {
        this.responsiblePeople = [];
        this.messageService.error('Failed to load responsible users.');
      }
    }
  }

  openAddModal(): void {
    this.editingId = null;
    this.form = this.emptyForm();
    this.showModal = true;
  }

  openEditModal(item: IhubAsset): void {
    this.editingId = item.id || null;
    this.form = {
      ...item,
      license_expiry: (item.license_expiry || '').slice(0, 10)
    };
    this.showModal = true;
  }

  closeModal(): void {
    this.showModal = false;
  }

  onResponsibleChanged(): void {
    const selected = this.responsiblePeople.find(
      p => p.email === this.form.responsible_person_email
    );
    this.form.responsible_person_name = selected?.displayName || '';
  }

  async runExpiryCheck(): Promise<void> {
    this.isRunningCheck = true;
    try {
      await firstValueFrom(this.ihubService.runExpiryCheck());
      this.messageService.success('Expiry check completed. New alert tickets have been generated if applicable.');
      await this.loadAssets();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Expiry check failed');
    } finally {
      this.isRunningCheck = false;
    }
  }

  async deleteAsset(item: IhubAsset): Promise<void> {
    if (!item.id) return;

    const confirmed = window.confirm(`Delete IHUB record for ${item.client} (${item.hostname})?`);
    if (!confirmed) return;

    try {
      await firstValueFrom(this.ihubService.deleteAsset(item.id));
      this.messageService.success('IHUB details deleted');
      await this.loadAssets();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to delete IHUB details');
    }
  }

  async save(): Promise<void> {
    if (!this.isFormValid()) {
      this.messageService.error('Please fill all required fields');
      return;
    }

    try {
      if (this.editingId) {
        await firstValueFrom(this.ihubService.updateAsset(this.editingId, this.form));
        this.messageService.success('IHUB details updated');
      } else {
        await firstValueFrom(this.ihubService.createAsset(this.form));
        this.messageService.success('IHUB details added');
      }

      this.showModal = false;
      await this.loadAssets();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to save IHUB details');
    }
  }

  expiryClass(days?: number): string {
    if (typeof days !== 'number') return 'safe';
    if (days <= 7) return 'alert';
    if (days <= 30) return 'warn';
    return 'safe';
  }

  expiryLabel(days?: number): string {
    if (typeof days !== 'number') return 'N/A';
    if (days < 0) return `Expired ${Math.abs(days)}d ago`;
    return `${days}d left`;
  }

  private isFormValid(): boolean {
    return !!(
      this.form.client?.trim() &&
      this.form.environment?.trim() &&
      this.form.license_expiry?.trim() &&
      this.form.responsible_person_email?.trim()
    );
  }

  private emptyForm(): IhubAsset {
    return {
      client: '',
      environment: '',
      hostname: '',
      ip_address: '',
      ihub_version: '',
      license_expiry: '',
      responsible_person_email: '',
      responsible_person_name: ''
    };
  }
}
