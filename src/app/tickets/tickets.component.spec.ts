import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { of, Subject } from 'rxjs';
import { TicketsComponent } from './tickets.component';
import { TicketService, Ticket } from '../services/ticket.service';
import { AssignmentService } from '../services/assignment.service';
import { LoadingService } from '../services/loading.service';
import { MessageService } from '../services/message.service';
import { MsalService } from '../services/msal.service';
import { IhubService } from '../services/ihub.service';
import { IhubCertificateService } from '../services/ihub-certificate.service';
import { SslService } from '../services/ssl.service';
import { DashboardComponent } from '../dashboard/dashboard.component';

describe('TicketsComponent', () => {
  let component: TicketsComponent;
  let fixture: ComponentFixture<TicketsComponent>;
  let ticketServiceSpy: jasmine.SpyObj<TicketService>;
  let assignmentServiceSpy: jasmine.SpyObj<AssignmentService>;
  let loadingService: LoadingService;
  let messageServiceSpy: jasmine.SpyObj<MessageService>;
  let msalServiceSpy: jasmine.SpyObj<MsalService>;
  let ihubServiceSpy: jasmine.SpyObj<IhubService>;
  let ihubCertificateServiceSpy: jasmine.SpyObj<IhubCertificateService>;
  let sslServiceSpy: jasmine.SpyObj<SslService>;
  let routerSpy: jasmine.SpyObj<Router>;
  let routeMock: any;

  const mockTickets: Ticket[] = [
    { id: '1', ticketNumber: 'TKT-001', subject: 'Test 1', status: 'Open', priority: 'High', email: 'a@test.com' },
    { id: '2', ticketNumber: 'TKT-002', subject: 'Test 2', status: 'Closed', priority: 'Low', email: 'b@test.com' }
  ];

  beforeEach(async () => {
    ticketServiceSpy = jasmine.createSpyObj('TicketService', [
      'getTickets', 'getTicketById', 'getTicketCounts', 'updateTicket',
      'closeTicket', 'openTicket', 'inProgressTicket', 'getAssignableUsers',
      'getTicketMessages', 'replyToTicket', 'getTicketAttachments',
      'uploadTicketAttachments', 'moveToRecycleBin', 'getRecycleBinTickets',
      'restoreFromRecycleBin', 'permanentDeleteFromRecycleBin',
      'getZohoStatuses', 'getDepartments', 'getTabCache', 'setTabCache',
      'invalidateTabCache', 'hasValidTabCache', 'clearAllCache',
      'invalidateUserTicketCache', 'resolveClosedBy'
    ]);
    
    ticketServiceSpy.getTickets.and.returnValue(of({ data: mockTickets, hasMore: false }));
    ticketServiceSpy.getTicketCounts.and.returnValue(of({ open: 1, closed: 1 }));
    ticketServiceSpy.getAssignableUsers.and.returnValue(of([]));
    ticketServiceSpy.getZohoStatuses.and.returnValue(of(['Open', 'Closed', 'In Progress']));
    ticketServiceSpy.getDepartments.and.returnValue(of([]));
    ticketServiceSpy.getTabCache.and.returnValue(null);
    ticketServiceSpy.hasValidTabCache.and.returnValue(false);
    ticketServiceSpy.resolveClosedBy.and.returnValue('');

    assignmentServiceSpy = jasmine.createSpyObj('AssignmentService', ['getAssignment', 'assignTicket', 'reassignTicket', 'closeAssignment', 'getAssignmentsByUser']);
    assignmentServiceSpy.getAssignment.and.returnValue(of(null));
    assignmentServiceSpy.getAssignmentsByUser.and.returnValue(of([]));

    messageServiceSpy = jasmine.createSpyObj('MessageService', ['show', 'hide']);
    msalServiceSpy = jasmine.createSpyObj('MsalService', ['getActiveAccount']);
    ihubServiceSpy = jasmine.createSpyObj('IhubService', []);
    ihubCertificateServiceSpy = jasmine.createSpyObj('IhubCertificateService', []);
    sslServiceSpy = jasmine.createSpyObj('SslService', []);
    
    routerSpy = jasmine.createSpyObj('Router', ['navigate', 'navigateByUrl']);
    routeMock = {
      snapshot: { queryParamMap: { get: jasmine.createSpy('get').and.returnValue(null) } },
      queryParamMap: of({ get: () => null })
    };

    await TestBed.configureTestingModule({
      imports: [TicketsComponent, FormsModule, DashboardComponent],
      providers: [
        { provide: TicketService, useValue: ticketServiceSpy },
        { provide: AssignmentService, useValue: assignmentServiceSpy },
        LoadingService,
        { provide: MessageService, useValue: messageServiceSpy },
        { provide: MsalService, useValue: msalServiceSpy },
        { provide: IhubService, useValue: ihubServiceSpy },
        { provide: IhubCertificateService, useValue: ihubCertificateServiceSpy },
        { provide: SslService, useValue: sslServiceSpy },
        { provide: Router, useValue: routerSpy },
        { provide: ActivatedRoute, useValue: routeMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TicketsComponent);
    component = fixture.componentInstance;
    loadingService = TestBed.inject(LoadingService);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('ngOnInit', () => {
    it('should initialize current user from localStorage', fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      
      component.ngOnInit();
      tick();
      
      expect(component.currentUserEmail).toBe('test@test.com');
      expect(component.userRole).toBe('admin');
    }));

    it('should load departments', fakeAsync(() => {
      component.ngOnInit();
      tick();
      
      expect(ticketServiceSpy.getDepartments).toHaveBeenCalled();
    }));
  });

  describe('switchTab', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should switch to open tab', () => {
      component.switchTab('open');
      expect(component.selectedTab).toBe('open');
    });

    it('should switch to closed tab', () => {
      component.switchTab('closed');
      expect(component.selectedTab).toBe('closed');
    });

    it('should switch to my tab', () => {
      component.switchTab('my');
      expect(component.selectedTab).toBe('my');
    });

    it('should switch to overview tab', () => {
      component.switchTab('overview');
      expect(component.selectedTab).toBe('overview');
    });

    it('should reset pagination when switching tabs', () => {
      component.currentPage = 5;
      component.switchTab('open');
      expect(component.currentPage).toBe(1);
    });
  });

  describe('switchMyStatus', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should switch myStatus to open', () => {
      component.switchMyStatus('open');
      expect(component.myStatus).toBe('open');
    });

    it('should switch myStatus to closed', () => {
      component.switchMyStatus('closed');
      expect(component.myStatus).toBe('closed');
    });
  });

  describe('switchMyViewFilter', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should switch myViewFilter to all', () => {
      component.switchMyViewFilter('all');
      expect(component.myViewFilter).toBe('all');
    });

    it('should switch myViewFilter to assigned', () => {
      component.switchMyViewFilter('assigned');
      expect(component.myViewFilter).toBe('assigned');
    });

    it('should switch myViewFilter to raised', () => {
      component.switchMyViewFilter('raised');
      expect(component.myViewFilter).toBe('raised');
    });
  });

  describe('onDepartmentChange', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should save department to sessionStorage', () => {
      component.selectedDepartmentId = 'dept-123';
      component.onDepartmentChange();
      expect(sessionStorage.getItem('ITSM_SELECTED_DEPT')).toBe('dept-123');
    });
  });

  describe('refreshCurrentTab', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should call getTickets with forceRefresh', fakeAsync(() => {
      component.selectedTab = 'open';
      component.refreshCurrentTab();
      tick();
      expect(ticketServiceSpy.getTickets).toHaveBeenCalledWith(1, 25, 'open', undefined, undefined, undefined, undefined, true);
    }));
  });

  describe('onSearchChange', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should update searchTerm via subject', () => {
      component.onSearchChange('search term');
      expect(component.searchTerm).toBe('search term');
    });

    it('should reset currentPage to 1', () => {
      component.currentPage = 3;
      component.onSearchChange('search');
      expect(component.currentPage).toBe(1);
    });
  });

  describe('priorityClass', () => {
    it('should return priority-sla for Critical', () => {
      expect(component.priorityClass('Critical')).toBe('priority-sla');
    });

    it('should return priority-high for High', () => {
      expect(component.priorityClass('High')).toBe('priority-high');
    });

    it('should return priority-medium for Medium', () => {
      expect(component.priorityClass('Medium')).toBe('priority-medium');
    });

    it('should return priority-low for Low', () => {
      expect(component.priorityClass('Low')).toBe('priority-low');
    });

    it('should return priority-unknown for unknown', () => {
      expect(component.priorityClass('Unknown')).toBe('priority-unknown');
    });
  });

  describe('priorityLabel', () => {
    it('should return SLA for Critical', () => {
      expect(component.priorityLabel('Critical')).toBe('SLA');
    });

    it('should return High for High', () => {
      expect(component.priorityLabel('High')).toBe('High');
    });

    it('should return Medium for Medium', () => {
      expect(component.priorityLabel('Medium')).toBe('Medium');
    });

    it('should return Low for Low', () => {
      expect(component.priorityLabel('Low')).toBe('Low');
    });

    it('should return Unknown for null', () => {
      expect(component.priorityLabel(null as any)).toBe('Unknown');
    });
  });

  describe('statusClass', () => {
    it('should return status class for Open', () => {
      expect(component.statusClass('Open')).toBe('open');
    });

    it('should return status class for Closed', () => {
      expect(component.statusClass('Closed')).toBe('closed');
    });

    it('should return status class for In Progress', () => {
      expect(component.statusClass('In Progress')).toBe('inprogress');
    });

    it('should return unknown for unknown status', () => {
      expect(component.statusClass('Unknown')).toBe('unknown');
    });
  });

  describe('assignedToDisplay', () => {
    it('should return assignee name when available', () => {
      const ticket: Ticket = { assignee: { firstName: 'John', lastName: 'Doe' } };
      expect(component.assignedToDisplay(ticket)).toBe('John Doe');
    });

    it('should return assignee email when name not available', () => {
      const ticket: Ticket = { assignee: { email: 'john@test.com' } };
      expect(component.assignedToDisplay(ticket)).toBe('john@test.com');
    });

    it('should return N/A when no assignee', () => {
      const ticket: Ticket = {};
      expect(component.assignedToDisplay(ticket)).toBe('N/A');
    });
  });

  describe('isAdmin getter', () => {
    it('should return true for admin role', () => {
      component.userRole = 'admin';
      expect(component.isAdmin).toBeTrue();
    });

    it('should return true for cloudops role', () => {
      component.userRole = 'cloudops';
      expect(component.isAdmin).toBeTrue();
    });

    it('should return true for itsm role', () => {
      component.userRole = 'itsm';
      expect(component.isAdmin).toBeTrue();
    });

    it('should return false for user role', () => {
      component.userRole = 'user';
      expect(component.isAdmin).toBeFalse();
    });
  });

  describe('Dialog methods', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    describe('openAssignDialog', () => {
      it('should open assign dialog with ticket info', () => {
        component.openAssignDialog('123', 'TKT-001');
        expect(component.showAssignDialog).toBeTrue();
        expect(component.assignTicketId).toBe('123');
        expect(component.assignTicketNumber).toBe('TKT-001');
        expect(component.isReassigning).toBeFalse();
      });
    });

    describe('openReassignDialog', () => {
      it('should open reassign dialog with ticket info', () => {
        component.openReassignDialog('123');
        expect(component.showAssignDialog).toBeTrue();
        expect(component.assignTicketId).toBe('123');
        expect(component.isReassigning).toBeTrue();
      });
    });

    describe('openBulkAssignDialog', () => {
      it('should open bulk assign dialog when tickets selected', () => {
        component.selectedTickets.add('1');
        component.selectedTickets.add('2');
        component.openBulkAssignDialog();
        expect(component.showBulkAssignDialog).toBeTrue();
      });

      it('should not open when no tickets selected', () => {
        component.openBulkAssignDialog();
        expect(component.showBulkAssignDialog).toBeFalse();
      });
    });

    describe('cancelDialogs', () => {
      it('should close all dialogs and reset state', () => {
        component.showAssignDialog = true;
        component.showBulkAssignDialog = true;
        component.showCloseDialog = true;
        component.showUpdateDialog = true;
        component.selectedAssignees = ['a@test.com'];
        component.bulkAssignees = ['b@test.com'];
        
        component.cancelDialogs();
        
        expect(component.showAssignDialog).toBeFalse();
        expect(component.showBulkAssignDialog).toBeFalse();
        expect(component.showCloseDialog).toBeFalse();
        expect(component.showUpdateDialog).toBeFalse();
        expect(component.selectedAssignees).toEqual([]);
        expect(component.bulkAssignees).toEqual([]);
      });
    });
  });

  describe('Selection methods', () => {
    beforeEach(() => {
      component.tickets = mockTickets;
    });

    it('should toggle ticket selection', () => {
      component.toggleSelectTicket('1');
      expect(component.selectedTickets.has('1')).toBeTrue();
      component.toggleSelectTicket('1');
      expect(component.selectedTickets.has('1')).toBeFalse();
    });

    it('should select all tickets when toggleSelectAll', () => {
      const event = { target: { checked: true } } as unknown as Event;
      component.toggleSelectAll(event);
      expect(component.selectedTickets.size).toBe(2);
    });

    it('should deselect all tickets when toggleSelectAll false', () => {
      component.selectedTickets.add('1');
      const event = { target: { checked: false } } as unknown as Event;
      component.toggleSelectAll(event);
      expect(component.selectedTickets.size).toBe(0);
    });

    it('should return true for isAllSelected when all selected', () => {
      component.selectedTickets.add('1');
      component.selectedTickets.add('2');
      expect(component.isAllSelected()).toBeTrue();
    });

    it('should return false for isAllSelected when not all selected', () => {
      component.selectedTickets.add('1');
      expect(component.isAllSelected()).toBeFalse();
    });
  });

  describe('updateTicket', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should open update dialog', () => {
      component.updateTicket('123');
      expect(component.showUpdateDialog).toBeTrue();
      expect(component.activeTicketId).toBe('123');
    });
  });

  describe('closeTicket', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
    }));

    it('should open close dialog', () => {
      component.closeTicket('123');
      expect(component.showCloseDialog).toBeTrue();
      expect(component.activeTicketId).toBe('123');
    });
  });

  describe('openTicket', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
      ticketServiceSpy.openTicket.and.returnValue(of({ success: true }));
    }));

    it('should call ticketService.openTicket', fakeAsync(() => {
      component.openTicket('123');
      tick();
      expect(ticketServiceSpy.openTicket).toHaveBeenCalledWith('123');
    }));
  });

  describe('confirmUpdate', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
      ticketServiceSpy.updateTicket.and.returnValue(of({ success: true }));
    }));

    it('should call updateTicket and close dialog', fakeAsync(() => {
      component.showUpdateDialog = true;
      component.activeTicketId = '123';
      component.updateStatus = 'Closed';
      component.updatePriority = 'High';
      
      component.confirmUpdate();
      tick();
      
      expect(ticketServiceSpy.updateTicket).toHaveBeenCalledWith('123', { status: 'Closed', priority: 'High' });
      expect(component.showUpdateDialog).toBeFalse();
    }));
  });

  describe('confirmClose', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
      ticketServiceSpy.closeTicket.and.returnValue(of({ success: true }));
    }));

    it('should call closeTicket and close dialog', fakeAsync(() => {
      component.showCloseDialog = true;
      component.activeTicketId = '123';
      
      component.confirmClose();
      tick();
      
      expect(ticketServiceSpy.closeTicket).toHaveBeenCalledWith('123', 'test@test.com');
      expect(component.showCloseDialog).toBeFalse();
    }));
  });

  describe('moveToRecycleBin', () => {
    beforeEach(fakeAsync(() => {
      localStorage.setItem('username', 'test@test.com');
      localStorage.setItem('role', 'admin');
      component.ngOnInit();
      tick();
      ticketServiceSpy.moveToRecycleBin.and.returnValue(of({ success: true }));
    }));

    it('should call moveToRecycleBin', fakeAsync(() => {
      const ticket = mockTickets[0];
      component.moveToRecycleBin(ticket);
      tick();
      expect(ticketServiceSpy.moveToRecycleBin).toHaveBeenCalledWith('1', ticket);
    }));
  });

  describe('viewTicket', () => {
    it('should navigate to ticket detail', () => {
      component.viewTicket('123');
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/tickets', '123']);
    });
  });
});