import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { IhubCertificateService, IhubCertificateAsset, IhubCertificateResponsiblePerson } from './ihub-certificate.service';

describe('IhubCertificateService', () => {
  let service: IhubCertificateService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [IhubCertificateService]
    });

    service = TestBed.inject(IhubCertificateService);
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
    it('should GET IHUB certificate assets', () => {
      const mockAssets: IhubCertificateAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'ihub1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });

      const req = httpMock.expectOne('/api/ihub-certificate');
      expect(req.request.method).toBe('GET');
      req.flush(mockAssets);
    });

    it('should return cached assets when not forced refresh', () => {
      const mockAssets: IhubCertificateAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'ihub1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe();
      httpMock.expectOne('/api/ihub-certificate').flush(mockAssets);

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });

      httpMock.expectNone('/api/ihub-certificate');
    });
  });

  describe('invalidateAssetsCache', () => {
    it('should clear assets cache', () => {
      const mockAssets: IhubCertificateAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'ihub1', ip_address: '1.1.1.1', license_expiry: '2025-12-31', responsible_person_email: 'admin@test.com' }
      ];

      service.getAssets().subscribe();
      httpMock.expectOne('/api/ihub-certificate').flush(mockAssets);

      service.invalidateAssetsCache();
      service.getAssets().subscribe();

      httpMock.expectOne('/api/ihub-certificate').flush(mockAssets);
    });
  });

  describe('createAsset', () => {
    it('should POST new IHUB certificate asset', () => {
      const newAsset: IhubCertificateAsset = {
        client: 'New Client',
        environment: 'Dev',
        hostname: 'newhost',
        ip_address: '2.2.2.2',
        license_expiry: '2026-01-01',
        responsible_person_email: 'user@test.com'
      };

      const createdAsset: IhubCertificateAsset = { ...newAsset, id: 2 };

      service.createAsset(newAsset).subscribe(asset => {
        expect(asset).toEqual(createdAsset);
      });

      const req = httpMock.expectOne('/api/ihub-certificate');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newAsset);
      req.flush(createdAsset);
    });
  });

  describe('updateAsset', () => {
    it('should PUT updated IHUB certificate asset', () => {
      const updatedAsset: IhubCertificateAsset = {
        id: 1,
        client: 'Updated Client',
        environment: 'Prod',
        hostname: 'ihub1',
        ip_address: '1.1.1.1',
        license_expiry: '2026-12-31',
        responsible_person_email: 'admin@test.com'
      };

      service.updateAsset(1, updatedAsset).subscribe(asset => {
        expect(asset).toEqual(updatedAsset);
      });

      const req = httpMock.expectOne('/api/ihub-certificate/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedAsset);
    });
  });

  describe('deleteAsset', () => {
    it('should DELETE IHUB certificate asset', () => {
      service.deleteAsset(1).subscribe(response => {
        expect(response).toEqual({ message: 'Deleted' });
      });

      const req = httpMock.expectOne('/api/ihub-certificate/1');
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
        ] as IhubCertificateResponsiblePerson[]
      };

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(req => req.url.includes('/api/admin/group-members'));
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockResponse);
    });
  });

  describe('invalidateResponsiblePeopleCache', () => {
    it('should clear responsible people cache', () => {
      const mockResponse = { members: [{ email: 'user@test.com', displayName: 'User' }] as IhubCertificateResponsiblePerson[] };

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

  describe('closeIhubCertificateTicket', () => {
    it('should POST to close IHUB certificate ticket with new expiry date', () => {
      const mockResponse = { message: 'Closed', license_expiry: '2026-06-30' };

      service.closeIhubCertificateTicket('123', '2026-06-30').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ihub-certificate/tickets/123/close');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ new_expiry_date: '2026-06-30' });
      req.flush(mockResponse);
    });
  });

  describe('runExpiryCheck', () => {
    it('should POST to run IHUB certificate expiry check', () => {
      const mockResponse = { message: 'IHUB certificate expiry check completed' };

      service.runExpiryCheck().subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ihub-certificate/run-expiry-check');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});