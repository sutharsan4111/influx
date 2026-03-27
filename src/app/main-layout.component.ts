// src/app/main-layout.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header/header.component';
import { SidebarComponent } from './sidebar/sidebar.component';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    RouterOutlet,
    HeaderComponent,
    SidebarComponent
  ],
  template: `
    <div class="layout">

      <app-header></app-header>

      <div class="body">

        <aside class="sidebar-wrapper">
          <app-sidebar></app-sidebar>
        </aside>

        <main class="content-wrapper">
          <router-outlet></router-outlet>
        </main>

      </div>
    </div>
  `,
  styles: [`
    :host {
      height: 100%;
      display: block;
    }

    .layout {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 100%;
      padding-top: 40px;
    }

    .body {
      flex: 1;
      display: flex;
      overflow: hidden;
      min-width: 0;
      height: calc(100% - 40px);
    }

    .sidebar-wrapper {
      width: 140px;
      flex-shrink: 0;
      border-right: 1px solid #e5e7eb;
      background: var(--card-bg, #fff);
      position: fixed;
      top: 40px;
      left: 0;
      height: calc(100% - 40px);
      overflow: visible;
      z-index: 100;
    }

    .content-wrapper {
      flex: 1;
      padding: 12px;
      background: var(--app-bg-alt, #f7f9fb);
      overflow-y: auto;
      border-radius: 10px 0 0 0;
      min-width: 0;
      overflow-x: hidden;
      height: calc(100% - 40px);
      margin-left: 140px;
      position: relative;
      z-index: 1;
    }

    @media (max-width: 1100px) {
      .sidebar-wrapper {
        width: 120px;
      }

      .content-wrapper {
        margin-left: 120px;
        padding: 10px;
      }
    }

    @media (max-width: 900px) {
      .body {
        flex-direction: column;
        overflow: visible;
        height: auto;
      }

      .sidebar-wrapper {
        position: static;
        width: 100%;
        height: auto;
        border-right: none;
        border-bottom: 1px solid #e5e7eb;
      }

      .content-wrapper {
        margin-left: 0;
        height: auto;
        border-radius: 0;
        padding: 16px;
      }
    }
  `]
})
export class MainLayoutComponent {}
