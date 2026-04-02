import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PublicClientApplication } from '@azure/msal-browser';


@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div class="header-container">

    <div class="left">
      <img
        src="assets/MuraaiLogo.png"
        alt="Muraai Logo"
        class="logo-img"
      />
    </div>

      <div class="right">
        <button class="theme-toggle" (click)="toggleTheme()" [title]="isDarkTheme ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
          <div class="theme-icon-wrapper" [class.dark]="isDarkTheme">
            <img *ngIf="isDarkTheme" src="assets/batman.svg" class="theme-icon batman" alt="Dark Mode" />
            <img *ngIf="!isDarkTheme" src="assets/superman.svg" class="theme-icon superman" alt="Light Mode" />
          </div>
        </button>
    </div>

  </div>
`,
  styles: [`
    .header-container {
      width: 100%;
      height: 40px;
      background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
      box-shadow: 0 1px 6px rgba(0, 0, 0, 0.05);
      position: fixed;
      top: 0;
      left: 0;
      z-index: 1000;
      padding: 0 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #e2e8f0;
    }

    .logo-text {
      font-size: 0.875rem;
      font-weight: 700;
      background: linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Theme Toggle - Batman/Superman */
    .theme-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
      border: 1px solid #cbd5e1;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.3s ease;
      width: 26px;
      height: 26px;
    }

    .theme-toggle:hover {
      border-color: #3b82f6;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
      transform: translateY(-1px);
    }

    .theme-icon-wrapper {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s ease;
      background: #fef3c7;
      border: 1px solid #fbbf24;
    }

    .theme-icon-wrapper.dark {
      background: #1e293b;
      border-color: #475569;
    }

    .theme-icon {
      width: 10px;
      height: 10px;
      transition: transform 0.3s ease;
    }

    .theme-icon.batman {
      filter: invert(1);
    }

    .theme-icon.superman {
      color: #dc2626;
    }

    .theme-toggle:hover .theme-icon {
      transform: scale(1.15);
    }

    .left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .logo-img {
      height: 22px;
      width: auto;
    }

    /* Dark Theme */
    :host-context(.dark-theme) .header-container {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      border-bottom-color: #334155;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
    }

    :host-context(.dark-theme) .logo-text {
      background: linear-gradient(135deg, #60a5fa 0%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    :host-context(.dark-theme) .theme-toggle {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border-color: #475569;
    }

    :host-context(.dark-theme) .theme-toggle:hover {
      border-color: #60a5fa;
      box-shadow: 0 4px 15px rgba(96, 165, 250, 0.25);
    }
  `]
})
export class HeaderComponent implements OnInit {

  constructor(
    private router: Router,
    @Inject('MSAL_INSTANCE') private msal: PublicClientApplication
  ) {}

  isDarkTheme = false;

  ngOnInit(): void {
    this.initTheme();
  }

  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    this.applyTheme(this.isDarkTheme);
  }


  private initTheme(): void {
    const stored = localStorage.getItem('theme');
    this.isDarkTheme = stored === 'dark';
    this.applyTheme(this.isDarkTheme);
  }

  private applyTheme(isDark: boolean): void {
    document.body.classList.toggle('dark-theme', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }
}