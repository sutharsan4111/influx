import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { MsalService } from '../services/msal.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-page">
      <div class="login-container">
        <div class="login-card">
          <div class="logo-container">
            <img src="assets/MuraaiLogo.png" class="logo" alt="Muraai Logo" />
          </div>
          <h1 class="login-title">Login to Muraai ITSM</h1>
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="login-form">
            <div class="form-group">
              <label for="username">UserName / Email</label>
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
            <div *ngIf="error" class="error-message">
              {{ error }}
            </div>
            <button type="submit" class="btn login-btn">
              Login
            </button>
          </form>
          <div class="divider">
            <span>or</span>
          </div>
          <button
            class="btn microsoft-btn"
            (click)="loginWithMicrosoft()"
            [disabled]="!msalReady"
          >
            <span>Login with Microsoft</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* Page Container */
    .login-page {
      width: 100%;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      background: url('/assets/BackgroundLogin.png') center/cover no-repeat;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      padding: 20px;
    }

    .login-container {
      width: 100%;
      max-width: 360px;
    }

    /* Card */
    .login-card {
      background: rgba(255, 255, 255, 0.67);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    /* Logo */
    .logo-container {
      text-align: center;
      margin-bottom: 16px;
    }

    .logo {
      max-width: 120px;
      height: auto;
      object-fit: contain;
    }

    /* Title */
    .login-title {
      font-size: 18px;
      font-weight: 600;
      color: #1a202c;
      margin: 0 0 18px 0;
      text-align: center;
    }

    /* Form */
    .login-form {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .form-group {
      display: flex;
      text-color: #000000;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      font-weight: 500;
      text-color: #000000;
      color: #000000;
      margin-bottom: 2px;
    }

    .form-input {
      width: 100%;
      padding: 8px 12px;
      border: 2px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      color: #2d3748;
      transition: all 0.2s;
      box-sizing: border-box;
    }

    .form-input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .form-input::placeholder {
      color: #a0aec0;
    }

    /* Error Message */
    .error-message {
      font-size: 14px;
      color: #e53e3e;
      background: #fff5f5;
      padding: 12px 16px;
      border-radius: 8px;
      border-left: 4px solid #e53e3e;
    }

    /* Buttons */
    .btn {
      width: 100%;
      padding: 10px 16px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
      box-sizing: border-box;
    }

    .login-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      margin-top: 8px;
    }

    .login-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }

    .microsoft-btn {
      background: #ffffff;
      color: #2d3748;
      border: 2px solid #e2e8f0;
    }

    .microsoft-btn:hover:not(:disabled) {
      background: #f7fafc;
      border-color: #cbd5e0;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .btn:disabled {
      background: #e2e8f0;
      color: #a0aec0;
      cursor: not-allowed;
      transform: none;
    }

    /* Divider */
    .divider {
      width: 100%;
      margin: 16px 0;
      text-align: center;
      position: relative;
      color: #4a5568;
      font-size: 12px;
      font-weight: 500;
    }

    .divider::before,
    .divider::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 42%;
      height: 1px;
      background: rgba(74, 85, 104, 0.25);
    } 

    .divider::before { left: 0; }
    .divider::after { right: 0; }

    .divider span {
      background: rgba(255, 255, 255, 0.92);
      padding: 2px 12px;
      border-radius: 999px;
      border: 1px solid rgba(74, 85, 104, 0.15);
      position: relative;
      z-index: 1;
    }
  `]
})
export class LoginComponent implements OnInit {

  error = '';
  msalReady = false;

  loginForm = this.fb.group({
    username: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private msalService: MsalService
  ) {}

  async ngOnInit() {
    try {
      await this.msalService.ensureInitialized();
      this.msalReady = true;
    } catch {
      this.error = 'Authentication service unavailable';
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
      sessionStorage.setItem('username', data.email);

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
      sessionStorage.setItem('username', email);

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