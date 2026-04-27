import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface AutomationSslEntry {
  id: number;
  alertname: string;
  milestone_days: number;
  client: string;
  environment: string;
  application: string;
  ssl_url: string;
  responsible?: string;
  responsible_email?: string;
  zoho_ticket_id?: string;
  zoho_ticket_number?: string;
  status: string;
  estimated_expiry_on?: string;
  estimated_days_to_expiry?: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
}

export interface AutomationSslMonitoredUrl {
  client: string;
  environment: string;
  application: string;
  ssl_url: string;
  responsible?: string;
  responsible_email?: string;
  hostname?: string;
  ip_address?: string;
  version?: string;
  estimated_expiry_on?: string;
  estimated_days_to_expiry?: number;
  metric_value?: number;
}

@Injectable({
  providedIn: 'root'
})
export class AutomationSslService {
  private apiUrl = '/api/automation-ssl';
  private ticketCache = new Map<string, AutomationSslEntry[]>();
  private monitoredUrlsCache: AutomationSslMonitoredUrl[] | null = null;

  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = sessionStorage.getItem('accessToken') || '';
    return new HttpHeaders({
      Authorization: `Bearer ${token}`
    });
  }

  getEntries(status = 'open', forceRefresh = false): Observable<AutomationSslEntry[]> {
    const normalizedStatus = (status || 'open').toLowerCase();

    if (!forceRefresh && this.ticketCache.has(normalizedStatus)) {
      return of(this.ticketCache.get(normalizedStatus) || []);
    }

    const query = normalizedStatus ? `?status=${encodeURIComponent(normalizedStatus)}` : '';
    return this.http
      .get<AutomationSslEntry[]>(`${this.apiUrl}${query}`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        tap((rows) => {
          this.ticketCache.set(normalizedStatus, rows || []);
        })
      );
  }

  getMonitoredUrls(forceRefresh = false): Observable<AutomationSslMonitoredUrl[]> {
    if (!forceRefresh && this.monitoredUrlsCache) {
      return of(this.monitoredUrlsCache);
    }

    return this.http
      .get<AutomationSslMonitoredUrl[]>(`${this.apiUrl}/monitored-urls`, {
        headers: this.getAuthHeaders()
      })
      .pipe(
        tap((rows) => {
          this.monitoredUrlsCache = rows || [];
        })
      );
  }

  invalidateCache(): void {
    this.ticketCache.clear();
    this.monitoredUrlsCache = null;
  }
}
