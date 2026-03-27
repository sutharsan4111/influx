// src/app/app.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet, RouterModule } from '@angular/router';
import { filter } from 'rxjs/operators';
import { LoadingOverlayComponent } from './shared/loading-overlay.component';
import { MessageAlertComponent } from './shared/message-alert.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    RouterOutlet,
    LoadingOverlayComponent,
    MessageAlertComponent
  ],
  template: `
    <router-outlet></router-outlet>

    <app-loading-overlay></app-loading-overlay>
    <app-message-alert></app-message-alert>
  `,
  styles: [`
  `]
})
export class AppComponent {

  title = 'Ticket Management System';

  constructor(private router: Router) {
  }
}
