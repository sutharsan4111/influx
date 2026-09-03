import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface IhubCertificateAsset {
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

export interface IhubCertificateResponsiblePerson {
  email: string;
  displayName: string;
}

export interface AssignableUserLite {
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class IhubCertificateService {
  private apiUrl = '/api/ihub-certificate';
  private assetsCache: IhubCertificateAsset[] | null = null;
  private responsiblePeopleCache = new Map<string, IhubCertificateResponsiblePerson[]>();

  constructor(private http: HttpClient) {}

  private getAuthHeaders(extraHeaders?: Record<string, string>): HttpHeaders {
    const token = localStorage.getItem('accessToken') || '';
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

  getAssets(forceRefresh = false): Observable<IhubCertificateAsset[]> {
    if (!forceRefresh && this.assetsCache) {
      return of(this.assetsCache);
    }

    return this.http.get<IhubCertificateAsset[]>(this.apiUrl, {
      headers: this.getAuthHeaders()
    }).pipe(
      tap((assets) => {
        this.assetsCache = assets || [];
      })
    );
  }

  invalidateAssetsCache(): void {
    this.assetsCache = null;
  }

  createAsset(payload: IhubCertificateAsset): Observable<IhubCertificateAsset> {
    return this.http.post<IhubCertificateAsset>(this.apiUrl, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateAsset(assetId: number, payload: IhubCertificateAsset): Observable<IhubCertificateAsset> {
    return this.http.put<IhubCertificateAsset>(`${this.apiUrl}/${assetId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deleteAsset(assetId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${assetId}`, {
      headers: this.getAuthHeaders()
    });
  }

  getResponsiblePeople(groupEmail: string, graphToken: string, forceRefresh = false): Observable<{ members: IhubCertificateResponsiblePerson[] }> {
    const cacheKey = (groupEmail || '').toLowerCase();
    const cachedMembers = this.responsiblePeopleCache.get(cacheKey);

    if (!forceRefresh && cachedMembers) {
      return of({ members: cachedMembers });
    }

    return this.http.get<{ members: IhubCertificateResponsiblePerson[] }>(
      `/api/admin/group-members?groupEmail=${encodeURIComponent(groupEmail)}`,
      {
        headers: this.getAuthHeaders({ 'x-graph-token': graphToken || '' })
      }
    ).pipe(
      tap((response) => {
        this.responsiblePeopleCache.set(cacheKey, response?.members || []);
      })
    );
  }

  invalidateResponsiblePeopleCache(): void {
    this.responsiblePeopleCache.clear();
  }

  getAssignableUsersFallback(): Observable<AssignableUserLite[]> {
    return this.http.get<AssignableUserLite[]>('/api/assignable-users', {
      headers: this.getAuthHeaders()
    });
  }

  closeIhubCertificateTicket(ticketId: string, newExpiryDate: string): Observable<{ message: string; license_expiry: string }> {
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
