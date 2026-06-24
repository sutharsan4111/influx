import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AssetMonitoringRecord {
  asset_id: string;
  hostname: string;
  owner_email: string;
  status: string;
  last_seen: string;
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  primary_issue?: string;
}

export interface AzureMetricRecord {
  resource_id: string;
  resource_name: string;
  resource_type: string;
  status: string;
  region: string;
  cpu_percent?: number;
  memory_percent?: number;
  storage_gb?: number;
  last_updated: string;
}

@Injectable({
  providedIn: 'root'
})
export class MonitoringService {
  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = sessionStorage.getItem('accessToken') || '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getAssetsByUser(userEmail: string): Observable<AssetMonitoringRecord[]> {
    return this.http.get<AssetMonitoringRecord[]>(`/api/monitoring/assets?userEmail=${encodeURIComponent(userEmail)}`, {
      headers: this.getAuthHeaders()
    });
  }

  getAzureResourcesByUser(userEmail: string): Observable<AzureMetricRecord[]> {
    return this.http.get<AzureMetricRecord[]>(`/api/monitoring/azure?userEmail=${encodeURIComponent(userEmail)}`, {
      headers: this.getAuthHeaders()
    });
  }

  runBackupReport(): Observable<any> {
    return this.http.post('/api/monitoring/azure/run-report', {}, { headers: this.getAuthHeaders() });
  }

  getBackupReportLog(): Observable<any> {
    return this.http.get('/api/monitoring/azure/report-log', { headers: this.getAuthHeaders() });
  }
}
