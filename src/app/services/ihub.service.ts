import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface IhubAsset {
  id?: number;
  client: string;
  environment: string;
  hostname: string;
  ip_address: string;
  ihub_version?: string;
  license_expiry: string;
  responsible_person_email: string;
  responsible_person_name?: string;
  days_to_expiry?: number;
  created_at?: string;
  updated_at?: string;
}

export interface IhubResponsiblePerson {
  email: string;
  displayName: string;
}

export interface AssignableUserLite {
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class IhubService {
  private apiUrl = '/api/ihub';

  constructor(private http: HttpClient) {}

  private getAuthHeaders(extraHeaders?: Record<string, string>): HttpHeaders {
    const token = sessionStorage.getItem('accessToken') || '';
    let headers = new HttpHeaders({
      Authorization: `Bearer ${token}`
    });

    if (extraHeaders) {
      Object.keys(extraHeaders).forEach(key => {
        headers = headers.set(key, extraHeaders[key]);
      });
    }

    return headers;
  }

  getAssets(): Observable<IhubAsset[]> {
    return this.http.get<IhubAsset[]>(this.apiUrl, {
      headers: this.getAuthHeaders()
    });
  }

  createAsset(payload: IhubAsset): Observable<IhubAsset> {
    return this.http.post<IhubAsset>(this.apiUrl, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateAsset(assetId: number, payload: IhubAsset): Observable<IhubAsset> {
    return this.http.put<IhubAsset>(`${this.apiUrl}/${assetId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deleteAsset(assetId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${assetId}`, {
      headers: this.getAuthHeaders()
    });
  }

  getResponsiblePeople(groupEmail: string, graphToken: string): Observable<{ members: IhubResponsiblePerson[] }> {
    return this.http.get<{ members: IhubResponsiblePerson[] }>(
      `/api/admin/group-members?groupEmail=${encodeURIComponent(groupEmail)}`,
      {
        headers: this.getAuthHeaders({ 'x-graph-token': graphToken || '' })
      }
    );
  }

  getAssignableUsersFallback(): Observable<AssignableUserLite[]> {
    return this.http.get<AssignableUserLite[]>('/api/assignable-users', {
      headers: this.getAuthHeaders()
    });
  }

  closeIhubTicket(ticketId: string, newExpiryDate: string): Observable<{ message: string; license_expiry: string }> {
    return this.http.post<{ message: string; license_expiry: string }>(
      `${this.apiUrl}/tickets/${ticketId}/close`,
      { new_expiry_date: newExpiryDate },
      { headers: this.getAuthHeaders() }
    );
  }

  runExpiryCheck(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/run-expiry-check`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }
}
