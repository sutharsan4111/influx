import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ProjectWorkspaceService, ProjectWorkspaceProject, ProjectWorkspaceTask, ProjectWorkspaceTimeLog } from './project-workspace.service';

describe('ProjectWorkspaceService', () => {
  let service: ProjectWorkspaceService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ProjectWorkspaceService]
    });

    service = TestBed.inject(ProjectWorkspaceService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getProjects', () => {
    it('should GET projects', () => {
      const mockProjects: ProjectWorkspaceProject[] = [
        { id: 1, name: 'Project 1', owner: 'Owner 1', status: 'Active', progress: 50, dueDate: '2025-12-31' }
      ];

      service.getProjects().subscribe(projects => {
        expect(projects).toEqual(mockProjects);
      });

      const req = httpMock.expectOne('/api/project-workspace/projects');
      expect(req.request.method).toBe('GET');
      req.flush(mockProjects);
    });
  });

  describe('getTasks', () => {
    it('should GET tasks', () => {
      const mockTasks: ProjectWorkspaceTask[] = [
        { id: 1, projectId: 1, title: 'Task 1', assignee: 'User 1', status: 'In Progress', priority: 'High', dueDate: '2025-12-31' }
      ];

      service.getTasks().subscribe(tasks => {
        expect(tasks).toEqual(mockTasks);
      });

      const req = httpMock.expectOne('/api/project-workspace/tasks');
      expect(req.request.method).toBe('GET');
      req.flush(mockTasks);
    });
  });

  describe('getTimeLogs', () => {
    it('should GET time logs', () => {
      const mockTimeLogs: ProjectWorkspaceTimeLog[] = [
        { id: 1, taskId: 1, projectId: 1, user: 'User 1', hours: 4, date: '2025-01-15', note: 'Work done' }
      ];

      service.getTimeLogs().subscribe(timeLogs => {
        expect(timeLogs).toEqual(mockTimeLogs);
      });

      const req = httpMock.expectOne('/api/project-workspace/time-logs');
      expect(req.request.method).toBe('GET');
      req.flush(mockTimeLogs);
    });
  });

  describe('getDashboard', () => {
    it('should GET dashboard', () => {
      const mockDashboard = { totalProjects: 5, activeProjects: 3, pendingTasks: 10, totalHours: 120 };

      service.getDashboard().subscribe(dashboard => {
        expect(dashboard).toEqual(mockDashboard);
      });

      const req = httpMock.expectOne('/api/project-workspace/dashboard');
      expect(req.request.method).toBe('GET');
      req.flush(mockDashboard);
    });
  });

  describe('getConfig', () => {
    it('should GET config', () => {
      const mockConfig = { zohoProjectsEnabled: true, zohoTimeLogsEnabled: false };

      service.getConfig().subscribe(config => {
        expect(config).toEqual(mockConfig);
      });

      const req = httpMock.expectOne('/api/project-workspace/config');
      expect(req.request.method).toBe('GET');
      req.flush(mockConfig);
    });
  });

  describe('createProject', () => {
    it('should POST new project', () => {
      const newProject = { name: 'New Project', owner: 'Owner', status: 'Planning' as const, progress: 0, dueDate: '2025-12-31' };
      const createdProject: ProjectWorkspaceProject = { id: 2, ...newProject };

      service.createProject(newProject).subscribe(project => {
        expect(project).toEqual(createdProject);
      });

      const req = httpMock.expectOne('/api/project-workspace/projects');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newProject);
      req.flush(createdProject);
    });
  });

  describe('createTask', () => {
    it('should POST new task', () => {
      const newTask = { projectId: 1, title: 'New Task', assignee: 'User 1', status: 'To Do' as const, priority: 'Medium' as const, dueDate: '2025-12-31' };
      const createdTask: ProjectWorkspaceTask = { id: 2, ...newTask };

      service.createTask(newTask).subscribe(task => {
        expect(task).toEqual(createdTask);
      });

      const req = httpMock.expectOne('/api/project-workspace/tasks');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newTask);
      req.flush(createdTask);
    });
  });

  describe('createTimeLog', () => {
    it('should POST new time log', () => {
      const newTimeLog = { taskId: 1, projectId: 1, user: 'User 1', hours: 2, date: '2025-01-15', note: 'Work' };
      const createdTimeLog: ProjectWorkspaceTimeLog = { id: 2, ...newTimeLog };

      service.createTimeLog(newTimeLog).subscribe(timeLog => {
        expect(timeLog).toEqual(createdTimeLog);
      });

      const req = httpMock.expectOne('/api/project-workspace/time-logs');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newTimeLog);
      req.flush(createdTimeLog);
    });
  });

  describe('updateTaskStatus', () => {
    it('should PATCH task status', () => {
      const updatedTask: ProjectWorkspaceTask = { id: 1, projectId: 1, title: 'Task 1', assignee: 'User 1', status: 'Done', priority: 'High', dueDate: '2025-12-31' };

      service.updateTaskStatus(1, 'Done').subscribe(task => {
        expect(task).toEqual(updatedTask);
      });

      const req = httpMock.expectOne('/api/project-workspace/tasks/1/status');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'Done' });
      req.flush(updatedTask);
    });
  });
});