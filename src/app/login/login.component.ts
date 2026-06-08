import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { MsalService } from '../services/msal.service';
import { ReportSuggestionModalComponent } from '../header/report-suggestion-modal.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ReportSuggestionModalComponent],
  template: `
    <div class="login-page">
      <button
        class="support-fab"
        type="button"
        (click)="openReportModal()"
        title="Support / Report Issue"
        aria-label="Support or report issue"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>

      <div class="login-shell">
        <section class="hero-panel" aria-label="Application introduction">
          <img src="assets/MuraaiLogo.png" class="logo" alt="Muraai Logo" />
          <h1 class="hero-title">Influx built for faster support execution</h1>
          <p class="hero-subtitle">
            Centralize ticket ownership, reduce response delays, and keep operational visibility in one place.
          </p>

          <div class="hero-points">
            <div class="point">Smart ticket assignment and tracking</div>
            <div class="point">SLA-focused monitoring and lifecycle control</div>
            <div class="point">Secure sign-in and access management</div>
          </div>
        </section>

        <section class="login-card" aria-label="Sign in form">
          <div class="card-head">
            <h2 class="login-title">Welcome back</h2>
            <p class="login-note">Sign in with your organization account to continue.</p>
          </div>

          <button
            class="btn microsoft-btn primary"
            (click)="loginWithMicrosoft()"
            [disabled]="!msalReady"
          >
            <span class="ms-icon" aria-hidden="true">
              <span></span><span></span><span></span><span></span>
            </span>
            <span>Continue with Microsoft</span>
          </button>

          <button
            class="btn local-toggle-btn"
            type="button"
            (click)="toggleLocalLogin()"
          >
            {{ showLocalLogin ? 'Hide local sign in' : 'Use local user sign in' }}
          </button>

          <form *ngIf="showLocalLogin" [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="login-form">
            <div class="form-group">
              <label for="username">Username / Email</label>
              <input
                id="username"
                type="email"
                placeholder="Enter your username / email"
                formControlName="username"
                class="form-input"
              />
            </div>
            <div class="form-group">
              <label for="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Enter your password"
                formControlName="password"
                class="form-input"
              />
            </div>
            <button type="submit" class="btn login-btn">
              Sign in
            </button>
          </form>

          <div *ngIf="error" class="error-message">
            {{ error }}
          </div>
        </section>
      </div>

      <app-report-suggestion-modal *ngIf="showReportModal"
        (submitted)="handleReportSubmit($event)"
        (closed)="closeReportModal()">
      </app-report-suggestion-modal>
    </div>
  `,
  styles: [`
    .login-page {
      width: 100%;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      position: relative;
      background:
        radial-gradient(900px circle at 0% 0%, rgba(56, 189, 248, 0.14), transparent 46%),
        radial-gradient(900px circle at 100% 100%, rgba(59, 130, 246, 0.12), transparent 44%),
        linear-gradient(180deg, #f8fafc 0%, #f3f6fb 100%);
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      padding: 24px;
    }

    .support-fab {
      position: fixed;
      right: 24px;
      bottom: 24px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1px solid #bfdbfe;
      background: linear-gradient(145deg, #eff6ff 0%, #dbeafe 100%);
      color: #1e3a8a;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 1100;
      box-shadow: 0 10px 20px rgba(30, 58, 138, 0.22);
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }

    .support-fab svg {
      width: 20px;
      height: 20px;
    }

    .support-fab:hover {
      transform: translateY(-2px);
      border-color: #93c5fd;
      box-shadow: 0 14px 24px rgba(30, 58, 138, 0.28);
    }

    .login-shell {
      width: 100%;
      max-width: 1120px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
      align-items: stretch;
    }

    .hero-panel {
      background: linear-gradient(145deg, #0f172a 0%, #1e3a8a 100%);
      border-radius: 20px;
      padding: 34px;
      min-height: 520px;
      color: #e2e8f0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      overflow: hidden;
      box-shadow: 0 18px 35px rgba(15, 23, 42, 0.22);
    }

    .hero-panel::after {
      content: '';
      position: absolute;
      width: 300px;
      height: 300px;
      right: -90px;
      bottom: -120px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.25), rgba(56, 189, 248, 0));
      pointer-events: none;
    }

    .hero-title {
      margin: 20px 0 10px;
      font-size: 34px;
      line-height: 1.16;
      letter-spacing: -0.3px;
      font-weight: 700;
      max-width: none;
    }

    .hero-subtitle {
      margin: 0;
      font-size: 16px;
      line-height: 1.5;
      color: #cbd5e1;
      max-width: none;
    }

    .hero-points {
      margin-top: 20px;
      display: grid;
      gap: 8px;
      width: 100%;
      max-width: none;
    }

    .point {
      font-size: 13px;
      font-weight: 600;
      color: #dbeafe;
      padding: 10px 12px;
      background: rgba(148, 163, 184, 0.14);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 10px;
    }

    .login-card {
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 20px;
      box-shadow: 0 16px 34px rgba(15, 23, 42, 0.1);
      padding: 30px 26px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 12px;
    }

    .card-head {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      margin-bottom: 10px;
    }

    .logo {
      max-width: 108px;
      height: auto;
      z-index: 1;
    }

    .login-title {
      font-size: 30px;
      font-weight: 700;
      letter-spacing: -0.35px;
      color: #111827;
      margin: 0;
      line-height: 1.15;
    }

    .login-note {
      margin: 0;
      color: #6b7280;
      font-size: 14px;
      line-height: 1.45;
    }

    .login-form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 4px;
      padding-top: 14px;
      border-top: 1px solid #eceff3;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      font-weight: 600;
      color: #4b5563;
      margin-bottom: 2px;
    }

    .form-input {
      width: 100%;
      padding: 12px 12px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      font-size: 13px;
      color: #111827;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      box-sizing: border-box;
      background: #fcfcfb;
    }

    .form-input:focus {
      outline: none;
      border-color: #9ca3af;
      box-shadow: 0 0 0 3px rgba(156, 163, 175, 0.16);
      background: #ffffff;
    }

    .form-input::placeholder {
      color: #94a3b8;
    }

    .error-message {
      font-size: 13px;
      color: #b91c1c;
      background: #fef2f2;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #fecaca;
    }

    .btn {
      width: 100%;
      padding: 12px 16px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-sizing: border-box;
      letter-spacing: 0.1px;
    }

    .microsoft-btn.primary {
      background: #0f172a;
      color: #ffffff;
      box-shadow: 0 8px 16px rgba(15, 23, 42, 0.2);
    }

    .microsoft-btn.primary:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 12px 20px rgba(15, 23, 42, 0.28);
    }

    .ms-icon {
      width: 18px;
      height: 18px;
      display: inline-flex;
      flex-wrap: wrap;
      gap: 1px;
    }

    .ms-icon span {
      width: 8px;
      height: 8px;
      border-radius: 2px;
      display: inline-block;
    }

    .ms-icon span:nth-child(1) { background: #f25022; }
    .ms-icon span:nth-child(2) { background: #7fba00; }
    .ms-icon span:nth-child(3) { background: #00a4ef; }
    .ms-icon span:nth-child(4) { background: #ffb900; }

    .local-toggle-btn {
      background: #ffffff;
      color: #4b5563;
      border: 1px solid #d1d5db;
    }

    .local-toggle-btn:hover {
      background: #f9fafb;
      border-color: #9ca3af;
    }

    .login-btn {
      background: #1f2937;
      color: #ffffff;
      margin-top: 2px;
    }

    .login-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 20px rgba(31, 41, 55, 0.24);
    }

    .btn:disabled {
      background: #e2e8f0;
      color: #a0aec0;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    @media (max-width: 960px) {
      .login-shell {
        grid-template-columns: 1fr;
        max-width: 520px;
      }

      .hero-panel {
        padding: 24px;
      }

      .hero-title {
        font-size: 24px;
      }

      .hero-points {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 520px) {
      .support-fab {
        right: 16px;
        bottom: 16px;
        width: 44px;
        height: 44px;
      }

      .login-card {
        padding: 20px;
      }

      .logo {
        max-width: 90px;
      }

      .login-title {
        font-size: 24px;
      }

      .hero-subtitle,
      .point,
      .login-note {
        font-size: 13px;
      }
    }
  `]
})
export class LoginComponent implements OnInit {

