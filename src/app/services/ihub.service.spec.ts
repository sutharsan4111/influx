import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { IhubService, IhubAsset, IhubResponsiblePerson } from './ihub.service';

describe('IhubService', () => {
  let service: IhubService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [IhubService]
    });

    service = TestBed.inject(IhubService);
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

  describe('getAssets', () => {
    it('should GET assets from API', () => {
      const mockAssets: IhubAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'host1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });

      const req = httpMock.expectOne('/api/ihub');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush(mockAssets);
    });

    it('should return cached assets when not forced refresh', () => {
      const mockAssets: IhubAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'host1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });
      httpMock.expectOne('/api/ihub').flush(mockAssets);

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });

      httpMock.expectNone('/api/ihub');
    });

    it('should bypass cache when forceRefresh is true', () => {
      const mockAssets: IhubAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'host1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe();
      httpMock.expectOne('/api/ihub').flush(mockAssets);

      service.getAssets(true).subscribe();

      const req = httpMock.expectOne('/api/ihub');
      expect(req.request.method).toBe('GET');
      req.flush(mockAssets);
    });
  });

  describe('invalidateAssetsCache', () => {
    it('should clear assets cache', () => {
      const mockAssets: IhubAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'host1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe();
      httpMock.expectOne('/api/ihub').flush(mockAssets);

      service.invalidateAssetsCache();
      service.getAssets().subscribe();

      httpMock.expectOne('/api/ihub').flush(mockAssets);
    });
  });

  describe('createAsset', () => {
    it('should POST new asset', () => {
      const newAsset: IhubAsset = {
        client: 'New Client',
        environment: 'Dev',
        hostname: 'newhost',
        ip_address: '2.2.2.2',
        license_expiry: '2026-01-01',
        responsible_person_email: 'user@test.com'
      };

      const createdAsset: IhubAsset = { ...newAsset, id: 2 };

      service.createAsset(newAsset).subscribe(asset => {
        expect(asset).toEqual(createdAsset);
      });

      const req = httpMock.expectOne('/api/ihub');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newAsset);
      req.flush(createdAsset);
    });
  });

  describe('updateAsset', () => {
    it('should PUT updated asset', () => {
      const updatedAsset: IhubAsset = {
        id: 1,
        client: 'Updated Client',
        environment: 'Prod',
        hostname: 'host1',
        ip_address: '1.1.1.1',
        license_expiry: '2026-12-31',
        responsible_person_email: 'admin@test.com'
      };

      service.updateAsset(1, updatedAsset).subscribe(asset => {
        expect(asset).toEqual(updatedAsset);
      });

      const req = httpMock.expectOne('/api/ihub/1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updatedAsset);
      req.flush(updatedAsset);
    });
  });

  describe('deleteAsset', () => {
    it('should DELETE asset', () => {
      service.deleteAsset(1).subscribe(response => {
        expect(response).toEqual({ message: 'Deleted' });
      });

      const req = httpMock.expectOne('/api/ihub/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Deleted' });
    });
  });

  describe('getResponsiblePeople', () => {
    it('should GET responsible people with graph token', () => {
      const mockResponse = {
        members: [
          { email: 'user1@test.com', displayName: 'User One' },
          { email: 'user2@test.com', displayName: 'User Two' }
        ] as IhubResponsiblePerson[]
      };

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(req => req.url.includes('/api/admin/group-members'));
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockResponse);
    });

    it('should return cached people when not forced refresh', () => {
      const mockResponse = {
        members: [
          { email: 'user1@test.com', displayName: 'User One' }
        ] as IhubResponsiblePerson[]
      };

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe();
      httpMock.expectOne(req => req.url.includes('/api/admin/group-members')).flush(mockResponse);

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      httpMock.expectNone(req => req.url.includes('/api/admin/group-members'));
    });
  });

  describe('invalidateResponsiblePeopleCache', () => {
    it('should clear responsible people cache', () => {
      const mockResponse = { members: [{ email: 'user@test.com', displayName: 'User' }] as IhubResponsiblePerson[] };

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe();
      httpMock.expectOne(req => req.url.includes('/api/admin/group-members')).flush(mockResponse);

      service.invalidateResponsiblePeopleCache();
      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe();

      httpMock.expectOne(req => req.url.includes('/api/admin/group-members')).flush(mockResponse);
    });
  });

  describe('getAssignableUsersFallback', () => {
    it('should GET assignable users', () => {
      const mockUsers = [
        { email: 'user1@test.com' },
        { email: 'user2@test.com' }
      ];

      service.getAssignableUsersFallback().subscribe(users => {
        expect(users).toEqual(mockUsers);
      });

      const req = httpMock.expectOne('/api/assignable-users');
      expect(req.request.method).toBe('GET');
      req.flush(mockUsers);
    });
  });

  describe('closeIhubTicket', () => {
    it('should POST to close ticket with new expiry date', () => {
      const mockResponse = { message: 'Closed', license_expiry: '2026-06-30' };

      service.closeIhubTicket('123', '2026-06-30').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ihub/tickets/123/close');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ new_expiry_date: '2026-06-30' });
      req.flush(mockResponse);
    });
  });

  describe('runExpiryCheck', () => {
    it('should POST to run expiry check', () => {
      const mockResponse = { message: 'Expiry check completed' };

      service.runExpiryCheck().subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ihub/run-expiry-check');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});