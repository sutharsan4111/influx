import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { TicketService } from '../services/ticket.service';
import { LoadingService } from '../services/loading.service';
import { MessageService } from '../services/message.service';
import { AssignmentService } from '../services/assignment.service';
import { Router } from '@angular/router';
import { MsalService } from '../services/msal.service';

@Component({
  selector: 'app-create-ticket',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="create-page">
      <!-- Page Header -->
      <div class="page-header">
        <div class="header-content">
          <div class="header-icon">
            <i class="fas fa-plus-circle"></i>
          </div>
          <div class="header-text">
            <h1>Create New Ticket</h1>
            <p>Fill in the details below to submit a support request</p>
          </div>
        </div>
      </div>

      <form #ticketForm="ngForm" (ngSubmit)="onSubmit()" class="create-form">

        <!-- Contact Information Card -->
        <div class="card">
          <div class="card-header">
            <i class="fas fa-user"></i>
            <h2>Contact Information</h2>
          </div>
          <div class="card-body">
            <div class="grid">
              <div class="form-group">
                <label for="name">
                  <i class="fas fa-user-circle"></i>
                  Contact Name <span class="required-star">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  [(ngModel)]="formData.name"
                  placeholder="Your full name"
                  readonly
                  required
                />
              </div>

              <div class="form-group">
                <label for="email">
                  <i class="fas fa-envelope"></i>
                  Email Address <span class="required-star">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  [(ngModel)]="formData.email"
                  placeholder="your.email@company.com"
                  readonly
                  required
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Ticket Details Card -->
        <div class="card">
          <div class="card-header">
            <i class="fas fa-ticket-alt"></i>
            <h2>Ticket Details</h2>
          </div>
          <div class="card-body">
            <div class="form-group full-width">
              <label for="subject">
                <i class="fas fa-heading"></i>
                Subject <span class="required-star">*</span>
              </label>
              <input
                type="text"
                id="subject"
                name="subject"
                [(ngModel)]="formData.subject"
                placeholder="Brief summary of your issue"
                required
              />
            </div>

            <div class="grid">
              <div class="form-group">
                <label for="departmentId">
                  <i class="fas fa-building"></i>
                  Department <span class="required-star">*</span>
                </label>
                <select
                  id="departmentId"
                  name="departmentId"
                  [(ngModel)]="formData.departmentId"
                  required
                >
                  <option *ngFor="let dept of departments" [value]="dept.id" [disabled]="dept.name !== 'ITSM'">
                    {{ dept.name }}
                  </option>
                </select>
              </div>

              <div class="form-group">
                <label for="issueCategory">
                  <i class="fas fa-folder"></i>
                  Issue Category <span class="required-star">*</span>
                </label>
                <select
                  id="issueCategory"
                  name="issueCategory"
                  [(ngModel)]="formData.issueCategory"
                  (ngModelChange)="onIssueCategoryChange($event)"
                  required
                >
                  <option value="">Select a category</option>
                  <option *ngFor="let cat of issueCategories" [value]="cat">{{ cat }}</option>
                </select>
              </div>

              <div class="form-group">
                <label for="priority">
                  <i class="fas fa-flag"></i>
                  Priority Level <span class="required-star">*</span>
                </label>
                <select
                  id="priority"
                  name="priority"
                  [(ngModel)]="formData.priority"
                  (change)="onPriorityChange()"
                  required
                >
                  <option value="">Select priority</option>
                  <option value="Critical">🔴 Critical</option>
                  <option value="High">🟠 High</option>
                  <option value="Medium">🟡 Medium</option>
                  <option value="Low">🟢 Low</option>
                </select>

                <button type="button" class="sla-toggle" (click)="toggleSla()">
                  <i class="fas" [class.fa-eye]="!showSla" [class.fa-eye-slash]="showSla"></i>
                  {{ showSla ? 'Hide Critical targets' : 'View Critical targets' }}
                </button>

                <div class="sla-note" *ngIf="showSla">
                  <div class="sla-title">
                    <i class="fas fa-clock"></i>
                    Critical Response Times
                  </div>
                  <div class="sla-grid">
                    <div class="sla-item critical">
                      <span class="sla-label">Critical</span>
                      <span class="sla-value">Response: 15 mins | Resolution: 2 hours</span>
                    </div>
                    <div class="sla-item high">
                      <span class="sla-label">High</span>
                      <span class="sla-value">Response: 30 mins | Resolution: 4 hours</span>
                    </div>
                    <div class="sla-item medium">
                      <span class="sla-label">Medium</span>
                      <span class="sla-value">Response: 2 hours | Resolution: 8 hours</span>
                    </div>
                    <div class="sla-item low">
                      <span class="sla-label">Low</span>
                      <span class="sla-value">Response: 2 hours | Resolution: 24-48 hours</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="form-group">
                <label for="assigneeId">
                  <i class="fas fa-user-tag"></i>
                  Assign To (Optional)
                </label>
                <div class="assignee-picker">
                  <input
                    type="text"
                    id="assigneeSearch"
                    name="assigneeSearch"
                    [(ngModel)]="assigneeSearchTerm"
                    (input)="onAssigneeSearchChange()"
                    (focus)="showAssigneeDropdown = true"
                    placeholder="Search for a user..."
                    autocomplete="off"
                  />
                  <div class="selected-assignee" *ngIf="formData.assigneeEmail && !assigneeSearchTerm">
                    <span class="assignee-badge">
                      <i class="fas fa-user-check"></i>
                      {{ getSelectedAssigneeName() }}
                    </span>
                    <button type="button" class="clear-btn" (click)="clearAssignee()">
                      <i class="fas fa-times"></i>
                    </button>
                  </div>
                  <div class="assignee-dropdown" *ngIf="showAssigneeDropdown && filteredOrgUsers.length > 0">
                    <div 
                      class="assignee-option" 
                      *ngFor="let user of filteredOrgUsers" 
                      (click)="selectAssignee(user)"
                    >
                      <div class="user-avatar">{{ (user.displayName || 'U').charAt(0).toUpperCase() }}</div>
                      <div class="user-info">
                        <span class="user-name">{{ user.displayName || user.email }}</span>
                        <span class="user-email">{{ user.email }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="assignee-dropdown" *ngIf="showAssigneeDropdown && assigneeSearchTerm && filteredOrgUsers.length === 0">
                    <div class="no-results">No users found</div>
                  </div>
                  <div class="loading-users" *ngIf="loadingOrgUsers">
                    <i class="fas fa-spinner fa-spin"></i> Loading users...
                  </div>
                </div>
                <small class="hint">
                  <i class="fas fa-info-circle"></i>
                  Leave blank for auto-assignment
                </small>
              </div>
            </div>
          </div>
        </div>

        <!-- Description Card -->
        <div class="card">
          <div class="card-header">
            <i class="fas fa-align-left"></i>
            <h2>Description & Attachments</h2>
          </div>
          <div class="card-body">
            <div class="form-group">
              <label for="description">
                <i class="fas fa-file-alt"></i>
                Detailed Description <span class="required-star">*</span>
              </label>
              <textarea
                id="description"
                name="description"
                [(ngModel)]="formData.description"
                placeholder="Please provide as much detail as possible about your issue..."
                rows="6"
                required
              ></textarea>
            </div>

            <div class="form-group">
              <label for="attachments">
                <i class="fas fa-paperclip"></i>
                Attachments
              </label>
              <div class="file-upload-area">
                <input
                  type="file"
                  id="attachments"
                  name="attachments"
                  (change)="onFilesSelected($event)"
                  multiple
                  class="file-input"
                />
                <label for="attachments" class="file-label">
                  <i class="fas fa-cloud-upload-alt"></i>
                  <span>Drop files here or click to browse</span>
                  <small>Supports multiple files</small>
                </label>
              </div>

              <div class="file-list" *ngIf="attachments.length">
                <div class="file-item" *ngFor="let file of attachments; let i = index">
                  <div class="file-info">
                    <i class="fas fa-file"></i>
                    <span>{{ file.name }}</span>
                    <span class="file-size">({{ formatFileSize(file.size) }})</span>
                  </div>
                  <button type="button" class="file-remove" (click)="removeAttachment(i)">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button
            type="submit"
            class="submit-btn"
            [disabled]="!ticketForm.valid || isSubmitting"
          >
            <i class="fas fa-paper-plane"></i>
            Create Ticket
          </button>
        </div>

      </form>
    </div>
  `,
  styles: [`
    :host { display: block; }
    
    .create-page { 
      max-width: 900px; 
      margin: 0 auto; 
      padding: 0; 
      width: 100%; 
    }

    /* Page Header - Compact */
    .page-header {
      background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      color: white;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .header-icon {
      width: 42px;
      height: 42px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .header-text h1 {
      font-size: 1.15rem;
      font-weight: 700;
      margin: 0 0 2px 0;
    }

    .header-text p {
      margin: 0;
      opacity: 0.9;
      font-size: 0.8rem;
    }

    .create-form { display: grid; gap: 14px; }
    
    /* Card Styles - Compact */
    .card { 
      background: white; 
      border: 1px solid #e2e8f0; 
      border-radius: 10px; 
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-bottom: 1px solid #e2e8f0;
    }

    .card-header i {
      font-size: 14px;
      color: #3b82f6;
    }

    .card-header h2 {
      margin: 0;
      font-size: 0.85rem;
      font-weight: 600;
      color: #1e293b;
    }

    .card-body {
      padding: 14px;
    }

    .grid { 
      display: grid; 
      gap: 14px; 
      grid-template-columns: repeat(2, minmax(0, 1fr)); 
    }

    .required-star {
      color: #ef4444;
      font-weight: 700;
      margin-left: 2px;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    .form-group { 
      display: flex; 
      flex-direction: column; 
      gap: 4px; 
    }

    label { 
      font-size: 0.75rem; 
      color: #374151; 
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    label i {
      color: #64748b;
      font-size: 11px;
    }

    input, select, textarea {
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 0.8rem;
      outline: none;
      transition: all 0.2s ease;
      background: white;
    }

    input[readonly] {
      background: #f8fafc;
      color: #64748b;
      cursor: not-allowed;
    }

    input:focus, select:focus, textarea:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }

    textarea { 
      resize: vertical; 
      min-height: 100px;
    }

    .hint { 
      color: #64748b; 
      font-size: 0.7rem;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .hint i {
      font-size: 10px;
    }

    /* Assignee Picker Styles - Compact */
    .assignee-picker {
      position: relative;
      overflow: visible !important;
    }

    .assignee-picker input {
      width: 100%;
      min-height: 42px;
      padding-right: 42px;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    .assignee-picker input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
      background: #fff;
    }

    .selected-assignee {
      position: absolute;
      top: 50%;
      left: 12px;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      max-width: calc(100% - 48px);
      pointer-events: none;
    }

    .assignee-badge {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      padding: 5px 10px;
      border-radius: 999px;
      font-size: 0.72rem;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 220px;
    }

    .clear-btn {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      color: #1d4ed8;
      border-radius: 999px;
      width: 22px;
      height: 22px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      transition: all 0.2s;
      pointer-events: auto;
    }

    .clear-btn:hover {
      background: #dbeafe;
      border-color: #93c5fd;
    }

    .assignee-dropdown {
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      margin-top: 6px;
      max-height: 300px;
      overflow-y: auto;
      z-index: 9999;
      box-shadow: 0 16px 30px rgba(15, 23, 42, 0.12);
    }

    .assignee-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
    }

    .assignee-option:hover {
      background: #eff6ff;
    }

    .user-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 12px;
      flex-shrink: 0;
    }

    .user-info {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .user-name {
      font-weight: 600;
      color: #1e293b;
      font-size: 0.8rem;
    }

    .user-email {
      color: #64748b;
      font-size: 0.72rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .no-results {
      padding: 12px;
      color: #64748b;
      text-align: center;
      font-size: 0.78rem;
    }

    .loading-users {
      padding: 10px 12px;
      color: #3b82f6;
      font-size: 0.78rem;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .sla-toggle {
      align-self: flex-start;
      margin-top: 8px;
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 1px solid #bfdbfe;
      color: #2563eb;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      padding: 6px 12px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .sla-toggle:hover {
      background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
    }

    .sla-note {
      margin-top: 10px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px;
    }

    .sla-title { 
      font-weight: 600; 
      color: #1e293b; 
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.8rem;
    }

    .sla-title i {
      color: #3b82f6;
      font-size: 12px;
    }

    .sla-grid {
      display: grid;
      gap: 6px;
    }

    .sla-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      background: white;
      border-left: 3px solid;
    }

    .sla-item.critical {
      border-color: #dc2626;
    }

    .sla-item.high {
      border-color: #ea580c;
    }

    .sla-item.medium {
      border-color: #f59e0b;
    }

    .sla-item.low {
      border-color: #22c55e;
    }

    .sla-label {
      font-weight: 600;
      font-size: 0.7rem;
      width: 55px;
    }

    .sla-item.critical .sla-label { color: #dc2626; }
    .sla-item.high .sla-label { color: #ea580c; }
    .sla-item.medium .sla-label { color: #f59e0b; }
    .sla-item.low .sla-label { color: #22c55e; }

    .sla-value {
      font-size: 0.7rem;
      color: #64748b;
    }

    /* File Upload - Compact */
    .file-upload-area {
      position: relative;
    }

    .file-input {
      position: absolute;
      width: 100%;
      height: 100%;
      top: 0;
      left: 0;
      opacity: 0;
      cursor: pointer;
    }

    .file-label {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .file-label:hover {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .file-label i {
      font-size: 28px;
      color: #3b82f6;
    }

    .file-label span {
      font-weight: 600;
      color: #374151;
      font-size: 0.8rem;
    }

    .file-label small {
      color: #64748b;
      font-size: 0.7rem;
    }

    .file-list { 
      margin-top: 10px; 
      display: grid; 
      gap: 6px; 
    }

    .file-item { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
      padding: 8px 12px;
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border-radius: 6px;
      border: 1px solid #e2e8f0;
    }

    .file-info {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #374151;
      font-size: 0.75rem;
    }

    .file-info i {
      color: #3b82f6;
      font-size: 14px;
    }

    .file-size {
      color: #64748b;
    }

    .file-remove { 
      background: #fef2f2; 
      border: none;
      border-radius: 4px;
      width: 24px;
      height: 24px;
      color: #dc2626; 
      cursor: pointer; 
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      font-size: 12px;
    }

    .file-remove:hover {
      background: #fee2e2;
    }

    .form-actions { 
      display: flex; 
      justify-content: flex-end; 
      padding-top: 8px;
    }

    .submit-btn {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 10px 24px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
      transition: all 0.2s ease;
    }

    .submit-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.35);
    }

    .submit-btn:disabled { 
      background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%);
      cursor: not-allowed;
      box-shadow: none;
    }

    @media (max-width: 900px) {
      .grid { grid-template-columns: 1fr; }
      .header-content { flex-direction: column; text-align: center; }
    }

    /* Dark Theme */
    :host-context(.dark-theme) .page-header {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
    }

    :host-context(.dark-theme) .card {
      background: #0f172a;
      border-color: #1e293b;
    }

    :host-context(.dark-theme) .card-header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-bottom-color: #334155;
    }

    :host-context(.dark-theme) .card-header h2 {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) label {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) label i {
      color: #94a3b8;
    }

    :host-context(.dark-theme) input,
    :host-context(.dark-theme) select,
    :host-context(.dark-theme) textarea {
      background: #1e293b;
      color: #e2e8f0;
      border-color: #334155;
    }

    :host-context(.dark-theme) input::placeholder,
    :host-context(.dark-theme) textarea::placeholder {
      color: #64748b;
    }

    :host-context(.dark-theme) input[readonly] {
      background: #0f172a;
      color: #94a3b8;
    }

    :host-context(.dark-theme) .sla-toggle {
      background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%);
      border-color: #1e40af;
      color: #93c5fd;
    }

    :host-context(.dark-theme) .sla-note {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-color: #334155;
    }

    :host-context(.dark-theme) .sla-title {
      color: #f1f5f9;
    }

    :host-context(.dark-theme) .sla-item {
      background: #1e293b;
    }

    :host-context(.dark-theme) .file-label {
      background: #1e293b;
      border-color: #334155;
    }

    :host-context(.dark-theme) .file-label:hover {
      background: #334155;
      border-color: #3b82f6;
    }

    :host-context(.dark-theme) .file-label span {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .file-item {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-color: #334155;
    }

    :host-context(.dark-theme) .file-info {
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .hint {
      color: #94a3b8;
    }
  `]
})
export class CreateTicketComponent implements OnInit {

  showSla = false;
  attachments: File[] = [];

  formData = {
    subject: '',
    name: '',
    email: '',
    issueCategory: '',
    departmentId: '132475000009937630',
    assigneeEmail: '',
    priority: '',
    description: ''
  };

  // MSAL Org Users for Assignment
  orgUsers: { email: string; displayName: string }[] = [];
  filteredOrgUsers: { email: string; displayName: string }[] = [];
  assigneeSearchTerm = '';
  showAssigneeDropdown = false;
  loadingOrgUsers = false;
  isSubmitting = false;

  issueCategories = [
    'Deployment',
    'Access Related',
    'Server Configuration',
    'Database',
    'Laptops',
    'Production Issue',
    'Production Deployment',
    'Other'
  ];

  private priorityDefaults: Record<string, string> = {
    Deployment: 'Medium',
    'Access Related': 'Medium',
    'Server Configuration': 'Low',
    Database: 'Medium',
    Laptops: 'Medium',
    'Laptops issue': 'Medium',
    Other: 'High',
    'Production Issue': 'Critical',
    'Production Deployment': 'Medium'
  };

  private priorityTouched = false;

  departments = [
    { id: '132475000009937630', name: 'ITSM' },
    { id: '132475000009948173', name: 'Support - Coming Soon... ' },
    { id: '132475000009958716', name: 'Products - Coming Soon...' },
    { id: '132475000009925079', name: 'HR - Coming Soon...' }
  ];

  constructor(
    private ticketService: TicketService,
    private loadingService: LoadingService,
    private messageService: MessageService,
    private assignmentService: AssignmentService,
    private router: Router,
    private msalService: MsalService,
    private http: HttpClient
  ) {}

  async ngOnInit(): Promise<void> {
    const storedEmail = sessionStorage.getItem('username') || '';
    const storedName = sessionStorage.getItem('displayName') || '';
    if (storedEmail) this.formData.email = storedEmail;
    if (storedName) this.formData.name = storedName;

    await this.tryLoadMicrosoftProfile();
    this.loadOrgUsers();

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.assignee-picker')) {
        this.showAssigneeDropdown = false;
      }
    });
  }

  async loadOrgUsers(): Promise<void> {
    this.loadingOrgUsers = true;
    try {
      this.orgUsers = await this.msalService.getOrganizationUsers();
      this.orgUsers.sort((a, b) => a.displayName.localeCompare(b.displayName));
      this.filteredOrgUsers = this.orgUsers.slice(0, 20);
    } catch (err) {
      console.error('Failed to load org users:', err);
    } finally {
      this.loadingOrgUsers = false;
    }
  }

  onAssigneeSearchChange(): void {
    this.showAssigneeDropdown = true;
    const term = this.assigneeSearchTerm.toLowerCase().trim();
    if (!term) {
      this.filteredOrgUsers = this.orgUsers.slice(0, 20);
      return;
    }
    this.filteredOrgUsers = this.orgUsers
      .filter(u => u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      .slice(0, 20);
  }

  selectAssignee(user: { email: string; displayName: string }): void {
    this.formData.assigneeEmail = user.email;
    this.assigneeSearchTerm = '';
    this.showAssigneeDropdown = false;
  }

  clearAssignee(): void {
    this.formData.assigneeEmail = '';
    this.assigneeSearchTerm = '';
  }

  getSelectedAssigneeName(): string {
    const user = this.orgUsers.find(u => u.email === this.formData.assigneeEmail);
    return user ? `${user.displayName}` : this.formData.assigneeEmail;
  }

  onIssueCategoryChange(category: string): void {
    const defaultPriority = this.priorityDefaults[category];
    if (defaultPriority) {
      this.formData.priority = defaultPriority;
      this.priorityTouched = false;
    }
  }

  onPriorityChange(): void {
    this.priorityTouched = true;
  }

  toggleSla(): void {
    this.showSla = !this.showSla;
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.attachments = [...this.attachments, ...files];
    input.value = '';
  }

  removeAttachment(index: number): void {
    this.attachments.splice(index, 1);
  }

  formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private async tryLoadMicrosoftProfile(): Promise<void> {
    const account = this.msalService.getAccount();
    if (!account) return;

    try {
      const token = await this.msalService.getAccessToken(['User.Read']);
      const response = await fetch(
        'https://graph.microsoft.com/v1.0/me?$select=mail,displayName,department',
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (!response.ok) return;

      const data = await response.json();

      if (data?.mail) this.formData.email = data.mail;
      if (data?.displayName) this.formData.name = data.displayName;
      // Keep default department (ITSM) from hardcoded list
    } catch (error) {
      console.warn('Failed to load Microsoft profile', error);
    }
  }

  onSubmit(): void {
    if (this.isSubmitting) return; // Prevent duplicate submissions
    
    this.isSubmitting = true;
    const hasAttachments = this.attachments.length > 0;
    const assigneeEmailToSave = this.formData.assigneeEmail; // Save for Supabase assignment

    // Create ticket WITHOUT assigneeEmail (Zoho only accepts registered agents)
    const ticket = hasAttachments
      ? (() => {
          const fd = new FormData();
          fd.append('subject', this.formData.subject);
          fd.append('departmentId', this.formData.departmentId);
          fd.append('category', this.formData.issueCategory);
          fd.append('priority', this.formData.priority);
          fd.append('description', this.formData.description);
          fd.append('status', 'Open');
          fd.append('name', this.formData.name);
          fd.append('email', this.formData.email);
          // Don't send assigneeEmail to Zoho - will save to Supabase instead
          this.attachments.forEach(file => fd.append('attachments', file));
          return fd;
        })()
      : {
          subject: this.formData.subject,
          departmentId: this.formData.departmentId,
          // Don't send assigneeEmail to Zoho - will save to Supabase instead
          contact: {
            lastName: this.formData.name,
            email: this.formData.email
          },
          category: this.formData.issueCategory,
          description: this.formData.description,
          priority: this.formData.priority,
          status: 'Open'
        };

    this.loadingService.show();

    this.ticketService.createTicket(ticket).subscribe({
      next: (response: any) => {
        this.isSubmitting = false;
        if (response?.errorCode || response?.message?.includes('error')) {
          this.messageService.error(response?.message || 'Failed to create ticket');
          this.loadingService.hide();
          return;
        }

        // Get the created ticket ID
        const ticketId = response?.id || response?.ticketNumber || response?.data?.id;

        // Save assignment to Supabase if user selected an assignee
        if (assigneeEmailToSave && ticketId) {
          const normalizedCategory = (this.formData.issueCategory || '').trim();
          this.assignmentService.assignTicket({
            zoho_ticket_id: ticketId,
            zoho_ticket_number: response?.ticketNumber || response?.number,
            assigned_users: [assigneeEmailToSave],
            assigned_by: this.formData.email,
            ...(normalizedCategory ? { category: normalizedCategory } : {})
          }).subscribe({
            next: () => {
              console.log('Assignment saved to Supabase');
            },
            error: (err) => {
              console.warn('Failed to save assignment:', err);
            }
          });
        }

        if (response?.warning) {
          this.messageService.error(response.warning);
        } else {
          this.messageService.success('Ticket created successfully!');
        }

        this.formData = {
          subject: '',
          name: '',
          email: '',
          issueCategory: '',
          departmentId: '132475000009937630',
          assigneeEmail: '',
          priority: '',
          description: ''
        };
        this.priorityTouched = false;
        this.attachments = [];

        // Ensure tickets list and dashboard counts reflect the new ticket immediately.
        this.ticketService.clearAllCache();
        this.ticketService.invalidateTabCache();

        this.loadingService.hide();
        this.router.navigate(['/tickets']);
      },
      error: (error: any) => {
        this.isSubmitting = false;
        console.error('Error creating ticket:', error);
        const details = error?.error?.details
          ? ` (${JSON.stringify(error.error.details)})`
          : '';
        this.messageService.error(
          (error?.error?.message || error?.message || 'Failed to create ticket') + details
        );
        this.loadingService.hide();
      }
    });
  }

}