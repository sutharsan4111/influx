import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AutomationSslService, AutomationSslEntry, AutomationSslMonitoredUrl } from './automation-ssl.service';
import { of } from 'rxjs';

describe('AutomationSslService', () => {
  let service: AutomationSslService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AutomationSslService]
    });

    service = TestBed.inject(AutomationSslService);
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

  describe('getEntries', () => {
    it('should GET entries with default status open', () => {
      const mockEntries: AutomationSslEntry[] = [
        { id: 1, alertname: 'SSL Expiry', milestone_days: 30, client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', status: 'open', created_at: '2025-01-01' }
      ];

      service.getEntries().subscribe(entries => {
        expect(entries).toEqual(mockEntries);
      });

      const req = httpMock.expectOne('/api/automation-ssl?status=open');
      expect(req.request.method).toBe('GET');
      req.flush(mockEntries);
    });

    it('should GET entries with custom status', () => {
      const mockEntries: AutomationSslEntry[] = [
        { id: 2, alertname: 'SSL Expiry', milestone_days: 30, client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', status: 'closed', created_at: '2025-01-01' }
      ];

      service.getEntries('closed').subscribe(entries => {
        expect(entries).toEqual(mockEntries);
      });

      const req = httpMock.expectOne('/api/automation-ssl?status=closed');
      expect(req.request.method).toBe('GET');
      req.flush(mockEntries);
    });

    it('should return cached entries when not forced refresh', () => {
      const mockEntries: AutomationSslEntry[] = [
        { id: 1, alertname: 'SSL Expiry', milestone_days: 30, client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', status: 'open', created_at: '2025-01-01' }
      ];

      service.getEntries('open').subscribe();
      httpMock.expectOne('/api/automation-ssl?status=open').flush(mockEntries);

      service.getEntries('open').subscribe(entries => {
        expect(entries).toEqual(mockEntries);
      });

      httpMock.expectNone('/api/automation-ssl?status=open');
    });

    it('should bypass cache when forceRefresh is true', () => {
      const mockEntries: AutomationSslEntry[] = [
        { id: 1, alertname: 'SSL Expiry', milestone_days: 30, client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', status: 'open', created_at: '2025-01-01' }
      ];

      service.getEntries('open').subscribe();
      httpMock.expectOne('/api/automation-ssl?status=open').flush(mockEntries);

      service.getEntries('open', true).subscribe();

      const req = httpMock.expectOne('/api/automation-ssl?status=open');
      expect(req.request.method).toBe('GET');
      req.flush(mockEntries);
    });
  });

  describe('getMonitoredUrls', () => {
    it('should GET monitored URLs', () => {
      const mockUrls: AutomationSslMonitoredUrl[] = [
        { client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', responsible: 'Admin', responsible_email: 'admin@test.com' }
      ];

      service.getMonitoredUrls().subscribe(urls => {
        expect(urls).toEqual(mockUrls);
      });

      const req = httpMock.expectOne('/api/automation-ssl/monitored-urls');
      expect(req.request.method).toBe('GET');
      req.flush(mockUrls);
    });

    it('should return cached URLs when not forced refresh', () => {
      const mockUrls: AutomationSslMonitoredUrl[] = [
        { client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', responsible: 'Admin', responsible_email: 'admin@test.com' }
      ];

      service.getMonitoredUrls().subscribe();
      httpMock.expectOne('/api/automation-ssl/monitored-urls').flush(mockUrls);

      service.getMonitoredUrls().subscribe(urls => {
        expect(urls).toEqual(mockUrls);
      });

      httpMock.expectNone('/api/automation-ssl/monitored-urls');
    });
  });

  describe('invalidateCache', () => {
    it('should clear all caches', () => {
      const mockEntries: AutomationSslEntry[] = [
        { id: 1, alertname: 'SSL Expiry', milestone_days: 30, client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', status: 'open', created_at: '2025-01-01' }
      ];
      const mockUrls: AutomationSslMonitoredUrl[] = [
        { client: 'Client A', environment: 'Prod', application: 'App1', ssl_url: 'https://app1.test.com', responsible: 'Admin', responsible_email: 'admin@test.com' }
      ];

      service.getEntries('open').subscribe();
      httpMock.expectOne('/api/automation-ssl?status=open').flush(mockEntries);

      service.getMonitoredUrls().subscribe();
      httpMock.expectOne('/api/automation-ssl/monitored-urls').flush(mockUrls);

      service.invalidateCache();

      service.getEntries('open').subscribe();
      httpMock.expectOne('/api/automation-ssl?status=open').flush(mockEntries);

      service.getMonitoredUrls().subscribe();
      httpMock.expectOne('/api/automation-ssl/monitored-urls').flush(mockUrls);
    });
  });
});