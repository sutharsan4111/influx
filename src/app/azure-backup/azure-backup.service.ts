import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, timeout } from 'rxjs';

export interface BackupItem {
  subscription: string;
  resourceGroup: string;
  vault: string;
  type: string;
  resource: string;
  rawResource?: string;
  consistency: string;
  recoveryType: string;
  latestRecoveryPoint: string;
  lastBackupStatus: string;
  status: string;
}

export interface VaultGroup {
  name: string;
  resourceGroup: string;
  items: BackupItem[];
  vmCount: number;
  fileShareCount: number;
}

export interface SubscriptionGroup {
  name: string;
  id: string;
  totalItems: number;
  healthy: number;
  warning: number;
  failed: number;
  vmCount: number;
  fileShareCount: number;
  vaults: VaultGroup[];
}

export interface BackupReport {
  file: string;
  generatedAt: string;
  totalRecords: number;
  healthy: number;
  warning: number;
  failed: number;
  totalVms: number;
  totalFileShares: number;
  consistencyCounts: { application: number; crash: number; filesystem: number };
  consistencyDetails: {
    application: { count: number; items: BackupItem[] };
    crash: { count: number; items: BackupItem[] };
    filesystem: { count: number; items: BackupItem[] };
  };
  items: BackupItem[];
  subscriptions: SubscriptionGroup[];
}

export interface BackupReportStatus {
  running: boolean;
  lastAttempt: string;
  lastSuccess: string;
  lastError: string;
}

@Injectable({ providedIn: 'root' })
export class AzureBackupService {
  constructor(private http: HttpClient) {}

  private getAuthHeaders(): HttpHeaders {
    const token = localStorage.getItem('accessToken') || '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getReport(): Observable<BackupReport> {
    return this.http.get<BackupReport>('/api/monitoring/azure/report-log', {
      headers: this.getAuthHeaders()
    });
  }

  getStatus(): Observable<BackupReportStatus> {
    return this.http.get<BackupReportStatus>('/api/monitoring/azure/report-status', {
      headers: this.getAuthHeaders()
    });
  }

  runReport(azureToken?: string): Observable<{ status: string; report: BackupReport }> {
    let headers = this.getAuthHeaders();
    if (azureToken) {
      headers = headers.set('x-azure-token', azureToken);
    }
    return this.http.post<{ status: string; report: BackupReport }>(
      '/api/monitoring/azure/run-report', {}, { headers }
    ).pipe(timeout(180000)); // 3 minutes
  }
}












// import { Injectable } from '@angular/core';
// import { HttpClient, HttpHeaders } from '@angular/common/http';
// import { Observable, timeout } from 'rxjs';

// export interface BackupItem {
//   subscription: string;
//   resourceGroup: string;
//   vault: string;
//   type: string;
//   resource: string;
//   rawResource?: string;
//   consistency: string;
//   recoveryType: string;
//   latestRecoveryPoint: string;
//   lastBackupStatus: string;
//   status: string;
// }

// export interface VaultGroup {
//   name: string;
//   resourceGroup: string;
//   items: BackupItem[];
//   vmCount: number;
//   fileShareCount: number;
// }

// export interface SubscriptionGroup {
//   name: string;
//   id: string;
//   totalItems: number;
//   vaults: VaultGroup[];
// }

// export interface BackupReport {
//   file: string;
//   generatedAt: string;
//   totalRecords: number;
//   healthy: number;
//   warning: number;
//   failed: number;
//   totalVms: number;
//   totalFileShares: number;
//   consistencyCounts: { application: number; crash: number; filesystem: number };
//   consistencyDetails: {
//     application: { count: number; items: BackupItem[] };
//     crash: { count: number; items: BackupItem[] };
//     filesystem: { count: number; items: BackupItem[] };
//   };
//   items: BackupItem[];
//   subscriptions: SubscriptionGroup[];
// }

// export interface BackupReportStatus {
//   running: boolean;
//   lastAttempt: string;
//   lastSuccess: string;
//   lastError: string;
// }

// @Injectable({ providedIn: 'root' })
// export class AzureBackupService {
//   constructor(private http: HttpClient) {}

//   private getAuthHeaders(): HttpHeaders {
//     const token = localStorage.getItem('accessToken') || '';
//     return new HttpHeaders({ Authorization: `Bearer ${token}` });
//   }

//   getReport(): Observable<BackupReport> {
//     return this.http.get<BackupReport>('/api/monitoring/azure/report-log', {
//       headers: this.getAuthHeaders()
//     });
//   }

//   getStatus(): Observable<BackupReportStatus> {
//     return this.http.get<BackupReportStatus>('/api/monitoring/azure/report-status', {
//       headers: this.getAuthHeaders()
//     });
//   }

//   runReport(azureToken?: string): Observable<{ status: string; report: BackupReport }> {
//     let headers = this.getAuthHeaders();
//     if (azureToken) {
//       headers = headers.set('x-azure-token', azureToken);
//     }
//     return this.http.post<{ status: string; report: BackupReport }>(
//       '/api/monitoring/azure/run-report', {}, { headers }
//     ).pipe(timeout(180000)); // 3 minutes
//   }
// }
