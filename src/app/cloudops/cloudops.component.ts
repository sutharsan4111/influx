import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MsalService } from '../services/msal.service';
import { MessageService } from '../services/message.service';
import {
  CloudOpsService,
  CloudOpsManager,
  CloudOpsEmployee,
  CloudOpsProject,
  CloudOpsTask,
  CloudOpsMember
} from '../services/cloudops.service';

@Component({
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="cloudops-page">
      <!-- LEFT PANEL: Employee Hierarchy -->
      <div class="left-panel">
        <div class="panel-title">
          <i class="fas fa-users"></i> Team
        </div>
        <div class="panel-error" *ngIf="teamLoadError">
          <i class="fas fa-triangle-exclamation"></i> {{ teamLoadError }}
        </div>
        <div class="hierarchy">
          <div class="manager-card" *ngIf="manager" (click)="selectEmployee(manager)" [class.active]="selectedEmployee?.email === manager.email">
            <div class="avatar manager-avatar">
              <i class="fas fa-user-tie"></i>
            </div>
            <div class="emp-info">
              <div class="emp-name">{{ manager.displayName || manager.email }}</div>
              <div class="emp-role">{{ manager.jobTitle || 'Manager - Managed Services' }}</div>
              <div class="emp-dept">{{ manager.department || 'Services - Managed Services' }}</div>
            </div>
          </div>
          <div class="empty-hint" *ngIf="!manager">No manager found for this team</div>

          <div class="divider"></div>

          <div class="emp-list-label">Team Members ({{ employees.length }})</div>
          <div class="employee-list">
            <div class="employee-card"
                 *ngFor="let emp of employees"
                 (click)="selectEmployee(emp)"
                 [class.active]="selectedEmployee?.email === emp.email">
              <div class="avatar">{{ (emp.displayName || emp.email)[0] }}</div>
              <div class="emp-info">
                <div class="emp-name">{{ emp.displayName || emp.email }}</div>
                <div class="emp-meta">{{ emp.project_count }} projects · {{ emp.task_count }} tasks</div>
              </div>
            </div>
            <div class="empty-hint" *ngIf="employees.length === 0">No team members found</div>
          </div>
        </div>
      </div>

      <!-- MAIN CONTENT -->
      <div class="main-content">
        <!-- Employee Detail View -->
        <div class="employee-detail" *ngIf="selectedEmployeeView">
          <button class="back-btn" (click)="clearEmployeeView()"><i class="fas fa-arrow-left"></i> Back</button>
          <div class="emp-header">
            <div class="avatar lg">{{ (selectedEmployeeView.displayName || selectedEmployeeView.email)[0] }}</div>
            <div>
              <h2>{{ selectedEmployeeView.displayName || selectedEmployeeView.email }}</h2>
              <p class="text-muted">{{ selectedEmployeeView.email }}</p>
            </div>
          </div>

          <div class="section">
            <h3><i class="fas fa-folder-open"></i> Projects ({{ employeeProjects.length }})</h3>
            <div class="project-mini-list">
              <div class="project-mini-card" *ngFor="let p of employeeProjects" (click)="viewProject(p)">
                <div class="mini-name">{{ p.name }}</div>
                <span class="status-badge" [ngClass]="statusClass(p.status)">{{ p.status }}</span>
              </div>
              <div class="empty-hint" *ngIf="employeeProjects.length === 0">No projects assigned</div>
            </div>
          </div>

          <div class="section">
            <h3><i class="fas fa-tasks"></i> Tasks ({{ employeeTasks.length }})</h3>
            <div class="task-mini-list">
              <div class="task-mini-card" *ngFor="let t of employeeTasks">
                <div class="mini-name">{{ t.name }}</div>
                <div class="mini-project">{{ t.project_name }}</div>
                <span class="status-badge" [ngClass]="statusClass(t.status)">{{ t.status }}</span>
              </div>
              <div class="empty-hint" *ngIf="employeeTasks.length === 0">No tasks assigned</div>
            </div>
          </div>
        </div>

        <!-- Projects Grid View -->
        <ng-container *ngIf="!selectedEmployeeView">
          <div class="projects-header">
            <h2>{{ sidebarTitle }}</h2>
          </div>

          <div class="projects-grid">
            <div class="project-card" *ngFor="let project of projects" (click)="viewProject(project)">
              <div class="card-header">
                <h3>{{ project.name }}</h3>
                <select class="status-select sm" [ngClass]="statusClass(project.status)"
                        [ngModel]="project.status"
                        (ngModelChange)="changeProjectStatus($event, project)"
                        (click)="$event.stopPropagation()"
                        title="Change project status">
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Testing">Testing</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>
              <div class="card-desc" *ngIf="project.description">{{ project.description }}</div>
              <div class="card-meta">
                <div class="meta-item" *ngIf="project.owner_name || project.owner_email">
                  <i class="fas fa-user-tie"></i> {{ project.owner_name || project.owner_email }}
                </div>
                <div class="meta-item">
                  <i class="fas fa-tasks"></i> {{ (project.tasks || []).length }} tasks
                </div>
                <div class="meta-item">
                  <i class="fas fa-users"></i> {{ (project.members || []).length }} members
                </div>
              </div>
              <div class="card-progress">
                <div class="progress-bar">
                  <div class="progress-fill" [style.width.%]="projectProgress(project)"></div>
                </div>
                <span class="progress-label">{{ projectProgress(project) }}%</span>
              </div>
              <div class="card-members">
                <div class="member-chip" *ngFor="let m of (project.members || []).slice(0, 5)" [title]="memberName(m)">
                  {{ memberInitial(m) }}
                </div>
                <span class="more-members" *ngIf="(project.members || []).length > 5">+{{ (project.members || []).length - 5 }}</span>
              </div>
            </div>
            <div class="empty-state" *ngIf="projects.length === 0">
              <i class="fas fa-folder-open"></i>
              <p>No projects found. Create one to get started!</p>
            </div>
          </div>
        </ng-container>
      </div>

      <!-- RIGHT SIDEBAR -->
      <div class="right-sidebar">
        <div class="sidebar-section-title">Projects</div>
        <button class="nav-btn primary" (click)="openCreateProjectModal()">
          <i class="fas fa-plus"></i> Create New Project
        </button>
        <div class="nav-list">
          <div class="nav-item" [class.active]="selectedFilter === 'all'" (click)="filterProjects('all')">
            <i class="fas fa-list"></i> All Projects
          </div>
          <div class="nav-item" [class.active]="selectedFilter === 'open'" (click)="filterProjects('open')">
            <i class="fas fa-folder-open"></i> Open Projects
          </div>
          <div class="nav-item" [class.active]="selectedFilter === 'in progress'" (click)="filterProjects('in progress')">
            <i class="fas fa-spinner"></i> In Progress
          </div>
          <div class="nav-item" [class.active]="selectedFilter === 'testing'" (click)="filterProjects('testing')">
            <i class="fas fa-vial"></i> Testing
          </div>
          <div class="nav-item" [class.active]="selectedFilter === 'closed'" (click)="filterProjects('closed')">
            <i class="fas fa-check-circle"></i> Completed
          </div>
        </div>
      </div>
    </div>

    <!-- CREATE / EDIT PROJECT MODAL -->
    <div class="modal-backdrop" *ngIf="showProjectModal" (click)="closeProjectModal()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>{{ editingProjectId ? 'Edit Project' : 'Create New Project' }}</h3>
          <button class="icon-close" (click)="closeProjectModal()">✕</button>
        </div>
        <div class="modal-body">
          <label>Project Name *</label>
          <input [(ngModel)]="projectForm.name" placeholder="e.g. Referral Application" />

          <label>Description</label>
          <textarea [(ngModel)]="projectForm.description" rows="3" placeholder="Project description"></textarea>

          <ng-container *ngIf="!editingProjectId">
            <label>Status</label>
            <select [(ngModel)]="projectForm.status">
              <option value="Open">Open</option>
              <option value="In Progress">In Progress</option>
              <option value="Testing">Testing</option>
              <option value="Closed">Closed</option>
            </select>

            <label>Project Owner *</label>
            <select [(ngModel)]="projectForm.ownerEmail">
              <option value="">Select project owner...</option>
              <option *ngFor="let m of teamMembers" [value]="m.email">{{ m.displayName || m.email }}</option>
            </select>
            <div class="empty-hint" *ngIf="teamMembers.length === 0">No team members available — check the CloudOps team configuration</div>

            <label>Team Members</label>
            <div class="member-checklist">
              <label class="member-check-item" *ngFor="let m of teamMembers">
                <input type="checkbox"
                       [checked]="isMemberSelected(m.email)"
                       (change)="toggleMemberSelection(m.email)" />
                {{ m.displayName || m.email }}
              </label>
              <div class="empty-hint" *ngIf="teamMembers.length === 0">No team members available to assign</div>
            </div>
          </ng-container>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" (click)="closeProjectModal()">Cancel</button>
          <button class="btn-primary" (click)="saveProject()">{{ editingProjectId ? 'Update' : 'Create' }}</button>
        </div>
      </div>
    </div>

    <!-- PROJECT DETAIL MODAL -->
    <div class="modal-backdrop project-detail-backdrop" *ngIf="showProjectDetail" (click)="closeProjectDetail()">
      <div class="modal-card project-detail-card" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>{{ selectedProject?.name }}</h3>
          <div class="header-actions">
            <button class="btn-icon" (click)="openEditProjectModal()" title="Edit Name/Description"><i class="fas fa-edit"></i></button>
            <button class="btn-icon danger" (click)="deleteCurrentProject()" title="Delete Project"><i class="fas fa-trash"></i></button>
            <button class="icon-close" (click)="closeProjectDetail()">✕</button>
          </div>
        </div>
        <div class="modal-body detail-layout">
          <!-- LEFT: Owner / Status / Team -->
          <div class="detail-sidebar">
            <div class="detail-field">
              <label>Project Owner</label>
              <select [ngModel]="selectedProject?.owner_email || ''" (ngModelChange)="changeProjectOwner($event)">
                <option value="">Unassigned</option>
                <option *ngFor="let m of teamMembers" [value]="m.email">{{ m.displayName || m.email }}</option>
              </select>
            </div>

            <div class="detail-field">
              <label>Status</label>
              <select class="status-select" [ngClass]="statusClass(selectedProject?.status || '')"
                      [ngModel]="selectedProject?.status"
                      (ngModelChange)="changeProjectStatus($event)"
                      title="Change project status">
                <option value="Open">Open</option>
                <option value="In Progress">In Progress</option>
                <option value="Testing">Testing</option>
                <option value="Closed">Closed</option>
              </select>
            </div>

            <div class="detail-field">
              <label>Team Members ({{ projectMembers.length }})</label>
              <div class="member-list">
                <div class="member-item" *ngFor="let m of projectMembers">
                  <div class="avatar sm">{{ memberInitial(m) }}</div>
                  <span>{{ memberName(m) }}</span>
                  <button class="btn-remove-sm" (click)="removeProjectMember(m)" title="Remove">✕</button>
                </div>
                <div class="empty-hint" *ngIf="projectMembers.length === 0">No members assigned</div>
              </div>
              <div class="add-member-row">
                <select [(ngModel)]="newMemberEmail" class="member-select">
                  <option value="">Select team member...</option>
                  <option *ngFor="let m of teamMembers" [value]="m.email">{{ m.displayName || m.email }}</option>
                </select>
                <button class="btn-sm" (click)="addProjectMember()" [disabled]="!newMemberEmail">Add</button>
              </div>
            </div>
          </div>

          <!-- RIGHT: Description then Tasks -->
          <div class="detail-main">
            <div class="detail-section">
              <h4><i class="fas fa-info-circle"></i> Description</h4>
              <p class="detail-desc">{{ selectedProject?.description || 'No description' }}</p>
            </div>

            <div class="detail-section">
              <h4><i class="fas fa-tasks"></i> Tasks ({{ projectTasks.length }}) <span class="progress-hint">· {{ completedTaskCount }}/{{ projectTasks.length }} done</span></h4>

              <div class="add-task-row">
                <input [(ngModel)]="newTaskName" placeholder="Task name" class="task-input" (keyup.enter)="addTask()" />
                <button class="btn-sm" (click)="addTask()" [disabled]="!newTaskName.trim()">Add Task</button>
              </div>

              <div class="task-table-wrap">
                <table class="task-table">
                  <thead>
                    <tr>
                      <th class="col-sno">S.No</th>
                      <th>Task</th>
                      <th>Assignees</th>
                      <th class="col-status">Status</th>
                      <th class="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr *ngFor="let task of projectTasks; let i = index" [class.completed]="task.status === 'Closed'">
                      <td class="col-sno">{{ i + 1 }}</td>
                      <td>
                        <div class="task-name">{{ task.name }}</div>
                        <div class="task-meta" *ngIf="task.description">{{ task.description }}</div>
                      </td>
                      <td>
                        <div class="task-assignees">
                          <div class="mini-chip" *ngFor="let a of (task.assignees || [])" [title]="a.display_name || a.email">
                            {{ (a.display_name || a.email)[0] }}
                            <span class="chip-remove" (click)="removeTaskAssignee(task, a.email)">✕</span>
                          </div>
                          <select class="assignee-add" (change)="addTaskAssignee(task, $event)">
                            <option value="">+ assign</option>
                            <option *ngFor="let m of teamMembers" [value]="m.email">{{ m.displayName || m.email }}</option>
                          </select>
                        </div>
                      </td>
                      <td class="col-status">
                        <select class="status-select sm" [ngClass]="statusClass(task.status)"
                                [ngModel]="task.status"
                                (ngModelChange)="updateTaskStatus(task, $event)">
                          <option value="Open">Open</option>
                          <option value="In Progress">In Progress</option>
                          <option value="Testing">Testing</option>
                          <option value="Closed">Closed</option>
                        </select>
                      </td>
                      <td class="col-actions">
                        <button class="btn-icon sm" (click)="openEditTaskModal(task)" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn-icon sm danger" (click)="deleteTask(task)" title="Delete"><i class="fas fa-trash"></i></button>
                      </td>
                    </tr>
                    <tr *ngIf="projectTasks.length === 0">
                      <td colspan="5" class="empty-hint">No tasks yet. Add one above!</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- EDIT TASK MODAL -->
    <div class="modal-backdrop" *ngIf="showTaskModal" (click)="closeTaskModal()">
      <div class="modal-card" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h3>Edit Task</h3>
          <button class="icon-close" (click)="closeTaskModal()">✕</button>
        </div>
        <div class="modal-body">
          <label>Task Name *</label>
          <input [(ngModel)]="taskForm.name" />

          <label>Description</label>
          <textarea [(ngModel)]="taskForm.description" rows="2"></textarea>

          <label>Status</label>
          <select [(ngModel)]="taskForm.status">
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Testing">Testing</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" (click)="closeTaskModal()">Cancel</button>
          <button class="btn-primary" (click)="saveTask()">Update</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .cloudops-page {
      display: grid;
      grid-template-columns: 220px 1fr 180px;
      height: 100%;
      background: #f1f5f9;
      overflow: hidden;
    }

    /* LEFT PANEL */
    .left-panel {
      background: #fff;
      border-right: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    .left-panel::-webkit-scrollbar { display: none; width: 0; height: 0; }
    .panel-title {
      padding: 14px 14px 10px;
      font-weight: 700;
      font-size: 13px;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 6px;
      border-bottom: 1px solid #f1f5f9;
    }
    .panel-title i { color: #3b82f6; }

    .panel-error {
      margin: 8px 10px 0;
      padding: 8px 10px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      font-size: 10.5px;
      line-height: 1.4;
      color: #b91c1c;
      display: flex;
      gap: 6px;
      align-items: flex-start;
    }
    .panel-error i { margin-top: 1px; flex-shrink: 0; }

    .hierarchy { padding: 8px; }
    .manager-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 2px solid #bfdbfe;
    }
    .manager-card:hover, .manager-card.active {
      background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
    }
    .manager-avatar {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-size: 14px;
    }
    .emp-info { flex: 1; min-width: 0; }
    .emp-name { font-weight: 600; font-size: 12px; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .emp-role { font-size: 10px; color: #2563eb; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .emp-dept { font-size: 9px; color: #64748b; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .divider { height: 1px; background: #e2e8f0; margin: 10px 0; }
    .emp-list-label { font-size: 10px; font-weight: 600; color: #64748b; padding: 4px 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .employee-list { display: grid; gap: 2px; margin-top: 4px; }
    .employee-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 8px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .employee-card:hover, .employee-card.active { background: #f1f5f9; }
    .avatar {
      width: 28px; height: 28px; min-width: 28px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      font-weight: 600;
      font-size: 11px;
    }
    .avatar.lg { width: 44px; height: 44px; font-size: 18px; }
    .avatar.sm { width: 22px; height: 22px; min-width: 22px; font-size: 9px; }
    .emp-meta { font-size: 9px; color: #94a3b8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* MAIN CONTENT */
    .main-content {
      display: block;
      padding: 16px;
      overflow-y: auto;
      background: #f8fafc;
    }
    .projects-header {
      display: block;
      width: 100%;
      margin-bottom: 18px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    .projects-header h2 { margin: 0; color: #1e293b; font-size: 20px; line-height: 1.25; white-space: nowrap; }

    .projects-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
    }
    .project-card {
      background: #fff;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      padding: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 110px;
    }
    .project-card:hover {
      box-shadow: 0 4px 14px rgba(0,0,0,0.07);
      transform: translateY(-1px);
      border-color: #bfdbfe;
    }
    .card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; }
    .card-header h3 { margin: 0; font-size: 12.5px; color: #1e293b; }
    .card-desc { font-size: 10px; color: #64748b; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .card-meta { display: flex; gap: 10px; font-size: 9px; color: #94a3b8; flex-wrap: wrap; }
    .meta-item { display: flex; align-items: center; gap: 3px; }
    .meta-item i { font-size: 9px; }
    .card-progress { display: flex; align-items: center; gap: 6px; }
    .progress-bar { flex: 1; height: 3px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #2563eb); border-radius: 3px; transition: width 0.3s ease; }
    .progress-label { font-size: 9px; font-weight: 600; color: #475569; min-width: 26px; text-align: right; }
    .card-members { display: flex; gap: 3px; align-items: center; flex-wrap: wrap; margin-top: auto; }
    .member-chip {
      width: 18px; height: 18px;
      background: linear-gradient(135deg, #e2e8f0, #cbd5e1);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 600;
      color: #475569;
    }
    .more-members { font-size: 9px; color: #94a3b8; }

    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      color: #94a3b8;
    }
    .empty-state i { font-size: 48px; margin-bottom: 12px; opacity: 0.4; }
    .empty-state p { font-size: 13px; }
    .empty-hint { font-size: 11px; color: #94a3b8; padding: 8px; text-align: center; }

    /* RIGHT SIDEBAR */
    .right-sidebar {
      background: #fff;
      border-left: 1px solid #e2e8f0;
      padding: 14px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sidebar-section-title {
      font-weight: 700;
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 0 4px;
    }
    .nav-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      font-weight: 600;
      font-size: 11px;
      transition: all 0.2s;
      width: 100%;
      text-align: left;
    }
    .nav-btn.primary {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #fff;
    }
    .nav-btn.primary:hover { background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%); }
    .nav-list { display: grid; gap: 2px; }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 500;
      color: #475569;
      transition: all 0.2s;
    }
    .nav-item:hover { background: #f1f5f9; color: #1d4ed8; }
    .nav-item.active { background: #eff6ff; color: #2563eb; font-weight: 600; }
    .nav-item i { width: 14px; text-align: center; font-size: 11px; }

    /* STATUS BADGES */
    .status-badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 9px;
      font-weight: 600;
      white-space: nowrap;
    }
    .status-badge.lg { padding: 4px 12px; font-size: 11px; }
    .status-badge.open { background: #dbeafe; color: #1e40af; }
    .status-badge.in-progress { background: #fef3c7; color: #92400e; }
    .status-badge.testing { background: #f3e8ff; color: #6b21a8; }
    .status-badge.closed { background: #d1fae5; color: #065f46; }

    .status-select {
      border: none;
      border-radius: 10px;
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
    }
    .status-select.sm { padding: 2px 8px; font-size: 9px; border-radius: 8px; }
    .status-select.open { background: #dbeafe; color: #1e40af; }
    .status-select.in-progress { background: #fef3c7; color: #92400e; }
    .status-select.testing { background: #f3e8ff; color: #6b21a8; }
    .status-select.closed { background: #d1fae5; color: #065f46; }

    /* EMPLOYEE DETAIL */
    .employee-detail { max-width: 700px; }
    .back-btn {
      border: none; background: none; cursor: pointer;
      font-size: 12px; color: #3b82f6; font-weight: 500;
      display: flex; align-items: center; gap: 4px;
      margin-bottom: 12px; padding: 0;
    }
    .emp-header { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .emp-header h2 { margin: 0; font-size: 18px; color: #1e293b; }
    .text-muted { color: #64748b; font-size: 12px; margin: 2px 0 0; }
    .section { margin-bottom: 20px; }
    .section h3 { font-size: 13px; color: #334155; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
    .project-mini-list, .task-mini-list { display: grid; gap: 6px; }
    .project-mini-card {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; background: #fff; border-radius: 8px;
      border: 1px solid #e2e8f0; cursor: pointer; transition: all 0.2s;
    }
    .project-mini-card:hover { border-color: #bfdbfe; }
    .task-mini-card {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: #fff; border-radius: 8px;
      border: 1px solid #e2e8f0;
    }
    .mini-name { font-weight: 600; font-size: 12px; color: #1e293b; flex: 1; }
    .mini-project { font-size: 10px; color: #64748b; }

    /* MODALS */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, 0.6);
      display: flex; align-items: center; justify-content: center;
      z-index: 99999;
      backdrop-filter: blur(4px);
    }
    .project-detail-backdrop { align-items: flex-start; padding-top: 40px; }
    .modal-card {
      background: #fff;
      border-radius: 14px;
      width: 480px;
      max-width: calc(100vw - 24px);
      max-height: calc(100vh - 80px);
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    }
    .project-detail-card {
      width: 820px;
      max-width: calc(100vw - 24px);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
      position: sticky;
      top: 0;
      background: #fff;
      z-index: 1;
    }
    .modal-header h3 { margin: 0; font-size: 16px; color: #1e293b; }
    .header-actions { display: flex; align-items: center; gap: 6px; }
    .icon-close {
      border: none; background: #e2e8f0; cursor: pointer;
      font-size: 13px; color: #64748b;
      width: 26px; height: 26px;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s;
    }
    .icon-close:hover { background: #dc2626; color: #fff; }
    .btn-icon {
      border: none; background: #f1f5f9; cursor: pointer;
      width: 26px; height: 26px;
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; color: #475569;
      transition: all 0.2s;
    }
    .btn-icon:hover { background: #e2e8f0; color: #2563eb; }
    .btn-icon.danger { color: #dc2626; }
    .btn-icon.danger:hover { background: #fef2f2; color: #b91c1c; }
    .btn-icon.sm { width: 22px; height: 22px; font-size: 10px; }

    .modal-body { padding: 16px 20px; display: grid; gap: 12px; }
    .modal-body label { font-size: 12px; font-weight: 600; color: #334155; display: block; margin-bottom: 4px; }
    .modal-body input, .modal-body textarea, .modal-body select {
      width: 100%; box-sizing: border-box;
      border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 9px 10px; font-size: 13px;
    }
    .modal-body textarea { resize: vertical; }
    .member-checklist {
      display: grid;
      gap: 4px;
      max-height: 160px;
      overflow-y: auto;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px;
    }
    .member-check-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 400;
      color: #334155;
      margin: 0;
    }
    .member-check-item input { width: auto; }
    .modal-footer {
      padding: 12px 20px;
      border-top: 1px solid #f1f5f9;
      display: flex; justify-content: flex-end; gap: 8px;
    }

    .btn-primary, .btn-secondary {
      border: none; border-radius: 8px;
      padding: 8px 16px; font-size: 12px; cursor: pointer;
      font-weight: 600;
    }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary { background: #e2e8f0; color: #334155; }
    .btn-secondary:hover { background: #cbd5e1; }
    .btn-sm {
      border: none; border-radius: 6px;
      padding: 6px 12px; font-size: 11px; cursor: pointer;
      background: #2563eb; color: #fff; font-weight: 500;
      white-space: nowrap;
    }
    .btn-sm:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-remove-sm {
      border: none; background: none; cursor: pointer;
      font-size: 10px; color: #94a3b8; padding: 2px;
      transition: all 0.2s;
    }
    .btn-remove-sm:hover { color: #dc2626; }

    /* PROJECT DETAIL */
    .detail-section { margin-bottom: 16px; }
    .detail-section h4 { font-size: 12px; color: #475569; margin: 0 0 8px; display: flex; align-items: center; gap: 6px; }
    .detail-desc { font-size: 12px; color: #64748b; line-height: 1.5; background: #f8fafc; padding: 10px; border-radius: 8px; }
    .member-list { display: grid; gap: 4px; margin-bottom: 8px; }
    .member-item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 8px; background: #f8fafc; border-radius: 6px;
      font-size: 11px; color: #334155;
    }
    .add-member-row { display: flex; gap: 6px; }
    .member-select { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; font-size: 11px; }

    .progress-hint { font-weight: 400; color: #94a3b8; font-size: 11px; }

    .add-task-row { display: flex; gap: 6px; margin-bottom: 8px; }
    .task-input { flex: 1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; font-size: 12px; }

    .task-name { font-size: 12px; font-weight: 500; color: #1e293b; }
    .task-meta { font-size: 10px; color: #94a3b8; margin-top: 2px; }
    .task-assignees { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .mini-chip {
      display: inline-flex; align-items: center; gap: 3px;
      padding: 2px 6px; background: #eff6ff; border-radius: 4px;
      font-size: 9px; font-weight: 500; color: #2563eb;
    }
    .chip-remove { cursor: pointer; font-size: 8px; opacity: 0.6; }
    .chip-remove:hover { opacity: 1; color: #dc2626; }
    .assignee-add {
      border: none; background: none; cursor: pointer;
      font-size: 9px; color: #3b82f6; font-weight: 500;
      padding: 2px 4px;
    }

    /* DETAIL LAYOUT: sidebar (owner/status/team) + main (description/tasks) */
    .detail-layout {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 18px;
    }
    .detail-sidebar {
      display: grid;
      gap: 16px;
      align-content: start;
      border-right: 1px solid #f1f5f9;
      padding-right: 16px;
    }
    .detail-field label {
      font-size: 10.5px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      display: block;
      margin-bottom: 5px;
    }
    .detail-field select { width: 100%; }
    .detail-main { display: grid; gap: 16px; align-content: start; min-width: 0; }

    /* TASK TABLE */
    .task-table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
    .task-table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .task-table th, .task-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: middle; }
    .task-table thead th {
      background: #f8fafc;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748b;
      font-weight: 700;
      border-bottom: 1px solid #e2e8f0;
    }
    .task-table .col-sno { width: 40px; text-align: center; color: #94a3b8; font-weight: 600; }
    .task-table .col-status { width: 130px; }
    .task-table .col-actions { width: 66px; text-align: right; white-space: nowrap; }
    .task-table tbody tr:last-child td { border-bottom: none; }
    .task-table tbody tr:hover { background: #f8fafc; }
    .task-table tbody tr.completed { opacity: 0.6; }
    .task-table tbody tr.completed .task-name { text-decoration: line-through; }

    /* DARK THEME */
    :host-context(.dark-theme) .cloudops-page { background: #0f172a; }
    :host-context(.dark-theme) .left-panel { background: #1e293b; border-right-color: #334155; }
    :host-context(.dark-theme) .panel-title { color: #e2e8f0; border-bottom-color: #334155; }
    :host-context(.dark-theme) .panel-error { background: #450a0a; border-color: #7f1d1d; color: #fca5a5; }
    :host-context(.dark-theme) .manager-card { background: linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%); border-color: #2563eb; }
    :host-context(.dark-theme) .emp-name { color: #e2e8f0; }
    :host-context(.dark-theme) .emp-role { color: #93c5fd; }
    :host-context(.dark-theme) .emp-dept { color: #94a3b8; }
    :host-context(.dark-theme) .divider { background: #334155; }
    :host-context(.dark-theme) .emp-list-label { color: #94a3b8; }
    :host-context(.dark-theme) .employee-card:hover, :host-context(.dark-theme) .employee-card.active { background: #0f172a; }
    :host-context(.dark-theme) .employee-card .avatar { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); }
    :host-context(.dark-theme) .main-content { background: #0f172a; }
    :host-context(.dark-theme) .projects-header h2 { color: #f1f5f9; }
    :host-context(.dark-theme) .project-card { background: #1e293b; border-color: #334155; }
    :host-context(.dark-theme) .project-card:hover { border-color: #2563eb; box-shadow: 0 8px 24px rgba(0,0,0,0.3); }
    :host-context(.dark-theme) .card-header h3 { color: #e2e8f0; }
    :host-context(.dark-theme) .card-desc { color: #94a3b8; }
    :host-context(.dark-theme) .progress-bar { background: #334155; }
    :host-context(.dark-theme) .progress-label { color: #94a3b8; }
    :host-context(.dark-theme) .member-chip { background: linear-gradient(135deg, #334155, #475569); color: #cbd5e1; }
    :host-context(.dark-theme) .right-sidebar { background: #1e293b; border-left-color: #334155; }
    :host-context(.dark-theme) .sidebar-section-title { color: #94a3b8; }
    :host-context(.dark-theme) .nav-item { color: #94a3b8; }
    :host-context(.dark-theme) .nav-item:hover { background: #0f172a; color: #60a5fa; }
    :host-context(.dark-theme) .nav-item.active { background: #1e3a8a; color: #93c5fd; }
    :host-context(.dark-theme) .modal-backdrop { background: rgba(0,0,0,0.75); }
    :host-context(.dark-theme) .modal-card { background: #1e293b; }
    :host-context(.dark-theme) .modal-header { background: #1e293b; border-bottom-color: #334155; }
    :host-context(.dark-theme) .modal-header h3 { color: #f1f5f9; }
    :host-context(.dark-theme) .modal-body label { color: #cbd5e1; }
    :host-context(.dark-theme) .modal-body input, :host-context(.dark-theme) .modal-body textarea, :host-context(.dark-theme) .modal-body select { background: #0f172a; border-color: #334155; color: #e2e8f0; }
    :host-context(.dark-theme) .member-checklist { background: #0f172a; border-color: #334155; }
    :host-context(.dark-theme) .member-check-item { color: #e2e8f0; }
    :host-context(.dark-theme) .btn-secondary { background: #334155; color: #e2e8f0; }
    :host-context(.dark-theme) .btn-secondary:hover { background: #475569; }
    :host-context(.dark-theme) .icon-close { background: #334155; color: #94a3b8; }
    :host-context(.dark-theme) .member-item { background: #0f172a; color: #e2e8f0; }
    :host-context(.dark-theme) .task-name { color: #e2e8f0; }
    :host-context(.dark-theme) .mini-chip { background: #1e3a8a; color: #93c5fd; }
    :host-context(.dark-theme) .detail-desc { background: #0f172a; color: #94a3b8; }
    :host-context(.dark-theme) .section h3 { color: #cbd5e1; }
    :host-context(.dark-theme) .emp-header h2 { color: #f1f5f9; }
    :host-context(.dark-theme) .project-mini-card { background: #1e293b; border-color: #334155; }
    :host-context(.dark-theme) .task-mini-card { background: #1e293b; border-color: #334155; }
    :host-context(.dark-theme) .mini-name { color: #e2e8f0; }
    :host-context(.dark-theme) .member-select { background: #0f172a; border-color: #334155; color: #e2e8f0; }
    :host-context(.dark-theme) .task-input { background: #0f172a; border-color: #334155; color: #e2e8f0; }
    :host-context(.dark-theme) .modal-footer { border-top-color: #334155; }
    :host-context(.dark-theme) .detail-sidebar { border-right-color: #334155; }
    :host-context(.dark-theme) .detail-field label { color: #94a3b8; }
    :host-context(.dark-theme) .task-table-wrap { border-color: #334155; }
    :host-context(.dark-theme) .task-table th, :host-context(.dark-theme) .task-table td { border-bottom-color: #334155; }
    :host-context(.dark-theme) .task-table thead th { background: #0f172a; color: #94a3b8; border-bottom-color: #334155; }
    :host-context(.dark-theme) .task-table tbody tr:hover { background: #0f172a; }
  `]
})
export class CloudopsComponent implements OnInit {
  // Data
  manager: CloudOpsManager | null = null;
  employees: CloudOpsEmployee[] = [];
  projects: CloudOpsProject[] = [];
  teamMembers: CloudOpsMember[] = [];
  teamLoadError: string | null = null;

  // Selection state
  selectedFilter: string = 'all';
  sidebarTitle: string = 'All Projects';
  selectedEmployee: CloudOpsMember | null = null;
  selectedEmployeeView: CloudOpsMember | null = null;
  employeeProjects: CloudOpsProject[] = [];
  employeeTasks: CloudOpsTask[] = [];

  // Project detail
  showProjectDetail = false;
  selectedProject: CloudOpsProject | null = null;
  projectMembers: CloudOpsMember[] = [];
  projectTasks: CloudOpsTask[] = [];
  newMemberEmail: string = '';
  newTaskName: string = '';

  // Project modal
  showProjectModal = false;
  editingProjectId: number | null = null;
  projectForm: any = { name: '', description: '', status: 'Open', ownerEmail: '', memberEmails: [] };

  // Task modal
  showTaskModal = false;
  editingTaskId: number | null = null;
  taskForm: any = { name: '', description: '', status: 'Open' };

  private graphToken: string = '';

  memberName(m: any): string {
    return m?.display_name || m?.displayName || m?.email || '';
  }

  memberInitial(m: any): string {
    return (this.memberName(m))[0] || '?';
  }

  constructor(
    private router: Router,
    private cloudOpsService: CloudOpsService,
    private msalService: MsalService,
    private messageService: MessageService
  ) {}

  async ngOnInit(): Promise<void> {
    const role = (sessionStorage.getItem('role') || '').toLowerCase();
    if (role !== 'admin' && role !== 'cloudops' && role !== 'itsm') {
      this.router.navigate(['/dashboard']);
      return;
    }

    try {
      this.graphToken = await this.msalService.getAccessToken([
        'User.Read',
        'GroupMember.Read.All',
        'Group.Read.All'
      ]);
    } catch {
      this.messageService.error('Failed to get Microsoft Graph token');
      return;
    }

    this.teamLoadError = null;
    await Promise.all([
      this.loadManager(),
      this.loadEmployees(),
      this.loadProjects(),
      this.loadTeamMembers()
    ]);
  }

  // Manager/employees/team-members all fail for the same underlying reason (the
  // Graph group lookup), so only surface the first distinct error once instead of
  // three overlapping toasts for one root cause.
  private reportTeamLoadError(message: string): void {
    if (this.teamLoadError) return;
    this.teamLoadError = message;
    this.messageService.error(message);
  }

  async loadManager(): Promise<void> {
    try {
      this.manager = await firstValueFrom(this.cloudOpsService.getManager(this.graphToken));
    } catch (err: any) {
      this.manager = null;
      this.reportTeamLoadError(err?.error?.message || 'Failed to load CloudOps manager');
    }
  }

  async loadEmployees(): Promise<void> {
    try {
      const res = await firstValueFrom(this.cloudOpsService.getEmployees(this.graphToken));
      this.employees = res?.employees || [];
    } catch (err: any) {
      this.employees = [];
      this.reportTeamLoadError(err?.error?.message || 'Failed to load CloudOps employees');
    }
  }

  async loadProjects(): Promise<void> {
    try {
      const status = this.selectedFilter === 'all' ? '' : this.selectedFilter;
      this.projects = await firstValueFrom(this.cloudOpsService.getProjects(status));
    } catch { this.projects = []; }
  }

  async loadTeamMembers(): Promise<void> {
    try {
      const res = await firstValueFrom(this.cloudOpsService.getTeamMembers(this.graphToken));
      this.teamMembers = res?.members || [];
    } catch (err: any) {
      this.teamMembers = [];
      this.reportTeamLoadError(err?.error?.message || 'Failed to load CloudOps team members');
    }
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase().replace(/\s+/g, '-');
    if (s === 'in-progress') return 'in-progress';
    return s;
  }

  projectProgress(project: CloudOpsProject): number {
    const tasks = project.tasks || [];
    if (tasks.length === 0) return 0;
    const closed = tasks.filter(t => (t.status || '').toLowerCase() === 'closed').length;
    return Math.round((closed / tasks.length) * 100);
  }

  async selectEmployee(emp: any): Promise<void> {
    this.selectedEmployee = emp;
    this.selectedEmployeeView = emp;
    this.showProjectDetail = false;

    try {
      const [projects, tasks] = await Promise.all([
        firstValueFrom(this.cloudOpsService.getEmployeeProjects(emp.email)),
        firstValueFrom(this.cloudOpsService.getEmployeeTasks(emp.email))
      ]);
      this.employeeProjects = projects || [];
      this.employeeTasks = tasks || [];
    } catch {
      this.employeeProjects = [];
      this.employeeTasks = [];
    }
  }

  clearEmployeeView(): void {
    this.selectedEmployeeView = null;
    this.selectedEmployee = null;
  }

  filterProjects(filter: string): void {
    this.selectedFilter = filter;
    this.clearEmployeeView();
    this.showProjectDetail = false;
    const titles: Record<string, string> = {
      'all': 'All Projects',
      'open': 'Open Projects',
      'in progress': 'In Progress',
      'testing': 'Testing',
      'closed': 'Completed Projects'
    };
    this.sidebarTitle = titles[filter] || 'Projects';
    this.loadProjects();
  }

  async viewProject(project: CloudOpsProject): Promise<void> {
    if (!project.id) return;
    this.selectedEmployeeView = null;
    this.showProjectDetail = false;

    try {
      const detail = await firstValueFrom(this.cloudOpsService.getProject(project.id));
      this.selectedProject = detail;
      this.projectMembers = (detail.members || []) as any;
      this.projectTasks = (detail.tasks || []) as any;
      this.showProjectDetail = true;
    } catch {
      this.messageService.error('Failed to load project details');
    }
  }

  closeProjectDetail(): void {
    this.showProjectDetail = false;
    this.selectedProject = null;
    this.projectMembers = [];
    this.projectTasks = [];
    this.newMemberEmail = '';
    this.newTaskName = '';
  }

  // ---- PROJECT CRUD ----
  openCreateProjectModal(): void {
    this.editingProjectId = null;
    this.projectForm = { name: '', description: '', status: 'Open', ownerEmail: '', memberEmails: [] };
    this.showProjectModal = true;
  }

  openEditProjectModal(): void {
    if (!this.selectedProject) return;
    this.editingProjectId = this.selectedProject.id || null;
    this.projectForm = {
      name: this.selectedProject.name,
      description: this.selectedProject.description || '',
      status: this.selectedProject.status,
      ownerEmail: this.selectedProject.owner_email || '',
      memberEmails: []
    };
    this.showProjectModal = true;
  }

  closeProjectModal(): void {
    this.showProjectModal = false;
  }

  isMemberSelected(email: string): boolean {
    return (this.projectForm.memberEmails || []).includes(email);
  }

  toggleMemberSelection(email: string): void {
    const list: string[] = this.projectForm.memberEmails || (this.projectForm.memberEmails = []);
    const idx = list.indexOf(email);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push(email);
    }
  }

  async saveProject(): Promise<void> {
    if (!this.projectForm.name.trim()) {
      this.messageService.error('Project name is required');
      return;
    }
    if (!this.editingProjectId && !this.projectForm.ownerEmail) {
      this.messageService.error('Please select a project owner');
      return;
    }

    const owner = this.teamMembers.find(m => m.email === this.projectForm.ownerEmail);
    const payload: any = {
      name: this.projectForm.name,
      description: this.projectForm.description,
      status: this.projectForm.status,
      ownerEmail: this.projectForm.ownerEmail || '',
      ownerName: owner?.displayName || ''
    };

    try {
      if (this.editingProjectId) {
        await firstValueFrom(this.cloudOpsService.updateProject(this.editingProjectId, payload));
        this.messageService.success('Project updated');
      } else {
        payload.members = (this.projectForm.memberEmails || [])
          .filter((email: string) => email !== this.projectForm.ownerEmail)
          .map((email: string) => ({
            email,
            display_name: this.teamMembers.find(m => m.email === email)?.displayName || ''
          }));
        await firstValueFrom(this.cloudOpsService.createProject(payload));
        this.messageService.success('Project created');
      }

      this.closeProjectModal();
      await this.loadProjects();

      if (this.showProjectDetail && this.selectedProject?.id) {
        const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject.id));
        this.selectedProject = detail;
        this.projectMembers = (detail.members || []) as any;
        this.projectTasks = (detail.tasks || []) as any;
      }
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to save project');
    }
  }

  // Quick status change from the project card or the detail modal header, without
  // going through the full edit form.
  async changeProjectStatus(newStatus: string, project?: CloudOpsProject): Promise<void> {
    const target = project || this.selectedProject;
    if (!target?.id || !newStatus || newStatus === target.status) return;

    try {
      const updated = await firstValueFrom(this.cloudOpsService.updateProject(target.id, {
        name: target.name,
        description: target.description || '',
        status: newStatus,
        ownerEmail: target.owner_email || '',
        ownerName: target.owner_name || ''
      }));

      target.status = updated.status;
      if (this.selectedProject?.id === target.id) {
        this.selectedProject = { ...this.selectedProject, ...updated };
      }
      this.messageService.success('Project status updated');
      await this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to update project status');
    }
  }

  // Quick owner change from the detail modal sidebar.
  async changeProjectOwner(newOwnerEmail: string): Promise<void> {
    if (!this.selectedProject?.id) return;
    if ((newOwnerEmail || '') === (this.selectedProject.owner_email || '')) return;

    const owner = this.teamMembers.find(m => m.email === newOwnerEmail);
    try {
      const updated = await firstValueFrom(this.cloudOpsService.updateProject(this.selectedProject.id, {
        name: this.selectedProject.name,
        description: this.selectedProject.description || '',
        status: this.selectedProject.status,
        ownerEmail: newOwnerEmail || '',
        ownerName: owner?.displayName || ''
      }));

      this.selectedProject = { ...this.selectedProject, ...updated };
      this.messageService.success('Project owner updated');
      await this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to update project owner');
    }
  }

  async deleteCurrentProject(): Promise<void> {
    if (!this.selectedProject?.id) return;
    const confirmed = window.confirm(`Delete project "${this.selectedProject.name}"?`);
    if (!confirmed) return;

    try {
      await firstValueFrom(this.cloudOpsService.deleteProject(this.selectedProject.id));
      this.messageService.success('Project deleted');
      this.closeProjectDetail();
      await this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to delete project');
    }
  }

  // ---- PROJECT MEMBERS ----
  async addProjectMember(): Promise<void> {
    if (!this.newMemberEmail || !this.selectedProject?.id) return;

    const member = this.teamMembers.find(m => m.email === this.newMemberEmail);
    try {
      await firstValueFrom(this.cloudOpsService.addProjectMember(
        this.selectedProject.id,
        this.newMemberEmail,
        member?.displayName
      ));
      this.messageService.success('Member added');
      this.newMemberEmail = '';

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject.id));
      this.selectedProject = detail;
      this.projectMembers = (detail.members || []) as any;
      this.projectTasks = (detail.tasks || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to add member');
    }
  }

  async removeProjectMember(member: CloudOpsMember): Promise<void> {
    if (!this.selectedProject?.id) return;
    try {
      await firstValueFrom(this.cloudOpsService.removeProjectMember(this.selectedProject.id, member.email));
      this.messageService.success('Member removed');

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject.id));
      this.selectedProject = detail;
      this.projectMembers = (detail.members || []) as any;
      this.projectTasks = (detail.tasks || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to remove member');
    }
  }

  get completedTaskCount(): number {
    return this.projectTasks.filter(t => (t.status || '').toLowerCase() === 'closed').length;
  }

  // ---- TASKS ----
  async addTask(): Promise<void> {
    if (!this.newTaskName.trim() || !this.selectedProject?.id) return;

    try {
      await firstValueFrom(this.cloudOpsService.createTask(this.selectedProject.id, {
        name: this.newTaskName.trim()
      }));
      this.messageService.success('Task added');
      this.newTaskName = '';

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject.id));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
      this.projectMembers = (detail.members || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to add task');
    }
  }

  async updateTaskStatus(task: CloudOpsTask, newStatus: string): Promise<void> {
    if (!task.id || !newStatus || newStatus === task.status) return;

    try {
      await firstValueFrom(this.cloudOpsService.updateTask(task.id, {
        name: task.name,
        description: task.description || '',
        status: newStatus
      }));

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject!.id!));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to update task status');
    }
  }

  openEditTaskModal(task: CloudOpsTask): void {
    this.editingTaskId = task.id || null;
    this.taskForm = {
      name: task.name,
      description: task.description || '',
      status: task.status
    };
    this.showTaskModal = true;
  }

  closeTaskModal(): void {
    this.showTaskModal = false;
  }

  async saveTask(): Promise<void> {
    if (!this.taskForm.name.trim() || !this.editingTaskId) return;

    try {
      await firstValueFrom(this.cloudOpsService.updateTask(this.editingTaskId, this.taskForm));
      this.messageService.success('Task updated');
      this.closeTaskModal();

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject!.id!));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to update task');
    }
  }

  async deleteTask(task: CloudOpsTask): Promise<void> {
    if (!task.id) return;
    const confirmed = window.confirm(`Delete task "${task.name}"?`);
    if (!confirmed) return;

    try {
      await firstValueFrom(this.cloudOpsService.deleteTask(task.id));
      this.messageService.success('Task deleted');

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject!.id!));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
      this.loadProjects();
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to delete task');
    }
  }

  async addTaskAssignee(task: CloudOpsTask, event: any): Promise<void> {
    const email = event.target.value;
    event.target.value = '';
    if (!email || !task.id) return;

    const member = this.teamMembers.find(m => m.email === email);
    try {
      await firstValueFrom(this.cloudOpsService.addTaskAssignee(task.id, email, member?.displayName));
      this.messageService.success('Assignee added');

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject!.id!));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to add assignee');
    }
  }

  async removeTaskAssignee(task: CloudOpsTask, email: string): Promise<void> {
    if (!task.id) return;

    try {
      await firstValueFrom(this.cloudOpsService.removeTaskAssignee(task.id, email));
      this.messageService.success('Assignee removed');

      const detail = await firstValueFrom(this.cloudOpsService.getProject(this.selectedProject!.id!));
      this.selectedProject = detail;
      this.projectTasks = (detail.tasks || []) as any;
    } catch (err: any) {
      this.messageService.error(err?.error?.message || 'Failed to remove assignee');
    }
  }
}
