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
        path: 'admin/report',
        loadComponent: () =>
          import('./admin/report.component').then(m => m.ReportComponent)
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
      }
    ]
  },

  { path: '**', redirectTo: 'login' }
];