  error = '';
  msalReady = false;
  showLocalLogin = false;
  showReportModal = false;

  loginForm = this.fb.group({
    username: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private msalService: MsalService,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    try {
      await this.msalService.ensureInitialized();
      this.msalReady = true;
    } catch {
      this.error = 'Authentication service unavailable';
    }
  }

  toggleLocalLogin(): void {
    this.showLocalLogin = !this.showLocalLogin;
    this.error = '';
  }

  openReportModal(): void {
    this.showReportModal = true;
  }

  closeReportModal(): void {
    this.showReportModal = false;
  }

  async handleReportSubmit(event: { content: string; includeName: boolean }): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/feedback/report', {
        content: event.content,
        includeName: event.includeName
      }));

      alert('Thank you. Your report/suggestion has been sent.');
      this.closeReportModal();
    } catch (submitError) {
      console.error('Failed to send report/suggestion:', submitError);
      alert('Unable to send report right now. Please try again.');
    }
  }

  // 🔹 Local login (optional – keep if needed)
 onSubmit() {
  if (this.loginForm.invalid) {
    this.error = 'Please enter valid email and password';
    return;
  }

  const { username, password } = this.loginForm.value;

  fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: username,
      password: password
    })
  })
  .then(res => {
    return res.json();
  })
  .then(data => {
    if (data.accessToken) {
      sessionStorage.setItem('accessToken', data.accessToken);
      sessionStorage.setItem('refreshToken', data.refreshToken);
      sessionStorage.setItem('role', data.role);
      sessionStorage.setItem('roles', JSON.stringify(Array.isArray(data.roles) ? data.roles : [data.role || 'user']));
      sessionStorage.setItem('username', data.email);
      sessionStorage.setItem('isCloudOps', data.isCloudOps ? 'true' : 'false');

      this.router.navigate(['/dashboard']);
    } else {
      this.error = data.message || data.error || 'Login failed';
    }
  })
  .catch((error) => {
    this.error = 'Backend authentication failed: ' + error.message;
  });
}


  // ✅ Microsoft login (POPUP – NOT redirect)
