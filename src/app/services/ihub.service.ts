import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

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
  private assetsCache: IhubAsset[] | null = null;
  private responsiblePeopleCache = new Map<string, IhubResponsiblePerson[]>();

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

  getAssets(forceRefresh = false): Observable<IhubAsset[]> {
    if (!forceRefresh && this.assetsCache) {
      return of(this.assetsCache);
    }

    return this.http.get<IhubAsset[]>(this.apiUrl, {
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

  getResponsiblePeople(groupEmail: string, graphToken: string, forceRefresh = false): Observable<{ members: IhubResponsiblePerson[] }> {
    const cacheKey = (groupEmail || '').toLowerCase();
    const cachedMembers = this.responsiblePeopleCache.get(cacheKey);

    if (!forceRefresh && cachedMembers) {
      return of({ members: cachedMembers });
    }

    return this.http.get<{ members: IhubResponsiblePerson[] }>(
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
