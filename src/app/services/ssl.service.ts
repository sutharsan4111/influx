import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface SslAsset {
  id?: number;
  client: string;
  environment: string;
  hostname: string;
  ip_address: string;
  application: string;
  version?: string;
  ssl_url: string;
  responsible_person_email: string;
  responsible_person_name?: string;
  ssl_expiry: string;
  days_to_expiry?: number;
  created_at?: string;
  updated_at?: string;
}

export interface SslResponsiblePerson {
  email: string;
  displayName: string;
}

export interface AssignableUserLite {
  email: string;
}

@Injectable({
  providedIn: 'root'
})
export class SslService {
  private apiUrl = '/api/ssl';
  private assetsCache: SslAsset[] | null = null;
  private alertTicketsCache: any[] | null = null;
  private responsiblePeopleCache = new Map<string, SslResponsiblePerson[]>();

  constructor(private http: HttpClient) {}

  private getAuthHeaders(extraHeaders?: Record<string, string>): HttpHeaders {
    const token = localStorage.getItem('accessToken') || '';
    let headers = new HttpHeaders({
      Authorization: `Bearer ${token}`
    });

    if (extraHeaders) {
      Object.keys(extraHeaders).forEach((key) => {
        headers = headers.set(key, extraHeaders[key]);
      });
    }

    return headers;
  }

  getAssets(forceRefresh = false): Observable<SslAsset[]> {
    if (!forceRefresh && this.assetsCache) {
      return of(this.assetsCache);
    }

    return this.http
      .get<SslAsset[]>(this.apiUrl, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        tap((assets) => {
          this.assetsCache = assets || [];
        })
      );
  }

  invalidateAssetsCache(): void {
    this.assetsCache = null;
  }

  createAsset(payload: SslAsset): Observable<SslAsset> {
    return this.http.post<SslAsset>(this.apiUrl, payload, {
      headers: this.getAuthHeaders()
    });
  }

  updateAsset(assetId: number, payload: SslAsset): Observable<SslAsset> {
    return this.http.put<SslAsset>(`${this.apiUrl}/${assetId}`, payload, {
      headers: this.getAuthHeaders()
    });
  }

  deleteAsset(assetId: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${assetId}`, {
      headers: this.getAuthHeaders()
    });
  }

  runExpiryCheck(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/run-expiry-check`,
      {},
      { headers: this.getAuthHeaders() }
    );
  }

  getAlertTickets(sslAssetId?: number, forceRefresh = false): Observable<any[]> {
    if (!sslAssetId && !forceRefresh && this.alertTicketsCache) {
      return of(this.alertTicketsCache);
    }

    const url = sslAssetId ? `${this.apiUrl}/alerts?ssl_asset_id=${sslAssetId}` : `${this.apiUrl}/alerts`;
    return this.http
      .get<any[]>(url, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        tap((alerts) => {
          if (!sslAssetId) {
            this.alertTicketsCache = alerts || [];
          }
        })
      );
  }

  invalidateAlertTicketsCache(): void {
    this.alertTicketsCache = null;
  }

  closeAlertTicket(
    zohoTicketId: string,
    newExpiryDate?: string
  ): Observable<{ message: string; ssl_expiry?: string }> {
    return this.http.post<{ message: string; ssl_expiry: string }>(
      `${this.apiUrl}/tickets/${zohoTicketId}/close`,
      newExpiryDate ? { new_expiry_date: newExpiryDate } : {},
      { headers: this.getAuthHeaders() }
    );
  }

  getResponsiblePeople(
    groupEmail: string,
    graphToken: string,
    forceRefresh = false
  ): Observable<{ members: SslResponsiblePerson[] }> {
    const cacheKey = (groupEmail || '').toLowerCase();
    const cachedMembers = this.responsiblePeopleCache.get(cacheKey);

    if (!forceRefresh && cachedMembers) {
      return of({ members: cachedMembers });
    }

    return this.http
      .get<{ members: SslResponsiblePerson[] }>(
        `/api/admin/group-members?groupEmail=${encodeURIComponent(groupEmail)}`,
        {
          headers: this.getAuthHeaders({ 'x-graph-token': graphToken || '' })
        }
      )
      .pipe(
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
}