async loginWithMicrosoft() {
  if (!this.msalReady) return;

  try {
    // 1️⃣ Microsoft Login
    await this.msalService.loginPopup([
      'openid',
      'profile',
      'email',
      'User.Read',
      'GroupMember.Read.All',
      'Group.Read.All'
    ]);

    // 2️⃣ Get active account
    const account = this.msalService.getActiveAccount();
    const email = account?.username;
    const displayName = account?.name || '';

    if (!email) {
      this.error = 'Unable to retrieve email';
      return;
    }

    // 3️⃣ Get Microsoft Access Token
    const accessToken = await this.msalService.getAccessToken([
      'User.Read',
      'GroupMember.Read.All',
      'Group.Read.All'
    ]);

    // 4️⃣ Send email + accessToken to backend
    const response = await fetch('/api/msal-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, accessToken })
    });

    const data = await response.json();

    if (data.accessToken) {
      sessionStorage.setItem('accessToken', data.accessToken);
      sessionStorage.setItem('refreshToken', data.refreshToken);
      sessionStorage.setItem('role', data.role);
      sessionStorage.setItem('roles', JSON.stringify(Array.isArray(data.roles) ? data.roles : [data.role || 'user']));
      sessionStorage.setItem('username', email);
      sessionStorage.setItem('displayName', displayName);

      this.router.navigate(['/dashboard']);
    } else {
      this.error = data.message || 'Backend authentication failed';
    }

  } catch (err) {
    console.error(err);
    this.error = 'Microsoft login failed';
  }
}


}