import { Routes } from '@angular/router';
import { MainLayoutComponent } from './main-layout.component';
import { AuthGuard } from './auth.guard';
import { TicketDetailComponent } from './ticket-detail.component';

export const routes: Routes = [

  {
    path: 'login',
    loadComponent: () =>
      import('./login/login.component').then(m => m.LoginComponent)
  },

  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [AuthGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },

      {
        path: 'dashboard',
        loadComponent: () =>
          import('./dashboard/dashboard.component').then(m => m.DashboardComponent)
      },
      {
        path: 'tickets',
        loadComponent: () =>
          import('./tickets/tickets.component').then(m => m.TicketsComponent)
      },
      {
        path: 'recycle-bin',
        loadComponent: () =>
          import('./recycle-bin/recycle-bin.component').then(m => m.RecycleBinComponent)
      },
      {
        path: 'tickets/:id',
        component: TicketDetailComponent
      },
      {
        path: 'create-ticket',
        loadComponent: () =>
          import('./create-ticket/create-ticket.component').then(m => m.CreateTicketComponent)
      },
      {
        path: 'admin',
        loadComponent: () =>
          import('./admin/admin.component').then(m => m.AdminComponent)
      },
      {
        path: 'monitoring',
        loadComponent: () =>
          import('./monitoring/monitoring-shell.component').then(m => m.MonitoringShellComponent),
        children: [
          { path: '', redirectTo: 'assets', pathMatch: 'full' },
          {
            path: 'assets',
            loadComponent: () =>
              import('./monitoring/asset-monitoring.component').then(m => m.AssetMonitoringComponent)
          },
          {
            path: 'azure',
            loadComponent: () =>
              import('./monitoring/azure-monitoring.component').then(m => m.AzureMonitoringComponent)
          }
        ]
      },
      {
        path: 'admin/user-roles',
        loadComponent: () =>
          import('./admin/user-roles.component').then(m => m.UserRolesComponent)
      },
      {
        path: 'infrastructure',
        loadComponent: () =>
          import('./admin/infrastructure.component').then(m => m.InfrastructureComponent),
        children: [
          { path: '', redirectTo: 'ssl', pathMatch: 'full' },
          {
            path: 'ssl',
            loadComponent: () =>
              import('./admin/ssl.component').then(m => m.SslComponent)
          },
          {
            path: 'ihub',
            loadComponent: () =>
              import('./admin/ihub.component').then(m => m.IhubComponent)
          },
          {
            path: 'automation-ssl',
            loadComponent: () =>
              import('./admin/automation-ssl.component').then(m => m.AutomationSslComponent)
          }
        ]
      },
      {
        path: 'ihub',
        redirectTo: 'infrastructure/ihub',
        pathMatch: 'full'
      },
      {
        path: 'ssl',
        redirectTo: 'infrastructure/ssl',
        pathMatch: 'full'
      },
      {
        path: 'automation-ssl',
        redirectTo: 'infrastructure/automation-ssl',
        pathMatch: 'full'
      }
    ]
  },

  { path: '**', redirectTo: 'login' }
];
