import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CloudOpsService, CloudOpsMember, CloudOpsManager, CloudOpsEmployee, CloudOpsProject, CloudOpsProjectCreatePayload, CloudOpsProjectMember, CloudOpsTask } from './cloudops.service';

describe('CloudOpsService', () => {
  let service: CloudOpsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CloudOpsService]
    });

    service = TestBed.inject(CloudOpsService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.setItem('accessToken', 'test-token');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getTeamMembers', () => {
    it('should GET team members with graph token', () => {
      const mockResponse = { members: [{ email: 'user@test.com', displayName: 'User', jobTitle: 'Dev', department: 'IT' }] as CloudOpsMember[] };

      service.getTeamMembers('graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/cloudops/team-members');
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockResponse);
    });
  });

  describe('getManager', () => {
    it('should GET manager with graph token', () => {
      const mockManager: CloudOpsManager = { displayName: 'Manager', email: 'mgr@test.com', jobTitle: 'Lead', department: 'CloudOps' };

      service.getManager('graph-token').subscribe(manager => {
        expect(manager).toEqual(mockManager);
      });

      const req = httpMock.expectOne('/api/cloudops/manager');
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockManager);
    });
  });

  describe('getEmployees', () => {
    it('should GET employees with graph token', () => {
      const mockResponse = { employees: [{ email: 'emp@test.com', displayName: 'Employee', jobTitle: 'Dev', department: 'IT', project_count: 2, task_count: 5 }] as CloudOpsEmployee[] };

      service.getEmployees('graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/cloudops/employees');
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockResponse);
    });
  });

  describe('getEmployeeProjects', () => {
    it('should GET employee projects', () => {
      const mockProjects: CloudOpsProject[] = [
        { id: 1, name: 'Project 1', description: 'Desc', status: 'Active', owner_email: 'owner@test.com', owner_name: 'Owner' }
      ];

      service.getEmployeeProjects('emp@test.com').subscribe(projects => {
        expect(projects).toEqual(mockProjects);
      });

      const req = httpMock.expectOne('/api/cloudops/employees/emp%40test.com/projects');
      expect(req.request.method).toBe('GET');
      req.flush(mockProjects);
    });
  });

  describe('getEmployeeTasks', () => {
    it('should GET employee tasks', () => {
      const mockTasks: CloudOpsTask[] = [
        { id: 1, project_id: 1, name: 'Task 1', description: 'Desc', status: 'In Progress', project_name: 'Project 1' }
      ];

      service.getEmployeeTasks('emp@test.com').subscribe(tasks => {
        expect(tasks).toEqual(mockTasks);
      });

      const req = httpMock.expectOne('/api/cloudops/employees/emp%40test.com/tasks');
      expect(req.request.method).toBe('GET');
      req.flush(mockTasks);
    });
  });

  describe('getProjects', () => {
    it('should GET all projects', () => {
      const mockProjects: CloudOpsProject[] = [
        { id: 1, name: 'Project 1', status: 'Active' },
        { id: 2, name: 'Project 2', status: 'Planning' }
      ];

      service.getProjects().subscribe(projects => {
        expect(projects).toEqual(mockProjects);
      });

      const req = httpMock.expectOne('/api/cloudops/projects');
      expect(req.request.method).toBe('GET');
      req.flush(mockProjects);
    });

    it('should GET projects with status filter', () => {
      service.getProjects('Active').subscribe();

      const req = httpMock.expectOne('/api/cloudops/projects?status=Active');
      expect(req.request.method).toBe('GET');
      req.flush([]);
    });
  });

  describe('getProject', () => {
    it('should GET single project', () => {
      const mockProject: CloudOpsProject = { id: 1, name: 'Project 1', status: 'Active' };

      service.getProject(1).subscribe(project => {
        expect(project).toEqual(mockProject);
      });

      const req = httpMock.expectOne('/api/cloudops/projects/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockProject);
    });
  });

  describe('createProject', () => {
    it('should POST new project', () => {
      const payload: CloudOpsProjectCreatePayload = { name: 'New Project', description: 'Desc', status: 'Planning', ownerEmail: 'owner@test.com' };
      const createdProject: CloudOpsProject = { id: 3, ...payload } as CloudOpsProject;

      service.createProject(payload).subscribe(project => {
        expect(project).toEqual(createdProject);
      });

      const req = httpMock.expectOne('/api/cloudops/projects');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(createdProject);
    });
  });

  describe('updateProject', () => {
    it('should PUT updated project', () => {
      const payload: CloudOpsProjectCreatePayload = { name: 'Updated Project', status: 'Active' };
      const updatedProject: CloudOpsProject = { id: 1, ...payload } as CloudOpsProject;

      service.updateProject(1, payload).subscribe(project => {
        expect(project).toEqual(updatedProject);
      });

      const req = httpMock.expectOne('/api/cloudops/projects/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedProject);
    });
  });

  describe('deleteProject', () => {
    it('should DELETE project', () => {
      service.deleteProject(1).subscribe(response => {
        expect(response).toEqual({ message: 'Deleted' });
      });

      const req = httpMock.expectOne('/api/cloudops/projects/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Deleted' });
    });
  });

  describe('addProjectMember', () => {
    it('should POST to add project member', () => {
      service.addProjectMember(1, 'user@test.com', 'User Name').subscribe();

      const req = httpMock.expectOne('/api/cloudops/projects/1/members');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'user@test.com', display_name: 'User Name' });
      req.flush({});
    });
  });

  describe('removeProjectMember', () => {
    it('should DELETE to remove project member', () => {
      service.removeProjectMember(1, 'user@test.com').subscribe();

      const req = httpMock.expectOne('/api/cloudops/projects/1/members/user%40test.com');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('getTasks', () => {
    it('should GET tasks for project', () => {
      const mockTasks: CloudOpsTask[] = [
        { id: 1, project_id: 1, name: 'Task 1', status: 'To Do' }
      ];

      service.getTasks(1).subscribe(tasks => {
        expect(tasks).toEqual(mockTasks);
      });

      const req = httpMock.expectOne('/api/cloudops/projects/1/tasks');
      expect(req.request.method).toBe('GET');
      req.flush(mockTasks);
    });
  });

  describe('createTask', () => {
    it('should POST new task', () => {
      const payload: Partial<CloudOpsTask> = { name: 'New Task', description: 'Desc', status: 'To Do' };
      const createdTask: CloudOpsTask = { id: 1, project_id: 1, ...payload } as CloudOpsTask;

      service.createTask(1, payload).subscribe(task => {
        expect(task).toEqual(createdTask);
      });

      const req = httpMock.expectOne('/api/cloudops/projects/1/tasks');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(createdTask);
    });
  });

  describe('updateTask', () => {
    it('should PUT updated task', () => {
      const payload: Partial<CloudOpsTask> = { name: 'Updated Task', status: 'In Progress' };
      const updatedTask: CloudOpsTask = { id: 1, project_id: 1, ...payload } as CloudOpsTask;

      service.updateTask(1, payload).subscribe(task => {
        expect(task).toEqual(updatedTask);
      });

      const req = httpMock.expectOne('/api/cloudops/tasks/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedTask);
    });
  });

  describe('deleteTask', () => {
    it('should DELETE task', () => {
      service.deleteTask(1).subscribe(response => {
        expect(response).toEqual({ message: 'Deleted' });
      });

      const req = httpMock.expectOne('/api/cloudops/tasks/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Deleted' });
    });
  });

  describe('addTaskAssignee', () => {
    it('should POST to add task assignee', () => {
      service.addTaskAssignee(1, 'user@test.com', 'User Name').subscribe();

      const req = httpMock.expectOne('/api/cloudops/tasks/1/assignees');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'user@test.com', display_name: 'User Name' });
      req.flush({});
    });
  });

  describe('removeTaskAssignee', () => {
    it('should DELETE to remove task assignee', () => {
      service.removeTaskAssignee(1, 'user@test.com').subscribe();

      const req = httpMock.expectOne('/api/cloudops/tasks/1/assignees/user%40test.com');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });
});