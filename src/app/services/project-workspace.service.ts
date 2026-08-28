import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ProjectWorkspaceProject {
  id: number;
  name: string;
  owner: string;
  status: 'Planning' | 'Active' | 'On Hold' | 'Completed';
  progress: number;
  dueDate: string;
}

export interface ProjectWorkspaceTask {
  id: number;
  projectId: number;
  title: string;
  assignee: string;
  status: 'To Do' | 'In Progress' | 'Blocked' | 'Done';
  priority: 'Low' | 'Medium' | 'High';
  dueDate: string;
}

export interface ProjectWorkspaceTimeLog {
  id: number;
  taskId: number;
  projectId: number;
  user: string;
  hours: number;
  date: string;
  note: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProjectWorkspaceService {
  private readonly apiUrl = '/api/project-workspace';

  constructor(private readonly http: HttpClient) {}

  getProjects(): Observable<ProjectWorkspaceProject[]> {
    return this.http.get<ProjectWorkspaceProject[]>(`${this.apiUrl}/projects`);
  }

  getTasks(): Observable<ProjectWorkspaceTask[]> {
    return this.http.get<ProjectWorkspaceTask[]>(`${this.apiUrl}/tasks`);
  }

  getTimeLogs(): Observable<ProjectWorkspaceTimeLog[]> {
    return this.http.get<ProjectWorkspaceTimeLog[]>(`${this.apiUrl}/time-logs`);
  }

  getDashboard(): Observable<any> {
    return this.http.get(`${this.apiUrl}/dashboard`);
  }

  getConfig(): Observable<{ zohoProjectsEnabled: boolean; zohoTimeLogsEnabled: boolean }> {
    return this.http.get<{ zohoProjectsEnabled: boolean; zohoTimeLogsEnabled: boolean }>(
      `${this.apiUrl}/config`
    );
  }

  createProject(project: Partial<ProjectWorkspaceProject>): Observable<ProjectWorkspaceProject> {
    return this.http.post<ProjectWorkspaceProject>(`${this.apiUrl}/projects`, project);
  }

  createTask(task: Partial<ProjectWorkspaceTask>): Observable<ProjectWorkspaceTask> {
    return this.http.post<ProjectWorkspaceTask>(`${this.apiUrl}/tasks`, task);
  }

  createTimeLog(entry: Partial<ProjectWorkspaceTimeLog>): Observable<ProjectWorkspaceTimeLog> {
    return this.http.post<ProjectWorkspaceTimeLog>(`${this.apiUrl}/time-logs`, entry);
  }

  updateTaskStatus(taskId: number, status: ProjectWorkspaceTask['status']): Observable<ProjectWorkspaceTask> {
    return this.http.patch<ProjectWorkspaceTask>(`${this.apiUrl}/tasks/${taskId}/status`, { status });
  }
}
