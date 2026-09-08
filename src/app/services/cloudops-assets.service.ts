import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AssetColumn {
  id?: number;
  page_id?: number;
  name: string;
  display_name: string;
  data_type: 'text' | 'number' | 'date' | 'boolean' | 'select' | 'email' | 'url';
  column_order?: number;
  is_required?: boolean;
  default_value?: string | null;
  select_options?: string[] | null;
  validation_regex?: string | null;
  is_visible?: boolean;
}

export interface AssetRow {
  id?: number;
  page_id?: number;
  row_data: { [key: string]: any };
  row_order?: number;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AssetPage {
  id?: number;
  name: string;
  display_name: string;
  description?: string;
  is_system_page?: boolean;
  page_order?: number;
  column_count?: number;
  row_count?: number;
  columns?: AssetColumn[];
  rows?: AssetRow[];
}

@Injectable({ providedIn: 'root' })
export class CloudOpsAssetsService {
  private api = '/api/cloudops/assets';

  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('accessToken') || '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getPages(): Observable<AssetPage[]> {
    return this.http.get<AssetPage[]>(`${this.api}/pages`, { headers: this.getAuthHeaders() });
  }

  getPage(pageId: number): Observable<AssetPage> {
    return this.http.get<AssetPage>(`${this.api}/pages/${pageId}`, { headers: this.getAuthHeaders() });
  }

  createPage(payload: { name: string; display_name: string; description?: string; columns?: Partial<AssetColumn>[] }): Observable<AssetPage> {
    return this.http.post<AssetPage>(`${this.api}/pages`, payload, { headers: this.getAuthHeaders() });
  }

  updatePage(pageId: number, payload: { display_name: string; description?: string; page_order?: number }): Observable<AssetPage> {
    return this.http.put<AssetPage>(`${this.api}/pages/${pageId}`, payload, { headers: this.getAuthHeaders() });
  }

  deletePage(pageId: number): Observable<any> {
    return this.http.delete(`${this.api}/pages/${pageId}`, { headers: this.getAuthHeaders() });
  }

  addColumn(pageId: number, column: Partial<AssetColumn>): Observable<AssetColumn> {
    return this.http.post<AssetColumn>(`${this.api}/pages/${pageId}/columns`, column, { headers: this.getAuthHeaders() });
  }

  updateColumn(pageId: number, columnId: number, column: Partial<AssetColumn>): Observable<AssetColumn> {
    return this.http.put<AssetColumn>(`${this.api}/pages/${pageId}/columns/${columnId}`, column, { headers: this.getAuthHeaders() });
  }

  deleteColumn(pageId: number, columnId: number): Observable<any> {
    return this.http.delete(`${this.api}/pages/${pageId}/columns/${columnId}`, { headers: this.getAuthHeaders() });
  }

  reorderColumns(pageId: number, columnIds: number[]): Observable<any> {
    return this.http.put(`${this.api}/pages/${pageId}/columns/reorder`, { columnIds }, { headers: this.getAuthHeaders() });
  }

  getRows(pageId: number): Observable<{ rows: AssetRow[]; total: number }> {
    return this.http.get<{ rows: AssetRow[]; total: number }>(`${this.api}/pages/${pageId}/rows?limit=500`, { headers: this.getAuthHeaders() });
  }

  createRow(pageId: number, row_data: { [key: string]: any }): Observable<AssetRow> {
    return this.http.post<AssetRow>(`${this.api}/pages/${pageId}/rows`, { row_data }, { headers: this.getAuthHeaders() });
  }

  updateRow(pageId: number, rowId: number, row_data: { [key: string]: any }): Observable<AssetRow> {
    return this.http.put<AssetRow>(`${this.api}/pages/${pageId}/rows/${rowId}`, { row_data }, { headers: this.getAuthHeaders() });
  }

  deleteRow(pageId: number, rowId: number): Observable<any> {
    return this.http.delete(`${this.api}/pages/${pageId}/rows/${rowId}`, { headers: this.getAuthHeaders() });
  }
}
