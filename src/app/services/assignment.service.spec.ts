import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AssignmentService, TicketAssignment, AssignmentPayload, ReassignPayload, BulkAssignPayload } from './assignment.service';

describe('AssignmentService', () => {
  let service: AssignmentService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AssignmentService]
    });

    service = TestBed.inject(AssignmentService);
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

  describe('getAssignment', () => {
    it('should GET assignment by ticket id', () => {
      const mockAssignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin@test.com',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      service.getAssignment('123').subscribe(assignment => {
        expect(assignment).toEqual(mockAssignment);
      });

      const req = httpMock.expectOne('/api/assignments/123');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush(mockAssignment);
    });
  });

  describe('getAssignmentsByUser', () => {
    it('should GET assignments by user email', () => {
      const mockAssignments: TicketAssignment[] = [
        { zoho_ticket_id: '123', assigned_users: ['user@test.com'], primary_assignee: 'user@test.com', assigned_by: 'admin', assigned_at: '2024-01-01', status: 'Open' }
      ];

      service.getAssignmentsByUser('user@test.com').subscribe(assignments => {
        expect(assignments).toEqual(mockAssignments);
      });

      const req = httpMock.expectOne('/api/assignments/user/user%40test.com');
      expect(req.request.method).toBe('GET');
      req.flush(mockAssignments);
    });
  });

  describe('getAllAssignments', () => {
    it('should GET all assignments', () => {
      const mockAssignments: TicketAssignment[] = [
        { zoho_ticket_id: '123', assigned_users: ['user@test.com'], primary_assignee: 'user@test.com', assigned_by: 'admin', assigned_at: '2024-01-01', status: 'Open' }
      ];

      service.getAllAssignments().subscribe(assignments => {
        expect(assignments).toEqual(mockAssignments);
      });

      const req = httpMock.expectOne('/api/assignments');
      expect(req.request.method).toBe('GET');
      req.flush(mockAssignments);
    });
  });

  describe('assignTicket', () => {
    it('should POST assignment payload', () => {
      const payload: AssignmentPayload = {
        zoho_ticket_id: '123',
        zoho_ticket_number: 'TKT-001',
        assigned_users: ['user@test.com'],
        assigned_by: 'admin@test.com'
      };

      const mockResponse: TicketAssignment = {
        ...payload,
        primary_assignee: 'user@test.com',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      service.assignTicket(payload).subscribe(assignment => {
        expect(assignment).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/assignments');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockResponse);
    });
  });

  describe('reassignTicket', () => {
    it('should PUT reassignment payload', () => {
      const payload: ReassignPayload = {
        zoho_ticket_id: '123',
        new_assigned_users: ['newuser@test.com'],
        reassigned_by: 'admin@test.com'
      };

      const mockResponse: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['newuser@test.com'],
        primary_assignee: 'newuser@test.com',
        assigned_by: 'admin@test.com',
        assigned_at: '2024-01-01',
        reassigned_user: 'newuser@test.com',
        reassigned_at: '2024-01-02',
        reassigned_by: 'admin@test.com',
        status: 'Open'
      };

      service.reassignTicket(payload).subscribe(assignment => {
        expect(assignment).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/assignments/reassign');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(payload);
      req.flush(mockResponse);
    });
  });

  describe('bulkAssign', () => {
    it('should POST bulk assignment payload', () => {
      const payload: BulkAssignPayload = {
        ticket_ids: ['123', '456'],
        assigned_users: ['user@test.com'],
        assigned_by: 'admin@test.com'
      };

      const mockResponse = { success: ['123'], failed: ['456'] };

      service.bulkAssign(payload).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/assignments/bulk');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockResponse);
    });
  });

  describe('closeAssignment', () => {
    it('should PUT close assignment', () => {
      const mockResponse: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin@test.com',
        assigned_at: '2024-01-01',
        closed_at: '2024-01-02',
        closed_by: 'user@test.com',
        status: 'Closed'
      };

      service.closeAssignment('123', 'user@test.com').subscribe(assignment => {
        expect(assignment).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/assignments/123/close');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ closed_by: 'user@test.com' });
      req.flush(mockResponse);
    });
  });

  describe('deleteAssignment', () => {
    it('should DELETE assignment', () => {
      service.deleteAssignment('123').subscribe();

      const req = httpMock.expectOne('/api/assignments/123');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('isUserAssigned', () => {
    it('should return true when user is in assigned_users', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com', 'other@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isUserAssigned(assignment, 'user@test.com')).toBeTrue();
      expect(service.isUserAssigned(assignment, 'other@test.com')).toBeTrue();
    });

    it('should return false when user is not in assigned_users', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isUserAssigned(assignment, 'other@test.com')).toBeFalse();
    });

    it('should be case insensitive', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['USER@TEST.COM'],
        primary_assignee: 'USER@TEST.COM',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isUserAssigned(assignment, 'user@test.com')).toBeTrue();
    });

    it('should return false for null assignment', () => {
      expect(service.isUserAssigned(null, 'user@test.com')).toBeFalse();
    });
  });

  describe('isPrimaryAssignee', () => {
    it('should return true when user is primary assignee', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com', 'other@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isPrimaryAssignee(assignment, 'user@test.com')).toBeTrue();
    });

    it('should return false when user is not primary assignee', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['user@test.com', 'other@test.com'],
        primary_assignee: 'user@test.com',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isPrimaryAssignee(assignment, 'other@test.com')).toBeFalse();
    });

    it('should be case insensitive', () => {
      const assignment: TicketAssignment = {
        zoho_ticket_id: '123',
        assigned_users: ['USER@TEST.COM'],
        primary_assignee: 'USER@TEST.COM',
        assigned_by: 'admin',
        assigned_at: '2024-01-01',
        status: 'Open'
      };

      expect(service.isPrimaryAssignee(assignment, 'user@test.com')).toBeTrue();
    });

    it('should return false for null assignment', () => {
      expect(service.isPrimaryAssignee(null, 'user@test.com')).toBeFalse();
    });
  });
});