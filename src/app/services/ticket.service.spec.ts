import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { TicketService, Ticket } from './ticket.service';
import { AssignmentService } from './assignment.service';
import { of } from 'rxjs';

describe('TicketService', () => {
  let service: TicketService;
  let httpMock: HttpTestingController;
  let assignmentServiceSpy: jasmine.SpyObj<AssignmentService>;

  const mockTicket: Partial<Ticket> = {
    id: '123',
    ticketNumber: 'TKT-001',
    subject: 'Test Ticket',
    status: 'Open',
    priority: 'High',
    email: 'test@example.com'
  };

  beforeEach(() => {
    assignmentServiceSpy = jasmine.createSpyObj('AssignmentService', ['closeAssignment']);
    assignmentServiceSpy.closeAssignment.and.returnValue(of({} as any));

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        TicketService,
        { provide: AssignmentService, useValue: assignmentServiceSpy }
      ]
    });

    service = TestBed.inject(TicketService);
    httpMock = TestBed.inject(HttpTestingController);

    localStorage.clear();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('login', () => {
    it('should POST to /login with data', () => {
      const loginData = { email: 'test@test.com', password: 'pass' };
      service.login(loginData).subscribe();

      const req = httpMock.expectOne('/login');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(loginData);
    });
  });

  describe('createTicket', () => {
    it('should POST to apiUrl with ticket data', () => {
      service.createTicket(mockTicket).subscribe();

      const req = httpMock.expectOne('/api/tickets');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(mockTicket);
    });
  });

  describe('getTickets', () => {
    it('should GET with default params', () => {
      service.getTickets().subscribe();

      const req = httpMock.expectOne(req => req.url.startsWith('/api/tickets?page=1&limit=27'));
      expect(req.request.method).toBe('GET');
    });

    it('should include status param when provided', () => {
      service.getTickets(1, 27, 'open').subscribe();

      const req = httpMock.expectOne(req => req.url.includes('status=open'));
      expect(req.request.method).toBe('GET');
    });

    it('should include search param when provided', () => {
      service.getTickets(1, 27, undefined, 'search term').subscribe();

      const req = httpMock.expectOne(req => req.url.includes('search=search%20term'));
      expect(req.request.method).toBe('GET');
    });

    it('should include filterByEmail param when provided', () => {
      service.getTickets(1, 27, undefined, undefined, 'user@test.com').subscribe();

      const req = httpMock.expectOne(req => req.url.includes('filterByEmail=user%40test.com'));
      expect(req.request.method).toBe('GET');
    });

    it('should include forceRefresh param when true', () => {
      service.getTickets(1, 27, undefined, undefined, undefined, undefined, undefined, true).subscribe();

      const req = httpMock.expectOne(req => req.url.includes('refresh=true'));
      expect(req.request.method).toBe('GET');
    });

    it('should include Authorization header', () => {
      localStorage.setItem('accessToken', 'test-token');
      service.getTickets().subscribe();

      const req = httpMock.expectOne('/api/tickets?page=1&limit=27');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
    });
  });

  describe('getTicketById', () => {
    it('should GET single ticket by id', () => {
      service.getTicketById('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('getTicketMessages', () => {
    it('should GET conversations for ticket', () => {
      service.getTicketMessages('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123/conversations');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('replyToTicket', () => {
    it('should POST reply to ticket', () => {
      const replyData = { content: 'Test reply' };
      service.replyToTicket('123', replyData).subscribe();

      const req = httpMock.expectOne('/api/tickets/123/reply');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(replyData);
    });
  });

  describe('updateTicket', () => {
    it('should PATCH ticket with updates', () => {
      const updates = { status: 'Closed' };
      service.updateTicket('123', updates).subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual(updates);
    });
  });

  describe('closeTicket', () => {
    it('should call updateTicket with status Closed', () => {
      spyOn(service, 'updateTicket').and.callThrough();
      service.closeTicket('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'Closed' });
    });

    it('should fallback to Resolved on 422 error', () => {
      service.closeTicket('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      req.flush({ error: 'Unprocessable' }, { status: 422, statusText: 'Unprocessable Entity' });

      const retryReq = httpMock.expectOne('/api/tickets/123');
      expect(retryReq.request.body).toEqual({ status: 'Resolved' });
    });
  });

  describe('openTicket', () => {
    it('should call updateTicket with status Open', () => {
      service.openTicket('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'Open' });
    });
  });

  describe('inProgressTicket', () => {
    it('should call updateTicket with status In Progress', () => {
      service.inProgressTicket('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'In Progress' });
    });
  });

  describe('getTicketCounts', () => {
    it('should GET counts endpoint', () => {
      service.getTicketCounts().subscribe();

      const req = httpMock.expectOne('/api/tickets/counts');
      expect(req.request.method).toBe('GET');
    });

    it('should include departmentId param when provided', () => {
      service.getTicketCounts(false, 'dept-123').subscribe();

      const req = httpMock.expectOne('/api/tickets/counts?departmentId=dept-123');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('clearAllCache', () => {
    it('should clear all internal caches', () => {
      service.getTickets().subscribe();
      httpMock.expectOne('/api/tickets?page=1&limit=27').flush({ data: [] });

      service.clearAllCache();
      service.getTickets().subscribe();
      httpMock.expectOne('/api/tickets?page=1&limit=27').flush({ data: [] });
    });
  });

  describe('getAssignableUsers', () => {
    it('should GET assignable users', () => {
      service.getAssignableUsers().subscribe();

      const req = httpMock.expectOne('/api/assignable-users');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('moveToRecycleBin', () => {
    it('should POST to recycle endpoint', () => {
      service.moveToRecycleBin('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/123/recycle');
      expect(req.request.method).toBe('POST');
    });

    it('should include ticket data when provided', () => {
      service.moveToRecycleBin('123', mockTicket).subscribe();

      const req = httpMock.expectOne('/api/tickets/123/recycle');
      expect(req.request.body).toEqual({ ticket: mockTicket });
    });
  });

  describe('getRecycleBinTickets', () => {
    it('should GET recycle bin tickets', () => {
      service.getRecycleBinTickets().subscribe();

      const req = httpMock.expectOne('/api/tickets/recycle-bin');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('restoreFromRecycleBin', () => {
    it('should POST to restore endpoint', () => {
      service.restoreFromRecycleBin('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/recycle-bin/123/restore');
      expect(req.request.method).toBe('POST');
    });
  });

  describe('permanentDeleteFromRecycleBin', () => {
    it('should DELETE from recycle bin', () => {
      service.permanentDeleteFromRecycleBin('123').subscribe();

      const req = httpMock.expectOne('/api/tickets/recycle-bin/123');
      expect(req.request.method).toBe('DELETE');
    });
  });

  describe('getZohoStatuses', () => {
    it('should GET zoho statuses', () => {
      service.getZohoStatuses().subscribe();

      const req = httpMock.expectOne('/api/zoho/statuses');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('getDepartments', () => {
    it('should GET departments', () => {
      service.getDepartments().subscribe();

      const req = httpMock.expectOne('/api/zoho/departments');
      expect(req.request.method).toBe('GET');
    });
  });

  describe('Tab Cache', () => {
    it('should return null for non-existent tab cache', () => {
      expect(service.getTabCache('my_open')).toBeNull();
    });

    it('should store and retrieve tab cache', () => {
      const entry = { tickets: [], page: 1, hasMore: false };
      service.setTabCache('my_open', entry);
      const retrieved = service.getTabCache('my_open');
      expect(retrieved).toEqual(jasmine.objectContaining(entry));
    });

    it('should return null and delete expired tab cache', () => {
      const entry = { tickets: [], page: 1, hasMore: false };
      service.setTabCache('my_open', entry);
      const now = Date.now();
      (service as any).globalTabCache.set('my_open', { ...entry, timestamp: now - 20 * 60 * 1000 });
      expect(service.getTabCache('my_open')).toBeNull();
    });

    it('should invalidate specific tab cache keys', () => {
      service.setTabCache('key1', { tickets: [], page: 1, hasMore: false });
      service.setTabCache('key2', { tickets: [], page: 1, hasMore: false });
      service.invalidateTabCache(['key1']);
      expect(service.getTabCache('key1')).toBeNull();
      expect(service.getTabCache('key2')).not.toBeNull();
    });

    it('should invalidate all tab cache when no keys provided', () => {
      service.setTabCache('key1', { tickets: [], page: 1, hasMore: false });
      service.setTabCache('key2', { tickets: [], page: 1, hasMore: false });
      service.invalidateTabCache();
      expect(service.getTabCache('key1')).toBeNull();
      expect(service.getTabCache('key2')).toBeNull();
    });

    it('should check if valid tab cache exists', () => {
      expect(service.hasValidTabCache('key1')).toBeFalse();
      service.setTabCache('key1', { tickets: [], page: 1, hasMore: false });
      expect(service.hasValidTabCache('key1')).toBeTrue();
    });
  });

  describe('resolveClosedBy', () => {
    it('should return direct closedBy from ticket', () => {
      const ticket = { closedBy: 'user@test.com' };
      expect(service.resolveClosedBy(ticket)).toBe('user@test.com');
    });

    it('should return closed_by from ticket', () => {
      const ticket = { closed_by: 'user@test.com' };
      expect(service.resolveClosedBy(ticket)).toBe('user@test.com');
    });

    it('should return closedByEmail from ticket', () => {
      const ticket = { closedByEmail: 'user@test.com' };
      expect(service.resolveClosedBy(ticket)).toBe('user@test.com');
    });

    it('should return closed_by_email from ticket', () => {
      const ticket = { closed_by_email: 'user@test.com' };
      expect(service.resolveClosedBy(ticket)).toBe('user@test.com');
    });

    it('should fall back to localStorage for ticket with id', () => {
      localStorage.setItem('ITSMS_CLOSED_BY', JSON.stringify({ '123': 'stored@test.com' }));
      const ticket = { id: '123' };
      expect(service.resolveClosedBy(ticket)).toBe('stored@test.com');
    });

    it('should return empty string when no closedBy found', () => {
      const ticket = { id: '999' };
      expect(service.resolveClosedBy(ticket)).toBe('');
    });
  });
});