import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CloudOpsAssetsService, AssetPage, AssetColumn, AssetRow } from './cloudops-assets.service';

describe('CloudOpsAssetsService', () => {
  let service: CloudOpsAssetsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CloudOpsAssetsService]
    });

    service = TestBed.inject(CloudOpsAssetsService);
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

  describe('getPages', () => {
    it('should GET all asset pages', () => {
      const mockPages: AssetPage[] = [
        { id: 1, name: 'master', display_name: 'Master Page', description: 'Main asset page', column_count: 5, row_count: 10 }
      ];

      service.getPages().subscribe(pages => {
        expect(pages).toEqual(mockPages);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages');
      expect(req.request.method).toBe('GET');
      req.flush(mockPages);
    });
  });

  describe('getPage', () => {
    it('should GET single asset page', () => {
      const mockPage: AssetPage = { id: 1, name: 'master', display_name: 'Master Page', columns: [], rows: [] };

      service.getPage(1).subscribe(page => {
        expect(page).toEqual(mockPage);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockPage);
    });
  });

  describe('createPage', () => {
    it('should POST new asset page', () => {
      const payload = { name: 'new-page', display_name: 'New Page', description: 'Test page' };
      const createdPage: AssetPage = { id: 2, ...payload, column_count: 0, row_count: 0 };

      service.createPage(payload).subscribe(page => {
        expect(page).toEqual(createdPage);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(createdPage);
    });
  });

  describe('updatePage', () => {
    it('should PUT updated asset page', () => {
      const payload = { display_name: 'Updated Page', description: 'Updated desc', page_order: 2 };
      const updatedPage: AssetPage = { id: 1, name: 'master', ...payload };

      service.updatePage(1, payload).subscribe(page => {
        expect(page).toEqual(updatedPage);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedPage);
    });
  });

  describe('deletePage', () => {
    it('should DELETE asset page', () => {
      service.deletePage(1).subscribe();

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('addColumn', () => {
    it('should POST new column', () => {
      const column: Partial<AssetColumn> = { name: 'hostname', display_name: 'Hostname', data_type: 'text', is_required: true };
      const createdColumn: AssetColumn = { id: 1, page_id: 1, ...column } as AssetColumn;

      service.addColumn(1, column).subscribe(col => {
        expect(col).toEqual(createdColumn);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/columns');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(column);
      req.flush(createdColumn);
    });
  });

  describe('updateColumn', () => {
    it('should PUT updated column', () => {
      const column: Partial<AssetColumn> = { display_name: 'Updated Hostname', is_required: false };
      const updatedColumn: AssetColumn = { id: 1, page_id: 1, name: 'hostname', ...column } as AssetColumn;

      service.updateColumn(1, 1, column).subscribe(col => {
        expect(col).toEqual(updatedColumn);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/columns/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedColumn);
    });
  });

  describe('deleteColumn', () => {
    it('should DELETE column', () => {
      service.deleteColumn(1, 1).subscribe();

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/columns/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });

  describe('reorderColumns', () => {
    it('should PUT column reorder', () => {
      const columnIds = [3, 1, 2];

      service.reorderColumns(1, columnIds).subscribe();

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/columns/reorder');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ columnIds });
      req.flush({});
    });
  });

  describe('getRows', () => {
    it('should GET rows for page', () => {
      const mockRows: AssetRow[] = [
        { id: 1, page_id: 1, row_data: { hostname: 'host1' }, row_order: 1 }
      ];
      const mockResponse = { rows: mockRows, total: 1 };

      service.getRows(1).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/rows?limit=500');
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('createRow', () => {
    it('should POST new row', () => {
      const row_data = { hostname: 'newhost', environment: 'Dev' };
      const createdRow: AssetRow = { id: 2, page_id: 1, row_data, row_order: 2 };

      service.createRow(1, row_data).subscribe(row => {
        expect(row).toEqual(createdRow);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/rows');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ row_data });
      req.flush(createdRow);
    });
  });

  describe('updateRow', () => {
    it('should PUT updated row', () => {
      const row_data = { hostname: 'updatedhost', environment: 'Prod' };
      const updatedRow: AssetRow = { id: 1, page_id: 1, row_data, row_order: 1 };

      service.updateRow(1, 1, row_data).subscribe(row => {
        expect(row).toEqual(updatedRow);
      });

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/rows/1');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedRow);
    });
  });

  describe('deleteRow', () => {
    it('should DELETE row', () => {
      service.deleteRow(1, 1).subscribe();

      const req = httpMock.expectOne('/api/cloudops/assets/pages/1/rows/1');
      expect(req.request.method).toBe('DELETE');
      req.flush({});
    });
  });
});