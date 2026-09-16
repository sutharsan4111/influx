import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { SslService, SslAsset } from './ssl.service';

describe('SslService', () => {
  let service: SslService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [SslService]
    });

    service = TestBed.inject(SslService);
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
    it('should GET SSL assets', () => {
      const mockAssets: SslAsset[] = [
        { id: 1, client: 'Client A', environment: 'Prod', hostname: 'app1', ip_address: '1.1.1.1', application: 'App1', ssl_url: 'https://app1.test.com', responsible_person_email: 'admin@test.com', ssl_expiry: '2025-12-31' }
      ];

      service.getAssets().subscribe(assets => {
        expect(assets).toEqual(mockAssets);
      });

      const req = httpMock.expectOne('/api/ssl');
      expect(req.request.method).toBe('GET');
      req.flush(mockAssets);
    });
  });

  describe('createAsset', () => {
    it('should POST new SSL asset', () => {
      const newAsset: SslAsset = {
        client: 'New Client',
        environment: 'Dev',
        hostname: 'newhost',
        ip_address: '2.2.2.2',
        application: 'NewApp',
        ssl_url: 'https://newapp.test.com',
        responsible_person_email: 'user@test.com',
        ssl_expiry: '2026-01-01'
      };

      const createdAsset: SslAsset = { ...newAsset, id: 2 };

      service.createAsset(newAsset).subscribe(asset => {
        expect(asset).toEqual(createdAsset);
      });

      const req = httpMock.expectOne('/api/ssl');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newAsset);
      req.flush(createdAsset);
    });
  });

  describe('updateAsset', () => {
    it('should PUT updated SSL asset', () => {
      const updatedAsset: SslAsset = {
        id: 1,
        client: 'Updated Client',
        environment: 'Prod',
        hostname: 'host1',
        ip_address: '1.1.1.1',
        application: 'App1',
        ssl_url: 'https://app1.test.com',
        responsible_person_email: 'admin@test.com',
        ssl_expiry: '2026-12-31'
      };

      service.updateAsset(1, updatedAsset).subscribe(asset => {
        expect(asset).toEqual(updatedAsset);
      });

      const req = httpMock.expectOne('/api/ssl/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedAsset);
    });
  });

  describe('deleteAsset', () => {
    it('should DELETE SSL asset', () => {
      service.deleteAsset(1).subscribe(response => {
        expect(response).toEqual({ message: 'Deleted' });
      });

      const req = httpMock.expectOne('/api/ssl/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ message: 'Deleted' });
    });
  });

  describe('getResponsiblePeople', () => {
    it('should GET responsible people with graph token', () => {
      const mockResponse = { members: [{ email: 'user@test.com', displayName: 'User' }] };

      service.getResponsiblePeople('group@test.com', 'graph-token').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(req => req.url.includes('/api/admin/group-members'));
      expect(req.request.headers.get('x-graph-token')).toBe('graph-token');
      req.flush(mockResponse);
    });
  });

  describe('closeAlertTicket', () => {
    it('should POST to close alert ticket with new expiry', () => {
      const mockResponse = { message: 'Closed', ssl_expiry: '2026-06-30' };

      service.closeAlertTicket('123', '2026-06-30').subscribe((response: any) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ssl/tickets/123/close');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ new_expiry_date: '2026-06-30' });
      req.flush(mockResponse);
    });

    it('should POST to close alert ticket without expiry', () => {
      const mockResponse = { message: 'Closed' };

      service.closeAlertTicket('123').subscribe((response: any) => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ssl/tickets/123/close');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(mockResponse);
    });
  });

  describe('runExpiryCheck', () => {
    it('should POST to run SSL expiry check', () => {
      const mockResponse = { message: 'SSL expiry check completed' };

      service.runExpiryCheck().subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/ssl/run-expiry-check');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });
});