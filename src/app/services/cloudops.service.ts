import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface CloudOpsMember {
  email: string;
  displayName: string;
  jobTitle?: string;
  department?: string;
}

export interface CloudOpsManager {
  displayName: string;
  email: string;
  jobTitle: string;
  department: string;
}

export interface CloudOpsEmployee extends CloudOpsMember {
  project_count: number;
  task_count: number;
}

export interface CloudOpsProject {
  id?: number;
  name: string;
  description?: string;
  status: string;
  owner_email?: string;
  owner_name?: string;
  members?: CloudOpsProjectMember[];
  tasks?: CloudOpsTask[];
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CloudOpsProjectCreatePayload extends Omit<Partial<CloudOpsProject>, 'members'> {
  ownerEmail?: string;
  ownerName?: string;
  members?: { email: string; display_name?: string }[];
}

export interface CloudOpsProjectMember {
  id?: number;
  project_id?: number;
  email: string;
  display_name: string;
  role?: string;
  assigned_at?: string;
}

export interface CloudOpsTask {
  id?: number;
  project_id?: number;
  name: string;
  description?: string;
  status: string;
  assigned_to?: string[];
  assignees?: CloudOpsTaskAssignee[];
  project_name?: string;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CloudOpsTaskAssignee {
  id?: number;
  task_id?: number;
  email: string;
  display_name: string;
  assigned_at?: string;
}

@Injectable({ providedIn: 'root' })
export class CloudOpsService {
  private api = '/api/cloudops';

  constructor(private http: HttpClient) {}

  private getAuthHeaders(graphToken?: string): HttpHeaders {
    const token = localStorage.getItem('accessToken') || '';
    let headers = new HttpHeaders({ Authorization: `Bearer ${token}` });
    if (graphToken) {
      headers = headers.set('x-graph-token', graphToken);
    }
    return headers;
  }

  getTeamMembers(graphToken: string): Observable<{ members: CloudOpsMember[] }> {
    return this.http.get<{ members: CloudOpsMember[] }>(`${this.api}/team-members`, {
      headers: this.getAuthHeaders(graphToken)
    });
  }

  getManager(graphToken: string): Observable<CloudOpsManager> {
    return this.http.get<CloudOpsManager>(`${this.api}/manager`, {
      headers: this.getAuthHeaders(graphToken)
    });
  }

  getEmployees(graphToken: string): Observable<{ employees: CloudOpsEmployee[] }> {
    return this.http.get<{ employees: CloudOpsEmployee[] }>(`${this.api}/employees`, {
      headers: this.getAuthHeaders(graphToken)
    });
  }

  getEmployeeProjects(email: string): Observable<CloudOpsProject[]> {
    return this.http.get<CloudOpsProject[]>(`${this.api}/employees/${encodeURIComponent(email)}/projects`, {
      headers: this.getAuthHeaders()
    });
  }

  getEmployeeTasks(email: string): Observable<CloudOpsTask[]> {
    return this.http.get<CloudOpsTask[]>(`${this.api}/employees/${encodeURIComponent(email)}/tasks`, {
      headers: this.getAuthHeaders()
    });
  }

  getProjects(status?: string): Observable<CloudOpsProject[]> {
    let url = `${this.api}/projects`;
    if (status) url += `?status=${encodeURIComponent(status)}`;
    return this.http.get<CloudOpsProject[]>(url, { headers: this.getAuthHeaders() });
  }

  getProject(id: number): Observable<CloudOpsProject> {
    return this.http.get<CloudOpsProject>(`${this.api}/projects/${id}`, {
      headers: this.getAuthHeaders()
    });
  }

  createProject(payload: CloudOpsProjectCreatePayload): Observable<CloudOpsProject> {
    return this.http.post<CloudOpsProject>(`${this.api}/projects`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateProject(id: number, payload: CloudOpsProjectCreatePayload): Observable<CloudOpsProject> {
    return this.http.put<CloudOpsProject>(`${this.api}/projects/${id}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deleteProject(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/projects/${id}`, {
      headers: this.getAuthHeaders()
    });
  }

  addProjectMember(projectId: number, email: string, display_name?: string): Observable<any> {
    return this.http.post(`${this.api}/projects/${projectId}/members`, { email, display_name }, {
      headers: this.getAuthHeaders()
    });
  }

  removeProjectMember(projectId: number, email: string): Observable<any> {
    return this.http.delete(`${this.api}/projects/${projectId}/members/${encodeURIComponent(email)}`, {
      headers: this.getAuthHeaders()
    });
  }

  getTasks(projectId: number): Observable<CloudOpsTask[]> {
    return this.http.get<CloudOpsTask[]>(`${this.api}/projects/${projectId}/tasks`, {
      headers: this.getAuthHeaders()
    });
  }

  createTask(projectId: number, payload: Partial<CloudOpsTask>): Observable<CloudOpsTask> {
    return this.http.post<CloudOpsTask>(`${this.api}/projects/${projectId}/tasks`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateTask(taskId: number, payload: Partial<CloudOpsTask>): Observable<CloudOpsTask> {
    return this.http.put<CloudOpsTask>(`${this.api}/tasks/${taskId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deleteTask(taskId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/tasks/${taskId}`, {
      headers: this.getAuthHeaders()
    });
  }

  addTaskAssignee(taskId: number, email: string, display_name?: string): Observable<any> {
    return this.http.post(`${this.api}/tasks/${taskId}/assignees`, { email, display_name }, {
      headers: this.getAuthHeaders()
    });
  }

  removeTaskAssignee(taskId: number, email: string): Observable<any> {
    return this.http.delete(`${this.api}/tasks/${taskId}/assignees/${encodeURIComponent(email)}`, {
      headers: this.getAuthHeaders()
    });
  }
}
