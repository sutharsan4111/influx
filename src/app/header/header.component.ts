import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { PublicClientApplication } from '@azure/msal-browser';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ReportSuggestionModalComponent } from './report-suggestion-modal.component';


@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, ReportSuggestionModalComponent],
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
      <button class="features-btn" (click)="openFeatures()" title="View Features">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
      </button>
      <button class="theme-toggle" (click)="toggleTheme()" [title]="isDarkTheme ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
        <div class="theme-icon-wrapper" [class.dark]="isDarkTheme">
          <img *ngIf="isDarkTheme" src="assets/batman.svg" class="theme-icon batman" alt="Dark Mode" />
          <img *ngIf="!isDarkTheme" src="assets/superman.svg" class="theme-icon superman" alt="Light Mode" />
        </div>
      </button>
      <button class="report-btn" (click)="openReportModal()" title="Report Issue or Suggestion" aria-label="Report feedback">
        <svg class="report-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
    </div>
  </div>
  <app-report-suggestion-modal *ngIf="showReportModal"
    (submitted)="handleReportSubmit($event)"
    (closed)="closeReportModal()">
  </app-report-suggestion-modal>
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
      margin-left: auto;
    }

    .features-btn {
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
      min-width: 26px;
      color: #7c3aed;
    }

    .features-btn:hover {
      border-color: #7c3aed;
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.2);
      transform: translateY(-1px);
    }

    .features-btn svg {
      width: 14px;
      height: 14px;
      transition: transform 0.3s ease;
    }

    .features-btn:hover svg {
      transform: scale(1.15);
    }

    .report-btn {
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
      min-width: 26px;
      color: #0f172a;
    }

    .report-btn:hover {
      border-color: #3b82f6;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
      transform: translateY(-1px);
    }

    .report-icon {
      width: 14px;
      height: 14px;
      color: #0f172a;
      transition: transform 0.3s ease;
    }

    .report-btn:hover .report-icon {
      transform: scale(1.15);
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

    :host-context(.dark-theme) .report-btn {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border-color: #475569;
      color: #e2e8f0;
    }

    :host-context(.dark-theme) .report-btn:hover {
      border-color: #60a5fa;
      box-shadow: 0 4px 15px rgba(96, 165, 250, 0.25);
    }

    :host-context(.dark-theme) .report-icon {
      color: #93c5fd;
    }

    :host-context(.dark-theme) .features-btn {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border-color: #475569;
      color: #a78bfa;
    }

    :host-context(.dark-theme) .features-btn:hover {
      border-color: #a78bfa;
      box-shadow: 0 4px 15px rgba(167, 139, 250, 0.25);
    }
  `]
})
export class HeaderComponent implements OnInit {

  constructor(
    private http: HttpClient,
    private router: Router,
    @Inject('MSAL_INSTANCE') private msal: PublicClientApplication
  ) {}

  isDarkTheme = false;
  showReportModal = false;

  ngOnInit(): void {
    this.initTheme();
  }

  toggleTheme(): void {
    this.isDarkTheme = !this.isDarkTheme;
    this.applyTheme(this.isDarkTheme);
  }

  openReportModal() {
    this.showReportModal = true;
  }

  openFeatures() {
    this.router.navigate(['/features']);
  }

  closeReportModal() {
    this.showReportModal = false;
  }

  async handleReportSubmit(event: { content: string; includeName: boolean }) {
    try {
      await firstValueFrom(this.http.post('/api/feedback/report', {
        content: event.content,
        includeName: event.includeName
      }));

      alert('Thank you. Your report/suggestion has been sent.');
      this.closeReportModal();
    } catch (error) {
      console.error('Failed to send report/suggestion:', error);
      alert('Unable to send report right now. Please try again.');
    }
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