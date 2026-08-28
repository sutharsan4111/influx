import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ProjectWorkspaceService, ProjectWorkspaceProject, ProjectWorkspaceTask, ProjectWorkspaceTimeLog } from '../services/project-workspace.service';

@Component({
  selector: 'app-project-workspace',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-workspace.component.html',
  styleUrls: ['./project-workspace.component.scss']
})
export class ProjectWorkspaceComponent implements OnInit {
  projects: ProjectWorkspaceProject[] = [];
  tasks: ProjectWorkspaceTask[] = [];
  timeLogs: ProjectWorkspaceTimeLog[] = [];
  dashboard: any = {};
  zohoProjectsEnabled = false;
  zohoTimeLogsEnabled = false;

  newProject = {
    name: '',
    owner: '',
    status: 'Planning' as ProjectWorkspaceProject['status'],
    progress: 0,
    dueDate: ''
  };

  newTask = {
    projectId: 0,
    title: '',
    assignee: '',
    status: 'To Do' as ProjectWorkspaceTask['status'],
    priority: 'Medium' as ProjectWorkspaceTask['priority'],
    dueDate: ''
  };

  newTimeLog = {
    taskId: 0,
    projectId: 0,
    user: '',
    hours: 1,
    date: '',
    note: ''
  };

  constructor(private readonly service: ProjectWorkspaceService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    forkJoin({
      config: this.service.getConfig(),
      projects: this.service.getProjects(),
      tasks: this.service.getTasks(),
      timeLogs: this.service.getTimeLogs(),
      dashboard: this.service.getDashboard()
    }).subscribe(({ config, projects, tasks, timeLogs, dashboard }) => {
      this.zohoProjectsEnabled = config.zohoProjectsEnabled;
      this.zohoTimeLogsEnabled = config.zohoTimeLogsEnabled;
      this.projects = projects;
      this.tasks = tasks;
      this.timeLogs = timeLogs;
      this.dashboard = dashboard;

      if (this.projects.length && !this.newTask.projectId) {
        this.newTask.projectId = this.projects[0].id;
      }
      if (this.projects.length && !this.newTimeLog.projectId) {
        this.newTimeLog.projectId = this.projects[0].id;
      }
    });
  }

  createProject(): void {
    if (!this.newProject.name.trim()) {
      return;
    }

    const payload = {
      name: this.newProject.name.trim(),
      owner: this.newProject.owner.trim() || 'Unassigned',
      status: this.newProject.status,
      progress: Math.max(0, Math.min(100, this.newProject.progress)),
      dueDate: this.newProject.dueDate
    };

    this.service.createProject(payload).subscribe(() => {
      this.newProject = { name: '', owner: '', status: 'Planning', progress: 0, dueDate: '' };
      this.refresh();
    });
  }

  createTask(): void {
    if (!this.newTask.title.trim() || !this.newTask.projectId) {
      return;
    }

    const payload = {
      projectId: this.newTask.projectId,
      title: this.newTask.title.trim(),
      assignee: this.newTask.assignee.trim() || 'Unassigned',
      status: this.newTask.status,
      priority: this.newTask.priority,
      dueDate: this.newTask.dueDate
    };

    this.service.createTask(payload).subscribe(() => {
      this.newTask = { projectId: this.projects[0]?.id || 0, title: '', assignee: '', status: 'To Do', priority: 'Medium', dueDate: '' };
      this.refresh();
    });
  }

  createTimeLog(): void {
    if (!this.newTimeLog.taskId || !this.newTimeLog.projectId || !this.newTimeLog.user.trim()) {
      return;
    }

    const payload = {
      taskId: this.newTimeLog.taskId,
      projectId: this.newTimeLog.projectId,
      user: this.newTimeLog.user.trim(),
      hours: Number(this.newTimeLog.hours) || 0,
      date: this.newTimeLog.date || new Date().toISOString().slice(0, 10),
      note: this.newTimeLog.note.trim()
    };

    this.service.createTimeLog(payload).subscribe(() => {
      this.newTimeLog = { taskId: 0, projectId: this.projects[0]?.id || 0, user: '', hours: 1, date: '', note: '' };
      this.refresh();
    });
  }

  updateTaskStatus(task: ProjectWorkspaceTask, status: ProjectWorkspaceTask['status']): void {
    this.service.updateTaskStatus(task.id, status).subscribe(() => this.refresh());
  }

  getProjectName(projectId: number): string {
    return this.projects.find(project => project.id === projectId)?.name || 'Unknown Project';
  }

  downloadElectronApp(): void {
    const installerUrl = 'https://your-company.example/downloads/itsm-electron-installer.exe';
    window.open(installerUrl, '_blank', 'noopener,noreferrer');
  }
}
